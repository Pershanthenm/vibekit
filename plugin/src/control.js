// The small set of things the served console is allowed to change.
//
// Everything here writes to the same files the CLI writes, through the same checks the CLI
// applies. That is the point: a board that moves a card without moving `status:` in spec.md is
// lying about the project, and a board that moves it past a blocked gate is worse — it would
// make the console a way around the gates rather than a view of them.
//
// What is deliberately absent: clearing a gate, and resolving an issue. Both are computed, not
// stored. Evidence passes when tests actually ran on a clean commit; review passes when a verdict
// is written in review.md. There is no field to set, so there is no action here to set it, and
// the page offers the command to run instead.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySelection } from './advisor/selection.js';
import { stateDir } from './evidence.js';
import { findFeature, listFeatures } from './features.js';
import { writeText } from './fsutil.js';
import { clearQueue, drain, enqueue, remove as removeQueued } from './queue.js';
import { ENGINES, FEATURE_STATUSES } from './schema.js';
import { collectScan, fixPlanFor } from './scan.js';
import { status as setStatus } from './commands/feature.js';

/** Refused because the request itself is wrong — a bad status, an unknown feature, a typo. */
export class BadRequest extends Error {}
/** Refused because the project says no — a blocked gate, a transition that is not allowed. */
export class Refused extends Error {}

const taskLine = (id) => new RegExp(`^(- \\[)([ xX])(\\] ${id}\\b)`, 'm');

async function featureStatus(root, project, { id, status }) {
  if (typeof id !== 'string' || !id) throw new BadRequest('Which feature?');
  if (!FEATURE_STATUSES.includes(status)) {
    throw new BadRequest(`"${status}" is not a status. Expected one of: ${FEATURE_STATUSES.join(', ')}.`);
  }
  try {
    // The CLI's own path, checks included: it refuses a move the gates do not allow, and it keeps
    // the roadmap and the journal in step afterwards. Note there is no --force
    // here and there will not be one: forcing is a decision made at a terminal, by a person who
    // can see what they are overriding.
    await setStatus({ root, args: [id, status] });
  } catch (error) {
    throw new Refused(error?.message ?? 'The project refused that change.');
  }
}

async function tickTask(root, project, { id, task }, ticked) {
  if (typeof id !== 'string' || !id) throw new BadRequest('Which feature?');
  if (typeof task !== 'string' || !/^T-\d+$/.test(task)) throw new BadRequest('Which task? Expected an id like T-3.');
  const feature = findFeature(await listFeatures(root), id);
  const pattern = taskLine(task);
  if (!pattern.test(feature.tasks)) throw new BadRequest(`${feature.id} has no ${task}.`);
  await writeText(join(feature.dir, 'tasks.md'), feature.tasks.replace(pattern, (_, open, _box, close) => `${open}${ticked ? 'x' : ' '}${close}`));
}

export const REQUIREMENTS_PATH = 'specs/requirements.json';

/**
 * The answers the wizard collected, saved where `vibekit advise apply` already looks for them.
 * The page is a form and nothing more: it decides no stack, applies no licence policy and writes
 * no project.json. That all stays in the advisor, where it is tested.
 */
async function saveRequirements(root, project, { requirements }) {
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) {
    throw new BadRequest('Expected the wizard answers as an object.');
  }
  const text = `${JSON.stringify(requirements, null, 2)}\n`;
  // A form with two dozen short answers; anything near this is not one of ours.
  if (text.length > 65536) throw new BadRequest('Those answers are too large.');
  await writeText(join(root, REQUIREMENTS_PATH), text);
  return { saved: REQUIREMENTS_PATH };
}

/** Save, then let the advisor choose the stack and scaffold — the same path the CLI runs. */
async function applyRequirements(root, project, body) {
  const saved = await saveRequirements(root, project, body);
  try {
    const { adrPath, choices } = await applySelection(root, body.requirements, body.preset);
    return { ...saved, adrPath, choices };
  } catch (error) {
    throw new Refused(error?.message ?? 'The advisor could not apply those answers.');
  }
}

// --- Running the scan's fixes ----------------------------------------------------------------

/**
 * The arguments each fix runs with. This is the whole vocabulary: the console cannot ask for a
 * command, it can only ask for one of these three, and each is the same command the terminal runs.
 * Nothing here interpolates anything a request supplied, so there is no shell string to escape and
 * nothing a crafted finding id could smuggle in.
 */
const STEP_ARGS = {
  sync: ['sync'],
  'analyze.fix': ['analyze', '--fix'],
  'verify.run': ['verify', '--all', '--run'],
};

// Running the suites is the slow one by design; the others touch files and return.
const STEP_TIMEOUT = { 'verify.run': 900_000, sync: 120_000, 'analyze.fix': 120_000 };

/**
 * Which exit codes mean the command did its job. Two of these are checkers, and a checker exits
 * non-zero when it still has something to report — `analyze --fix` appends the missing tasks and
 * then exits 1 because the work it just wrote down is not done yet, and `verify --run` records
 * the evidence and exits 1 when a suite failed. Reading either as a broken fix would stop a plan
 * that was working, so the run reports the code and keeps going; anything else is a real failure.
 */
const STEP_OK = { sync: [0], 'analyze.fix': [0, 1], 'verify.run': [0, 1] };

const BIN = fileURLToPath(new URL('../bin/vibekit', import.meta.url));

/**
 * Where a run's transcript goes. Outside the working tree wherever there is a git directory to
 * put it in, so running a fix never dirties the repository the fix is about — and beside the
 * project otherwise, because a project without git still deserves to be watchable.
 */
export function runLogPath(root) {
  try {
    return join(stateDir(root), 'scan-run.log');
  } catch {
    return join(root, '.vibekit', 'scan-run.log');
  }
}

/**
 * Run one fix as its own process, with everything it prints appended to the run log. The log is
 * what the console streams, so watching a fix from a phone is the same mechanism as watching a
 * dispatched lane — there is no second path to keep working.
 */
function runStep(root, action, log) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...STEP_ARGS[action], '--dir', root], {
      cwd: root,
      env: { ...process.env, VIBEKIT_NO_OPEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => child.kill(), STEP_TIMEOUT[action] ?? 120_000);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', (error) => {
      clearTimeout(timer);
      log.write(`\n✖ ${action} could not start: ${error.message}\n`);
      done({ action, ok: false, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const ok = (STEP_OK[action] ?? [0]).includes(code);
      log.write(`\n${ok ? '✔' : '✖'} ${action} ${ok ? `finished (exit ${code})` : `exited with ${code}`}\n`);
      done({ action, ok, code });
    });
  });
}

/**
 * Run the fixes for a selection of findings, in order, stopping at the first failure — a failed
 * sync followed by a test run would report on files nobody meant to ship.
 *
 * The selection chooses from findings the scan produced; anything without an allowlisted action
 * comes back untouched in `manual`, because those need a decision rather than a command.
 */
async function runScan(root, project, { ids }) {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new BadRequest('Which findings? Expected a list of ids.');
  if (!ids.length) throw new BadRequest('Nothing was selected.');
  if (!project) throw new Refused('There is no readable project here yet.');

  const scan = await collectScan(root, project);
  const plan = fixPlanFor(scan, ids);
  const unknown = ids.filter((id) => !scan.findings.some((entry) => entry.id === id));
  if (unknown.length) throw new BadRequest(`This scan has no ${unknown.join(', ')}. Rescan and try again.`);
  if (!plan.steps.length) throw new Refused('Nothing selected can be fixed by a command. Those findings need a person.');

  await mkdir(dirname(runLogPath(root)), { recursive: true }).catch(() => {});
  const log = createWriteStream(runLogPath(root), { flags: 'a' });
  log.write(`\n▶ ${new Date().toISOString()} — running ${plan.steps.length} fix(es) for ${ids.length} finding(s)\n`);

  const ran = [];
  for (const step of plan.steps) {
    log.write(`\n▶ ${step.command}\n`);
    const result = await runStep(root, step.action, log);
    ran.push({ ...result, covers: step.covers, command: step.command });
    if (!result.ok) break;
  }
  const stopped = ran.some((result) => !result.ok);
  log.write(stopped ? '\n■ stopped at the first failure\n' : '\n✔ all fixes ran\n');
  await new Promise((closed) => log.end(closed));

  // Rescanned afterwards, so the page shows what is true now rather than what was asked for.
  return { ran, manual: plan.manual, stopped, scan: await collectScan(root, project) };
}

// --- Reaching the console from a phone ---------------------------------------------------------

/**
 * Open and close the tunnel from the page itself.
 *
 * A tunnel is a public hostname pointed at this machine, so being able to put it away without
 * killing the console is the difference between a session you supervise and one you forget about.
 * The console keeps running either way; only the way in from outside goes.
 *
 * Reopening deliberately does not reuse the old hostname — Cloudflare assigns a new one each time,
 * and a link that stops working when you said stop is the honest outcome.
 */
async function tunnelStart(root, project, body, { tunnel } = {}) {
  if (!tunnel) throw new Refused('This console is not managing a tunnel.');
  const state = await tunnel.start();
  if (state.error) throw new Refused(state.error);
  return state;
}

async function tunnelStop(root, project, body, { tunnel } = {}) {
  if (!tunnel) throw new Refused('This console is not managing a tunnel.');
  return tunnel.stop();
}

// --- The queue ---------------------------------------------------------------------------------

/**
 * Queue a feature, and start working through the queue immediately. There is no second button to
 * press: queueing something is the instruction to build it.
 *
 * The refusals that matter — a feature that is not in-progress, a dirty tree, lanes already
 * dispatched, no ready parallel tasks — all live in `vibekit dispatch`, which the drain runs as
 * its own process. Duplicating them here would give the console its own opinion about when work
 * may start, and the two would drift. What this does check is that the feature exists and the
 * engine is one the schema knows, because those decide what gets spawned.
 */
async function queueAdd(root, project, { id, engine }) {
  if (typeof id !== 'string' || !id) throw new BadRequest('Which feature?');
  if (engine != null && !ENGINES.includes(engine)) {
    throw new BadRequest(`"${engine}" is not an engine. Expected one of: ${ENGINES.join(', ')}.`);
  }
  let feature;
  try {
    feature = findFeature(await listFeatures(root), id);
  } catch (error) {
    throw new BadRequest(error?.message ?? `No feature matches ${id}.`);
  }
  const { entry, added } = await enqueue(root, { feature: feature.id, engine: engine ?? null });
  // Deliberately not awaited: the drain runs for as long as the agents do, and the request that
  // started it should come back at once. The page watches the states change.
  drain(root).catch(() => {});
  return { entry, added, feature: feature.id };
}

async function queueRemove(root, project, { entry }) {
  if (typeof entry !== 'string' || !entry) throw new BadRequest('Which queued item?');
  const { removed, reason } = await removeQueued(root, entry);
  if (!removed && reason === 'running') throw new Refused('That one has already started. Let it finish.');
  if (!removed) throw new BadRequest('That is not in the queue.');
  return { removed: entry };
}

const queueClear = async (root) => clearQueue(root);

/**
 * Every action the console may take, by name. An allowlist rather than a dispatcher: a request
 * naming anything not in here is refused before anything reads the rest of it.
 */
export const ACTIONS = {
  'feature.status': featureStatus,
  'task.tick': (root, project, body) => tickTask(root, project, body, true),
  'task.untick': (root, project, body) => tickTask(root, project, body, false),
  'requirements.save': saveRequirements,
  'requirements.apply': applyRequirements,
  'scan.run': runScan,
  'queue.add': queueAdd,
  'queue.remove': queueRemove,
  'queue.clear': queueClear,
  'tunnel.start': tunnelStart,
  'tunnel.stop': tunnelStop,
};

/**
 * Returns whatever the action wants to report back, or nothing where there is nothing to say.
 *
 * `services` is what the running server owns and the files do not — currently the tunnel. It is
 * passed rather than imported so that an action can only touch what the caller decided to hand
 * over, and so a test can serve without one.
 */
export async function apply(root, project, body, services = {}) {
  const action = ACTIONS[body?.action];
  if (!action) throw new BadRequest(`Unknown action: ${body?.action ?? '(none)'}`);
  return action(root, project, body, services);
}
