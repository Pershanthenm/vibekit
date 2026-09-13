import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/cli.js';
import { serveDashboard } from '../src/commands/dashboard.js';
import { worktreeBase } from '../src/git.js';
import { fingerprint, readSince, secret } from '../src/live.js';
import { gitInit, newProject, tempDir } from './helpers.js';

console.log = () => {};

const open = [];
const serve = async (root, options = {}) => {
  const server = await serveDashboard(root, { port: 0, ...options });
  open.push(server);
  return server;
};
after(() => Promise.all(open.map((server) => server.close())));

const get = async (url) => {
  const response = await fetch(url);
  return { status: response.status, body: await response.text(), headers: response.headers };
};

/**
 * Collect server-sent events until `wanted` is satisfied, or give up. The budget is generous
 * because the event being waited for usually follows a real `vibecheck` command scaffolding real
 * files, and on a loaded machine running the whole suite at once that is not quick.
 */
async function events(url, wanted, ms = 60000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  const collected = [];
  try {
    const response = await fetch(url, { signal: abort.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!abort.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const type = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (type) collected.push({ type, data: data ? JSON.parse(data) : null });
      }
      if (wanted(collected)) break;
    }
  } catch {
    // An abort is how a stream that never satisfies `wanted` ends; the assertions report it.
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  return collected;
}

// --- The secret path ---

test('a secret is 192 bits of url-safe randomness, and never repeats', () => {
  const one = secret();

  assert.match(one, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(one, secret());
});

test('the console is served only under its secret path', async () => {
  const root = await newProject('--yes');
  const { url, port, path } = await serve(root);

  assert.ok(url.endsWith(`/${path}/`), 'the url carries the path, so it can be opened as given');
  assert.equal((await get(url)).status, 200);

  const base = `http://127.0.0.1:${port}`;
  for (const wrong of ['/', '/dashboard', `/${secret()}/`, `/${path}x/`]) {
    const miss = await get(base + wrong);
    assert.equal(miss.status, 404, `${wrong} must not be served`);
    assert.doesNotMatch(miss.body, /vibecheck|dashboard|lifecycle/i, 'a 404 must not hint that anything is here');
  }
});

test('each start gets a different path, so an old link stops working', async () => {
  const root = await newProject('--yes');
  const first = await serve(root);
  const second = await serve(root);

  assert.notEqual(first.path, second.path);
  assert.equal((await get(`http://127.0.0.1:${second.port}/${first.path}/`)).status, 404);
});

// --- Headers: the path is the only thing keeping the page private, so it must not travel ---

test('the page tells browsers not to leak or index it', async () => {
  const root = await newProject('--yes');
  const { headers } = await get((await serve(root)).url);

  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.match(headers.get('x-robots-tag'), /noindex/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.match(headers.get('cache-control'), /no-store/);
  assert.match(headers.get('content-security-policy'), /default-src 'none'/);
});

// --- Live updates ---

test('the served page streams instead of reloading itself', async () => {
  const root = await newProject('--yes');
  const { body } = await get((await serve(root)).url);

  assert.doesNotMatch(body, /http-equiv="refresh"/, 'a meta-refresh loses the scroll position');
  assert.match(body, /new EventSource/);
});

test('a change to the project reaches an open stream', async () => {
  const root = await newProject('--yes');
  const { url } = await serve(root);

  const streamed = events(`${url}events`, (all) => all.some((event) => event.type === 'state'));
  // Made after the stream is listening, so the event is a change and not the initial state.
  setTimeout(() => { run(['feature', '--dir', root, 'Device register']).catch(() => {}); }, 300);

  assert.ok((await streamed).some((event) => event.type === 'state'), 'adding a feature must reach the page');
});

// The fingerprint is what decides whether to push, so a moving clock must not look like a change.
test('a state that only differs by its timestamp is not a change', () => {
  const state = { project: { name: 'X', generatedAt: '2026-01-01T00:00:00.000Z' }, features: [] };
  const later = { project: { name: 'X', generatedAt: '2026-09-12T11:00:00.000Z' }, features: [] };
  const changed = { project: { name: 'X', generatedAt: '2026-01-01T00:00:00.000Z' }, features: [{ id: '001' }] };

  assert.equal(fingerprint(state), fingerprint(later));
  assert.notEqual(fingerprint(state), fingerprint(changed));
});

// --- Lane output ---

test('reading a log returns its tail first, then only what is new', async () => {
  const path = join(tempDir('vc-log-'), 'lane.log');
  writeFileSync(path, 'first\n');

  const start = await readSince(path, 0);
  assert.equal(start.text, 'first\n');

  const nothing = await readSince(path, start.offset);
  assert.equal(nothing.text, '', 'nothing new means nothing sent');

  appendFileSync(path, 'second\n');
  assert.equal((await readSince(path, start.offset)).text, 'second\n', 'only the new bytes');
});

test('a log replaced by a shorter one starts again rather than reporting nonsense', async () => {
  const path = join(tempDir('vc-log-'), 'lane.log');
  writeFileSync(path, 'a long first run\n');
  const { offset } = await readSince(path, 0);

  writeFileSync(path, 'redispatched\n');
  assert.equal((await readSince(path, offset)).text, 'redispatched\n');
});

test('a log that does not exist is not an error', async () => {
  assert.equal(await readSince(join(tempDir('vc-log-'), 'missing.log'), 0), null);
});

test('lane output reaches the page as an agent writes it', async () => {
  const root = await newProject('--yes');
  gitInit(root);
  await run(['feature', '--dir', root, 'Shared list']);

  const base = worktreeBase(root);
  mkdirSync(base, { recursive: true });
  const logPath = join(base, 'api.log');
  writeFileSync(logPath, 'installing dependencies\n');
  writeFileSync(join(base, '001-shared-list.json'), JSON.stringify({ feature: '001-shared-list', lanes: [{ name: 'api', logPath }] }));

  const { url } = await serve(root);
  const streamed = events(`${url}events`, (all) => all.some((event) => event.type === 'log' && /compiling/.test(event.data.text)));
  setTimeout(() => appendFileSync(logPath, 'compiling\n'), 400);

  const logs = (await streamed).filter((event) => event.type === 'log');
  const text = logs.map((event) => event.data.text).join('');
  assert.ok(logs.length, 'the console must receive lane output');
  assert.equal(logs[0].data.lane, 'api');
  assert.match(text, /installing dependencies/, 'a page opened late still sees the tail');
  assert.match(text, /compiling/, 'and everything written after it');
});
