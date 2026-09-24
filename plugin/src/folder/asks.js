import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontMatter, setFrontMatterValue } from '../frontmatter.js';
import { readText, writeAtomic, writeText } from '../fsutil.js';
import { DEFAULT_FOLDER } from './layout.js';
import { parseList, sectionOf } from './requirements.js';

/**
 * The asks inbox. Specification §12.
 *
 * One place for everything an agent needs a human to decide, in two kinds and one shape. A
 * question is "I need information"; a proposal is "I need permission to add something the folder
 * lacks". Splitting them into two inboxes was considered and rejected: the person answering does
 * not care which kind it is, they care what is blocking and how much it matters.
 */

export const KINDS = Object.freeze(['question', 'proposal', 'conflict', 'security']);
export const STATUSES = Object.freeze(['open', 'waiting', 'answered', 'accepted', 'rejected', 'deferred']);
export const OPEN_STATUSES = Object.freeze(['open', 'waiting']);
export const PROPOSAL_ABOUT = Object.freeze(['entity', 'field', 'rule', 'skill', 'package', 'path']);

/** §12 — an ask nobody answers is a requirement nobody can finish. `ask-threshold` in profile.md. */
export const ASK_THRESHOLD_DAYS = 3;

/**
 * §12 — "People will not remember the technical version and should not have to."
 *
 * The cap is small on purpose. Sixty words is about four sentences; past that the writer has
 * started explaining the implementation again, which is what the section exists to keep out.
 */
export const PLAIN_WORD_CAP = 60;

const dir = (root, folder) => join(root, folder, 'workflow/asks');
const answersDir = (root, folder) => join(root, folder, 'workflow/answers');
const FILE = /^[QP]-\d+[\w.-]*\.md$/;

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ask';

export const wordCount = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

export function parseAsk(fileName, text) {
  const meta = readFrontMatter(text);
  const asked = meta.asked ? new Date(meta.asked) : null;
  const plain = sectionOf(text, 'In plain terms');
  return {
    id: meta.id ?? fileName.replace(/\.md$/, ''),
    file: fileName,
    kind: KINDS.includes(meta.kind) ? meta.kind : 'question',
    for: meta.for?.trim() || null,
    // An empty `stage:` in the front matter parses as '', which is not null — so `?? 'general'`
    // downstream produced a file called `-answers.md`: a leading dash, hostile to every shell
    // tool, and not the filename anybody would look in.
    stage: String(meta.stage ?? '').trim() || null,
    by: meta.by ?? null,
    about: meta.about?.trim() || null,
    blocking: String(meta.blocking ?? 'false') === 'true',
    topic: parseList(meta.topic),
    source: meta.source?.trim() || null,
    status: STATUSES.includes(meta.status) ? meta.status : 'open',
    asked: meta.asked ?? null,
    waitingDays: asked && !Number.isNaN(asked.valueOf()) ? Math.floor((Date.now() - asked.valueOf()) / 86400000) : 0,
    plain,
    plainWords: wordCount(plain),
    ask: sectionOf(text, 'Ask') || sectionOf(text, 'Question'),
    why: sectionOf(text, 'Why it matters'),
    options: sectionOf(text, 'Options the agent can see')
      .split('\n')
      .map((line) => line.replace(/^\s*\d+[.)]\s*|^[-*]\s+/, '').trim())
      .filter(Boolean),
    answer: sectionOf(text, 'Answer'),
    text,
  };
}

export async function listAsks(root, folder = DEFAULT_FOLDER) {
  const names = (await readdir(dir(root, folder)).catch(() => [])).filter((name) => FILE.test(name)).sort();
  const found = [];
  for (const name of names) {
    const text = await readText(join(dir(root, folder), name));
    if (text !== null) found.push(parseAsk(name, text));
  }
  return found;
}

export const isOpen = (ask) => OPEN_STATUSES.includes(ask.status);

/**
 * §44 and §57 — how many requirements wait on each ask, so the inbox can be sorted by what
 * unblocks the most work rather than by what arrived first.
 */
export function blastRadius(ask, requirements) {
  if (!ask.for) return 0;
  const direct = requirements.find((entry) => entry.id === ask.for);
  if (!direct) return 0;
  const blocked = new Set([direct.id]);
  // A requirement whose `after:` chain reaches the blocked one is waiting on this ask too.
  let grew = true;
  while (grew) {
    grew = false;
    for (const requirement of requirements) {
      if (blocked.has(requirement.id) || requirement.status === 'done') continue;
      if (requirement.after.some((id) => blocked.has(id))) {
        blocked.add(requirement.id);
        grew = true;
      }
    }
  }
  return blocked.size;
}

export function nextAskId(asks, kind) {
  const prefix = kind === 'proposal' ? 'P' : 'Q';
  const highest = asks
    .filter((ask) => ask.id.startsWith(`${prefix}-`))
    .reduce((top, ask) => {
      const number = Number.parseInt(ask.id.slice(2), 10);
      return Number.isFinite(number) && number > top ? number : top;
    }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`;
}

export function askBody({ id, kind, forRequirement, stage, by, blocking, topic, about, source, plain, ask, why, options }) {
  const lines = [
    '---',
    `id: ${id}`,
    `kind: ${kind}`,
    `for: ${forRequirement ?? ''}`,
    `stage: ${stage ?? ''}`,
    `asked: ${new Date().toISOString().slice(0, 10)}`,
    `by: ${by ?? 'unknown'}`,
    `blocking: ${blocking ? 'true' : 'false'}`,
    `topic: [${(topic ?? []).join(', ')}]`,
  ];
  if (about) lines.push(`about: ${about}`);
  if (source) lines.push(`source: ${source}`);
  lines.push('status: waiting', '---', '');
  lines.push('## In plain terms', '', plain?.trim() || 'TODO: two or three sentences a non-technical colleague would understand.', '');
  lines.push(kind === 'proposal' ? '## Ask' : '## Question', '', ask.trim(), '');
  lines.push('## Why it matters', '', why?.trim() || 'TODO: what happens if this is not decided.', '');
  if (options?.length) {
    lines.push('## Options the agent can see', '', ...options.map((option, index) => `${index + 1}. ${option}`), '');
  }
  lines.push('## Answer', '', '');
  return lines.join('\n');
}

/**
 * Writing an ask is what an agent does instead of inventing. A blocking ask also stops the
 * requirement it is for, so the board shows the work stopped and why, rather than showing it
 * running while it waits on a person.
 */
export async function openAsk(root, options, folder = DEFAULT_FOLDER) {
  const { kind = 'question', ask, forRequirement = null } = options;
  if (!KINDS.includes(kind)) throw new Error(`"${kind}" is not an ask kind. Use one of: ${KINDS.join(', ')}.`);
  if (!ask?.trim()) throw new Error('An ask needs a body: what exactly you need decided.');
  // §12 — plain language first, every time. The person who can answer an ask is usually not the
  // person who can read the technical version, and an ask they cannot read is a decision that
  // waits until somebody translates it. The MCP tool declared this required and did not check it.
  if (!String(options.plain ?? '').trim()) {
    throw new Error('An ask needs its plain terms: the same question in words a non-technical person can answer. Pass --plain "…".');
  }
  if (options.about && !PROPOSAL_ABOUT.includes(options.about)) {
    throw new Error(`--about must be one of: ${PROPOSAL_ABOUT.join(', ')}.`);
  }

  const existing = await listAsks(root, folder);
  const id = nextAskId(existing, kind);
  const path = join(dir(root, folder), `${id}-${slug(options.plain || ask)}.md`);
  await writeText(path, askBody({ ...options, id, kind, forRequirement }));
  return { id, path };
}

/**
 * Answering writes the decision into the ask and appends it to the stage's answer file, which is
 * append-only so the record of who decided what survives a later change of mind.
 */
export async function answerAsk(root, id, { answer, by, status = null }, folder = DEFAULT_FOLDER) {
  const asks = await listAsks(root, folder);
  const ask = asks.find((entry) => entry.id.toLowerCase() === String(id).toLowerCase());
  if (!ask) throw new Error(`No ask ${id} in ${folder}/workflow/asks/.`);
  if (!answer?.trim()) throw new Error('An answer needs words.');

  const path = join(dir(root, folder), ask.file);
  const text = await readText(path);
  const settled = status ?? (ask.kind === 'proposal' ? 'accepted' : 'answered');
  const withAnswer = text.replace(
    /^##\s+Answer\s*\n[\s\S]*$/im,
    `## Answer\n\n${answer.trim()}\n\n— ${by ?? 'unknown'}, ${new Date().toISOString().slice(0, 10)}\n`,
  );
  await writeAtomic(path, setFrontMatterValue(withAnswer, 'status', settled));

  const stageFile = join(answersDir(root, folder), `${ask.stage ?? 'general'}-answers.md`);
  const previous = (await readText(stageFile)) ?? '# Answers\n\nAppend-only. One entry per decision.\n';
  const entry = `\n## ${ask.id} — ${new Date().toISOString().slice(0, 10)} — ${by ?? 'unknown'}\n\n${answer.trim()}\n`;
  await writeText(stageFile, `${previous.trimEnd()}\n${entry}`);

  return { id: ask.id, status: settled, for: ask.for, kind: ask.kind };
}

export async function rejectAsk(root, id, { reason, by }, folder = DEFAULT_FOLDER) {
  return answerAsk(root, id, { answer: reason || 'Rejected.', by, status: 'rejected' }, folder);
}
