import { isOpen, listAsks } from './asks.js';
import { runChecks } from './checks.js';
import { DEFAULT_FOLDER } from './layout.js';
import { listRequirements } from './requirements.js';

/**
 * Convergence. Specification §68.
 *
 * "An assistant that says 'done' is making a claim. Evidence proves the tests ran. Convergence
 * proves something harder: that the work has stopped changing and nothing else broke."
 *
 * A round collects every problem the folder can see mechanically. The verdict compares rounds:
 * the same set twice is converged; a shrinking set is converging; a set that stopped shrinking,
 * or a problem that went away and came back, is not converging — and that one is caught on the
 * spot, because watching an assistant undo its own fix for three rounds teaches nobody anything.
 */

export const STATES = Object.freeze(['converged', 'converging', 'not-converging']);
export const DEFAULT_ROUNDS = 3;

/** Problems in scope, each with a stable key so two rounds can be compared. */
export async function roundProblems(root, { folder = DEFAULT_FOLDER, ids = null } = {}) {
  const problems = [];
  const checks = await runChecks(root, { folder }).catch((error) => ({ findings: [{ code: 'check.crashed', message: error.message, severity: 'error' }] }));
  for (const finding of checks.findings.filter((entry) => entry.severity === 'error')) {
    problems.push({ key: `${finding.code}:${finding.message}`, kind: 'check', message: finding.message, fix: finding.fix ?? null });
  }

  const requirements = (await listRequirements(root, folder)).filter((entry) => (ids ? ids.includes(entry.id) : ['in-progress', 'tested', 'review'].includes(entry.status)));
  const asks = (await listAsks(root, folder)).filter(isOpen);
  for (const requirement of requirements) {
    const verified = new Set([...requirement.verification.matchAll(/\bAC-\d+\b/g)].map((match) => match[0]));
    for (const criterion of requirement.acceptance) {
      if (!verified.has(criterion.id)) problems.push({ key: `${requirement.id}:${criterion.id}:no-test`, kind: 'criterion', id: requirement.id, message: `${requirement.id} ${criterion.id} has no named test in ## Verification` });
    }
    if (!requirement.evidence.trim()) problems.push({ key: `${requirement.id}:no-evidence`, kind: 'evidence', id: requirement.id, message: `${requirement.id} has no ## Evidence — nothing has been run against this commit` });
    else if (/\bexit\s+[1-9]\d*\b/.test(requirement.evidence)) problems.push({ key: `${requirement.id}:red`, kind: 'evidence', id: requirement.id, message: `${requirement.id} evidence is red` });
    for (const ask of asks.filter((entry) => entry.for === requirement.id)) {
      problems.push({ key: `${requirement.id}:ask:${ask.id}`, kind: 'ask', id: requirement.id, message: `${ask.id} is open for ${requirement.id}` });
    }
    if (['tested', 'review'].includes(requirement.status) && !requirement.review.trim()) {
      problems.push({ key: `${requirement.id}:no-review`, kind: 'review', id: requirement.id, message: `${requirement.id} is ${requirement.status} with no ## Review` });
    }
  }
  return problems;
}

/**
 * Compare a sequence of rounds. Pure, so the rule can be tested without a folder.
 *
 * `rounds` is the list of problem-key sets, oldest first.
 */
export function verdict(rounds) {
  if (!rounds.length) return { state: 'not-converging', why: 'no round ran' };
  const last = rounds[rounds.length - 1];
  if (last.size === 0) return { state: 'converged', why: 'nothing left to fix' };
  if (rounds.length === 1) return { state: 'converging', why: `${last.size} problem(s) found; nothing has been fixed yet` };

  const previous = rounds[rounds.length - 2];
  const returned = [...last].filter((key) => !previous.has(key) && rounds.slice(0, -2).some((round) => round.has(key)));
  if (returned.length) return { state: 'not-converging', why: `a problem came back after being fixed: ${returned[0]}`, oscillating: returned };

  const same = last.size === previous.size && [...last].every((key) => previous.has(key));
  if (same) return { state: 'converged', why: `the same ${last.size} problem(s) two rounds running — the work has stopped changing, and these remain` , remaining: [...last] };
  if (last.size < previous.size) return { state: 'converging', why: `${previous.size} → ${last.size} problem(s)` };
  return { state: 'not-converging', why: `${previous.size} → ${last.size} problem(s): each round finds as much as the last` };
}

/**
 * Run rounds until converged, out of rounds, or clearly not converging. `fix` is what a round may
 * do about the problems it found — an agent, a script, nothing. With no `fix` there is one round,
 * and the verdict says what stands.
 */
export async function converge(root, { folder = DEFAULT_FOLDER, ids = null, rounds = DEFAULT_ROUNDS, fix = null, log = () => {} } = {}) {
  const history = [];
  const seen = [];
  for (let round = 1; round <= rounds; round += 1) {
    const problems = await roundProblems(root, { folder, ids });
    history.push(problems);
    seen.push(new Set(problems.map((problem) => problem.key)));
    log(`round ${round}: ${problems.length} problem(s)`);
    const said = verdict(seen);
    if (said.state === 'converged' && problems.length === 0) return { state: 'converged', rounds: round, problems, why: said.why, history };
    if (said.state === 'not-converging') return { ...said, rounds: round, problems, history };
    if (!fix) {
      // One look, no fixer: the honest answer is what stands, not "converging".
      return { state: problems.length ? 'not-converging' : 'converged', rounds: round, problems, why: problems.length ? `${problems.length} problem(s) and nothing here fixes them; they need an agent or a person` : said.why, history };
    }
    if (round < rounds) await fix(problems, round);
  }
  const problems = history[history.length - 1];
  const said = verdict(seen);
  return { state: said.state === 'converging' ? 'not-converging' : said.state, rounds, problems, why: said.state === 'converging' ? `out of rounds with ${problems.length} problem(s) left — the requirement is probably wrong, not the effort` : said.why, history };
}
