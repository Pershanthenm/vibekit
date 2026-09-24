import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { estimateCodeTokens, estimateProseTokens } from './tokens.js';
import { readText, writeAtomic, writeText } from './fsutil.js';

/**
 * A session, and what it is allowed to put in its own context. Specification §60.
 *
 * Three layers of memory, each with one home: the working context (here), the task state (the
 * requirement file), and long-term memory (`memory/`). This module owns the first and nothing
 * else — which is why it can be strict about it.
 *
 * The strictness is the point. Every limit below exists because the alternative is a session
 * that runs until it has forgotten the standards it was given at the start, and then writes code
 * as if they did not exist.
 */

/** §60 — a soft limit at 60 per cent of the window, a hard limit at 80. */
export const SOFT_LIMIT = 0.6;
export const HARD_LIMIT = 0.8;

/** §60/§61 — the always-loaded set is ~4,900 tokens and the scoped set for a requirement ~1,500. */
export const ALWAYS_LOADED = 4900;
export const SCOPED = 1500;

/** §60 — past this many tool calls without a checkpoint, writes are refused until one is written. */
export const CADENCE_LIMIT = 12;

/** §60 — a file read over this many lines is refused unless the agent names a line range. */
export const READ_LINES = 300;
export const GREP_HITS = 50;

export const sessionsPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, '.state/sessions.json');
export const sessionDir = (root, id, folder = DEFAULT_FOLDER) => join(root, folder, '.state/sessions', id);

export async function readSessions(root, folder = DEFAULT_FOLDER) {
  try {
    const parsed = JSON.parse((await readText(sessionsPath(root, folder))) ?? '{}');
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    // State is disposable; a corrupt file is rebuilt rather than reported as a failure.
    return [];
  }
}

/**
 * §60 — sessions are numbered and recorded with model, role, requirement, tokens in and out,
 * compactions, checkpoints written, and how the session ended.
 *
 * §62 adds runner, tier and why it was chosen, so the budget and security reports are complete
 * regardless of where the work happened.
 */
export async function record(root, session, folder = DEFAULT_FOLDER) {
  const sessions = await readSessions(root, folder);
  const existing = sessions.findIndex((entry) => entry.id === session.id);
  const entry = {
    id: session.id,
    at: session.at ?? new Date().toISOString(),
    requirement: session.requirement ?? null,
    role: session.role ?? null,
    runner: session.runner ?? null,
    tier: session.tier ?? null,
    model: session.model ?? null,
    why: session.why ?? [],
    attended: session.attended ?? null,
    input: Number(session.input ?? 0),
    output: Number(session.output ?? 0),
    cached: Number(session.cached ?? 0),
    compactions: Number(session.compactions ?? 0),
    checkpoints: Number(session.checkpoints ?? 0),
    escalated: Boolean(session.escalated),
    size: session.size ?? null,
    sandbox: session.sandbox ?? null,
    ended: session.ended ?? null,
    // External MCP calls (integration spec §2): server, tool, role, outcome — never the payloads.
    calls: Array.isArray(session.calls) ? session.calls : undefined,
  };
  if (entry.calls === undefined) delete entry.calls;
  if (existing >= 0) sessions[existing] = { ...sessions[existing], ...entry };
  else sessions.push(entry);
  await writeAtomic(sessionsPath(root, folder), `${JSON.stringify({ sessions }, null, 2)}\n`);
  return entry;
}

export const nextSessionId = (sessions) => {
  const highest = sessions.reduce((top, session) => {
    const number = Number.parseInt(String(session.id ?? '').replace(/^s-/, ''), 10);
    return Number.isFinite(number) && number > top ? number : top;
  }, 0);
  return `s-${String(highest + 1).padStart(4, '0')}`;
};

// ---------------------------------------------------------------- the context window

/**
 * Where a session is against its window, and what that means it must do next.
 *
 * The two limits do different jobs. The soft one asks for a checkpoint and tells the agent to
 * finish the step it is on rather than open another file. The hard one ends the session — cleanly,
 * with the checkpoint written and the requirement still held — and a new one continues from it.
 * Neither is advice: at the hard limit there is not enough room left to finish anything, and a
 * session that keeps going produces work nobody can review.
 */
export function windowState({ used, window, softLimit = SOFT_LIMIT, hardLimit = HARD_LIMIT }) {
  const share = window > 0 ? used / window : 0;
  if (share >= hardLimit) {
    return {
      share,
      level: 'hard',
      action: 'end the session cleanly: write the checkpoint, leave the worktree as it is, keep the requirement in-progress with the holder recorded',
      log: 'continued after context limit',
    };
  }
  if (share >= softLimit) {
    return {
      share,
      level: 'soft',
      action: 'checkpoint now, and finish the current step without starting another file',
      log: null,
    };
  }
  return { share, level: 'ok', action: null, log: null };
}

/** What is left for work once the folder has been loaded. */
export const roomForWork = (window, { always = ALWAYS_LOADED, scoped = SCOPED } = {}) =>
  Math.max(0, Math.round(window * HARD_LIMIT) - always - scoped);

// ---------------------------------------------------------------- trimming tool output (§60)

/**
 * Tool output is trimmed before it enters context, and the full output is kept on disk.
 *
 * §60 calls this a cost control as much as a context one: test logs are the largest avoidable
 * input on most sessions. The rule that makes it safe is that nothing is discarded — the whole
 * output goes to `.state/sessions/<id>/` for the reviewer and for `verify`.
 */
export function trimTestOutput(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const summary = lines.filter((line) => /\b(\d+)\s+(?:passing|passed|failing|failed|tests?)\b|\bTests run:|\bok\b\s*\d|^ℹ\s*(?:tests|pass|fail)/i.test(line));
  const failures = lines.filter((line) => /^\s*(?:✖|✗|FAIL|not ok|E\s)|\bAssertionError\b|\bfailed\b/i.test(line));
  const kept = [...new Set([...summary, ...failures])];
  return kept.length ? kept.join('\n') : lines.slice(-20).join('\n');
}

export function trimBuildOutput(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const kept = lines.filter((line) => /\b(?:error|warning)\b|\berror [A-Z]+\d+|^\s*\^/i.test(line));
  return kept.length ? kept.join('\n') : lines.slice(-10).join('\n');
}

export const trimGrep = (text, hits = GREP_HITS) => {
  const lines = String(text ?? '').split('\n').filter(Boolean);
  if (lines.length <= hits) return lines.join('\n');
  return [...lines.slice(0, hits), `… ${lines.length - hits} more hit(s). Narrow the pattern or name a path.`].join('\n');
};

/**
 * Why a file read is refused, or null when it is allowed.
 *
 * §60 refuses a read over 300 lines unless the agent names a line range. The refusal names the
 * count so the agent can pick a range rather than guess at one.
 */
export function refuseRead(text, { range = null, limit = READ_LINES } = {}) {
  if (range) return null;
  const lines = String(text ?? '').split('\n').length;
  if (lines <= limit) return null;
  return `That file is ${lines} lines, over the ${limit}-line limit. Name a line range, or grep for what you actually need — reading it whole would spend a fifth of the window on one file.`;
}

export const trimFor = (kind, text) => {
  if (kind === 'test') return trimTestOutput(text);
  if (kind === 'build') return trimBuildOutput(text);
  if (kind === 'grep') return trimGrep(text);
  return text;
};

/** The full output, kept where the reviewer and `verify` can read it. */
export async function keepOutput(root, id, name, text, folder = DEFAULT_FOLDER) {
  const dir = sessionDir(root, id, folder);
  await mkdir(dir, { recursive: true });
  await writeText(join(dir, name), String(text ?? ''));
  return join(dir, name);
}

// ---------------------------------------------------------------- checkpoint cadence (§60)

/**
 * §60 — "past 12 tool calls or one completed loop step without one, it injects the instruction to
 * checkpoint now and refuses further file writes until one is written."
 *
 * Refusing the write is what makes it real. An instruction to checkpoint that an agent can
 * decline is an instruction that stops being followed on the session where it matters most.
 */
export function cadence({ callsSinceCheckpoint = 0, stepCompleted = false, limit = CADENCE_LIMIT } = {}) {
  const over = callsSinceCheckpoint >= limit;
  if (!over && !stepCompleted) return { due: false, refuseWrites: false, instruction: null };
  return {
    due: true,
    refuseWrites: over,
    instruction: over
      ? `${callsSinceCheckpoint} tool calls since the last checkpoint. Write \`## Checkpoint\` now — file writes are refused until you do.`
      : 'A loop step is complete. Write `## Checkpoint` before starting the next one.',
  };
}

// ---------------------------------------------------------------- compaction (§60)

/**
 * What is re-sent after a compaction, in this order and nothing else.
 *
 * §60 fixes the order, and §61 explains why it cannot vary: the always-loaded set is identical
 * across every session on a repo, so a stable order is what lets a provider cache it. A re-send
 * that reshuffled itself would pay full price every time.
 */
export const COMPACTION_ORDER = Object.freeze([
  'standards/*',
  'the requirement file, which now includes the checkpoint',
  'the entity sections the requirement names',
  'the evidence block so far',
]);

export const compactionBrief = (requirement) => [
  'Your context was compacted. These are re-sent, in this order, and nothing else:',
  ...COMPACTION_ORDER.map((item, index) => `  ${index + 1}. ${item}`),
  '',
  `Re-read \`## Approach\` and \`## Checkpoint\` in ${requirement ?? 'the requirement'} before your next action, and continue from \`next:\` rather than re-planning.`,
].join('\n');

/**
 * The always-loaded set first and in a fixed order, so a provider's cache holds across sessions.
 * §61: this typically cuts input cost on that portion by an order of magnitude.
 */
export const CACHE_ORDER = Object.freeze(['pointer', 'standards', 'product core', 'indexes', 'scoped set']);

export const estimateFor = (kind, text) => (kind === 'prose' ? estimateProseTokens(text) : estimateCodeTokens(text));
