// The small set of things the served page is allowed to change. Specification §57.
//
// Everything here writes to the same files the CLI writes, through the same checks the CLI
// applies. That is the point: a board that moves a card without moving `status:` in the
// requirement is lying about the project, and a board that moves it past a blocked gate is worse —
// it would make the page a way around the gates rather than a view of them.
//
// What is deliberately absent: editing code, `standards/`, `guardrails.md` or `architecture.md`
// content. §57: those are pull requests.

import { join } from 'node:path';
import { answerAsk, listAsks, rejectAsk } from './folder/asks.js';
import { AGENT_SEVERITY_MAX, SEVERITIES, refuseSeverity } from './folder/bugs.js';
import { appendLog, claim, createRequirement, listRequirements, nextRequirementId, release as releaseHold, requirementPath, setStatus as setRequirementStatus, SIZES, STATUSES } from './folder/requirements.js';
import { approvalOf, STAGES } from './folder/workflow.js';
import { setFrontMatterValue } from './frontmatter.js';
import { folderOf } from './dashboard.js';
import { readText, writeAtomic, writeText } from './fsutil.js';
import { changedBetween, commitToTracker, snapshot } from './trackerbranch.js';

/** Refused because the request itself is wrong — a bad status, an unknown id, a typo. */
export class BadRequest extends Error {}
/** Refused because the project says no — a blocked gate, a transition that is not allowed. */
export class Refused extends Error {}
/** Refused because the target moved since the action was decided — a queued action needs a second look. */
export class Changed extends Error {}

const need = (value, what) => { if (typeof value !== 'string' || !value.trim()) throw new BadRequest(what); return value.trim(); };
const refusing = async (work, fallback) => { try { return await work(); } catch (error) { if (error instanceof BadRequest) throw error; throw new Refused(error?.message ?? fallback); } };

/**
 * The moves a person may make from the page. Every one goes through the same function the CLI
 * calls, so a decision made on a phone and a decision made in a terminal meet the same checks.
 */
async function requirementStatus(root, project, { id, status }) {
  need(id, 'Which requirement?');
  if (!STATUSES.includes(status)) throw new BadRequest(`"${status}" is not a status. Expected one of: ${STATUSES.join(', ')}.`);
  const folder = await folderOf(root, project);
  // by: 'human' — the page is a person. There is no --force here and there will not be one:
  // forcing is a decision made at a terminal, by somebody who can see what they are overriding.
  const moved = await refusing(() => setRequirementStatus(root, id, status, { by: 'human', folder }), 'The project refused that change.');
  return { message: `${moved.id}: ${moved.from} → ${moved.to}` };
}

async function requirementRelease(root, project, { id }) {
  need(id, 'Which requirement?');
  const folder = await folderOf(root, project);
  const found = (await listRequirements(root, folder)).find((entry) => entry.id === id);
  if (!found) throw new BadRequest(`No requirement ${id}.`);
  await releaseHold(root, id, folder);
  await appendLog(root, id, 'unheld from the tracker', folder).catch(() => {});
  return { message: `${id} released. The work stays on its branch.` };
}

/** §57 — start a piece of work for a named runner: the same claim as `vibekit start`. */
async function requirementStart(root, project, { id, role = 'implementer', runner = 'tracker' }) {
  need(id, 'Which requirement?');
  const { ROLE_NAMES } = await import('./folder/templates.js');
  if (!ROLE_NAMES.includes(role)) throw new BadRequest(`"${role}" is not a role. One of: ${ROLE_NAMES.join(', ')}.`);
  if (!/^[\w.-]{1,40}$/.test(String(runner))) throw new BadRequest('runner: a short name such as claude-code or cursor.');
  const folder = await folderOf(root, project);
  const found = (await listRequirements(root, folder)).find((entry) => entry.id === id);
  if (!found) throw new BadRequest(`No requirement ${id}.`);
  if (found.status !== 'ready') throw new Refused(`${id} is ${found.status}. Only a ready requirement can be picked up.`);
  await refusing(() => setRequirementStatus(root, id, 'in-progress', { by: 'agent', folder }), 'Could not start it.');
  const holder = await refusing(() => claim(root, { id, role, runner }, folder), 'Could not hold it.');
  return { message: `${id} held by ${role} on ${holder.runner}, branch ${holder.branch}` };
}

/** §57 — "Add a requirement or quick fix": product owner adds, tech lead quick-fixes. */
async function requirementAdd(root, project, { title, size = null, kind = 'requirement' }) {
  need(title, 'A requirement needs a title.');
  const folder = await folderOf(root, project);
  const requirements = await listRequirements(root, folder);
  const id = nextRequirementId(requirements, kind === 'bug' ? 'bug' : 'requirement');
  await createRequirement(root, { id, title: title.trim(), kind, size: size ?? null }, folder);
  await appendLog(root, id, 'added from the tracker', folder).catch(() => {});
  return { message: `${id} added as a draft: ${title.trim()}. Acceptance criteria next.`, id };
}

async function requirementHotfix(root, project, body) {
  const added = await requirementAdd(root, project, { ...body, size: 'S', kind: 'bug' });
  return { ...added, message: `${added.id} opened as an S hotfix. Write its criterion and the failing test; \`vibekit bug fix ${added.id}\` starts it on hotfix/*.` };
}

/** §57 — "Change a requirement's size or status to review" (tech lead). */
async function requirementSize(root, project, { id, size }) {
  need(id, 'Which requirement?');
  if (!SIZES.includes(String(size ?? '').toUpperCase())) throw new BadRequest(`size takes one of ${SIZES.join(', ')}.`);
  const folder = await folderOf(root, project);
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new BadRequest(`No requirement ${id}.`);
  await writeAtomic(path, setFrontMatterValue(text, 'size', String(size).toUpperCase()));
  await appendLog(root, id, `size set to ${String(size).toUpperCase()} from the tracker`, folder).catch(() => {});
  return { message: `${id} is size ${String(size).toUpperCase()}` };
}

/** §23 — severity above medium is a human judgement; the page is a human, so all three are allowed. */
async function bugSeverity(root, project, { id, severity }) {
  need(id, 'Which bug?');
  const refusal = refuseSeverity(severity, { by: 'human' });
  if (refusal) throw new BadRequest(refusal);
  const folder = await folderOf(root, project);
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new BadRequest(`No bug ${id}.`);
  if (!/^kind:\s*bug/m.test(text)) throw new BadRequest(`${id} is not a bug.`);
  await writeAtomic(path, /^severity:/m.test(text) ? setFrontMatterValue(text, 'severity', String(severity).toLowerCase()) : text.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\nseverity: ${String(severity).toLowerCase()}\n---`));
  await appendLog(root, id, `severity set to ${String(severity).toLowerCase()} from the tracker`, folder).catch(() => {});
  return { message: `${id} severity ${String(severity).toLowerCase()}` };
}

async function askAnswer(root, project, { id, answer, by }) {
  need(id, 'Which ask?');
  need(answer, 'An answer needs words.');
  const folder = await folderOf(root, project);
  const result = await refusing(() => answerAsk(root, id, { answer, by: by ?? 'tracker' }, folder), 'That ask could not be answered.');
  return { message: `${result.id} ${result.status}.` };
}

async function askReject(root, project, { id, answer, by }) {
  need(id, 'Which ask?');
  const folder = await folderOf(root, project);
  const result = await refusing(() => rejectAsk(root, id, { reason: answer, by: by ?? 'tracker' }, folder), 'That ask could not be rejected.');
  return { message: `${result.id} rejected. It stays as a record of what was refused.` };
}

/** §57 — "Accept or reject a memory proposal" (tech lead): the ask's status, then the memory file. */
async function memoryAccept(root, project, { id, accept = true, by }) {
  need(id, 'Which proposal?');
  const folder = await folderOf(root, project);
  const ask = (await listAsks(root, folder)).find((entry) => entry.id === id);
  if (!ask) throw new BadRequest(`No ask ${id}.`);
  if (ask.kind !== 'proposal') throw new BadRequest(`${id} is a ${ask.kind}, not a memory proposal.`);
  if (!accept) return askReject(root, project, { id, answer: 'not kept as a lesson', by });
  const result = await refusing(() => answerAsk(root, id, { answer: 'accepted as a lesson', by: by ?? 'tracker', status: 'accepted' }, folder), 'Could not accept it.');
  const memoryId = `M-${String(Date.now()).slice(-6)}`;
  const body = String(ask.ask ?? '').trim();
  await writeText(join(root, folder, 'memory/repo', `${memoryId}-${String(ask.topic ?? 'lesson').replace(/[^\w-]+/g, '-').slice(0, 24) || 'lesson'}.md`), [
    '---', `id: ${memoryId}`, 'kind: semantic', `topic: [${[ask.topic].flat().filter(Boolean).join(', ') || 'lesson'}]`, `learned: ${new Date().toISOString().slice(0, 10)}`, `by: ${ask.by ?? 'unknown'} (accepted from the tracker by ${by ?? 'tracker'})`, 'confidence: medium', 'scope: repo', '---', body, '',
  ].join('\n'));
  return { message: `${result.id} accepted; ${memoryId} written to memory/repo/.` };
}

/**
 * §57 — "Approve or reject a gate": the `approved:` line, written to the gate's own file, by the
 * role humans.md names. The page writes exactly what a person would type; nothing here passes a
 * gate by itself.
 */
const GATE_FILES = Object.freeze({ 2: 'workflow/architecture.md', 3: 'product/design/components.md', 4: 'workflow/plan.md' });
async function gateApprove(root, project, { stage, by, reject = false, note = null }) {
  const n = Number.parseInt(String(stage ?? ''), 10);
  if (!GATE_FILES[n] && n !== 1) throw new BadRequest(`Stage ${stage} has no approval line to write. Gates with one: 1 (assumptions reviewed), 2, 3, 4.`);
  const who = need(by, 'An approval carries a name.');
  const folder = await folderOf(root, project);
  const date = new Date().toISOString().slice(0, 10);
  if (reject) {
    const statusPath = join(root, folder, 'workflow/status.md');
    const text = (await readText(statusPath)) ?? '';
    await writeText(statusPath, `${text.trimEnd()}\n\nRejected at stage ${n} on ${date} by ${who}${note ? `: ${note}` : ''}\n`);
    return { message: `Stage ${n} rejected; the note is in status.md.` };
  }
  if (n === 1) {
    const path = join(root, folder, 'workflow/assumptions.md');
    const text = (await readText(path)) ?? '---\nreviewed:\n---\n';
    const { reviewedOf } = await import('./folder/workflow.js');
    if (reviewedOf(text)) throw new Refused(`The assumptions are already reviewed (${reviewedOf(text)}).`);
    await writeAtomic(path, /^reviewed:/m.test(text) ? setFrontMatterValue(text, 'reviewed', `${date} by ${who}`) : `reviewed: ${date} by ${who}\n${text}`);
    return { message: `Assumptions reviewed by ${who}.` };
  }
  const path = join(root, folder, GATE_FILES[n]);
  const text = await readText(path);
  if (text === null) throw new Refused(`${GATE_FILES[n]} does not exist yet; there is nothing to approve.`);
  if (approvalOf(text)) throw new Refused(`${GATE_FILES[n]} is already approved by ${approvalOf(text).by}.`);
  const line = `${date} by ${who}`;
  const next = /^approved:/m.test(text) ? setFrontMatterValue(text, 'approved', line) : `${text.trimEnd()}\n\n<!-- local -->\napproved: ${line}\n`;
  await writeAtomic(path, next);
  if (n === 3) {
    // tokens.md is generated; its approval lives below <!-- local -->, where regeneration keeps it.
    const tokensPath = join(root, folder, 'product/design/tokens.md');
    const tokens = await readText(tokensPath);
    if (tokens !== null && !approvalOf(tokens)) await writeAtomic(tokensPath, `${tokens.trimEnd()}\n\n<!-- local -->\napproved: ${line}\n`);
  }
  return { message: `${STAGES.find((entry) => entry.n === n)?.name ?? `stage ${n}`} approved by ${who}.` };
}

/** §57 — "Reorder or defer requirements" (product owner, tech lead): plan.md, with a log line. */
async function planReorder(root, project, { order, defer = [], by }) {
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) throw new BadRequest('order: a list of requirement ids, in the order you want them.');
  const folder = await folderOf(root, project);
  const path = join(root, folder, 'workflow/plan.md');
  const text = await readText(path);
  if (text === null) throw new Refused('No plan.md to reorder.');
  const known = new Set((await listRequirements(root, folder)).map((entry) => entry.id));
  for (const id of [...order, ...defer]) if (!known.has(id)) throw new BadRequest(`No requirement ${id}.`);

  // Within the sprint each id sits in, the bullets are re-sorted to the given order; deferred ids
  // move to ## Deferred with the person's name as the reason. Nothing else in the file changes.
  const rank = new Map(order.map((id, index) => [id, index]));
  const lines = text.split('\n');
  const out = [];
  let block = [];
  const flush = () => {
    const bullets = block.filter((line) => /^\s*[-*]\s+/.test(line));
    const rest = block.filter((line) => !/^\s*[-*]\s+/.test(line));
    const idOf = (line) => line.match(/\b((?:REQ|MIG|BUG)-[\w.-]+)\b/)?.[1];
    const kept = bullets.filter((line) => !defer.includes(idOf(line)));
    kept.sort((a, b) => (rank.get(idOf(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(idOf(b)) ?? Number.MAX_SAFE_INTEGER));
    out.push(...rest.filter((line) => line.trim() === '' ? false : true).filter((line) => !/^##/.test(line)), ...kept);
    block = [];
  };
  let inSprint = false;
  for (const line of lines) {
    if (/^##\s+(?:Phase|Sprint)\s+\d+/i.test(line)) { if (inSprint) flush(); inSprint = true; out.push(line); block = []; continue; }
    if (/^##\s+/.test(line)) { if (inSprint) flush(); inSprint = false; out.push(line); continue; }
    if (inSprint) block.push(line); else out.push(line);
  }
  if (inSprint) flush();
  let next = out.join('\n').replace(/\n{3,}/g, '\n\n');
  if (defer.length) {
    const deferredLines = defer.map((id) => `- ${id}  reason: deferred from the tracker by ${by ?? 'tracker'}`).join('\n');
    next = /^##\s+Deferred/m.test(next) ? next.replace(/^(##\s+Deferred\s*\n)/m, `$1\n${deferredLines}\n`) : `${next.trimEnd()}\n\n## Deferred\n\n${deferredLines}\n`;
  }
  await writeAtomic(path, next.endsWith('\n') ? next : `${next}\n`);
  for (const id of defer) await appendLog(root, id, `deferred from the tracker by ${by ?? 'tracker'}`, folder).catch(() => {});
  return { message: `plan.md reordered${defer.length ? `; ${defer.join(', ')} deferred` : ''}.` };
}

/** §57 — "Leave a note on anything": a `## Notes` line in the file, attributed and timestamped. */
async function noteAdd(root, project, { id, text, by }) {
  need(id, 'Note on what?');
  const words = need(text, 'A note needs words.');
  const folder = await folderOf(root, project);
  const askFile = async () => {
    const { readdir } = await import('node:fs/promises');
    const dir = join(root, folder, 'workflow/asks');
    const name = (await readdir(dir).catch(() => [])).find((entry) => entry === `${id}.md` || entry.startsWith(`${id}-`));
    return name ? join(dir, name) : null;
  };
  const path = /^(?:REQ|MIG|BUG)-/.test(id) ? requirementPath(root, id, folder) : /^[QP]-/.test(id) ? await askFile() : null;
  if (!path) throw new BadRequest(`Notes go on a requirement or an ask; "${id}" is neither.`);
  const existing = await readText(path);
  if (existing === null) throw new BadRequest(`No ${id}.`);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `- ${stamp} ${by ?? 'tracker'}: ${words.replace(/\s+/g, ' ')}`;
  const next = /^##\s+Notes\s*$/m.test(existing) ? existing.replace(/^##\s+Notes\s*$/m, `## Notes\n\n${line}`) : `${existing.trimEnd()}\n\n## Notes\n\n${line}\n`;
  await writeAtomic(path, next.endsWith('\n') ? next : `${next}\n`);
  return { message: `Note left on ${id}.` };
}

// --- Reaching the console from a phone ---------------------------------------------------------

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

/**
 * Every action the page may take, by name. An allowlist rather than a dispatcher: a request naming
 * anything not in here is refused before anything reads the rest of it. §57's table, one entry each.
 */
export const ACTIONS = {
  'req.status': requirementStatus,
  'req.release': requirementRelease,
  'req.start': requirementStart,
  'req.add': requirementAdd,
  'req.hotfix': requirementHotfix,
  'req.size': requirementSize,
  'bug.severity': bugSeverity,
  'ask.answer': askAnswer,
  'ask.reject': askReject,
  'memory.accept': memoryAccept,
  'gate.approve': gateApprove,
  'plan.reorder': planReorder,
  'note.add': noteAdd,
  'tunnel.start': tunnelStart,
  'tunnel.stop': tunnelStop,
};

/** The actions that write workflow files — the ones §57 records on the tracker's branch. */
const WRITES_WORKFLOW = new Set(Object.keys(ACTIONS).filter((name) => !name.startsWith('tunnel.')));

async function currentStatus(root, project, body) {
  const folder = await folderOf(root, project);
  if (String(body.action).startsWith('req.') || String(body.action).startsWith('bug.')) return (await listRequirements(root, folder)).find((entry) => entry.id === body.id)?.status ?? null;
  if (String(body.action).startsWith('ask.') || String(body.action).startsWith('memory.')) return (await listAsks(root, folder)).find((entry) => entry.id === body.id)?.status ?? null;
  return null;
}

/**
 * §57 — "a queued action whose target changed underneath it is shown for re-confirmation rather
 * than applied." The page sends the status it saw when the decision was made; if the file says
 * something else now, the decision was made about a different situation and is refused with the
 * truth beside it. A request that carries no expectation is a live one and is not held to this.
 */
async function refuseIfChanged(root, project, body) {
  const expected = body?.expect?.status;
  if (typeof expected !== 'string') return;
  const now = await currentStatus(root, project, body).catch(() => null);
  if (now !== null && now !== expected) {
    throw new Changed(`${body.id} is now "${now}", not "${expected}" as it was when this was decided. Look at it again before applying.`);
  }
}

/** §57 — the decision, in a commit with the person's name on it. */
async function recordOnTracker(root, folder, before, body, result, services) {
  const paths = changedBetween(before, await snapshot(root, folder));
  const subject = `${body.action} ${body.id ?? body.stage ?? ''}`.trim();
  return commitToTracker(root, {
    user: services.session.email,
    name: services.session.person?.name ?? null,
    paths,
    message: result?.message ? `${subject}: ${result.message}` : subject,
    trailers: services.trailers ?? [],
  });
}

const trackerNote = (landed) => {
  if (!landed?.committed) return '';
  if (landed.merged) return `Recorded on ${landed.branch} and merged into ${landed.into}.`;
  return `Recorded on ${landed.left}; ${landed.why}.`;
};

/**
 * Returns whatever the action wants to report back, or nothing where there is nothing to say.
 *
 * `services` is what the running server owns and the files do not — the tunnel, and with Access in
 * front, who is asking. It is passed rather than imported so that an action can only touch what
 * the caller decided to hand over, and so a test can serve without one.
 */
export async function apply(root, project, body, services = {}) {
  const action = ACTIONS[body?.action];
  if (!action) throw new BadRequest(`Unknown action: ${body?.action ?? '(none)'}`);
  await refuseIfChanged(root, project, body);

  // Only an identified person is recorded on a branch of their own; the shared-token console on a
  // laptop is the terminal's equal and commits the way the terminal does — by hand.
  const attributable = Boolean(services.session?.email) && WRITES_WORKFLOW.has(body.action);
  const folder = attributable ? await folderOf(root, project).catch(() => null) : null;
  const before = folder ? await snapshot(root, folder) : null;

  const by = services.session?.person?.name ?? services.session?.email ?? body.by;
  const result = await action(root, project, { ...body, by: by ?? body.by }, services);
  if (!before) return result;

  const landed = await recordOnTracker(root, folder, before, body, result, services).catch((error) => ({ committed: false, why: error.message }));
  return { ...(result ?? {}), tracker: landed, message: [result?.message, trackerNote(landed)].filter(Boolean).join(' ') };
}

export { AGENT_SEVERITY_MAX, SEVERITIES };
