import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readText, writeAtomic } from '../fsutil.js';
import { isOpen, listAsks } from './asks.js';
import { DEFAULT_FOLDER } from './layout.js';
import { listRequirements, readTasksState } from './requirements.js';

/**
 * Sprints. Specification §21, §23 and §67.
 *
 * A sprint is what §21 calls a phase: a group of requirements in `plan.md` with its own end-to-end
 * check, reports and gate. The file keeps the word "Phase" because a team's plans already use it
 * and §51 tags `phase/<n>`; the commands say "sprint" because that is what people call the thing
 * they are in. Both headings are read.
 *
 * Nothing here decides which sprint is current by a stored flag. The current sprint is the first
 * one with work not yet done, read from the requirement files every time, so a sprint somebody
 * closed by hand and a sprint the plan moved a requirement out of both read correctly.
 */

const HEADING = /^##\s+(?:Phase|Sprint)\s+(\d+)\s*(?::|—|-)?\s*(.*)$/i;
const ID = /\b((?:REQ|MIG|BUG)-[\w.-]+)\b/g;

/** `plan.md` as sprints: number, title, the ids listed under each, and the deferred list. */
export function parsePlan(text) {
  const sprints = [];
  const deferred = [];
  let current = null;
  let inDeferred = false;
  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const heading = raw.match(HEADING);
    if (heading) {
      current = { n: Number.parseInt(heading[1], 10), title: heading[2].trim() || `Sprint ${heading[1]}`, ids: [], lines: [] };
      sprints.push(current);
      inDeferred = false;
      continue;
    }
    if (/^##\s+Deferred/i.test(raw)) { current = null; inDeferred = true; continue; }
    if (/^##\s+/.test(raw)) { current = null; inDeferred = false; continue; }
    if (!/^\s*[-*]\s+/.test(raw)) continue;
    // The template's placeholder (`- TODO: REQ-001 …`) names an id to show the shape; it is not a plan.
    if (/^\s*[-*]\s+TODO\b/i.test(raw)) continue;
    // The first id on a line is the item; anything after it (`after: REQ-004`) is a reference.
    const first = raw.match(ID)?.[0] ?? null;
    if (inDeferred) { if (first && !deferred.includes(first)) deferred.push(first); }
    else if (current) {
      if (first && !current.ids.includes(first)) current.ids.push(first);
      current.lines.push(raw.replace(/^\s*[-*]\s+/, '').trim());
    }
  }
  return { sprints, deferred };
}

const planPath = (root, folder) => join(root, folder, 'workflow/plan.md');
const statePath = (root, folder) => join(root, folder, '.state/workflow.json');

export async function readWorkflowState(root, folder = DEFAULT_FOLDER) {
  try {
    return JSON.parse((await readText(statePath(root, folder))) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

const writeWorkflowState = (root, state, folder) => writeAtomic(statePath(root, folder), `${JSON.stringify(state, null, 2)}\n`);

/**
 * Every sprint with its requirements and where each stands. A requirement listed nowhere in the
 * plan is `unplanned` — it exists, it is real work, and the plan does not say when.
 */
export async function sprintBoard(root, folder = DEFAULT_FOLDER, { current: chosen = null } = {}) {
  const [plan, requirements, state, tasks] = await Promise.all([
    readText(planPath(root, folder)),
    listRequirements(root, folder),
    readWorkflowState(root, folder),
    readTasksState(root, folder),
  ]);
  const { sprints, deferred } = parsePlan(plan);
  const byId = new Map(requirements.map((entry) => [entry.id, entry]));
  const listed = new Set();

  const rows = sprints.map((sprint) => {
    const items = sprint.ids.map((id) => { listed.add(id); return byId.get(id) ?? { id, title: id, status: 'missing', missing: true }; });
    const done = items.filter((item) => item.status === 'done').length;
    const closed = state.sprints?.[sprint.n] ?? null;
    return {
      ...sprint,
      items,
      done,
      total: items.length,
      complete: items.length > 0 && done === items.length,
      closed,
      held: items.filter((item) => tasks.held[item.id]).map((item) => ({ id: item.id, ...tasks.held[item.id] })),
    };
  });

  const unplanned = requirements.filter((entry) => !listed.has(entry.id) && !deferred.includes(entry.id) && entry.kind !== 'bug');
  const bugs = requirements.filter((entry) => entry.kind === 'bug' && !listed.has(entry.id));
  // The current sprint is the first with work left; one that has no requirements listed (a
  // skeleton phase described in prose) counts as passed once anything after it has started.
  // `use sprint N` (CLI Spec §2) chooses the working sprint; a closed one cannot be chosen, and a
  // choice the plan no longer has falls back to what the files say.
  const picked = chosen !== null && chosen !== undefined ? rows.find((row) => row.n === Number(chosen) && !row.closed) ?? null : null;
  const current = picked ?? rows.find((row) => row.total && !row.complete && !row.closed) ?? rows.find((row) => row.total && !row.closed) ?? null;
  return { sprints: rows, deferred, unplanned, bugs, current, held: tasks.held };
}

/**
 * §23 — the sprint gate. "Every piece of work in the sprint `done`, the sprint's end-to-end path
 * passes, `vibekit security scan` clean of high findings, documents regenerated, all three reports
 * produced, lessons proposed, and a human closes the sprint in `status.md`."
 *
 * Each row is a fact read from the folder, never a claim. `extra` lets the command add the checks
 * that need to run something (the suite, the scan) and report what they found.
 */
export async function sprintGate(root, n, { folder = DEFAULT_FOLDER, extra = [] } = {}) {
  const board = await sprintBoard(root, folder);
  const sprint = board.sprints.find((row) => row.n === Number(n));
  if (!sprint) return { ok: false, sprint: null, rows: [{ ok: false, what: `sprint ${n}`, why: 'not in workflow/plan.md' }] };

  const asks = (await listAsks(root, folder)).filter(isOpen);
  const ids = new Set(sprint.ids);
  const openForSprint = asks.filter((ask) => ask.for && ids.has(ask.for));
  const highBugs = board.bugs.filter((bug) => /^high$/i.test(String(bug.severity ?? '')) && bug.status !== 'done');

  const rows = [
    { ok: sprint.complete, what: 'every piece of work done', why: sprint.complete ? `${sprint.done} of ${sprint.total}` : `${sprint.total - sprint.done} of ${sprint.total} not done: ${sprint.items.filter((item) => item.status !== 'done').map((item) => item.id).join(', ')}` },
    { ok: !sprint.held.length, what: 'nothing still held', why: sprint.held.length ? sprint.held.map((holder) => `${holder.id} by ${holder.role}`).join(', ') : 'no holds' },
    { ok: !openForSprint.length, what: 'no open asks for this work', why: openForSprint.length ? openForSprint.map((ask) => ask.id).join(', ') : 'none open' },
    { ok: !highBugs.length, what: 'no open high-severity bug', why: highBugs.length ? highBugs.map((bug) => bug.id).join(', ') : 'none' },
    ...extra,
  ];
  return { ok: rows.every((row) => row.ok), sprint, rows };
}

/**
 * The line a human writes. Recorded in `.state/workflow.json` (rebuilt from the tag when lost)
 * and as a lightweight `phase/<n>` tag (§51), so the close is in git with everything else.
 */
export async function closeSprint(root, n, { by, folder = DEFAULT_FOLDER, now = () => new Date(), tag = true } = {}) {
  const who = String(by ?? '').trim();
  if (!who) throw new Error('Closing a sprint is a human decision: say who with --by "<name>".');
  const state = await readWorkflowState(root, folder);
  state.sprints = { ...(state.sprints ?? {}), [n]: { closedAt: now().toISOString(), by: who } };
  await writeWorkflowState(root, state, folder);

  let tagged = false;
  if (tag) {
    try {
      execFileSync('git', ['tag', '--force', `phase/${n}`], { cwd: root, stdio: 'ignore' });
      tagged = true;
    } catch { /* not a repository, or no commits: the state file still records it */ }
  }
  return { n: Number(n), by: who, closedAt: state.sprints[n].closedAt, tagged };
}

/** The plain-language line for a status, for the screens that show work rather than identifiers (§67). */
export const stepWords = (requirement, holder = null) => {
  const checkpoint = requirement.checkpoint ?? '';
  if (requirement.status === 'done') return 'done';
  if (requirement.status === 'tested' || requirement.status === 'review') return 'waiting for a second pair of eyes';
  if (requirement.status === 'blocked') return 'waiting on your answer';
  if (requirement.status === 'paused') return 'paused';
  if (requirement.status === 'ready') return 'next';
  if (requirement.status === 'draft') return 'still being defined';
  if (/in hand:\s*(?!nothing)/i.test(checkpoint) && /test/i.test(checkpoint)) return 'writing the tests';
  if (/next:\s*.*verify/i.test(checkpoint)) return 'checking it';
  if (requirement.approach?.trim()) return 'writing the code';
  return holder ? 'working out the approach' : 'started';
};

/** A title as a gerund: "Cancel a booking" → "Cancelling a booking". Best effort; a title is a human's words. */
export function gerund(title) {
  const text = String(title ?? '').trim();
  const [first, ...rest] = text.split(/\s+/);
  if (!first) return text;
  const word = first.toLowerCase();
  if (/ing$/.test(word)) return text;
  const irregular = { add: 'adding', run: 'running', set: 'setting', get: 'getting', put: 'putting', stop: 'stopping', plan: 'planning', log: 'logging', map: 'mapping', drop: 'dropping', ship: 'shipping', cancel: 'cancelling', create: 'creating', delete: 'deleting', update: 'updating', save: 'saving', make: 'making', close: 'closing', invite: 'inviting', remove: 'removing', assign: 'assigning', mark: 'marking', start: 'starting', show: 'showing', list: 'listing', record: 'recording', flag: 'flagging', accept: 'accepting', reject: 'rejecting', count: 'counting', see: 'seeing', send: 'sending', import: 'importing', export: 'exporting' };
  const ing = irregular[word] ?? (word.endsWith('e') && !word.endsWith('ee') ? `${word.slice(0, -1)}ing` : `${word}ing`);
  // Only a verb-first title is turned; "a counter starts a stock take" stays as written.
  if (!/^(?:[a-z]+)$/i.test(first) || /^(?:a|an|the|when|if|while|where)$/i.test(first)) return text;
  return [ing.charAt(0).toUpperCase() + ing.slice(1), ...rest].join(' ');
}
