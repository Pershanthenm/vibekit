import { briefGaps, extractStatements, splitSections } from './sources.js';

/**
 * A business requirements document, built from eight answers. For the person who has no BRS
 * and should not have to know what one looks like: they answer in their own words, and what is
 * written is the document the analyst would otherwise have to reconstruct from questions —
 * numbered sections a requirement can cite, and obligations in the words the parser reads.
 */

export const BRS_QUESTIONS = Object.freeze([
  { key: 'purpose', question: 'What is it for? One sentence.', hint: 'Staff count stock on a phone; supervisors review the variances before they are posted.', list: false },
  { key: 'users', question: 'Who uses it? The kinds of user, comma-separated.', hint: 'staff, supervisor, admin', list: true, separator: ',' },
  { key: 'capabilities', question: 'What must it let them do? One per line, as "role: action".', hint: 'staff: count a bin and save the quantity\nsupervisor: review and approve a variance\nadmin: add a location', list: true },
  { key: 'rules', question: 'What must it never do or allow?', hint: 'post a variance nobody approved\nshow another store\'s counts', list: true },
  { key: 'targets', question: 'What must be measurable? Response time, uptime, volumes, deadlines.', hint: 'a count saves within 2 seconds on a store wifi\n500 counters at once on stock-take day', list: true },
  { key: 'data', question: 'What data does it hold, and how sensitive is it? Personal, financial, how long it is kept.', hint: 'staff names and ids (personal)\nstock values in ZAR (financial), kept 7 years', list: true },
  { key: 'integrations', question: 'What does it talk to? Systems, APIs, files. "None" is an answer.', hint: 'the ERP stock ledger (nightly file)\nsingle sign-on', list: true },
  { key: 'scope', question: 'What is in the first release, and what is out?', hint: 'in: counting, variance review\nout: purchasing, forecasting', list: true },
]);

const OBLIGATION = /\b(?:shall|must|will|is required to|is expected to)\b/i;

/** Split a list answer: lines, or the question's separator, or semicolons; blanks dropped. */
export function splitAnswer(question, value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (!question.list) return [text];
  const separator = question.separator === ',' ? /[,\n;]+/ : /[\n;]+/;
  return text.split(separator).map((item) => item.trim()).filter(Boolean);
}

/** `--answer key=value` flags and a JSON file into one answers object; unknown keys are refused. */
export function parseAnswers(flags = [], fromJson = null) {
  const answers = { ...(fromJson ?? {}) };
  for (const flag of flags) {
    const at = String(flag).indexOf('=');
    if (at < 1) throw new Error(`--answer needs key=value, not "${flag}". Keys: ${BRS_QUESTIONS.map((question) => question.key).join(', ')}.`);
    answers[flag.slice(0, at).trim()] = flag.slice(at + 1);
  }
  for (const key of Object.keys(answers)) {
    if (!BRS_QUESTIONS.some((question) => question.key === key)) throw new Error(`"${key}" is not a BRS question. Keys: ${BRS_QUESTIONS.map((question) => question.key).join(', ')}.`);
  }
  return answers;
}

const sentence = (text) => {
  const trimmed = String(text).trim().replace(/\s+/g, ' ');
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** "role: action" → "The system shall let a role action."; a bare action → "The system shall action."; an obligation already phrased is kept. */
function capability(line) {
  if (OBLIGATION.test(line)) return sentence(capital(line));
  const at = line.indexOf(':');
  if (at > 0) {
    const role = line.slice(0, at).trim();
    const action = line.slice(at + 1).trim();
    const article = /^[aeiou]/i.test(role) ? 'an' : 'a';
    return sentence(`The system shall let ${article} ${role} ${action}`);
  }
  return sentence(`The system shall ${line.trim()}`);
}

function prohibition(line) {
  const text = line.trim().replace(/^(?:it\s+)?(?:must|shall|should)\s+(?:not|never)\s+/i, '').replace(/^never\s+/i, '');
  if (/\b(?:must|shall)\s+not\b/i.test(line)) return sentence(capital(line));
  return sentence(`The system must not ${text}`);
}

function target(line) {
  return OBLIGATION.test(line) ? sentence(capital(line)) : sentence(`The system shall meet this target: ${line.trim()}`);
}

function integration(line) {
  if (/^(?:none|nothing|n\/a)\.?$/i.test(line.trim())) return 'The system will integrate with nothing in the first release.';
  return OBLIGATION.test(line) ? sentence(capital(line)) : sentence(`The system will integrate with ${line.trim()}`);
}

function scope(line) {
  const match = line.match(/^(in|out)(?:\s+of\s+scope)?\s*:\s*(.+)$/i);
  if (!match) return sentence(capital(line));
  return match[1].toLowerCase() === 'in' ? sentence(`The first release will include ${match[2].trim()}`) : sentence(`The first release will not include ${match[2].trim()}`);
}

/** The document. Every section numbered, every requirement a sentence the parser reads as an obligation. */
export function brsBody(name, answers, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const get = (key) => splitAnswer(BRS_QUESTIONS.find((question) => question.key === key), answers[key]);
  const numbered = (n, items) => items.map((item, index) => `${n}.${index + 1} ${item}`);
  const users = get('users');
  const lines = [
    `# ${name} — Business Requirements`,
    '',
    `Written with \`vibekit new brs\` on ${date}. Edit it freely; \`vibekit ingest docs/brs.md\` re-reads it, and a requirement cites a section by its number.`,
    '',
    '## 1. Purpose', '',
    sentence(get('purpose')[0] ?? `${name} is to be built.`), '',
    '## 2. Users', '',
    ...(users.length ? numbered(2, users.map((role) => sentence(`${capital(role)} is a kind of user of the system`))) : ['2.1 Who uses the system is not yet decided.']), '',
    '## 3. Functional requirements', '',
    ...(get('capabilities').length ? numbered(3, get('capabilities').map(capability)) : ['3.1 What the system must let its users do is not yet decided.']), '',
    '## 4. Rules and prohibitions', '',
    ...(get('rules').length ? numbered(4, get('rules').map(prohibition)) : ['4.1 What the system must never do or allow is not yet decided.']), '',
    '## 5. Measurable targets', '',
    ...(get('targets').length ? numbered(5, get('targets').map(target)) : ['5.1 What must be measurable is not yet decided.']), '',
    '## 6. Data', '',
    ...(get('data').length ? numbered(6, get('data').map((line) => (OBLIGATION.test(line) ? sentence(capital(line)) : sentence(`The system will hold ${line.trim()}`)))) : ['6.1 What data the system holds, and how sensitive it is, is not yet decided.']), '',
    '## 7. Integrations', '',
    ...(get('integrations').length ? numbered(7, get('integrations').map(integration)) : ['7.1 What the system talks to is not yet decided.']), '',
    '## 8. Scope of the first release', '',
    ...(get('scope').length ? numbered(8, get('scope').map(scope)) : ['8.1 What the first release includes is not yet decided.']), '',
  ];
  return lines.join('\n');
}

/** What the document still does not say, in the words the analyst will use for its first asks. */
export function brsGaps(text) {
  const { sections } = splitSections(text);
  const statements = extractStatements(sections);
  const gaps = briefGaps(text, { sections, statements, found: [] });
  const undecided = sections.filter((section) => /not yet (?:decided|been)/i.test(section.body)).map((section) => `§${section.number} ${section.title} is still empty`);
  return { sections: sections.length, statements: statements.length, gaps: [...undecided, ...gaps] };
}
