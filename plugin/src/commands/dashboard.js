import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { collectState, dashboardPath, renderDashboard } from '../dashboard.js';
import { BadRequest, Refused, apply } from '../control.js';
import { writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { collectProblems } from './check.js';
import { PING, POLL_MS, PREAMBLE, RETRY, fingerprint, laneLogs, readSince, secret, sse } from '../live.js';
import { renderWizard } from '../wizard-page.js';
import { collectScan } from '../scan.js';
import { MAX_BYTES, render as renderQr } from '../qr.js';
import { openTunnel } from '../tunnel.js';

/**
 * Hand a file to whatever the operating system uses to open it. Detached and unreferenced, so a
 * short-lived CLI command is never held open by the browser it just launched. Best-effort by
 * design: a machine with no browser, or a locked-down desktop, must not fail the job that
 * opened the page — the file is written either way.
 */
export function openInBrowser(path) {
  // Tests, CI and headless sessions still write the page; they must never launch a window.
  if (process.env.VIBEKIT_NO_OPEN === '1' || process.env.CI) return false;
  const [command, args] = process.platform === 'win32'
    // cmd's `start` takes an empty title first, or it treats a quoted path as the window title.
    ? [process.env.ComSpec || 'cmd', ['/c', 'start', '', path]]
    : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

// --out is the user asking for a copy somewhere specific; everything else stays out of the tree.
const pathFor = (root, out) => (out ? (isAbsolute(out) ? out : resolve(root, out)) : dashboardPath(root));

/**
 * Render the current lifecycle to a file and return where it landed. Long-running commands call
 * this as they start and again as they finish, so an already-open page catches up on its next
 * refresh without anything having to talk to the browser.
 */
export async function writeDashboard(root, project, { out, setup = null, live = true, problems } = {}) {
  const path = pathFor(root, out);
  const found = problems ?? await collectProblems(root, project).catch(() => []);
  const state = await collectState(root, project, { setup, problems: found });
  await writeText(path, renderDashboard(state, { live }));
  return { path, state };
}

// Reopening on every refresh would fight the user for focus, so each path is opened once per run.
const opened = new Set();

/**
 * Write the page and open it the first time only. Never throws: a dashboard that cannot be shown
 * is not a reason for the work it was reporting on to stop.
 */
export async function openDashboard(root, project, options = {}) {
  try {
    const { path } = await writeDashboard(root, project, options);
    if (!opened.has(path)) {
      opened.add(path);
      openInBrowser(path);
      console.log(`  ↗ live status: ${path}`);
    }
    return path;
  } catch {
    return null;
  }
}

// The written page refreshes itself, but nothing regenerates it in the background — it is only
// rewritten while a long command happens to be running. Serving closes that gap by rendering on
// every request, which is also less machinery than watching the filesystem: no watcher, no
// debounce, no rewrites, and no stale file to go out of date.
export const DEFAULT_PORT = 7332;

/** The page shown when the project cannot be read, so one bad edit does not kill the server. */
const errorPage = (message) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Dashboard — waiting</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0b0a;color:#f4f5f2;
font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
div{max-width:38rem;padding:24px}h1{font-size:17px;margin:0 0 8px}
p{color:#9ea19a;margin:0 0 6px}code{color:#b6f24a}</style></head>
<body><div><h1>Waiting for a readable project</h1>
<p>${message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</p>
<p>This page retries every 5 seconds. Fix it with <code>vibekit check</code>.</p></div></body></html>`;

/**
 * Serve the dashboard, rendering current state on every request. Returns the server so a caller —
 * or a test — can close it. Binds to loopback unless told otherwise: the page carries feature
 * titles and blocker text that quote file paths and review comments, and that is not something to
 * put on a shared network by accident.
 */
export async function serveDashboard(root, { port = DEFAULT_PORT, host = '127.0.0.1', path = secret(), token = secret(), open: openWith = openTunnel } = {}) {
  const prefix = `/${path}`;
  const control = `${prefix}/do`;
  const scanFeed = `${prefix}/scan.json`;
  const stateFeed = `${prefix}/state.json`;
  const logsFeed = `${prefix}/logs.json`;
  const clients = new Set();
  const offsets = new Map();
  let fingerprinted = null;
  let timer = null;

  const broadcast = (frame) => {
    for (const client of clients) client.write(frame);
  };

  // --- The way in from outside ---------------------------------------------------------------
  //
  // The server owns the tunnel rather than the command that started it, because the point is to be
  // able to put the tunnel away without putting the console away. Stopping it leaves everything on
  // this machine running; starting it again asks Cloudflare for a fresh hostname, so a link you
  // said stop to stays stopped.
  let opened = null;
  let tunnelState = { open: false, url: null, reach: null, since: null, error: null, busy: false };
  const tunnelStatus = () => ({ ...tunnelState });

  const startTunnel = async () => {
    if (opened || tunnelState.busy) return tunnelStatus();
    tunnelState = { ...tunnelState, busy: true, error: null };
    try {
      opened = await openWith(server.address().port);
      // The tunnel reaches the whole server, so the secret path still decides what is reachable:
      // the public hostname on its own lands on the same bare 404 as any other wrong path.
      tunnelState = { open: true, url: opened.url, reach: `${opened.url}${prefix}/`, since: new Date().toISOString(), error: null, busy: false };
    } catch (error) {
      opened = null;
      tunnelState = { open: false, url: null, reach: null, since: null, error: error?.message ?? 'The tunnel could not be opened.', busy: false };
    }
    return tunnelStatus();
  };

  const stopTunnel = async () => {
    if (opened) opened.close();
    opened = null;
    tunnelState = { open: false, url: null, reach: null, since: null, error: null, busy: false };
    return tunnelStatus();
  };

  const tunnel = { status: tunnelStatus, start: startTunnel, stop: stopTunnel };

  const currentState = async () => {
    const project = await loadProject(root);
    const problems = await collectProblems(root, project).catch(() => []);
    return collectState(root, project, { problems, tunnel: tunnelStatus() });
  };

  // The scan walks every spec, every recorded run and every document, so it is read when a page is
  // served or asks for it — never on the one-second tick that keeps the lifecycle current.
  const currentScan = async () => collectScan(root, await loadProject(root));

  // One pass: has anything the page shows changed, and has any lane written a new line?
  async function tick() {
    let state;
    try {
      state = await currentState();
      fingerprinted = fingerprint(state);
    } catch {
      // An unreadable project is already reported by the page itself; the stream stays up.
      return;
    }
    if (fingerprinted !== tick.last) {
      tick.last = fingerprinted;
      // The state travels with the event: the page re-renders from it rather than refetching the
      // whole document and swapping nodes, which loses focus, scroll and any open menu.
      broadcast(sse('state', state));
    }
    for (const log of await laneLogs(root).catch(() => [])) {
      const chunk = await readSince(log.path, offsets.get(log.id) ?? 0).catch(() => null);
      if (!chunk) continue;
      offsets.set(log.id, chunk.offset);
      if (chunk.text) broadcast(sse('log', { id: log.id, lane: log.lane, feature: log.feature, offset: chunk.offset, text: chunk.text }));
    }
  }

  /**
   * One pass at a time, with the gap measured from the end of the last one rather than its start.
   *
   * An interval would start a new pass whether or not the previous had finished, and a pass is not
   * free: it reads every spec, every recorded run and the state of the repository. On a project
   * where that takes longer than the gap, the passes pile up until the process cannot answer a
   * request at all — which is exactly what a phone on a tunnel is waiting for it to do.
   *
   * Only runs while someone is watching, and never holds the process open.
   */
  function watching(active) {
    if (active && !timer) {
      const again = () => {
        if (!timer) return;
        timer = setTimeout(() => { tick().catch(() => {}).then(again); }, POLL_MS);
        timer.unref();
      };
      timer = setTimeout(() => {}, 0);
      timer.unref();
      again();
    }
    if (!active && timer && clients.size === 0) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // A page opened after a lane started would otherwise show an empty console until the next line.
  async function backlog(response) {
    for (const log of await laneLogs(root).catch(() => [])) {
      const seen = offsets.get(log.id);
      const chunk = await readSince(log.path, seen ?? 0).catch(() => null);
      if (!chunk?.text) continue;
      if (seen === undefined) offsets.set(log.id, chunk.offset);
      response.write(sse('log', { id: log.id, lane: log.lane, feature: log.feature, offset: chunk.offset, text: chunk.text }));
    }
  }

  function stream(request, response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform` is the part that makes this work through a tunnel. Cloudflare compresses
      // text responses, and compressing a stream means buffering it — with it absent, a phone
      // gets the headers and then nothing at all, for as long as the build runs. `X-Accel-
      // Buffering` says the same thing to nginx. Both were verified against a real quick tunnel.
      'Cache-Control': 'no-store, no-transform',
      'Content-Encoding': 'identity',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Referrer-Policy': 'no-referrer',
    });
    response.write(PREAMBLE);
    response.write(RETRY);
    // A real event, immediately. `onopen` fires when the headers arrive, which happens even when
    // a proxy is holding the body back — so the page cannot tell a working stream from a buffered
    // one without something it can actually receive. This is that something.
    response.write(sse('ready', { at: Date.now() }));
    clients.add(response);
    watching(true);
    backlog(response).catch(() => {});
    // Idle connections are closed by tunnels and phone radios alike; a comment keeps them open.
    const ping = setInterval(() => response.write(PING), 20000).unref();
    const drop = () => {
      clearInterval(ping);
      clients.delete(response);
      watching(false);
    };
    request.on('close', drop);
    response.on('error', drop);
  }

  /**
   * Any page this server serves, with the headers that keep it private. The path is the only
   * thing standing between this and a stranger, so it must not travel: no referrer, no indexing.
   * The page loads nothing but the font stylesheet, so nothing else can leak it either.
   */
  const page = (response, status, body) => {
    response.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      // No caching: the whole point is that a request shows what is true now.
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
    });
    response.end(body);
  };

  const json = (response, status, body) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  };

  /**
   * Compare without leaking how much of the token was right. Lengths differing is itself an
   * answer, so that is checked first and separately — both operands must be the same size.
   */
  const authorised = (header) => {
    const offered = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
    const a = Buffer.from(offered);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // At most 16KB: every action here is a few short fields, and a socket that keeps sending is
  // not a request, it is a way to fill memory.
  const readBody = (request) => new Promise((done, failed) => {
    let text = '';
    request.on('data', (chunk) => {
      text += chunk;
      if (text.length > 16384) {
        failed(new BadRequest('That request is too big.'));
        request.destroy();
      }
    });
    request.on('end', () => done(text));
    request.on('error', failed);
  });

  /**
   * The one way the page can change anything. The token is separate from the path on purpose:
   * the URL leaks through history, screenshots and link previews, so finding the console must
   * not be the same as being able to drive it.
   */
  async function command(request, response) {
    if (request.method !== 'POST') return json(response, 405, { error: 'Use POST.' });
    if (!authorised(request.headers.authorization)) return json(response, 401, { error: 'A write token is required.' });
    // A cross-site form cannot set this header, so requiring it keeps one off the endpoint.
    if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) {
      return json(response, 415, { error: 'Send application/json.' });
    }
    try {
      const body = JSON.parse(await readBody(request) || '{}');
      // A project that cannot be read yet is not a reason to refuse: the wizard's whole job is
      // to produce the answers that create one. Actions needing a project load it themselves.
      const project = await loadProject(root).catch(() => null);
      const result = await apply(root, project, body, { tunnel });
      return json(response, 200, { ok: true, result: result ?? null, state: await currentState().catch(() => null) });
    } catch (error) {
      const status = error instanceof BadRequest ? 400 : error instanceof Refused ? 409 : 500;
      // The refusal comes back with the truth beside it, so a page that drew an optimistic move
      // has something honest to redraw from.
      const state = await currentState().catch(() => null);
      return json(response, status, { error: error?.message ?? 'That did not work.', state });
    }
  }

  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === `${prefix}/events`) return stream(request, response);
    if (pathname === control) return command(request, response);
    // The same two things the stream carries, as plain requests. A proxy that buffers a streaming
    // response — Cloudflare's quick tunnels do — leaves the page connected and silent, so it falls
    // back to asking for these instead. Reads, so the link is the only thing they need.
    if (pathname === stateFeed) {
      try {
        return json(response, 200, await currentState());
      } catch (error) {
        return json(response, 503, { error: error?.message ?? 'the project could not be read' });
      }
    }
    if (pathname === logsFeed) {
      const asked = new URL(request.url, 'http://localhost').searchParams.get('offsets') ?? '{}';
      let known = {};
      // A malformed or oversized parameter is treated as "I know nothing", which is safe: the
      // reply is then the tail of each log rather than an error the page cannot act on.
      if (asked.length <= 8192) { try { known = JSON.parse(asked); } catch { known = {}; } }
      const chunks = [];
      for (const log of await laneLogs(root).catch(() => [])) {
        const at = Number.isFinite(known[log.id]) ? known[log.id] : undefined;
        const chunk = await readSince(log.path, at ?? 0).catch(() => null);
        if (!chunk) continue;
        chunks.push({ id: log.id, lane: log.lane, feature: log.feature, offset: chunk.offset, text: chunk.text });
      }
      return json(response, 200, { logs: chunks });
    }
    // Reading the scan is what the link already grants; only running its fixes needs the token.
    if (pathname === scanFeed) {
      try {
        return json(response, 200, await currentScan());
      } catch (error) {
        return json(response, 503, { error: error?.message ?? 'the project could not be read' });
      }
    }
    // The wizard rides the same server, and therefore the same tunnel and the same secret path:
    // one link reaches both, and the form can hand its answers straight back with no CORS, no
    // second token and nothing for the user to copy between windows.
    if (pathname === `${prefix}/wizard` || pathname === `${prefix}/wizard/`) {
      const project = await loadProject(root).catch(() => null);
      return page(response, 200, renderWizard({ projectName: project?.project?.name ?? '', control }));
    }
    if (pathname !== prefix && pathname !== `${prefix}/`) {
      // No hint that anything is here: a wrong path is a wrong path, whatever it was reaching for.
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end('Not found');
    }

    try {
      const [state, scan] = await Promise.all([currentState(), currentScan().catch(() => null)]);
      return page(response, 200, renderDashboard(state, { live: true, stream: true, control, scan, scanUrl: scanFeed }));
    } catch (error) {
      return page(response, 503, errorPage(error?.message ?? 'the project could not be read'));
    }
  });

  await new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen(port, host, () => { server.removeListener('error', failed); ready(); });
  });

  const actual = server.address();
  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual.port}${prefix}/`,
    port: actual.port,
    path,
    token,
    control,
    tunnel,
    close: () => new Promise((closed) => {
      if (timer) clearInterval(timer);
      if (opened) opened.close();
      opened = null;
      for (const client of clients) client.end();
      clients.clear();
      server.close(closed);
    }),
  };
}

// --static drops the meta-refresh, for a copy that is going somewhere other than a local browser.
export async function dashboard({ root, out, json, open, static: isStatic, serve, port, host, tunnel }) {
  if (serve) {
    const requested = port ? Number(port) : DEFAULT_PORT;
    if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
      console.error(`✖ --port must be a number between 0 and 65535, not "${port}".`);
      process.exitCode = 1;
      return;
    }
    const lan = host === '0.0.0.0';
    let server;
    try {
      server = await serveDashboard(root, { port: requested, host: lan ? '0.0.0.0' : '127.0.0.1' });
    } catch (error) {
      const busy = error?.code === 'EADDRINUSE';
      console.error(busy
        ? `✖ Port ${requested} is already in use. Choose another with --port, or stop what is on it.`
        : `✖ Could not start the dashboard server: ${error?.message ?? error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Live console on ${server.url}`);
    console.log('  Updates as the work happens: task ticks, lane output, test runs. Ctrl-C to stop.');
    console.log('  The path is random and changes every start, so an old link stops working.');
    console.log(`  Spec wizard on ${server.url}wizard`);
    console.log(`\n  Write token: ${server.token}`);
    console.log('  The page asks for this the first time you change something, and keeps it in that');
    console.log('  browser. Reading needs only the link; changing the project needs this as well.');
    if (lan) console.log('\n  Bound to every interface on this network — it carries your feature titles and blockers.');

    // Closed with the console either way, so a tunnel never outlives the thing it points at.
    const shut = () => { server.tunnel.stop(); process.exit(0); };
    process.once('SIGINT', shut);
    process.once('SIGTERM', shut);

    if (tunnel) {
      const state = await server.tunnel.start();
      if (state.error) {
        console.error(`\n✖ No tunnel: ${state.error}`);
        console.error('  The console is still running on this machine, at the address above.');
      } else {
        console.log(`\n  On your phone: ${state.reach}`);
        console.log(`  Spec wizard:   ${state.reach}wizard`);
        // Nobody types a random 32-character path into a phone twice. Point a camera at this
        // instead. Too long to encode is not worth an error: the address above still works.
        if (state.reach.length <= MAX_BYTES) {
          console.log('');
          console.log(renderQr(state.reach));
        }
        console.log('\n  ! That hostname is public while it is open. The random path is what keeps the page');
        console.log('    private, and the write token is what stops a reader changing anything.');
        console.log('    Done for now? Turn the tunnel off on the Overview page — the console keeps');
        console.log('    running, and turning it back on gets a fresh address.');
      }
    } else {
      console.log('\n  To reach it from a phone: vibekit dashboard --serve --tunnel');
      console.log('  Or turn one on from the Overview page once the console is open.');
    }
    if (open) openInBrowser(server.url);
    return;
  }

  const project = await loadProject(root);
  const problems = await collectProblems(root, project).catch(() => []);
  if (json) {
    console.log(JSON.stringify(await collectState(root, project, { problems }), null, 2));
    return;
  }
  const { path, state } = await writeDashboard(root, project, { out, live: !isStatic, problems });
  const blocked = state.features.flatMap((feature) => feature.gates.filter((gate) => gate.state === 'blocked'));
  console.log(`Wrote ${path}`);
  console.log(`  ${state.features.length} feature(s) · ${blocked.length} blocked gate(s)${state.next ? ` · next: ${state.next.step}` : ''}`);
  if (open) openInBrowser(path);
}
