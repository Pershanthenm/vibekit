import { estimateProseTokens } from '../tokens.js';
import { readText, writeAtomic } from '../fsutil.js';
import { DEFAULT_FOLDER } from './layout.js';
import { requirementPath } from './requirements.js';

/**
 * The checkpoint. Specification §60.
 *
 * "A checkpoint is small (under 200 tokens), replaces the previous one, and is committed with the
 * work. It is the only thing a resumed session needs beyond the standard scoped set."
 *
 * Every clause is load-bearing. **Replaces** rather than appends, because a list of checkpoints
 * is a transcript again and costs what a transcript costs. **Under 200 tokens**, because the
 * whole point is that resuming is cheap. **Committed with the work**, because a note in a tool
 * nobody else has is not a handoff.
 *
 * The cap is enforced here rather than requested in the prompt. A prompt that says "keep it
 * small" is a suggestion; the refusal below is the only thing that still holds on the tenth
 * session.
 */

export const CHECKPOINT_CAP = 200;

/**
 * The five labels, in §60's order — what is finished, what is half-done in the working tree,
 * the next step, what is unanswered, and what to read first.
 *
 * Plain `label:` lines, aligned, exactly as the specification writes them. Not bullets: this is
 * a block a resuming agent reads top to bottom, and the format is part of the contract with the
 * stage prompt that tells it to continue from `next:`.
 */
export const FIELDS = Object.freeze([
  { key: 'done', label: 'done', required: true, hint: 'what is finished and proved' },
  { key: 'hand', label: 'in hand', required: true, hint: 'what is half-written in the working tree, with the file and line' },
  { key: 'next', label: 'next', required: true, hint: 'the single next step' },
  { key: 'open', label: 'open', required: false, hint: 'the ask it is waiting on, and what was assumed meanwhile' },
  { key: 'read', label: 'read', required: false, hint: 'what was loaded, so the next session loads the same' },
]);

const WIDTH = Math.max(...FIELDS.map((field) => field.label.length)) + 2;
const byLabel = (label) => FIELDS.find((field) => field.label === label.trim().toLowerCase());

/**
 * `## Checkpoint   2026-09-23T14:32Z   session s-0419   step 2 of 6`
 *
 * The heading carries when, which session and where in the loop, because a resumed session needs
 * to know whether the checkpoint predates the worktree it is looking at.
 */
export const CHECKPOINT_SECTION = /^##[ \t]+Checkpoint([^\n]*)\n([\s\S]*?)(?=\n##[ \t]|(?![\s\S]))/im;

export function renderCheckpoint(values, { at = new Date(), session = null, step = null, of = null } = {}) {
  const stamp = at instanceof Date ? `${at.toISOString().slice(0, 16)}Z` : String(at);
  const heading = ['## Checkpoint', stamp, session ? `session ${session}` : '', step && of ? `step ${step} of ${of}` : '']
    .filter(Boolean)
    .join('   ');

  const body = FIELDS
    .filter((field) => String(values[field.key] ?? '').trim())
    .map((field) => `${`${field.label}:`.padEnd(WIDTH)}${String(values[field.key]).trim()}`)
    .join('\n');

  return `${heading}\n${body}`;
}

export function parseCheckpoint(text) {
  const matched = String(text ?? '').replace(/\r\n/g, '\n').match(CHECKPOINT_SECTION);
  const heading = matched?.[1] ?? '';
  const body = matched?.[2] ?? String(text ?? '');

  const values = {};
  for (const line of body.split('\n')) {
    const field = line.match(/^\s*([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
    if (!field) continue;
    const known = byLabel(field[1]);
    if (known) values[known.key] = field[2].trim();
  }

  return {
    ...values,
    at: heading.match(/\d{4}-\d{2}-\d{2}T[\d:]+Z?/)?.[0] ?? null,
    session: heading.match(/session\s+(\S+)/i)?.[1] ?? null,
    step: Number.parseInt(heading.match(/step\s+(\d+)\s+of\s+(\d+)/i)?.[1] ?? '', 10) || null,
    of: Number.parseInt(heading.match(/step\s+(\d+)\s+of\s+(\d+)/i)?.[2] ?? '', 10) || null,
  };
}

/**
 * Why this checkpoint would not help somebody resuming, or an empty list when it would.
 *
 * Each problem is a phrase that follows "it" or "its ## Checkpoint", so the same list reads
 * correctly whether `check` reports it or `writeCheckpoint` refuses on it.
 *
 * A checkpoint with no `next:` is the common failure: it reads like a status report, and the
 * session that picks it up has to work the next step out of the diff — which is the cost the
 * checkpoint existed to remove.
 */
export function checkpointProblems(text) {
  const body = String(text ?? '').trim();
  if (!body) return ['is empty'];

  const problems = [];
  const values = parseCheckpoint(body);
  for (const field of FIELDS.filter((entry) => entry.required)) {
    if (!String(values[field.key] ?? '').trim()) problems.push(`has no \`${field.label}:\` line — ${field.hint}`);
  }

  const tokens = estimateProseTokens(body);
  if (tokens > CHECKPOINT_CAP) {
    problems.push(`is about ${tokens} tokens, over the ${CHECKPOINT_CAP} cap — a checkpoint as expensive as re-reading the work saves nothing`);
  }
  return problems;
}

export const checkpointTokens = (text) => estimateProseTokens(String(text ?? '').trim());

/**
 * Write the checkpoint, replacing the previous one.
 *
 * Refused rather than truncated when it is too long: a half-saved checkpoint is worse than none,
 * because it looks current. This does its own section replacement rather than using
 * `writeSection`, whose pattern requires the heading line to end after the heading — and §60's
 * heading carries the timestamp, the session and the step.
 */
export async function writeCheckpoint(root, id, values, options = {}) {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new Error(`No requirement ${id} in ${folder}/product/requirements/.`);

  const block = typeof values === 'string' ? values.trim() : renderCheckpoint(values, options);
  const problems = checkpointProblems(block);
  if (problems.length) {
    throw new Error(`That checkpoint would not help somebody resuming:\n${problems.map((reason) => `  - it ${reason}`).join('\n')}`);
  }

  const next = CHECKPOINT_SECTION.test(text)
    ? text.replace(CHECKPOINT_SECTION, `${block}\n`)
    : `${text.trimEnd()}\n\n${block}\n`;
  await writeAtomic(path, next.endsWith('\n') ? next : `${next}\n`);
  return block;
}

/** The whole block, heading included, which is what a resuming session is handed. */
export async function readCheckpoint(root, id, folder = DEFAULT_FOLDER) {
  const text = await readText(requirementPath(root, id, folder));
  if (text === null) throw new Error(`No requirement ${id}.`);
  const matched = text.replace(/\r\n/g, '\n').match(CHECKPOINT_SECTION);
  return matched ? `## Checkpoint${matched[1]}\n${matched[2]}`.trimEnd() : '';
}

/**
 * Which requirements a resumed session would have to reconstruct from the diff.
 *
 * Only interrupted work counts: a requirement nobody has started has nothing to check point, and
 * a finished one is described by its Evidence and Review instead. `paused` is included because
 * §60 makes it the state a project-level pause leaves work in, and that is exactly the work
 * somebody will come back to cold.
 */
export const RESUMABLE = Object.freeze(['in-progress', 'paused', 'blocked']);

export function checkpointGaps(requirements) {
  return requirements
    .filter((requirement) => RESUMABLE.includes(requirement.status))
    .map((requirement) => ({ requirement, problems: checkpointProblems(requirement.checkpoint) }))
    .filter((entry) => entry.problems.length);
}
