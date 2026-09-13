// Work you line up on the board, pushed to an agent without going back to a terminal.
//
// The queue is deliberately thin. It holds an ordered list of features to dispatch and nothing
// about how to dispatch them: draining an entry runs `vibecheck dispatch`, the same command a
// person runs, as its own process. So the worktrees, the briefs, the routing, the clean-tree
// check and the refusal to dispatch a feature that is not in-progress are all enforced in one
// place — the place they were already enforced — rather than reimplemented behind a button.
//
// Entries drain one at a time. Within a dispatch the lanes run in parallel, which is where the
// parallelism belongs; two dispatches at once would race over the same HEAD and the same
// worktree base, and the failure would land on whoever was watching rather than on whoever
// wrote this.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from './evidence.js';
import { readText, writeText } from './fsutil.js';

/** queued: waiting. running: an agent is working. done/failed: it finished, one way or the other. */
export const QUEUE_STATES = ['queued', 'running', 'done', 'failed'];

// An agent implementing a lane can run for a long time; the cap is here to stop a wedged process
// holding the queue forever, not to bound honest work.
export const DISPATCH_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const BIN = fileURLToPath(new URL('../bin/vibecheck', import.meta.url));

const fallback = (root, ...parts) => {
  try {
    return stateDir(root, ...parts);
  } catch {
    return join(root, '.vibecheck', ...parts);
  }
};

/** Outside the working tree, like the evidence records: queueing work must not dirty the repo. */
export const queuePath = (root) => fallback(root, 'queue.json');

/** The transcript of the queue itself — what it started, and what came back. */
export const queueLogPath = (root) => fallback(root, 'queue.log');

export async function readQueue(root) {
  const text = await readText(queuePath(root));
  if (!text) return { entries: [] };
  try {
    const parsed = JSON.parse(text);
    return { entries: Array.isArray(parsed?.entries) ? parsed.entries : [] };
  } catch {
    // A corrupt queue file is not worth failing a page render over, and an empty queue is honest
    // about what will happen next, which is nothing.
    return { entries: [] };
  }
}

const write = (root, queue) => writeText(queuePath(root), `${JSON.stringify(queue, null, 2)}\n`);

// Read-modify-write, from a server that is also draining the queue. One chain per project keeps
// two requests arriving in the same tick from each overwriting the other's entry.
const chains = new Map();

function serialise(root, work) {
  const next = (chains.get(root) ?? Promise.resolve()).then(work, work);
  chains.set(root, next.then(() => {}, () => {}));
  return next;
}

const edit = (root, change) => serialise(root, async () => {
  const queue = await readQueue(root);
  const result = change(queue);
  await write(root, queue);
  return result;
});

/**
 * Add a feature to the queue. A feature already waiting or running is not added twice — pressing
 * the button again means "yes, I meant it", not "start a second agent on the same worktrees".
 */
export function enqueue(root, { feature, engine = null }) {
  return edit(root, (queue) => {
    const waiting = queue.entries.find((entry) => entry.feature === feature && (entry.state === 'queued' || entry.state === 'running'));
    if (waiting) return { entry: waiting, added: false };
    const entry = {
      id: randomBytes(8).toString('hex'),
      feature,
      engine,
      state: 'queued',
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      note: null,
    };
    queue.entries.push(entry);
    return { entry, added: true };
  });
}

/** Drop an entry. Something already running keeps running: stopping an agent mid-edit is worse. */
export function remove(root, id) {
  return edit(root, (queue) => {
    const entry = queue.entries.find((candidate) => candidate.id === id);
    if (!entry) return { removed: false, reason: 'gone' };
    if (entry.state === 'running') return { removed: false, reason: 'running' };
    queue.entries = queue.entries.filter((candidate) => candidate.id !== id);
    return { removed: true };
  });
}

/** Clear everything that is not running, so a queue built up over a day can be abandoned at once. */
export function clearQueue(root) {
  return edit(root, (queue) => {
    const before = queue.entries.length;
    queue.entries = queue.entries.filter((entry) => entry.state === 'running');
    return { removed: before - queue.entries.length };
  });
}

const patch = (root, id, fields) => edit(root, (queue) => {
  const entry = queue.entries.find((candidate) => candidate.id === id);
  if (entry) Object.assign(entry, fields);
  return entry ?? null;
});

/**
 * Run one entry: `vibecheck dispatch <feature>`, its output appended to the queue log.
 *
 * Nothing a request supplied reaches a shell — this spawns the binary directly, and the only
 * values interpolated are a feature id the caller has already matched against a real feature and
 * an engine checked against the schema's list.
 */
function runDispatch(root, entry, log) {
  const args = [BIN, 'dispatch', entry.feature, '--dir', root];
  if (entry.engine) args.push('--engine', entry.engine);
  return new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      // The console is already open in front of whoever queued this; a browser tab opening on the
      // server's machine helps nobody, and on a headless box there is nothing to open.
      env: { ...process.env, VIBECHECK_NO_OPEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => child.kill(), DISPATCH_TIMEOUT_MS);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, note: `could not start: ${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, note: code === 0 ? null : `dispatch exited with ${code}` });
    });
  });
}

// One drain per project. Queueing while a drain is running joins that drain rather than starting
// a second one, which is what makes "queue it and it goes" safe to press twice.
const draining = new Map();

/**
 * Work through everything queued, oldest first, until nothing is left.
 *
 * Returns a promise for the whole drain, which callers may ignore: queueing from the console
 * answers immediately and the page watches the states change. `run` is injectable so the queue
 * can be tested without spawning agents.
 */
export function drain(root, { run = runDispatch } = {}) {
  if (draining.has(root)) return draining.get(root);
  const work = (async () => {
    await mkdir(dirname(queueLogPath(root)), { recursive: true }).catch(() => {});
    const log = createWriteStream(queueLogPath(root), { flags: 'a' });
    try {
      for (;;) {
        const { entries } = await readQueue(root);
        const next = entries.find((entry) => entry.state === 'queued');
        if (!next) break;
        await patch(root, next.id, { state: 'running', startedAt: new Date().toISOString() });
        log.write(`\n▶ ${new Date().toISOString()} — dispatching ${next.feature}\n`);
        const { code, note } = await run(root, next, log);
        log.write(`\n${code === 0 ? '✔' : '✖'} ${next.feature} ${note ?? 'finished'}\n`);
        await patch(root, next.id, {
          state: code === 0 ? 'done' : 'failed',
          finishedAt: new Date().toISOString(),
          exitCode: code,
          note,
        });
      }
    } finally {
      await new Promise((closed) => log.end(closed));
      draining.delete(root);
    }
  })();
  draining.set(root, work);
  return work;
}

/** Whether a drain is in flight here — what the page shows as "working through the queue". */
export const isDraining = (root) => draining.has(root);
