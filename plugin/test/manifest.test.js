// DASHBOARD AC-14: given a dispatch in progress, lane states reflect real running agents.
//
// A manifest records "running" when an agent starts and "finished" when it ends. If whatever was
// dispatching is killed in between, the second write never happens, and every reader — the board,
// the live page, `vibecheck lanes`, `vibecheck merge` — goes on reporting an agent that is not
// there. Nobody is working on that feature and the page says somebody is, which is the one thing
// a board must never do.
//
// These use real processes: a real pid that is really alive, and a real one that is really gone.
// There is no stand-in for "is this process running", so there is none here.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { isAlive, loadManifest, withLiveness } from '../src/manifest.js';
import { EXAMPLE, TOOL_FREE_PATH, fillSpec, gitInit, installFakeBin, newProject, patchProject, restoreEnv, setDocsEnabled } from './helpers.js';

console.log = () => {};

const lane = (fields) => ({ name: 'lane-1', tasks: ['T-1'], logPath: 'x.log', ...fields });

/** A process that will sit there until it is killed. */
const living = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });

/** A pid that is definitely not running: start a process, wait for it to exit, keep its id. */
const departed = async () => {
  const child = spawn(process.execPath, ['-e', '']);
  const { pid } = child;
  await new Promise((done) => child.on('exit', done));
  return pid;
};

test('a pid that is running is reported as running, and one that is gone is not', async () => {
  const child = living();
  try {
    assert.equal(isAlive(child.pid), true);
  } finally {
    child.kill();
  }
  assert.equal(isAlive(await departed()), false);
  assert.equal(isAlive(0), false, 'signalling 0 means the process group, never "is anything alive"');
  assert.equal(isAlive(undefined), false);
});

test('a lane whose agent is gone stops claiming to be running', async () => {
  const manifest = { feature: '001', lanes: [lane({ state: 'running', pid: await departed() })] };

  assert.equal(withLiveness(manifest).lanes[0].state, 'stopped');
});

test('a lane whose agent is working is left alone', () => {
  const child = living();
  try {
    const manifest = { feature: '001', lanes: [lane({ state: 'running', pid: child.pid })] };

    assert.equal(withLiveness(manifest).lanes[0].state, 'running');
  } finally {
    child.kill();
  }
});

test('states that were written down as final are never second-guessed', async () => {
  const pid = await departed();
  const manifest = { feature: '001', lanes: [
    lane({ name: 'a', state: 'finished', pid }),
    lane({ name: 'b', state: 'failed', pid }),
    lane({ name: 'c', state: 'ready' }),
  ] };

  assert.deepEqual(withLiveness(manifest).lanes.map((entry) => entry.state), ['finished', 'failed', 'ready']);
});

test('a manifest from before pids were recorded is left exactly as it is', () => {
  const manifest = { feature: '001', lanes: [lane({ state: 'running' })] };

  assert.equal(withLiveness(manifest).lanes[0].state, 'running', 'nothing to check against is not evidence it died');
});

// --- The whole way through ---------------------------------------------------------------------
//
// The unit tests above prove the check. This proves the plumbing that feeds it: a real dispatch,
// a real agent process, its id recorded in the manifest as it starts, and the lane reading as
// stopped once that process is gone.

const FEATURE = '001-shared-list';
// One lane, not two: this test is about what the manifest records, and every extra lane is another
// git worktree to create and tear down while the rest of the suite is using the same disk.
const TASKS = ['- [ ] T-1 [impl] API (AC-1) — apps/api/list.ts [P]'];

// An agent that starts and then sits there, so there is something real to observe and to kill.
const SLOW_AGENT = `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('fake'); process.exit(0); }
setTimeout(() => {}, 30000);
`;

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

test('a dispatched lane records the agent it started, and reads as stopped once that agent is gone', async () => {
  const original = { ...process.env };
  const bin = await mkdtemp(join(tmpdir(), 'slow-agent-'));
  await installFakeBin(bin, 'cursor-agent', SLOW_AGENT);
  process.env.PATH = [bin, TOOL_FREE_PATH].join(delimiter);
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  process.env.VIBECHECK_HOME = await mkdtemp(join(tmpdir(), 'vc-home-'));

  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await patchProject(root, { workflow: { engine: 'cursor' }, commands: { install: '' } });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  await run(['status', '--dir', root, FEATURE, 'in-progress', '--force']);
  gitInit(root);

  const dispatched = run(['dispatch', '--dir', root, FEATURE]);
  try {
    // Generous, because this waits on a real dispatch — a git worktree, an install step and a
    // process launch — on a machine running the rest of the suite at the same time. It returns as
    // soon as the pid appears, so the budget costs nothing when the machine is not busy.
    let running = null;
    for (let attempt = 0; attempt < 1200 && !running; attempt += 1) {
      await settle(100);
      const manifest = await loadManifest(root, FEATURE);
      running = manifest?.lanes.find((entry) => entry.state === 'running' && entry.pid);
    }
    assert.ok(running, 'the manifest records the process id of the agent it started');
    assert.equal(isAlive(running.pid), true, 'and that process is really there');

    process.kill(running.pid);
    await settle(300);

    const after = await loadManifest(root, FEATURE);
    const lane = after.lanes.find((entry) => entry.name === running.name);
    assert.notEqual(lane.state, 'running', 'a lane whose agent has gone must stop claiming to be running');
  } finally {
    for (const lane of (await loadManifest(root, FEATURE))?.lanes ?? []) {
      if (lane.pid && isAlive(lane.pid)) process.kill(lane.pid);
    }
    await dispatched.catch(() => {});
    restoreEnv(original);
    process.exitCode = 0;
  }
});

// --- Reading while it is being written ---------------------------------------------------------
//
// This is what the end-to-end test above kept tripping over, and it was the manifest's fault, not
// the test's. A plain write truncates the file first, so a reader arriving in between sees zero
// bytes — and zero bytes read as "there is no manifest". For `vibecheck dispatch` that is not a
// cosmetic glitch: assertDispatchable treats no manifest as permission to dispatch again, over
// worktrees that already exist.

test('an empty manifest file is a read that arrived mid-write, not a manifest that is gone', async () => {
  // This is the one that matters: `dispatch` reads "no manifest" as permission to start another
  // set of lanes over worktrees that already exist. A reader landing on a half-replaced file must
  // look again rather than report absence.
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createManifestWriter } = await import('../src/manifest.js');
  const { worktreeBase } = await import('../src/git.js');
  const { gitInit } = await import('./helpers.js');
  const root = await mkdtemp(join(tmpdir(), 'vc-atomic-'));
  await writeFile(join(root, 'README.md'), 'a repository needs something in it to commit');
  gitInit(root);
  const save = createManifestWriter(root);
  const manifest = { feature: 'f', baseCommit: 'abc', lanes: [lane({ state: 'ready' })] };
  await save(manifest);

  // Exactly the state a torn read sees, with the real write landing just after.
  await writeFile(join(worktreeBase(root), 'f.json'), '');
  setTimeout(() => { save(manifest); }, 10);

  assert.ok(await loadManifest(root, 'f'), 'an empty file must not read as no manifest at all');
});

test('replacing a file a reader has open is waited out, not failed', async () => {
  // Windows refuses the rename with EPERM while another handle is open. That is a wait, not an
  // error, and treating it as one would turn a busy moment into a lost manifest.
  const { mkdtemp, open, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { writeAtomic } = await import('../src/fsutil.js');
  const directory = await mkdtemp(join(tmpdir(), 'vc-busy-'));
  const target = join(directory, 'held.json');
  await writeAtomic(target, '{"lanes":[]}');

  const handle = await open(target, 'r');
  const writing = writeAtomic(target, '{"lanes":[1]}');
  setTimeout(() => handle.close(), 60);
  await writing;

  assert.equal(await readFile(target, 'utf8'), '{"lanes":[1]}');
});
