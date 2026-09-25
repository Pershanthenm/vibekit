import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { compareResponses } from './migration.js';
import { refuseUrl } from './netguard.js';

/**
 * The two ways `verify` puts real traffic through both systems. CLI Spec §2 (`verify --live`,
 * `verify --replay`).
 *
 * Shadow mode: a small proxy takes each request, sends it to the old system and the new one,
 * serves the old system's answer, and records where the new one disagreed. Only the old is
 * served — the new system is being measured, never trusted, until a person moves traffic to it.
 *
 * Replay: the same comparison over a recorded log instead of a live socket.
 *
 * Both go through the network guard: a person naming a private address says so with
 * --allow-private, exactly as every other command that fetches.
 */

/** One request to one system, as plain data. No redirects are followed: a redirect is an answer. */
export function send(base, request, { timeoutMs = 15_000 } = {}) {
  const url = new URL(request.path, base.endsWith('/') ? base : `${base}/`);
  const client = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const started = Date.now();
    const headers = { ...(request.headers ?? {}) };
    delete headers.host; delete headers.Host; delete headers['content-length'];
    const req = client(url, { method: request.method ?? 'GET', headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - started }));
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    req.on('error', (error) => resolve({ status: 0, headers: {}, body: '', error: error.message, ms: Date.now() - started }));
    if (request.body !== null && request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD') req.write(typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
    req.end();
  });
}

async function guard(urls, allowPrivate) {
  for (const url of urls) {
    const why = await refuseUrl(url, { allowPrivate });
    if (why) throw new Error(why);
  }
}

/** Replay a recorded log through both systems and return every difference, with what was sent. */
export async function replay(requests, { oldUrl, newUrl, allowPrivate = false, slice = null, sender = send }) {
  await guard([oldUrl, newUrl], allowPrivate);
  const found = [];
  const rows = [];
  for (const request of requests) {
    const [old, next] = await Promise.all([sender(oldUrl, request), sender(newUrl, request)]);
    const differences = compareResponses(request, old, next);
    rows.push({ request: `${request.method} ${request.path}`, old: old.status, new: next.status, oldMs: old.ms, newMs: next.ms, differences: differences.length, errors: [old.error, next.error].filter(Boolean) });
    for (const difference of differences) found.push({ ...difference, slice });
  }
  return { rows, found, sent: requests.length };
}

/**
 * Shadow mode. Listens locally; every request goes to both; the old system's answer is what the
 * caller gets. `onDifference` is called with each disagreement as it is found, so the command can
 * record it while the proxy keeps running.
 */
export async function shadow({ oldUrl, newUrl, port = 0, host = '127.0.0.1', allowPrivate = false, slice = null, onDifference = () => {}, sender = send }) {
  await guard([oldUrl, newUrl], allowPrivate);
  const seen = { requests: 0, differences: 0 };
  const server = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', async () => {
      const request = { method: incoming.method, path: incoming.url, headers: incoming.headers, body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null };
      seen.requests += 1;
      const [old, next] = await Promise.all([sender(oldUrl, request), sender(newUrl, request)]);
      for (const difference of compareResponses(request, old, next)) {
        seen.differences += 1;
        await Promise.resolve(onDifference({ ...difference, slice })).catch(() => {});
      }
      const headers = { ...(old.headers ?? {}) };
      delete headers['transfer-encoding']; delete headers['content-length'];
      outgoing.writeHead(old.status || 502, headers);
      outgoing.end(old.body ?? '');
    });
  });
  await new Promise((ready, fail) => { server.once('error', fail); server.listen(port, host, ready); });
  return {
    port: server.address().port,
    host,
    seen,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
