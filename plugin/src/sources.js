import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { estimateProseTokens } from './tokens.js';
import { which } from './which.js';
import { exists, readText, writeText } from './fsutil.js';

/**
 * A BRS is not memory. Specification §31.
 *
 * "Memory is what agents learned; a BRS is what the business asked for." So a source document
 * goes into the folder as a source, and requirements, entities and glossary terms are extracted
 * from it *with traceability back to the section they came from* — which is the whole reason this
 * subsystem exists rather than everyone pasting the brief into a chat.
 *
 * Four rules from §31, each ruling out the easy version:
 *
 *   * **Convert on ingest and commit the Markdown, not the docx.** A binary in git is a document
 *     nobody can diff, review or cite a line of.
 *   * **Split on the document's own numbering, not by token count**, so a citation means
 *     something to the business. `BRS-001 §4.2` has to be the section the business calls 4.2.
 *   * **Extract only explicit shall/must/will statements** and let the human add the rest.
 *     Inferring requirements from prose is how a spec acquires things nobody asked for.
 *   * **Redact before writing.** The folder is in git forever, and a BRS carries names, email
 *     addresses, phone numbers and contract values. The mapping is kept outside the repo.
 */

export const SOURCES_DIR = 'product/sources';

/** §31 — the abstract is about a hundred tokens, because it loads on every citing task. */
export const ABSTRACT_TOKENS = 100;

export const sourcesDir = (root, folder = DEFAULT_FOLDER) => join(root, folder, SOURCES_DIR);

/**
 * A source id is `BRS-001` or `DESC-001` and nothing else.
 *
 * It becomes a directory name inside the folder and a file name outside the repository (the
 * redaction mapping), so an id that could carry a `/` or a `..` would let `--id` choose where
 * those land. Checked once here, and every path builder goes through it.
 */
export const SOURCE_ID = /^(?:BRS|DESC)-\d{3,}$/;
export function assertSourceId(id) {
  if (!SOURCE_ID.test(String(id ?? ''))) {
    throw new Error(`"${id}" is not a source id. One looks like BRS-001 or DESC-001 — it names a folder, so it cannot carry a path.`);
  }
  return String(id);
}

export const sourcePath = (root, id, folder = DEFAULT_FOLDER) => join(sourcesDir(root, folder), assertSourceId(id));
export const indexPath = (root, folder = DEFAULT_FOLDER) => join(sourcesDir(root, folder), 'index.md');

/**
 * The redaction mapping lives here, never in the folder.
 *
 * §31 is explicit: "kept as an app asset outside the repo, never in the folder". A mapping in the
 * repository would undo the redaction completely, and it would look like diligence while doing it.
 */
export const mappingPath = (id) => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'redactions', `${assertSourceId(id)}.json`);

// ---------------------------------------------------------------- conversion

const NATIVE = new Set(['.md', '.markdown', '.txt', '.text']);

/** Converters for the formats a BRS actually arrives in. */
const CONVERTERS = [
  { command: 'pandoc', args: (input) => [input, '-t', 'markdown', '--wrap=none'] },
  { command: 'textutil', args: (input) => ['-convert', 'txt', '-stdout', input] },
];

export const converterFor = () => CONVERTERS.find((candidate) => which(candidate.command)) ?? null;

/**
 * The document as Markdown, or a refusal naming what to install.
 *
 * Nothing is half-converted: a BRS read as binary noise would produce sections and citations that
 * look real and point at nothing.
 */
export function convertSource(path) {
  const extension = extname(path).toLowerCase();
  if (NATIVE.has(extension)) return { ok: true, native: true };

  const converter = converterFor();
  if (!converter) {
    return {
      ok: false,
      reason: `${extension || 'that format'} needs converting to Markdown first, and neither pandoc nor textutil is installed. Install pandoc, or save the document as Markdown or plain text and ingest that — VibeKit commits the Markdown, never the original binary.`,
    };
  }
  try {
    const text = execFileSync(converter.command, converter.args(path), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, text, by: converter.command };
  } catch (error) {
    return { ok: false, reason: `${converter.command} could not read it: ${String(error.stderr ?? error.message).trim().split('\n')[0]}` };
  }
}

// ---------------------------------------------------------------- redaction (§31)

/**
 * The detectors, in the order §31 names them.
 *
 * Deliberately conservative on names: a capitalised pair of words is as often a product or a
 * place as a person, so only a line that introduces one as a person counts. Over-redacting a BRS
 * makes it unreadable, which gets the whole step switched off.
 */
export const DETECTORS = Object.freeze([
  { kind: 'EMAIL', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },
  // An international number has no leading zero on the area code, which is most of them. The
  // boundaries reject a longer token or a decimal on either side, but allow the full stop that
  // ends a sentence — a number written at the end of one is the ordinary case, not the exception.
  { kind: 'PHONE', pattern: /(?<!\w)(?<!\d\.)(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s-]\d{3,4}[\s-]?\d{3,4}(?!\w)(?!\.\d)/g },
  { kind: 'AMOUNT', pattern: /(?:[R$£€]\s?|\bZAR\s|\bUSD\s|\bGBP\s|\bEUR\s)\d[\d\s,]*(?:\.\d{2})?\b/g },
  { kind: 'PERSON', pattern: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][\w-]+(?:\s+[A-Z][\w-]+)?/g },
  { kind: 'PERSON', pattern: /\b(?:contact|owner|sponsor|signed(?:\s+off)?\s+by|approved\s+by|attention|attn)\s*:?\s+([A-Z][\w-]+\s+[A-Z][\w-]+)/gi },
]);

/**
 * What the detectors found, with a stable placeholder for each distinct value.
 *
 * Stable matters: the same name in section 2 and section 9 must become the same placeholder, or
 * the document stops making sense and a reader cannot tell whether two mentions are one person.
 */
/**
 * A random 40-character token with no known prefix walked straight past every regex above. Shannon
 * entropy catches the shape rather than the vendor: a base64 secret sits over five bits a character,
 * a git sha under four, an English word under three.
 */
export const ENTROPY_MIN = 4.5;

export function shannon(text) {
  const counts = new Map();
  for (const character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
}

export function highEntropyTokens(text) {
  const hits = [];
  for (const match of String(text ?? '').matchAll(/[A-Za-z0-9+/=_-]{32,}/g)) {
    const token = match[0];
    if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
    if (/^[0-9a-f]+$/i.test(token)) continue;
    // A UUID (hex and hyphens) is an identifier, not a secret; it appears in paths, tests and ids.
    if (/^[0-9a-f-]+$/i.test(token)) continue;
    // A subresource-integrity hash is random by construction and public by design.
    if (/^sha(?:256|384|512)-/.test(token)) continue;
    if (shannon(token) >= ENTROPY_MIN) hits.push(token);
  }
  return hits;
}

export function detect(text) {
  const found = [];
  const numbers = new Map();
  const placeholders = new Map();

  for (const token of highEntropyTokens(text)) {
    if (placeholders.has(token)) continue;
    const next = (numbers.get('SECRET') ?? 0) + 1;
    numbers.set('SECRET', next);
    const placeholder = `[SECRET-${next}]`;
    placeholders.set(token, placeholder);
    found.push({ kind: 'SECRET', value: token, placeholder });
  }

  for (const detector of DETECTORS) {
    for (const match of String(text ?? '').matchAll(detector.pattern)) {
      const value = (match[1] ?? match[0]).trim();
      if (!value || placeholders.has(value)) continue;
      const next = (numbers.get(detector.kind) ?? 0) + 1;
      numbers.set(detector.kind, next);
      const placeholder = `[${detector.kind}-${next}]`;
      placeholders.set(value, placeholder);
      found.push({ kind: detector.kind, value, placeholder });
    }
  }
  return found;
}

export const redact = (text, found) => found.reduce(
  (body, hit) => body.split(hit.value).join(hit.placeholder),
  String(text ?? ''),
);

// ---------------------------------------------------------------- sectioning (§31)

/**
 * Split on the document's own numbering.
 *
 * `4.2 Cancellation`, `## 4.2 Cancellation` and `4.2. Cancellation` are all the same section to
 * the business, and all three appear in real documents. Anything before the first numbered
 * heading is kept as a preamble rather than dropped, because a BRS usually opens with the scope
 * statement everything else refers back to.
 */
const HEADING = /^\s*(?:#{1,6}\s*)?(\d+(?:\.\d+)*)[.)]?\s+(.{2,120}?)\s*$/;

export function splitSections(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  const preamble = [];

  for (const line of lines) {
    const heading = line.match(HEADING);
    // A line of prose that happens to start with a figure is not a heading: a real one is short
    // and is followed by a body.
    if (heading && !/[.!?]$/.test(heading[2]) && heading[2].split(/\s+/).length <= 12) {
      current = { number: heading[1], title: heading[2].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((section) => ({
      number: section.number,
      title: section.title,
      slug: `${section.number}-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 60),
      body: section.lines.join('\n').trim(),
      tokens: estimateProseTokens(section.lines.join('\n')),
    })),
  };
}

// ---------------------------------------------------------------- extraction (§31)

/**
 * Only explicit shall/must/will statements, and the human adds the rest.
 *
 * §31's rule, and the reason is the failure it prevents: a tool that inferred requirements from
 * prose would fill the folder with things nobody asked for, each looking as authoritative as the
 * ones that were actually written down.
 */
const OBLIGATION = /\b(?:shall|must|will|is required to|is expected to)\b/i;
const NEGATIVE = /\b(?:shall|must|will)\s+not\b/i;

export function extractStatements(sections) {
  const statements = [];
  for (const section of sections) {
    for (const raw of section.body.split(/(?<=[.;])\s+|\n/)) {
      const sentence = raw.replace(/^\s*[-*\d.)]+\s*/, '').trim();
      if (sentence.length < 12 || !OBLIGATION.test(sentence)) continue;
      statements.push({
        section: section.number,
        cite: `§${section.number}`,
        text: sentence.replace(/\s+/g, ' ').slice(0, 300),
        negative: NEGATIVE.test(sentence),
      });
    }
  }
  return statements;
}

/** Candidate glossary terms: a capitalised noun phrase the document defines or repeats. */
export function extractTerms(text) {
  const counts = new Map();
  // The determiner is excluded by the pattern rather than stripped afterwards. Matching it first
  // consumed the phrase behind it — "The Booking Window" ate "Booking Window", so the term this
  // is looking for was never counted at all.
  const STOP = 'The|This|That|These|Those|Section|Appendix|Figure|Table|When|Where|Which|Each|Every|Any|All|Such|Its|Their';
  const pattern = new RegExp(`\\b(?!(?:${STOP})\\b)([A-Z][a-z]{2,}(?:\\s+(?!(?:${STOP})\\b)[A-Z][a-z]{2,})?)\\b`, 'g');
  for (const match of String(text ?? '').matchAll(pattern)) {
    const term = match[1];
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, times]) => times >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([term, times]) => ({ term, times }));
}

// ---------------------------------------------------------------- the files (§31)

export const abstractOf = (title, preamble, sections, statements) => [
  `# ${title}`,
  '',
  preamble ? trimTo(preamble, ABSTRACT_TOKENS - 30) : `${sections.length} numbered section(s).`,
  '',
  `${sections.length} section(s) · ${statements.length} explicit obligation(s). Cite a section to load its wording.`,
  '',
].join('\n');

function trimTo(text, tokens) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ');
  const keep = Math.max(10, Math.round(tokens * 0.75));
  return words.length <= keep ? words.join(' ') : `${words.slice(0, keep).join(' ')}…`;
}

export const extractFileOf = (id, statements, terms, sections) => [
  `# ${id} — what was pulled out`,
  '',
  'Generated. Every line cites the section it came from, so a requirement built on it can be checked',
  'against what was actually asked for.',
  '',
  '## Explicit obligations',
  '',
  statements.length ? '| Cite | Statement | Kind |\n| --- | --- | --- |' : '_No sentence in this document uses shall, must or will. Requirements from it are a human\'s reading, not an extraction._',
  ...statements.map((statement) => `| ${statement.cite} | ${statement.text.replace(/\|/g, '\\|')} | ${statement.negative ? 'prohibition' : 'obligation'} |`),
  '',
  '## Candidate glossary terms',
  '',
  terms.length ? terms.map((term) => `- **${term.term}** — used ${term.times} times; define it or drop it`).join('\n') : '_Nothing repeated often enough to be a term of art._',
  '',
  '## Sections',
  '',
  '| Cite | Title | Tokens |',
  '| --- | --- | --- |',
  ...sections.map((section) => `| §${section.number} | ${section.title.replace(/\|/g, '\\|')} | ${section.tokens} |`),
  '',
].join('\n');


/**
 * The index is written through the folder's own template, not a second renderer here.
 *
 * `product/sources/index.md` is a generated file the folder owns (it is in the layout, with a
 * budget). A private copy of the format in this module would be the third time two writers
 * disagreed about one file.
 */
export async function renderIndex(entries) {
  const { sourcesIndexBody } = await import('./folder/templates.js');
  const { withHeader } = await import('./folder/header.js');
  return withHeader('product/sources/index.md', 'sources', sourcesIndexBody(entries));
}

export async function readIndex(root, folder = DEFAULT_FOLDER) {
  const text = (await readText(indexPath(root, folder))) ?? '';
  return text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6 && /^(?:BRS|DESC)-\d+/.test(cells[0]))
    .map(([id, title, version, date, sections, redacted]) => ({
      id, title, version, date,
      sections: Number.parseInt(sections, 10) || 0,
      redacted: !/no/i.test(redacted),
    }));
}

export const nextSourceId = (entries, kind = 'BRS') => {
  const highest = entries
    .filter((entry) => entry.id.startsWith(`${kind}-`))
    .reduce((top, entry) => Math.max(top, Number.parseInt(entry.id.slice(kind.length + 1), 10) || 0), 0);
  return `${kind}-${String(highest + 1).padStart(3, '0')}`;
};

/** Which sections changed between two ingests of the same id. §31: only those produce asks. */
export async function changedSections(root, id, sections, folder = DEFAULT_FOLDER) {
  const dir = join(sourcePath(root, id, folder), 'sections');
  const existing = await readdir(dir).catch(() => []);
  if (!existing.length) return { first: true, added: sections.map((section) => section.number), changed: [], removed: [] };

  const added = [];
  const changed = [];
  for (const section of sections) {
    const previous = await readText(join(dir, `${section.slug}.md`));
    if (previous === null) added.push(section.number);
    else if (previous.replace(/^<!--[\s\S]*?-->\n/, '').trim() !== sectionBody(id, section).replace(/^<!--[\s\S]*?-->\n/, '').trim()) {
      changed.push(section.number);
    }
  }
  const kept = new Set(sections.map((section) => `${section.slug}.md`));
  const removed = existing.filter((name) => name.endsWith('.md') && !kept.has(name));
  return { first: false, added, changed, removed };
}

export const sectionBody = (id, section) => [
  `<!-- generated by vibekit · do not edit · source: ${id} §${section.number} -->`,
  `# §${section.number} ${section.title}`,
  '',
  section.body,
  '',
].join('\n');

/**
 * Write a source into the folder. Nothing here decides anything: the caller has already
 * confirmed the redaction, which is the one step §31 requires a human to see first.
 */
export async function writeSource(root, { id, title, version, text, found, redacted }, folder = DEFAULT_FOLDER) {
  const dir = sourcePath(root, id, folder);
  const body = redacted ? redact(text, found) : text;
  const { preamble, sections } = splitSections(body);
  const statements = extractStatements(sections);
  const terms = extractTerms(body);

  await writeText(join(dir, 'source.md'), `<!-- ${id} · converted on ingest · never loaded by an agent -->\n# ${title}\n\n${body}\n`);
  await writeText(join(dir, '.abstract'), abstractOf(title, preamble, sections, statements));
  await writeText(join(dir, 'extract.md'), extractFileOf(id, statements, terms, sections));
  for (const section of sections) {
    await writeText(join(dir, 'sections', `${section.slug}.md`), sectionBody(id, section));
  }

  const entries = (await readIndex(root, folder)).filter((entry) => entry.id !== id);
  entries.push({ id, title, version, date: new Date().toISOString().slice(0, 10), sections: sections.length, redacted });
  await writeText(indexPath(root, folder), await renderIndex(entries.sort((a, b) => a.id.localeCompare(b.id))));

  // Outside the repo, always. A mapping in the folder would undo the redaction while looking
  // like diligence.
  if (redacted && found.length) {
    await writeText(mappingPath(id), `${JSON.stringify({ id, at: new Date().toISOString(), found }, null, 2)}\n`);
    // This is the one file that undoes the redaction. Owner-only, or the redaction protected the
    // repository from everyone except whoever can read this user's home directory.
    const { ownerOnly } = await import('./fsutil.js');
    await ownerOnly(mappingPath(id));
  }

  return { id, dir, sections, statements, terms, mapping: redacted && found.length ? mappingPath(id) : null };
}

/** Every section of every source, for `why` to cite and `trace` to walk. */
export async function allSections(root, folder = DEFAULT_FOLDER) {
  const out = [];
  for (const entry of await readIndex(root, folder)) {
    const dir = join(sourcePath(root, entry.id, folder), 'sections');
    for (const name of (await readdir(dir).catch(() => [])).sort()) {
      if (!name.endsWith('.md')) continue;
      const text = (await readText(join(dir, name))) ?? '';
      const heading = text.match(/^#\s*§([\d.]+)\s*(.*)$/m);
      out.push({
        source: entry.id,
        number: heading?.[1] ?? name.replace(/\.md$/, ''),
        title: heading?.[2] ?? '',
        path: `${folder}/${SOURCES_DIR}/${entry.id}/sections/${name}`,
        body: text.replace(/^<!--[\s\S]*?-->\n/, '').replace(/^#[^\n]*\n/, '').trim(),
      });
    }
  }
  return out;
}

export const hasSources = async (root, folder = DEFAULT_FOLDER) => exists(indexPath(root, folder));

/**
 * What stage 1 would have to ask about, read off the text of a brief. Everything here is derived
 * from the document; nothing is invented, so an empty list means the brief is unusually complete
 * rather than that this gave up. Shared by `clarify` and the fixture runs, so a prompt edit that
 * changes the questions shows up as a diff against the golden outputs (§32, §5.4).
 */
export function briefGaps(text, { sections = null, statements = null, found = null } = {}) {
  const split = sections ?? splitSections(text).sections;
  const obligations = statements ?? extractStatements(split);
  const hits = found ?? detect(text);
  return [
    !split.length && 'it has no numbered sections, so nothing in it can be cited by a requirement',
    !obligations.length && 'no sentence uses shall, must or will, so there is nothing to extract as a requirement',
    !/\b(?:user|member|customer|staff|admin|operator|role)\b/i.test(text) && 'it never says who uses this',
    !/\b(?:must not|shall not|never|prohibit|forbid)\b/i.test(text) && 'it states no prohibition, and what a system must not do is usually where the risk is',
    !/\b(?:second|minute|hour|day|percent|%|uptime|availability|latency|response time)\b/i.test(text) && 'it sets no measurable target, so the non-functional section would be empty',
    !/\b(?:personal|financial|sensitive|gdpr|popia|retention|delete|erasure)\b/i.test(text) && 'it says nothing about data classification or retention',
    /\bshould be (?:fast|quick|responsive|scalable|secure|easy|simple|intuitive)\b/i.test(text) && 'it asks for something to be "fast", "secure" or "easy" without saying how fast, how secure or for whom — a wish, not a criterion',
    /\b(?:tbd|tbc|to be (?:decided|confirmed)|\?\?\?)\b/i.test(text) && 'it marks something as still to be decided, which is an ask before it is a requirement',
    hits.length > 0 && `it contains ${hits.length} thing(s) that must be redacted before it goes into git`,
  ].filter(Boolean);
}
