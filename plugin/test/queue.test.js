// Queueing is the instruction to build something, so these are mostly tests about restraint:
// what the queue refuses to start twice, what it refuses to take away mid-flight, and that the
// thing it eventually runs is `vibecheck dispatch` and not a private reimplementation of it.
//
// The drain is driven with an injected runner throughout. Spawning real agents here would make
// the suite depend on a Claude or Cursor CLI being installed and on the network; what matters is
// the order entries run in and the states they pass through.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { run } from '../src/cli.js';
import { serveDashboard } from '../src/commands/dashboard.js';
import { clearQueue, drain, enqueue, readQueue, remove } from '../src/queue.js';
import { EXAMPLE, newProject } from './helpers.js';

console.log = () => {};

const open = [];
after(() => Promise.all(open.map((server) => server.close())));

const serve = async (root) => {
  const server = await serveDashboard(root, { port: 0 });
  open.push(server);
  return server;
};

const post = (server, body, token = server.token) => fetch(`http://127.0.0.1:${server.port}${server.control}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

const withFeature = async () => {
  const root = await newProject('--from', EXAMPLE);
  await run(['feature', '--dir', root, 'Shared shopping list']);
  return root;
};

/** Wait for an entry to reach a state, rather than guessing how long the drain takes to start. */
const waitFor = async (root, id, state) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = (await readQueue(root)).entries.find((entry) => entry.id === id);
    if (found?.state === state) return found;
    await new Promise((settled) => setTimeout(settled, 20));
  }
  throw new Error(`${id} never reached ${state}`);
};

// A runner that records what it was asked to do instead of starting an agent.
const recorder = (codes = {}) => {
  const started = [];
  return {
    started,
    run: async (root, entry) => {
      started.push(entry.feature);
      return { code: codes[entry.feature] ?? 0, note: null };
    },
  };
};

// --- What goes in ---

test('a feature already waiting is not queued twice', async () => {
  const root = await newProject('--from', EXAMPLE);

  const first = await enqueue(root, { feature: '001-thing' });
  const second = await enqueue(root, { feature: '001-thing' });

  assert.equal(first.added, true);
  assert.equal(second.added, false, 'pressing the button again means "yes, I meant it"');
  assert.equal(second.entry.id, first.entry.id);
  assert.equal((await readQueue(root)).entries.length, 1);
});

test('the queue is kept outside the working tree, so queueing work never dirties the repo', async () => {
  const root = await newProject('--from', EXAMPLE);
  await enqueue(root, { feature: '001-thing' });

  const { stdout } = await import('node:child_process').then((cp) => cp.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }));
  assert.equal(stdout.trim(), '', 'nothing queued may show up as a change to commit');
});

// --- What comes out ---

test('entries run oldest first, and each passes through running on its way to finished', async () => {
  const root = await newProject('--from', EXAMPLE);
  await enqueue(root, { feature: 'first' });
  await enqueue(root, { feature: 'second' });
  const agent = recorder();

  await drain(root, { run: agent.run });

  assert.deepEqual(agent.started, ['first', 'second'], 'one at a time, in the order they were queued');
  const { entries } = await readQueue(root);
  assert.deepEqual(entries.map((entry) => entry.state), ['done', 'done']);
  assert.ok(entries.every((entry) => entry.startedAt && entry.finishedAt), 'and each records when it ran');
});

test('a dispatch that fails is reported as failed, and does not stop the rest of the queue', async () => {
  const root = await newProject('--from', EXAMPLE);
  await enqueue(root, { feature: 'broken' });
  await enqueue(root, { feature: 'fine' });
  const agent = recorder({ broken: 1 });

  await drain(root, { run: agent.run });

  const { entries } = await readQueue(root);
  assert.deepEqual(entries.map((entry) => entry.state), ['failed', 'done']);
  assert.equal(entries[0].exitCode, 1);
  assert.deepEqual(agent.started, ['broken', 'fine']);
});

test('queueing while a drain is running joins it rather than starting a second one', async () => {
  const root = await newProject('--from', EXAMPLE);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const started = [];
  const runner = async (_root, entry) => {
    started.push(entry.feature);
    if (entry.feature === 'slow') await held;
    return { code: 0, note: null };
  };

  await enqueue(root, { feature: 'slow' });
  const first = drain(root, { run: runner });
  const second = drain(root, { run: runner });
  assert.equal(second, first, 'the same drain, not a rival one');

  await enqueue(root, { feature: 'added-late' });
  release();
  await first;

  assert.deepEqual(started, ['slow', 'added-late'], 'work added mid-drain is picked up by that drain');
});

// --- Taking things back out ---

test('something already running cannot be removed, because stopping an agent mid-edit is worse', async () => {
  const root = await newProject('--from', EXAMPLE);
  const { entry } = await enqueue(root, { feature: 'running-now' });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const work = drain(root, { run: async () => { await held; return { code: 0, note: null }; } });
  await waitFor(root, entry.id, 'running');

  assert.deepEqual(await remove(root, entry.id), { removed: false, reason: 'running' });

  release();
  await work;
});

test('clearing takes out everything that has not started', async () => {
  const root = await newProject('--from', EXAMPLE);
  await enqueue(root, { feature: 'a' });
  await enqueue(root, { feature: 'b' });

  assert.deepEqual(await clearQueue(root), { removed: 2 });
  assert.equal((await readQueue(root)).entries.length, 0);
});

// --- From the page ---

test('the console refuses to queue a feature that does not exist, or an engine that is not real', async () => {
  const root = await withFeature();
  const server = await serve(root);

  assert.equal((await post(server, { action: 'queue.add', id: 'no-such-feature' })).status, 400);
  assert.equal((await post(server, { action: 'queue.add', id: '001', engine: 'rm -rf' })).status, 400);
  assert.equal((await readQueue(root)).entries.length, 0, 'and nothing was queued');
});

test('queueing without the write token changes nothing', async () => {
  const root = await withFeature();
  const server = await serve(root);

  assert.equal((await post(server, { action: 'queue.add', id: '001' }, 'guessed')).status, 401);
  assert.equal((await readQueue(root)).entries.length, 0);
});

test('the queue appears in the served state, so the page can show what is waiting', async () => {
  const root = await withFeature();
  const server = await serve(root);
  await enqueue(root, { feature: '001-shared-shopping-list' });

  const state = await (await fetch(new URL('state.json', server.url))).json();

  assert.equal(state.queue.entries.length, 1);
  assert.equal(state.queue.entries[0].feature, '001-shared-shopping-list');
  await clearQueue(root);
});
