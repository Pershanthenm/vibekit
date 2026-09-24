import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontMatter } from './frontmatter.js';
import { openAsk } from './folder/asks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { listRequirements } from './folder/requirements.js';
import { readText } from './fsutil.js';

/**
 * Session notes into proposed memories. Specification §30.
 *
 * "Agents write only to `memory/sessions/<date>.md`, append-only, one line per learning, plus
 * `remember:` lines in a requirement's `## Log`. That is the only direct write."
 *
 * Everything else about memory goes through here, and the output is a **proposal**, never a
 * memory. That is the whole shape of it: an agent that could write into `memory/repo/` would be
 * an agent that teaches itself, and the next session would load its own guess as a fact.
 *
 * Distil also reports what has earned promotion. §30: "A healthy project's `memory/repo/` shrinks
 * over time as the folder learns" — a memory that keeps matching belongs in `standards/` or
 * `map.md`, where it is a rule rather than a hint.
 */

/** §30 — matched more than five times is the threshold for proposing promotion. */
export const PROMOTE_AFTER = 5;

/** §5 — a memory cannot override a guardrail, and one that tries is flagged rather than kept. */
const OVERRIDES_GUARDRAIL = /\b(?:skip|ignore|bypass|disable|turn off|work around)\b[^.]*\b(?:check|guardrail|test|review|gate|lint|migration)\b/i;

const sessionsDir = (root, folder) => join(root, folder, 'memory/sessions');
const repoDir = (root, folder) => join(root, folder, 'memory/repo');

/** One line per learning, with the day it was learned and the file it came from. */
export async function readSessionNotes(root, folder = DEFAULT_FOLDER) {
  const dir = sessionsDir(root, folder);
  const notes = [];
  for (const name of (await readdir(dir).catch(() => [])).filter((file) => file.endsWith('.md')).sort()) {
    const text = (await readText(join(dir, name))) ?? '';
    for (const raw of text.split('\n')) {
      const line = raw.replace(/^\s*[-*]\s+/, '').trim();
      if (!line || line.startsWith('#') || line.startsWith('<!--')) continue;
      notes.push({ from: `${folder}/memory/sessions/${name}`, date: name.replace(/\.md$/, ''), text: line });
    }
  }
  return notes;
}

/** `remember:` in a requirement's log is the other way an agent flags something (§30). */
export async function readRememberLines(root, folder = DEFAULT_FOLDER) {
  const requirements = await listRequirements(root, folder);
  const lines = [];
  for (const requirement of requirements) {
    for (const entry of requirement.log) {
      const remembered = entry.match(/\bremember:\s*(.+)$/i);
      if (remembered) lines.push({ from: `${folder}/product/requirements/${requirement.id}.md`, requirement: requirement.id, text: remembered[1].trim() });
    }
  }
  return lines;
}

export async function readMemories(root, folder = DEFAULT_FOLDER) {
  const dir = repoDir(root, folder);
  const memories = [];
  for (const name of (await readdir(dir).catch(() => [])).filter((file) => file.endsWith('.md')).sort()) {
    const text = (await readText(join(dir, name))) ?? '';
    const meta = readFrontMatter(text);
    memories.push({
      id: meta.id ?? name.replace(/\.md$/, ''),
      file: name,
      topic: String(meta.topic ?? '').replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean),
      by: meta.by ?? null,
      matched: Number.parseInt(String(meta.matched ?? '0'), 10) || 0,
      promotedTo: meta['promoted-to'] ?? null,
      archived: String(meta.archived ?? 'false') === 'true',
      text,
    });
  }
  return memories;
}

/**
 * Near-duplicate notes collapse into one proposal.
 *
 * Five sessions noticing the same thing is one memory with five witnesses, not five memories.
 * Comparison is on the significant words rather than the exact string, because the same learning
 * is never written twice the same way.
 */
/**
 * The significant words of a note, as a set.
 *
 * Not a truncated sorted string: the same learning is never written twice in the same order or
 * at the same length, and a key built from the first eight words missed every real duplicate.
 */
export const signature = (text) => new Set(String(text)
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((word) => word.length > 3 && !STOP_WORDS.has(word)));

const STOP_WORDS = new Set(['this', 'that', 'with', 'from', 'when', 'must', 'will', 'shall', 'been', 'have', 'else', 'than', 'then', 'they', 'were', 'what', 'which', 'would', 'could', 'should', 'otherwise', 'needs', 'need']);

/** How much two notes overlap, 0 to 1. */
export function similarity(a, b) {
  const left = signature(a);
  const right = signature(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** §30 — two notes this alike are one learning with two witnesses. */
export const SAME_LEARNING = 0.6;

export function group(notes, { threshold = SAME_LEARNING } = {}) {
  const groups = [];
  for (const note of notes) {
    if (!signature(note.text).size) continue;
    const existing = groups.find((candidate) => similarity(candidate.text, note.text) >= threshold);
    const target = existing ?? { text: note.text, witnesses: [], from: [] };
    if (!existing) groups.push(target);

    target.witnesses.push(note.date ?? note.requirement ?? 'unknown');
    if (!target.from.includes(note.from)) target.from.push(note.from);
    // The longest phrasing usually carries the most detail, which is what a human wants to read.
    if (note.text.length > target.text.length) target.text = note.text;
  }
  return groups.sort((a, b) => b.witnesses.length - a.witnesses.length);
}

const topicsFor = (text) => {
  const known = {
    domain: /\b(?:booking|member|customer|tenant|order|invoice|payment)\b/i,
    stack: /\b(?:dotnet|node|vue|react|postgres|redis|docker)\b/i,
    testing: /\b(?:test|flaky|fixture|mock|coverage)\b/i,
    deploy: /\b(?:deploy|pipeline|ci|environment|release)\b/i,
    auth: /\b(?:auth|token|permission|role|claim)\b/i,
    planning: /\b(?:plan|sequence|order|phase|dependency)\b/i,
    ui: /\b(?:ui|screen|component|token|design)\b/i,
  };
  return Object.entries(known).filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
};

/**
 * What distil would propose, without writing anything.
 *
 * Separated from the writing so `vibekit distil --dry-run` and the tracker can show the same
 * list, and so the promotion report can be read without creating an inbox full of asks.
 */
export async function plan(root, { folder = DEFAULT_FOLDER } = {}) {
  const [notes, remembered, memories] = await Promise.all([
    readSessionNotes(root, folder),
    readRememberLines(root, folder),
    readMemories(root, folder),
  ]);

  const known = memories.map((memory) => memory.text);
  const proposals = group([...notes, ...remembered])
    // Something already recorded is not proposed again; an inbox that repeats itself stops
    // being read, and §12's whole argument rests on the inbox being readable.
    .filter((candidate) => !known.some((recorded) => similarity(recorded, candidate.text) >= SAME_LEARNING))
    .map((candidate) => ({
      ...candidate,
      topic: topicsFor(candidate.text),
      refused: OVERRIDES_GUARDRAIL.test(candidate.text)
        ? 'this would override a guardrail, and a memory cannot do that (§5). It is reported, not proposed.'
        : null,
    }));

  return {
    notes: notes.length,
    remembered: remembered.length,
    proposals: proposals.filter((proposal) => !proposal.refused),
    refused: proposals.filter((proposal) => proposal.refused),
    // §30 — matched more than five times belongs in standards/, map.md or a skill.
    promote: memories.filter((memory) => memory.matched > PROMOTE_AFTER && !memory.promotedTo && !memory.archived),
    // A memory whose topic matches nothing can never be fetched, so it is dead weight in a file
    // that is always loaded.
    dead: memories.filter((memory) => !memory.topic.length && !memory.archived),
  };
}

/** Write the proposals as asks. Nothing becomes a memory here; a human accepts each one. */
export async function distil(root, { folder = DEFAULT_FOLDER, limit = 10 } = {}) {
  const planned = await plan(root, { folder });
  const opened = [];

  for (const proposal of planned.proposals.slice(0, limit)) {
    const ask = await openAsk(root, {
      kind: 'proposal',
      ask: `Remember: ${proposal.text}\n\nSeen in ${proposal.witnesses.length} session(s): ${proposal.from.join(', ')}.${proposal.topic.length ? `\n\nSuggested topic: ${proposal.topic.join(', ')}.` : ''}`,
      plain: `Should we write this down for next time? ${proposal.text}`,
      about: null,
    }, folder).catch(() => null);
    if (ask) opened.push({ id: ask.id, text: proposal.text, witnesses: proposal.witnesses.length });
  }

  return { ...planned, opened };
}
