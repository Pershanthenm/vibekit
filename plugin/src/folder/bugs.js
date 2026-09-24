import { join } from 'node:path';
import { upsertFrontMatter } from '../frontmatter.js';
import { exists, readText, writeAtomic } from '../fsutil.js';
import { DEFAULT_FOLDER } from './layout.js';
import { appendLog, createRequirement, listRequirements, nextRequirementId, parseRequirement, requirementPath, writeSection } from './requirements.js';

/**
 * Bugs. Specification §23 (Findings and bugs) and §68 (Bug verdicts).
 *
 * "A bug is a requirement." It lives in `product/requirements/BUG-NNN.md` with `kind: bug`, EARS
 * criteria like any other, and the failing test that exposed it as its acceptance test. What makes
 * it a bug rather than a feature is four fields — who found it, where, what introduced it, how bad —
 * and one rule: no reproducing test, no bug. A bug nobody can reproduce is a report, not work.
 *
 * Fixing one is three jobs, and the verdict at the end is one of three words, never a sentence.
 */

export const SEVERITIES = Object.freeze(['high', 'medium', 'low']);
/** §23 — an agent may size a bug and fix one, but "that is a human judgement about impact". */
export const AGENT_SEVERITY_MAX = 'medium';
export const VERDICTS = Object.freeze(['verified', 'partial', 'failed']);

const rank = (severity) => SEVERITIES.indexOf(String(severity ?? '').toLowerCase());

/** Why this bug is not yet work, in the order a person would fix them. */
export function bugBlockers(bug) {
  const blockers = [];
  if (!bug.test) blockers.push('it names no reproducing test (`test:`). A bug nobody can reproduce is a report, not work.');
  if (rank(bug.severity) === -1) blockers.push(`severity is not one of ${SEVERITIES.join(', ')}`);
  if (!bug.foundBy) blockers.push('found-by: is empty — who or what noticed it');
  if (!bug.acceptance.length) blockers.push('it has no acceptance criterion stating the absence of the defect');
  return blockers;
}

/** §23 — severity decides placement, not priority arguments. */
export const placementFor = (severity) => (rank(severity) === 0
  ? { phase: 'current', blocksGate: true, why: 'high: enters the current sprint immediately and blocks the sprint gate' }
  : rank(severity) === 1
    ? { phase: 'backlog', blocksGate: false, why: 'medium: backlog, scheduled by a human at the next gate' }
    : { phase: 'backlog', blocksGate: false, why: 'low: backlog, no gate impact' });

export function refuseSeverity(severity, { by = 'human' } = {}) {
  if (rank(severity) === -1) return `"${severity}" is not a severity. One of: ${SEVERITIES.join(', ')}.`;
  if (by === 'agent' && rank(severity) < rank(AGENT_SEVERITY_MAX)) {
    return `An agent may not set severity above ${AGENT_SEVERITY_MAX}: how bad a defect is for the people using the software is a human judgement.`;
  }
  return null;
}

/**
 * Create a bug. `criterion` is the absence of the defect in EARS form; `test` is the failing test
 * that exposed it, committed with the bug before any fix.
 */
export async function createBug(root, {
  title, severity = 'medium', foundBy, foundOn = null, introducedBy = null, test = null, criterion = null, by = 'human', source = null,
}, folder = DEFAULT_FOLDER) {
  const refusal = refuseSeverity(severity, { by });
  if (refusal) throw new Error(refusal);
  const requirements = await listRequirements(root, folder);
  const id = nextRequirementId(requirements, 'bug');
  await createRequirement(root, { id, title, kind: 'bug', size: 'S', entities: [], source: source ?? foundOn ?? null }, folder);

  const path = requirementPath(root, id, folder);
  let text = await readText(path);
  text = upsertFrontMatter(text, 'severity', String(severity).toLowerCase());
  text = upsertFrontMatter(text, 'found-by', foundBy ?? 'unknown');
  text = upsertFrontMatter(text, 'found-on', foundOn ?? '');
  text = upsertFrontMatter(text, 'introduced-by', introducedBy ?? '');
  text = upsertFrontMatter(text, 'test', test ?? '');
  text = upsertFrontMatter(text, 'phase', placementFor(severity).phase);
  await writeAtomic(path, text);

  if (criterion) await writeSection(root, id, 'Acceptance', `- AC-1  ${String(criterion).trim().replace(/\.?$/, '.')}`, folder);
  await appendLog(root, id, `opened by ${foundBy ?? by}${foundOn ? ` on ${foundOn}` : ''} · severity ${severity} · ${placementFor(severity).why}`, folder);
  return { id, path, placement: placementFor(severity) };
}

export const readBug = async (root, id, folder = DEFAULT_FOLDER) => {
  const text = await readText(requirementPath(root, id, folder));
  if (text === null) throw new Error(`No bug ${id}.`);
  const bug = parseRequirement(id, text);
  if (bug.kind !== 'bug') throw new Error(`${id} is a ${bug.kind}, not a bug.`);
  return bug;
};

/** Step one: the cause, stated with evidence, without changing anything. */
export async function assess(root, id, { cause, evidence = null, test = null, by = 'human' }, folder = DEFAULT_FOLDER) {
  const bug = await readBug(root, id, folder);
  if (!String(cause ?? '').trim()) throw new Error('An assessment states what is actually wrong and why. Give --cause "<statement>".');
  const body = [`**Cause.** ${String(cause).trim()}`, evidence ? `**Evidence.** ${String(evidence).trim()}` : null, `**Reproduced by.** ${test ?? bug.test ?? 'TODO: the failing test'}`].filter(Boolean).join('\n\n');
  await writeSection(root, id, 'Assessment', body, folder);
  if (test && test !== bug.test) await writeAtomic(requirementPath(root, id, folder), upsertFrontMatter(await readText(requirementPath(root, id, folder)), 'test', test));
  await appendLog(root, id, `assessed by ${by}: ${String(cause).trim().slice(0, 80)}`, folder);
  return { id, cause: String(cause).trim(), test: test ?? bug.test ?? null };
}

/** Does the named test exist in the tree? A verdict on a test nobody can find is a sentence. */
export async function testExists(root, test) {
  if (!test) return false;
  const path = String(test).split(/\s*[·:#]\s*|\s+/)[0];
  // A test lives in the repository; a path that climbs out of it is not one, and is not probed.
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')) return false;
  return exists(join(root, path));
}

/**
 * Step three: the verdict. Mechanical — the reproducing test and the suite are run, and three
 * facts decide it: is the named test present, did the suite pass, did the assessment's test pass.
 *
 * `run` is the runner that executes the map.md commands and returns `{ green, results }`; it is
 * injected so the rule can be tested without a build.
 */
export function verdictFrom({ testPresent, suiteGreen, ran }) {
  if (!ran) return { verdict: 'failed', why: 'nothing ran: map.md names no test command' };
  if (!suiteGreen) return { verdict: 'failed', why: 'the suite is red — the symptom, or something near it, still fails' };
  if (!testPresent) return { verdict: 'partial', why: 'the suite is green but the reproducing test is not in the tree, so the original symptom was not tested' };
  return { verdict: 'verified', why: 'the reproducing test passes, the suite passes, nothing near it regressed' };
}

export async function test(root, id, { run, by = 'human' }, folder = DEFAULT_FOLDER) {
  const bug = await readBug(root, id, folder);
  const outcome = await run(root, id, { folder });
  const said = verdictFrom({ testPresent: await testExists(root, bug.test), suiteGreen: Boolean(outcome?.green), ran: Boolean(outcome?.ran) });
  await writeSection(root, id, 'Verdict', `**${said.verdict[0].toUpperCase()}${said.verdict.slice(1)}.** ${said.why}${outcome?.commit ? `\n\ncommit ${outcome.commit}` : ''}`, folder);
  await appendLog(root, id, `verdict ${said.verdict} (${by})`, folder);
  return { id, ...said, evidence: outcome };
}
