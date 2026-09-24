import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontMatter, setFrontMatterValue } from '../frontmatter.js';
import { readText, writeAtomic, writeText } from '../fsutil.js';
import { estimateProseTokens } from '../tokens.js';
import { repoState } from '../evidence.js';
import { evidenceRefusal } from './evidence.js';
import { isTodo, parseCriteria } from './ears.js';
import { DEFAULT_FOLDER } from './layout.js';

/**
 * The requirement is the unit of work; there is no separate task list. Specification §6 and §12.
 *
 * Two rules hold the workflow together and both are enforced here rather than trusted to an
 * agent's good behaviour: an agent may move a requirement forward but never to `done`, and an
 * agent holds one `in-progress` requirement at a time, so a task is always attributable.
 */

export const STATUSES = Object.freeze(['draft', 'ready', 'in-progress', 'blocked', 'paused', 'tested', 'review', 'done']);

/**
 * §12 — `done` is absent from every agent's list on purpose, and it is the only one that is.
 * `review` belongs here because the reviewer is an agent: it records findings and hands back.
 * What no agent may do is declare its own work finished.
 */
export const SETTABLE_BY_AGENT = Object.freeze(['in-progress', 'blocked', 'tested', 'review', 'ready', 'paused']);

/** §49 — size decides ceremony, not the other way round. */
export const SIZES = Object.freeze(['S', 'M', 'L']);
export const KINDS = Object.freeze(['requirement', 'migration', 'bug']);
export const PROPOSAL_BUDGET = Object.freeze({ S: 1, M: 3, L: 3 });

const ID_PREFIX = Object.freeze({ requirement: 'REQ', migration: 'MIG', bug: 'BUG' });

const dir = (root, folder) => join(root, folder, 'product/requirements');
export const requirementPath = (root, id, folder = DEFAULT_FOLDER) => join(dir(root, folder), `${id}.md`);
export const tasksStatePath = (root, folder = DEFAULT_FOLDER) => join(root, folder, '.state/tasks.json');

const FILE = /^(?:REQ|MIG|BUG)-[\w.-]+\.md$/;

export const sectionOf = (text, heading) => String(text ?? '')
  .replace(/\r\n/g, '\n')
  .match(new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im'))?.[1]?.trim() ?? '';

/** The `## Checkpoint …` block with its annotated heading (§60). */
export const checkpointOf = (text) => {
  const matched = String(text ?? '').replace(/\r\n/g, '\n').match(/^##[ \t]+Checkpoint([^\n]*)\n([\s\S]*?)(?=\n##[ \t]|(?![\s\S]))/im);
  return matched ? `## Checkpoint${matched[1]}\n${matched[2]}`.trimEnd() : '';
};

const bullets = (text) => text.split('\n').map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);

/** `entities: [Booking, Payment]` — the closed vocabulary this requirement may touch. */
export const parseList = (value) => String(value ?? '')
  .replace(/^\[|\]$/g, '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export function parseRequirement(id, text) {
  const meta = readFrontMatter(text);
  const acceptanceSection = sectionOf(text, 'Acceptance');
  const criteria = parseCriteria(acceptanceSection);

  return {
    id: meta.id ?? id,
    title: meta.title ?? id,
    kind: KINDS.includes(meta.kind) ? meta.kind : 'requirement',
    size: SIZES.includes(String(meta.size ?? '').toUpperCase()) ? String(meta.size).toUpperCase() : null,
    status: STATUSES.includes(meta.status) ? meta.status : 'draft',
    entities: parseList(meta.entities),
    after: parseList(meta.after),
    assumes: parseList(meta.assumes),
    quality: parseList(meta.quality),
    invariants: parseList(meta.invariants),
    // A TODO is not a citation. Treating it as one lets a requirement reach an agent with
    // nothing behind it, which is the whole failure the definition of ready exists to stop.
    source: meta.source && !/^TODO/i.test(meta.source.trim()) ? meta.source.trim() : null,
    phase: meta.phase ?? null,
    // §23 — the four fields that make a bug a bug, empty on anything else.
    severity: meta.severity ? String(meta.severity).toLowerCase() : null,
    foundBy: meta['found-by'] || null,
    foundOn: meta['found-on'] || null,
    introducedBy: meta['introduced-by'] || null,
    test: meta.test || null,
    criteria,
    acceptance: criteria.filter((entry) => entry.ok),
    malformed: criteria.filter((entry) => !entry.ok),
    todoCriteria: acceptanceSection.split('\n').filter((line) => /^[-*]\s/.test(line.trim()) && isTodo(line)).length,
    outOfScope: bullets(sectionOf(text, 'Out of scope')),
    security: sectionOf(text, 'Security'),
    approach: sectionOf(text, 'Approach'),
    verification: sectionOf(text, 'Verification'),
    review: sectionOf(text, 'Review'),
    evidence: sectionOf(text, 'Evidence'),
    // §60's heading carries a timestamp, a session and a step, so `sectionOf` — which requires
    // the heading line to end after the heading — never matched it.
    checkpoint: checkpointOf(text),
    log: bullets(sectionOf(text, 'Log')),
    tokens: estimateProseTokens(text),
    text,
  };
}

export async function listRequirements(root, folder = DEFAULT_FOLDER) {
  const names = (await readdir(dir(root, folder)).catch(() => [])).filter((name) => FILE.test(name)).sort();
  const found = [];
  for (const name of names) {
    const text = await readText(join(dir(root, folder), name));
    if (text !== null) found.push(parseRequirement(name.replace(/\.md$/, ''), text));
  }
  return found;
}

export const findRequirement = (requirements, query) => {
  const wanted = String(query ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return requirements.find((entry) => entry.id.toLowerCase() === wanted)
    ?? requirements.find((entry) => entry.id.toLowerCase().startsWith(wanted))
    ?? requirements.find((entry) => entry.title.toLowerCase().includes(wanted))
    ?? null;
};

export function nextRequirementId(requirements, kind = 'requirement') {
  const prefix = ID_PREFIX[kind] ?? 'REQ';
  const highest = requirements
    .filter((entry) => entry.id.startsWith(`${prefix}-`))
    .reduce((top, entry) => {
      const number = Number.parseInt(entry.id.slice(prefix.length + 1), 10);
      return Number.isFinite(number) && number > top ? number : top;
    }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- definition of ready

/**
 * §6. Every reason this requirement may not be set `ready`, in the order a person would fix them.
 *
 * "Only `ready` requirements are offered to agents" is the sentence this function protects. A
 * requirement that reaches an agent with an undecided criterion is one the agent will decide for
 * itself, which is the whole failure the format exists to prevent — so the planner cannot bypass
 * this and neither can the page.
 */
export function readyBlockers(requirement, { entities = null, assumptions = null } = {}) {
  const blockers = [];

  if (!requirement.acceptance.length) {
    blockers.push('it has no acceptance criteria — an agent given it would have nothing to build against');
  }
  for (const bad of requirement.malformed) {
    blockers.push(`${bad.id ?? 'a criterion'} ${bad.reason}`);
  }
  if (requirement.todoCriteria) {
    const many = requirement.todoCriteria === 1 ? 'criterion is' : 'criteria are';
    blockers.push(`${requirement.todoCriteria} acceptance ${many} still TODO`);
  }
  if (!requirement.size) blockers.push(`size is not set (one of ${SIZES.join(', ')}) — size decides how much review it gets`);
  if (!requirement.source) blockers.push('source: cites nothing, so no one can check it against what was asked for');

  if (entities) {
    for (const entity of requirement.entities) {
      if (!entities.includes(entity)) blockers.push(`it names the entity "${entity}", which is not in product/entities.md`);
    }
  }
  if (assumptions) {
    for (const assumption of requirement.assumes) {
      if (!assumptions.includes(assumption)) blockers.push(`it assumes ${assumption}, which is not in workflow/assumptions.md`);
    }
  }
  if ((requirement.size === 'M' || requirement.size === 'L') && !requirement.security.trim()) {
    blockers.push(`## Security is empty, and a ${requirement.size} requirement must say what data it touches`);
  }
  return blockers;
}

// ---------------------------------------------------------------- ownership

export async function readTasksState(root, folder = DEFAULT_FOLDER) {
  try {
    const parsed = JSON.parse((await readText(tasksStatePath(root, folder))) ?? '{}');
    return { held: parsed.held ?? {} };
  } catch {
    // State is disposable; a corrupt file is rebuilt rather than reported as a failure.
    return { held: {} };
  }
}

const writeTasksState = (root, state, folder) => writeAtomic(tasksStatePath(root, folder), `${JSON.stringify(state, null, 2)}\n`);

/** §27 — a second `start` on a held requirement is refused, so work is always attributable. */
export async function claim(root, { id, role, runner, branch }, folder = DEFAULT_FOLDER) {
  const state = await readTasksState(root, folder);
  const existing = state.held[id];
  if (existing) throw new Error(`${id} is already held by ${existing.role} on ${existing.runner} since ${existing.startedAtUtc}.`);
  state.held[id] = { role, runner, branch: branch ?? `req/${id}`, startedAtUtc: new Date().toISOString() };
  await writeTasksState(root, state, folder);
  return state.held[id];
}

export async function release(root, id, folder = DEFAULT_FOLDER) {
  const state = await readTasksState(root, folder);
  delete state.held[id];
  await writeTasksState(root, state, folder);
}

/** §46 — a hold older than `hold-timeout` with no commit on its branch is stale. */
export const holdAgeHours = (holder) => (holder?.startedAtUtc ? (Date.now() - new Date(holder.startedAtUtc).valueOf()) / 3600000 : 0);

// ---------------------------------------------------------------- status

/**
 * Why a move is refused, or null when it is allowed.
 *
 * `by` is 'agent' or 'human'. The distinction is the whole point: an agent that could close its
 * own work would only ever be checked by the thing it is checking.
 */
export function refuseStatus(requirement, next, { by = 'human', holder = null, entities = null, assumptions = null, repo = null } = {}) {
  if (!STATUSES.includes(next)) return `"${next}" is not a status. Use one of: ${STATUSES.join(', ')}.`;
  if (next === requirement.status) return `${requirement.id} is already ${next}.`;

  if (by === 'agent' && !SETTABLE_BY_AGENT.includes(next)) {
    return `An agent cannot set ${requirement.id} to ${next}. A human closes a requirement, after the review is approved.`;
  }

  if (next === 'ready') {
    const blockers = readyBlockers(requirement, { entities, assumptions });
    if (blockers.length) {
      return `${requirement.id} is not ready:\n${blockers.map((reason) => `  - ${reason}`).join('\n')}`;
    }
  }

  if (next === 'in-progress' && !['ready', 'blocked', 'review', 'paused'].includes(requirement.status)) {
    return `${requirement.id} is ${requirement.status}. Only a ready requirement can be picked up.`;
  }

  if (next === 'tested') {
    if (requirement.status !== 'in-progress') return `${requirement.id} is ${requirement.status}; only work in progress can be handed to the reviewer.`;
    // §55 — a Log line that says "tests green" is not accepted. Evidence is a captured exit code,
    // for this commit, and green. Each of those is a separate thing the block can fail to be.
    const refusal = evidenceRefusal(requirement, repo ?? null);
    if (refusal) return refusal;
  }

  if (next === 'done') {
    if (holder) return `${requirement.id} is still held by ${holder.role}. Release it before closing.`;
    if (!requirement.review.trim()) return `${requirement.id} has no ## Review. A reviewer approves before a human closes.`;
    if (!requirement.verification.trim()) return `${requirement.id} has no ## Verification mapping criteria to tests.`;
  }

  return null;
}

export async function setStatus(root, id, next, { by = 'human', folder = DEFAULT_FOLDER, entities = null, assumptions = null } = {}) {
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new Error(`No requirement ${id} in ${folder}/product/requirements/.`);
  const requirement = parseRequirement(id, text);
  const state = await readTasksState(root, folder);
  const refusal = refuseStatus(requirement, next, {
    by, entities, assumptions,
    holder: next === 'done' ? state.held[id] : null,
    // The sha the evidence must match, read once here so the rule below can be tested without a repository.
    repo: next === 'tested' ? repoState(root) : null,
  });
  if (refusal) throw new Error(refusal);

  await writeAtomic(path, setFrontMatterValue(text, 'status', next));
  if (['done', 'ready', 'paused'].includes(next)) await release(root, id, folder);
  // §27 — every move is a line in the file, so `why`, the reports and the next session read the
  // same history a person does, and nothing about the work lives only in a status column.
  await appendLog(root, id, `${requirement.status} → ${next} (${by})`, folder);
  return { id, from: requirement.status, to: next };
}

/**
 * §27 — a handoff is a line in the requirement, appended by whoever is finishing. Nothing else is
 * needed: the next agent reads the file it was pointed at, and the history travels with the work
 * rather than in a system the repository does not carry.
 */
export async function appendLog(root, id, entry, folder = DEFAULT_FOLDER) {
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new Error(`No requirement ${id}.`);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `- ${stamp} ${entry}`;
  const body = /^##\s+Log\s*$/im.test(text)
    ? text.replace(/^##\s+Log\s*$/im, `## Log\n\n${line}`)
    : `${text.trimEnd()}\n\n## Log\n\n${line}\n`;
  await writeAtomic(path, body.endsWith('\n') ? body : `${body}\n`);
  return line;
}

/** Replace one `## Section` wholesale, which is how an agent writes Approach, Evidence or Review. */
export async function writeSection(root, id, heading, body, folder = DEFAULT_FOLDER) {
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new Error(`No requirement ${id}.`);
  const block = `## ${heading}\n\n${String(body).trim()}\n`;
  const pattern = new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n[\\s\\S]*?(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im');
  const next = pattern.test(text) ? text.replace(pattern, block.trimEnd()) : `${text.trimEnd()}\n\n${block}`;
  await writeAtomic(path, next.endsWith('\n') ? next : `${next}\n`);
  return block;
}

export async function createRequirement(root, { id, title, kind = 'requirement', size = null, entities = [], source = null }, folder = DEFAULT_FOLDER) {
  const { requirementStarter } = await import('./templates.js');
  const path = requirementPath(root, id, folder);
  await writeText(path, requirementStarter({ id, title, kind, size, entities, source }));
  return path;
}
