import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stateDir } from './evidence.js';
import { readText, writeText } from './fsutil.js';

const TICKED = /^- \[x\] (T-\d+)\b/gim;
const OUTPUT_LINES = 20;

// A suite this slow has already stopped being a per-task check. Rather than hold the turn open
// indefinitely, the gate reports that it could not run and lets the turn end.
export const TEST_TIMEOUT_MS = 120_000;

const gatePath = (root) => join(stateDir(root), 'task-gate.json');

export const tickedTasks = (feature) => [...(feature.tasks ?? '').matchAll(TICKED)].map(([, id]) => id);

/** Tasks ticked since the suite last passed for this feature. */
export function newlyDone(feature, recorded = []) {
  const seen = new Set(recorded);
  return tickedTasks(feature).filter((id) => !seen.has(id));
}

async function readGate(root) {
  const text = await readText(gatePath(root)).catch(() => null);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const tail = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/).filter(Boolean).slice(-OUTPUT_LINES).join('\n');

/**
 * Runs the project's test command when tasks have been ticked since it last passed, so "run the
 * tests after each task" is enforced rather than asked for: a skipped run used to leave no trace.
 * The suite runs once per turn however many tasks were ticked — it is the whole project's suite,
 * not one task's — and only a green run records those tasks, so a failure re-gates until it is fixed.
 */
export async function testGate(root, project, features) {
  const command = project.commands?.test;
  if (!command) return null;
  let state;
  try {
    state = await readGate(root);
  } catch {
    return null; // Not a git repository: there is nowhere to record what has been gated.
  }

  const pending = features
    .filter((feature) => feature.status === 'in-progress')
    .map((feature) => ({ feature, tasks: newlyDone(feature, state[feature.id]) }))
    .filter((entry) => entry.tasks.length);
  if (!pending.length) return null;

  const result = spawnSync(command, { shell: true, cwd: root, encoding: 'utf8', timeout: TEST_TIMEOUT_MS });
  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT' ? `it took longer than ${TEST_TIMEOUT_MS / 1000}s` : result.error.message;
    return { ran: false, ok: false, command, pending, reason };
  }
  if (result.status !== 0) return { ran: true, ok: false, command, pending, output: tail(result) };

  for (const { feature } of pending) state[feature.id] = tickedTasks(feature);
  await writeText(gatePath(root), `${JSON.stringify(state, null, 2)}\n`).catch(() => {});
  return { ran: true, ok: true, command, pending };
}

export const gateSummary = (gate) => gate.pending.map(({ feature, tasks }) => `${feature.id}: ${tasks.join(', ')}`).join('; ');
