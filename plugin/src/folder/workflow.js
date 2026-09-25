import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontMatter } from '../frontmatter.js';
import { exists, readText } from '../fsutil.js';
import { isOpen, listAsks } from './asks.js';
import { DEFAULT_FOLDER } from './layout.js';
import { holdAgeHours, listRequirements, readTasksState, sectionOf } from './requirements.js';

/**
 * Stages and gates. Specification §14, §15 and §24.
 *
 * A gate is a line a human writes. Nothing here ever writes one: `gateState` only reports whether
 * the line is there, and `nextAction` says what to do about it. "No stage advances itself" is a
 * design goal (§1.7), and the way to keep it true is to give the code no way to pass a gate.
 *
 * Every stage reads files and writes files. No stage depends on chat history, which is why a
 * session that dies is resumed by reading status.md rather than by remembering a conversation.
 */

export const STAGES = Object.freeze([
  { n: 0, name: 'intake', role: 'analyst', prompt: 'workflow/stages/0-intake.md', gate: 'source recorded' },
  { n: 1, name: 'clarify', role: 'analyst', prompt: 'workflow/stages/1-clarify.md', gate: 'no open blocking asks; assumptions reviewed' },
  { n: 2, name: 'architecture', role: 'planner', prompt: 'workflow/stages/2-architecture.md', gate: 'workflow/architecture.md approved' },
  { n: 3, name: 'design system', role: 'designer', prompt: 'workflow/stages/3-design-system.md', gate: 'tokens + components approved' },
  { n: 4, name: 'plan', role: 'planner', prompt: 'workflow/stages/4-plan.md', gate: 'workflow/plan.md approved' },
  { n: 5, name: 'build', role: 'implementer', prompt: 'workflow/stages/5-build.md', gate: 'vibekit check green per requirement' },
  { n: 6, name: 'test', role: 'reviewer', prompt: 'workflow/stages/6-test.md', gate: 'reviewer approves, a human sets done' },
]);

export const ADOPT = Object.freeze({ n: 'A', name: 'adopt', role: 'analyst', prompt: 'workflow/stages/adopt.md', gate: 'vibekit check green against the repo' });

// `[^\S\n]*`, not `\s*`: an empty `approved:` is followed by a newline, and a pattern that crosses
// it captures the next line — here the closing `---` of the front matter — as the approver.
const APPROVED = /^approved:[^\S\n]*(.+)$/im;
const APPROVED_ALL = /^approved:[^\S\n]*(.+)$/gim;

/** A gate is passed when a human wrote the line, and not otherwise. */
export function approvalOf(text) {
  if (!text) return null;
  // The first `approved:` line that says anything. The templates ship the key empty in the front
  // matter, and reading it with `??` treated that empty string as the answer — so a human who
  // wrote `approved: 2026-09-24 by …` as a body line, exactly as works on plan.md, was ignored on
  // architecture.md and the gate stayed shut with the approval sitting in the file.
  const candidates = [readFrontMatter(text).approved, ...[...String(text).matchAll(APPROVED_ALL)].map((match) => match[1])];
  const line = candidates.find((value) => value && !/^\s*$/.test(value) && !/^TODO/i.test(value));
  if (!line) return null;
  const matched = String(line).match(/^(\d{4}-\d{2}-\d{2})?\s*(?:by\s+)?(.*)$/i);
  return { date: matched?.[1] ?? null, by: (matched?.[2] || '').trim() || 'unknown', raw: String(line).trim() };
}

/** `reviewed: 2026-09-23 by <name>` in assumptions.md — the stage 1 gate. */
export const reviewedOf = (text) => {
  if (!text) return null;
  const line = readFrontMatter(text).reviewed ?? text.match(/^reviewed:\s*(.+)$/im)?.[1];
  if (!line || /^\s*$/.test(line) || /^TODO/i.test(line)) return null;
  return String(line).trim();
};

const countFiles = async (path, match) => (await readdir(path).catch(() => [])).filter((name) => match.test(name)).length;

/**
 * Where every gate stands, read from the files rather than from a stored flag — a stored flag is
 * a second source of truth and it is always the one that is wrong.
 */
export async function gateState(root, folder = DEFAULT_FOLDER) {
  const base = join(root, folder);
  const read = (path) => readText(join(base, path));

  const [architecture, plan, tokens, components, assumptions] = await Promise.all([
    read('workflow/architecture.md'),
    read('workflow/plan.md'),
    read('product/design/tokens.md'),
    read('product/design/components.md'),
    read('workflow/assumptions.md'),
  ]);

  const sources = await countFiles(join(base, 'product/sources'), /^(?:BRS|DESC)-/);
  const asks = await listAsks(root, folder);
  const blockingOpen = asks.filter((ask) => isOpen(ask) && ask.blocking);
  const architectureApproval = approvalOf(architecture);
  // The design stage is skipped, not failed, when the architecture recorded no front end.
  const api = readFrontMatter(architecture ?? '').api ?? null;
  const designSkipped = api === 'none';
  // Read from a line a human writes in assumptions.md, exactly like every other gate. It used to
  // also accept the phrase appearing anywhere in status.md — which status.md prints in its own
  // gate-description column, so the gate passed itself on the second run. A gate that can be
  // satisfied by the report of the gate is not a gate.
  const assumptionsReviewed = Boolean(reviewedOf(assumptions));

  return {
    0: { passed: sources > 0, detail: sources ? `${sources} source(s) recorded` : 'no source yet — describe the app or upload a BRS' },
    1: {
      passed: sources > 0 && blockingOpen.length === 0 && assumptionsReviewed,
      detail: blockingOpen.length
        ? `${blockingOpen.length} blocking ask(s) open: ${blockingOpen.map((ask) => ask.id).join(', ')}`
        : assumptionsReviewed ? 'assumptions reviewed' : 'assumptions not yet reviewed by a human',
      by: assumptionsReviewed ? 'human' : null,
    },
    2: { passed: Boolean(architectureApproval), detail: architectureApproval ? `approved by ${architectureApproval.by}` : 'workflow/architecture.md has no approved: line', by: architectureApproval?.by ?? null },
    3: {
      // §: "a human approves tokens.md and components.md". tokens.md is generated, so its approval
      // is written below `<!-- local -->`, where a regeneration leaves it alone.
      passed: designSkipped || Boolean(approvalOf(tokens) && approvalOf(components)),
      detail: designSkipped
        ? 'skipped — the architecture records no front end'
        : !approvalOf(tokens)
          ? 'design/tokens.md not approved — write `approved: <date> by <name>` below a `<!-- local -->` line; it survives regeneration'
          : !approvalOf(components)
            ? 'design/components.md not approved — write `approved: <date> by <name>` in it'
            : 'tokens and components approved',
      skipped: designSkipped,
    },
    4: { passed: Boolean(approvalOf(plan)), detail: approvalOf(plan) ? `approved by ${approvalOf(plan).by}` : 'workflow/plan.md has no approved: line', by: approvalOf(plan)?.by ?? null },
  };
}

/**
 * The one thing to do next, chosen the way a person would: clear what blocks somebody, then pass
 * the gate that is ready, then hand out the work that is waiting.
 */
export async function nextAction(root, folder = DEFAULT_FOLDER, { holdTimeout = 4 } = {}) {
  const gates = await gateState(root, folder);
  const asks = await listAsks(root, folder);
  const requirements = await listRequirements(root, folder);
  const held = (await readTasksState(root, folder)).held;

  const blocking = asks.filter((ask) => isOpen(ask) && ask.blocking);
  if (blocking.length) {
    const ask = blocking[0];
    return { kind: 'answer-ask', forHuman: true, id: ask.id, detail: ask.plain || ask.ask.split('\n')[0], command: `vibekit ask answer ${ask.id} "<your answer>"` };
  }

  for (const stage of STAGES.slice(0, 5)) {
    const gate = gates[stage.n];
    if (gate && !gate.passed) {
      return {
        kind: 'stage', stage: stage.n, name: stage.name, role: stage.role, prompt: `${folder}/${stage.prompt}`,
        forHuman: /approved|reviewed/.test(gate.detail) || Boolean(gate.by === null && stage.n > 0),
        detail: gate.detail, command: 'vibekit run',
      };
    }
  }

  const stale = Object.entries(held).find(([, holder]) => holdAgeHours(holder) > holdTimeout);
  if (stale) {
    return { kind: 'stale-hold', forHuman: true, id: stale[0], detail: `held by ${stale[1].role} for ${Math.round(holdAgeHours(stale[1]))}h with no progress`, command: `vibekit unhold ${stale[0]}` };
  }

  const closable = requirements.find((entry) => entry.status === 'review' && entry.review.trim() && !held[entry.id]);
  if (closable) return { kind: 'close', forHuman: true, id: closable.id, detail: closable.title, command: `vibekit req done ${closable.id}` };

  const toReview = requirements.find((entry) => entry.status === 'tested');
  if (toReview) return { kind: 'review', forHuman: false, id: toReview.id, detail: toReview.title, command: `vibekit start ${toReview.id} --as reviewer` };

  const ready = requirements.find((entry) => entry.status === 'ready' && entry.after.every((id) => requirements.find((other) => other.id === id)?.status === 'done'));
  if (ready) return { kind: 'build', forHuman: false, id: ready.id, detail: ready.title, command: `vibekit start ${ready.id} --as implementer` };

  const draft = requirements.find((entry) => entry.status === 'draft');
  if (draft) return { kind: 'ready', forHuman: true, id: draft.id, detail: draft.title, command: `vibekit req ready ${draft.id}` };

  return null;
}

/** Which stage the project is in: the first whose gate has not passed, else build. */
export async function currentStage(root, folder = DEFAULT_FOLDER) {
  const gates = await gateState(root, folder);
  for (const stage of STAGES.slice(0, 5)) if (!gates[stage.n]?.passed) return stage;
  return STAGES[5];
}

/**
 * §24 — one generated file is the single point of truth about where things are. Every tool reads
 * it first, and the page renders it.
 */
export async function renderStatus(root, folder = DEFAULT_FOLDER, { holdTimeout = 4 } = {}) {
  const gates = await gateState(root, folder);
  const stage = await currentStage(root, folder);
  const asks = await listAsks(root, folder);
  const requirements = await listRequirements(root, folder);
  const held = (await readTasksState(root, folder)).held;
  const next = await nextAction(root, folder, { holdTimeout });

  const open = asks.filter(isOpen);
  const blocking = open.filter((ask) => ask.blocking);
  const done = requirements.filter((entry) => entry.status === 'done').length;

  const rows = STAGES.slice(0, 5).map((entry) => {
    const gate = gates[entry.n] ?? {};
    const state = gate.skipped ? 'skipped' : gate.passed ? 'complete' : entry.n === stage.n ? 'in progress' : 'not started';
    return `| ${entry.n} ${entry.name} | ${state} | ${entry.gate} | ${gate.by ?? '—'} |`;
  });
  if (stage.n >= 5) {
    rows.push(`| 5 build | in progress | ${STAGES[5].gate} | |`);
    rows.push(`| 6 test | ${requirements.some((entry) => entry.status === 'tested' || entry.status === 'review') ? 'in progress' : 'not started'} | ${STAGES[6].gate} | |`);
  }

  const heldLine = Object.entries(held)
    .map(([id, holder]) => `${id} (${holder.role}, ${holder.runner}, ${Math.round(holdAgeHours(holder))}h)`)
    .join(' · ') || 'nothing';

  return [
    '# Workflow status',
    '',
    `stage: ${stage.n} ${stage.name}`,
    '',
    '| Stage | State | Gate | By |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `Requirements: ${done} of ${requirements.length} done`,
    `Open blocking asks: ${blocking.length} · Open asks: ${open.length}${open.length ? ` (${open.map((ask) => ask.id).join(', ')})` : ''}`,
    `Held: ${heldLine}`,
    next ? `Next: ${next.command}${next.detail ? `  — ${next.detail}` : ''}` : 'Next: nothing outstanding',
    '',
  ].join('\n');
}

export const stageByNumber = (n) => STAGES.find((stage) => String(stage.n) === String(n)) ?? (String(n).toUpperCase() === 'A' ? ADOPT : null);

export async function readAssumptions(root, folder = DEFAULT_FOLDER) {
  const text = await readText(join(root, folder, 'workflow/assumptions.md'));
  if (!text) return [];
  return [...text.matchAll(/^[-*]\s*(?<id>A-\d+)\b[.:)]?\s*(?<body>.+)$/gim)].map((match) => {
    const confidence = match.groups.body.match(/confidence:\s*(low|medium|high)/i)?.[1]?.toLowerCase() ?? 'medium';
    return { id: match.groups.id.toUpperCase(), text: match.groups.body.trim(), confidence };
  });
}

export const hasFolder = (root, folder = DEFAULT_FOLDER) => exists(join(root, folder));
export { sectionOf };
