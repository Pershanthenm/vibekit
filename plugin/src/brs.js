import { briefGaps, extractStatements, splitSections } from './sources.js';

/**
 * A business requirements document, built from eight answers. For the person who has no BRS
 * and should not have to know what one looks like: they answer in their own words, and what is
 * written is the document the analyst would otherwise have to reconstruct from questions —
 * numbered sections a requirement can cite, and obligations in the words the parser reads.
 */

export const BRS_QUESTIONS = Object.freeze([
  { key: 'what', question: 'What is it, and who is it for?', hint: 'An app where store staff count stock on their phones and supervisors approve the differences.', list: false },
  { key: 'does', question: 'What should people be able to do with it? The main things, one per line.', hint: 'count a shelf and save it\napprove or reject a difference\nsee which shelves are still uncounted', list: true },
  { key: 'never', question: 'What must never happen?', hint: 'a difference gets posted without approval\none store sees another store\'s numbers', list: true },
  { key: 'limits', question: 'Any hard limits or things it must connect to? Speed, how many people, sensitive data, other systems.', hint: 'saving a count must feel instant on store wifi\n500 people counting at once on stock-take day\nsends the final counts to the ERP every night', list: true },
  { key: 'first', question: 'What is in the first version, and what can wait?', hint: 'first: counting and approvals\nlater: purchasing, forecasting', list: true },
]);

const OBLIGATION = /\b(?:shall|must|will|is required to|is expected to)\b/i;

/**
 * Suggested answers, so a person picks rather than types. Half come from the description they
 * already gave (its clauses, as things people do); half are the answers most apps share. The
 * analyst treats a picked suggestion exactly like a typed one: it is still the person's word.
 */
const GENERIC = Object.freeze({
  does: ['sign in with their work account', 'see a list of things and search it', 'add or change a record', 'approve or reject something before it counts', 'get a report or an export'],
  never: ['one user sees another user\'s data', 'something gets posted, paid or sent without approval', 'work is lost when the connection drops', 'a deleted record disappears without a trace', 'anyone can act without signing in'],
  limits: ['feels instant on a phone', 'hundreds of people using it at once', 'holds personal data, kept only as long as needed', 'single sign-on with the company account', 'exports or syncs to another system every night'],
});

/** Clauses of the description, as things people do: "Staff count stock on a phone; supervisors review variances" → two suggestions. */
function clausesOf(description) {
  return String(description ?? '')
    .split(/[;.]\s+|\s+(?:and then|, and|and)\s+/i)
    .map((clause) => clause.trim().replace(/[.;]$/, ''))
    .filter((clause) => clause.split(/\s+/).length >= 3 && clause.length <= 90)
    .map((clause) => clause.charAt(0).toLowerCase() + clause.slice(1))
    .slice(0, 4);
}

export function suggestionsFor(key, { description = null, does = [] } = {}) {
  if (key === 'does') {
    const own = clausesOf(description);
    return [...own, ...GENERIC.does].filter((item, index, all) => all.indexOf(item) === index).slice(0, 7);
  }
  if (key === 'never' || key === 'limits') return [...GENERIC[key]];
  if (key === 'first') return does.length ? does.map((item) => `first: ${item}`) : ['first: everything above', 'later: reports and integrations'];
  return [];
}

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


const IMPERATIVE = /^(?:allow|let|show|post|send|delete|remove|lose|leak|expose|charge|overwrite|store|share|reveal|accept|skip|bypass|ignore|drop|double|email|display|print|save|change|edit|approve|reject|create|give|grant|permit|log|record|keep|hide|block)\b/i;
function prohibition(line) {
  if (/\b(?:must|shall)\s+not\b/i.test(line)) return sentence(capital(line));
  const text = line.trim().replace(/^(?:it\s+)?(?:must|shall|should|may)\s+(?:not|never)\s+/i, '').replace(/^never\s+/i, '');
  if (IMPERATIVE.test(text)) return sentence(`The system must not ${text}`);
  return sentence(`The system must not allow this to happen: ${text}`);
}




/** A line under "what should people do" → an obligation. "role: action" names the role; a bare action is for everyone. */
function feature(line) {
  if (OBLIGATION.test(line)) return sentence(capital(line));
  const at = line.indexOf(':');
  if (at > 0) {
    const role = line.slice(0, at).trim();
    const action = line.slice(at + 1).trim();
    const article = /^[aeiou]/i.test(role) ? 'an' : 'a';
    return sentence(`The system shall let ${article} ${role} ${action}`);
  }
  return sentence(`The system shall let people ${line.trim()}`);
}

/** A limit or a connection: what it talks to reads as an integration, the rest as a target or a data rule. */
const THIRD_PERSON = /^(sends|receives|exports|imports|syncs|talks|connects|integrates|pushes|pulls|reads|writes|posts|emails|notifies|runs|loads|saves|supports|handles|works|needs|uses|stores|keeps|shows|updates|calls|fetches|checks)\b/i;
const base = (verb) => (/(?:ches|shes|sses|xes)$/i.test(verb) ? verb.slice(0, -2) : verb.replace(/s$/i, ''));
function limit(line) {
  if (/\b(?:should|needs? to|has to)\b/i.test(line) && !OBLIGATION.test(line)) return sentence(capital(line.trim().replace(/\b(?:should|needs? to|has to)\b/i, 'must')));
  if (OBLIGATION.test(line)) return sentence(capital(line));
  const text = line.trim();
  const conjugated = text.match(THIRD_PERSON);
  if (conjugated) return sentence(`The system will ${base(conjugated[1])}${text.slice(conjugated[1].length)}`);
  if (/^(?:connect|integrate|talk|sync|send|receive|export|import|push|pull|read|write|notify|call|fetch)\b/i.test(text)) return sentence(`The system will ${text}`);
  if (/\b(?:sso|sign[- ]on|erp|crm|ledger|api|gateway|webhook|payment|bucket|queue|active directory|ldap|okta|azure ad|entra)\b/i.test(text)) return sentence(`The system will integrate with ${text}`);
  if (/\b(?:personal|financial|sensitive|private|confidential|retention|kept|delete|gdpr|popia)\b/i.test(text)) return sentence(`The system will hold ${text}`);
  if (/^\d/.test(text)) return sentence(`The system must handle ${text}`);
  if (/^(?:be|have|handle|support|work|run|load|save|respond|allow|cope|stay|remain|fit)\b/i.test(text)) return sentence(`The system must ${text}`);
  return sentence(`The system must meet this limit: ${text}`);
}

function first(line) {
  const match = line.match(/^(first|now|in|v1|later|out|next)(?:\s+version)?\s*:\s*(.+)$/i);
  if (!match) return sentence(capital(line));
  const now = /^(?:first|now|in|v1)$/i.test(match[1]);
  return sentence(`The first version will ${now ? '' : 'not '}include ${match[2].trim()}`);
}

/** The document. Five numbered sections; every line under 2 to 5 an obligation the parser reads. */
export function brsBody(name, answers, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const get = (key) => splitAnswer(BRS_QUESTIONS.find((question) => question.key === key), answers[key]);
  const numbered = (n, items) => items.map((item, index) => `${n}.${index + 1} ${item}`);
  const section = (n, title, items, make, empty) => ['', `## ${n}. ${title}`, '', ...(items.length ? numbered(n, items.map(make)) : [`${n}.1 ${empty} is not yet decided.`])];
  return [
    `# ${name} — Requirements`,
    '',
    `Written with \`vibekit new spec\` on ${date}, from your answers. Edit it freely; \`vibekit ingest docs/spec.md\` re-reads it, and a requirement cites a section by its number.`,
    '',
    '## 1. What it is', '',
    sentence(get('what')[0] ?? `${name} is to be built`),
    ...section(2, 'What people can do', get('does'), feature, 'What people can do with it'),
    ...section(3, 'What must never happen', get('never'), prohibition, 'What must never happen'),
    ...section(4, 'Limits and connections', get('limits'), limit, 'Its limits, and what it connects to,'),
    ...section(5, 'The first version', get('first'), first, 'What the first version includes'),
    '',
  ].join('\n');
}

/** What the document still does not say, in the words the analyst will use for its first asks. */
export function brsGaps(text) {
  const { sections } = splitSections(text);
  const statements = extractStatements(sections);
  const gaps = briefGaps(text, { sections, statements, found: [] });
  const undecided = sections.filter((section) => /not yet (?:decided|been)/i.test(section.body)).map((section) => `§${section.number} ${section.title} is still empty`);
  return { sections: sections.length, statements: statements.length, gaps: [...undecided, ...gaps] };
}
