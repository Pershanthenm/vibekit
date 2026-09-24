import { readdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { createRequirement, listRequirements, nextRequirementId } from './folder/requirements.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { readText, writeAtomic } from './fsutil.js';

/**
 * A spec for a codebase that never had one. Specification §41.
 *
 * "For a repo with tests, it drafts one requirement per test class, with the acceptance criteria
 * inferred from test names and the entities from the types touched, all `confidence: low` and
 * `status: draft`."
 *
 * The confidence is the whole design. Everything here is inferred from test names, which are the
 * closest thing a legacy codebase has to a statement of intent — and still only an approximation
 * of one. A drafted requirement that arrived looking authoritative would be worse than none,
 * because the first person to read it would build on it.
 *
 * "Spec Kit is greenfield-first; this is where most real software lives."
 */

const TEST_FILE = /(\.test\.|\.spec\.|_test\.|Tests?\.(?:cs|java|kt)$|(?:^|\/)test_)/i;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', 'vendor', 'coverage', '.next', 'target', '.venv', 'venv']);

/**
 * Only files that could hold a test. `.spec.` matches the folder's own `pipeline.spec.md`, and
 * drafting a requirement from VibeKit's deployment spec is exactly the kind of confident nonsense
 * this command has to avoid.
 */
const CODE = /\.(?:cs|fs|ts|tsx|js|jsx|mjs|cjs|vue|py|java|kt|go|rb|php|swift|rs|scala|dart)$/i;

/** How a test suite names one behaviour, across the frameworks people actually use. */
const CASE_PATTERNS = [
  // it('does the thing') · test("does the thing") · it.each(...)('...')
  /\b(?:it|test|scenario|specify)\s*(?:\.\w+\s*)?\(\s*(['"`])([^'"`]{4,200})\1/g,
  // [Fact] public void Cancel_ConfirmedBooking_IssuesRefund()
  /\[(?:Fact|Test|Theory)\][\s\S]{0,200}?\b(?:public|internal)\s+(?:async\s+)?\w[\w<>,\s]*\s+(\w{4,120})\s*\(/g,
  // def test_cancel_confirmed_booking_issues_refund(self):
  /\bdef\s+(test_\w{3,120})\s*\(/g,
  // @Test public void cancelConfirmedBookingIssuesRefund()
  /@Test\b[\s\S]{0,120}?\b(?:public|private)\s+\w[\w<>,\s]*\s+(\w{4,120})\s*\(/g,
];

/** The suite's name for the thing under test: `describe('Bookings')`, `class BookingTests`. */
const SUITE_PATTERNS = [
  /\b(?:describe|suite|context)\s*\(\s*(['"`])([^'"`]{2,120})\1/,
  /\b(?:public\s+)?(?:sealed\s+)?class\s+(\w+?)(?:Tests?|Spec)\b/,
  /\bclass\s+(Test\w+)\b/,
];

export async function findTestFiles(root, { max = 400 } = {}) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 6 || found.length >= max) return;
    for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) await walk(path, depth + 1);
        continue;
      }
      if (TEST_FILE.test(entry.name) && CODE.test(entry.name)) found.push(relative(root, path).split('\\').join('/'));
    }
  };
  await walk(root, 0);
  return found;
}

/**
 * A test name as a sentence.
 *
 * `Cancel_ConfirmedBooking_IssuesRefund` and `test_cancel_confirmed_booking_issues_refund` and
 * `cancels a confirmed booking` all describe one behaviour, and the point of reading them is
 * that somebody already wrote the intent down — badly, but down.
 */
export function humanise(name) {
  return String(name)
    .replace(/^test_?/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * EARS, as far as a test name supports it.
 *
 * A name with a condition ("when…", "if…", "…_WithNoCard_…") becomes an event or unwanted
 * criterion; anything else is ubiquitous. Nothing is invented to fill a pattern: a criterion that
 * claimed a trigger the test never mentions would be a fabricated requirement.
 */
/**
 * A third-person verb reads wrongly after "shall": "the system shall issues refund".
 *
 * Only the leading word is touched, and `-es` is stripped only after the endings that take it,
 * so `processes` becomes `process` rather than `processe`. A word that is already plural-looking
 * but not a verb (`address`) ends in a double s and is left alone.
 */
export function base(response) {
  const [first, ...rest] = String(response).split(' ');
  if (!first || /ss$/.test(first) || !/s$/.test(first)) return response;
  // The stem must end in a doubled s, not a single one: "processes" loses "es" and
  // "refuses" loses only the "s", because the verb is "refuse".
  const singular = /(?:ss|x|z|ch|sh)es$/.test(first) ? first.slice(0, -2) : first.slice(0, -1);
  return [singular, ...rest].join(' ');
}

export function criterionFrom(name) {
  const sentence = humanise(name);
  const words = sentence.split(' ');
  // The `test_` prefix is dropped before splitting, or the subject of the criterion is the word
  // "test" — which humanises to nothing and produces "If  is called with…".
  const stem = String(name).replace(/^test[_.]?/i, '');

  const unwanted = sentence.match(/^(?:refus|reject|throw|fail|error|deny|not )/) || /\b(?:invalid|missing|expired|unauthoris|unauthoriz|too late|no card|empty)\b/.test(sentence);
  const when = sentence.match(/\b(?:when|given|after|while|if)\s+(.+)$/);

  if (when) {
    const [, condition] = when;
    const response = words.slice(0, words.indexOf(when[0].split(' ')[0])).join(' ') || 'behave as the test asserts';
    return { text: `${unwanted ? 'If' : 'When'} ${condition}, ${unwanted ? 'then ' : ''}the system shall ${base(response)}.`, pattern: unwanted ? 'unwanted' : 'event' };
  }

  // `Cancel_ConfirmedBooking_IssuesRefund` — the middle part is the condition, the last the
  // response. This is the shape most .NET and Java suites use.
  const parts = stem.split(/[_.]/).filter(Boolean);
  // Exactly three: `Subject_Condition_Response` is an xUnit and JUnit idiom with three parts.
  // A longer snake_case name is a sentence, and splitting it produces a condition like "with".
  if (parts.length === 3 && humanise(parts[0])) {
    const [subject, condition, ...rest] = parts;
    return {
      text: `${unwanted ? 'If' : 'When'} ${humanise(subject)} is called with ${humanise(condition)}, ${unwanted ? 'then ' : ''}the system shall ${base(humanise(rest.join(' ')))}.`,
      pattern: unwanted ? 'unwanted' : 'event',
    };
  }

  return { text: `The system shall ${base(sentence)}.`, pattern: 'ubiquitous' };
}

/** Types the file mentions that look like entities, so the draft names a vocabulary to check. */
export function typesIn(text, vocabulary = []) {
  const known = new Set(vocabulary);
  const mentioned = new Set();
  for (const match of String(text ?? '').matchAll(/\b([A-Z][A-Za-z0-9]{2,})\b/g)) {
    const name = match[1];
    if (/^(?:Test|Tests|Fact|Theory|Assert|Should|Given|When|Then|Expect|It|Describe|Mock|Stub|Fake|Task|String|Int32|Guid|List|Dictionary|Exception|Console|Program)$/.test(name)) continue;
    if (!known.size || known.has(name)) mentioned.add(name);
  }
  return [...mentioned].sort().slice(0, 6);
}

export function suiteName(text, path) {
  for (const pattern of SUITE_PATTERNS) {
    const match = String(text ?? '').match(pattern);
    if (match) return (match[2] ?? match[1]).replace(/Tests?$|Spec$/i, '').trim();
  }
  return basename(path, extname(path)).replace(/[._-](?:test|spec|tests)$/i, '');
}

export function casesIn(text) {
  const names = [];
  for (const pattern of CASE_PATTERNS) {
    for (const match of String(text ?? '').matchAll(new RegExp(pattern.source, pattern.flags))) {
      names.push(match[2] ?? match[1]);
    }
  }
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

/**
 * What `reverse` would draft, without writing it.
 *
 * A test file with no recognisable cases is reported rather than skipped: it is the one signal
 * that this codebase's tests are shaped in a way this cannot read, which the person running it
 * needs to know before trusting the count.
 */
export async function planReverse(root, { folder = DEFAULT_FOLDER, vocabulary = [] } = {}) {
  const files = await findTestFiles(root);
  const drafts = [];
  const unreadable = [];

  for (const path of files) {
    const text = (await readText(join(root, path))) ?? '';
    const cases = casesIn(text);
    if (!cases.length) {
      unreadable.push(path);
      continue;
    }
    drafts.push({
      path,
      title: `${suiteName(text, path)} behaves as its tests describe`,
      suite: suiteName(text, path),
      entities: typesIn(text, vocabulary),
      criteria: cases.slice(0, 12).map((name, index) => ({ id: `AC-${index + 1}`, name, ...criterionFrom(name) })),
      cases: cases.length,
    });
  }

  return { files: files.length, drafts, unreadable };
}

/**
 * Draft one requirement per test class.
 *
 * Every one is `status: draft` with `confidence: low`, and its Verification already names the
 * test that produced each criterion — which is the one part of a reversed requirement that is
 * not an inference. §41's requirements are a starting point for a human, not a spec.
 */
export async function reverse(root, { folder = DEFAULT_FOLDER, vocabulary = [], limit = 50 } = {}) {
  const planned = await planReverse(root, { folder, vocabulary });
  const existing = await listRequirements(root, folder);
  const written = [];

  for (const draft of planned.drafts.slice(0, limit)) {
    // A suite already reversed is not reversed again; running it twice should not double the
    // backlog, which is the failure that makes a one-shot command unusable.
    if (existing.some((requirement) => requirement.title === draft.title)) continue;

    const id = nextRequirementId([...existing, ...written.map((entry) => ({ id: entry.id }))], 'requirement');
    await createRequirement(root, { id, title: draft.title, kind: 'requirement', size: null, source: null }, folder);

    const path = join(root, folder, 'product/requirements', `${id}.md`);
    const text = (await readText(path)) ?? '';
    await writeAtomic(path, fill(text, id, draft));
    written.push({ id, ...draft });
  }

  return { ...planned, written };
}

const section = (text, heading, body) => {
  const pattern = new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n[\\s\\S]*?(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im');
  // The trailing newline is part of the block: without it the next heading joins the last
  // bullet, and every Markdown reader shows one run-on line instead of two sections.
  const block = `## ${heading}\n\n${body.trim()}\n`;
  return pattern.test(text) ? text.replace(pattern, block) : `${text.trimEnd()}\n\n${block}`;
};

function fill(text, id, draft) {
  let body = text
    .replace(/^status:.*$/m, 'status: draft')
    .replace(/^source:.*$/m, `source: ${draft.path}`)
    .replace(/^entities:.*$/m, `entities: [${draft.entities.join(', ')}]`);

  if (!/^confidence:/m.test(body)) body = body.replace(/^status: draft$/m, 'status: draft\nconfidence: low');

  body = section(body, 'Acceptance', draft.criteria.map((criterion) => `- ${criterion.id}  ${criterion.text}`).join('\n'));
  body = section(body, 'Verification', draft.criteria.map((criterion) => `- ${criterion.id} — ${draft.path} · \`${criterion.name}\``).join('\n'));
  body = section(body, 'Log', [
    `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} drafted by \`vibekit reverse\` from ${draft.cases} test(s) in ${draft.path}`,
    '- Every criterion above was inferred from a test name. Read each one against the test before setting this ready.',
  ].join('\n'));

  return body.endsWith('\n') ? body : `${body}\n`;
}
