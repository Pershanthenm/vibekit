import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { readText, writeText } from './fsutil.js';
import { git } from './git.js';

export const SUITES = ['test', 'smoke', 'ui'];
export const SUITE_NAMES = { test: 'tests', smoke: 'smoke', ui: 'UI' };

export function repoState(root) {
  try {
    return { commit: git(root, 'rev-parse', 'HEAD'), dirty: Boolean(git(root, 'status', '--porcelain')) };
  } catch {
    return null;
  }
}

// Where a repository keeps its common git directory cannot change while this process runs, and
// asking git costs a process launch — which on some machines is most of a second. The console asks
// for this many times a second (every evidence file, every manifest, every log), so the answer is
// kept. Keyed by root, because one process can serve several worktrees.
const commonDirs = new Map();

export function stateDir(root, ...parts) {
  if (!commonDirs.has(root)) commonDirs.set(root, git(root, 'rev-parse', '--git-common-dir'));
  const common = commonDirs.get(root);
  return join(isAbsolute(common) ? common : join(root, common), 'vibecheck', ...parts);
}

const evidencePath = (root, featureId) => join(stateDir(root, 'evidence'), `${featureId}.json`);
export const definedSuites = (project) => SUITES.filter((suite) => project.commands[suite]);

export const runsFor = (project) => Math.max(1, Number(project.standards?.testing?.runs) || 1);

/**
 * Run every defined suite, `runs` times each. One green run only proves the suite passed once:
 * a suite that passes twice in three is not a passing suite, it is a flaky one, and shipping on
 * it means shipping a failure nobody has seen yet. Every run counts, not just the last.
 */
export function runSuites(project, cwd, { runs = 1 } = {}) {
  return definedSuites(project).map((suite) => {
    const command = project.commands[suite];
    const started = Date.now();
    let passed = 0;
    for (let attempt = 1; attempt <= runs; attempt += 1) {
      console.log(`\n$ ${command}${runs > 1 ? `   (run ${attempt}/${runs})` : ''}`);
      if ((spawnSync(command, { shell: true, stdio: 'inherit', cwd }).status ?? 1) === 0) passed += 1;
    }
    return {
      suite,
      command,
      runs,
      passed,
      ok: passed === runs,
      flaky: passed > 0 && passed < runs,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  });
}

// Evidence written before repeat runs existed carries no `runs`; it described exactly one.
export const runCountOf = (result) => ({
  runs: result.runs ?? 1,
  passed: result.passed ?? (result.ok ? 1 : 0),
  flaky: Boolean(result.flaky),
});

export async function saveEvidence(root, featureId, record) {
  await writeText(evidencePath(root, featureId), `${JSON.stringify({ feature: featureId, at: new Date().toISOString(), ...record }, null, 2)}\n`);
}

export async function loadEvidence(root, featureId) {
  try {
    const text = await readText(evidencePath(root, featureId));
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export const clearEvidence = async (root, featureId) => rm(evidencePath(root, featureId), { force: true }).catch(() => {});

// Recording a review is itself a commit, so HEAD moves when a reviewer writes their verdict
// down. Evidence still describes the same code when that commit is the only thing between:
// a review.md edit changes nothing the suites ran against.
function onlyReviewChanged(root, from, to, featureId) {
  try {
    const changed = git(root, 'diff', '--name-only', `${from}..${to}`).split(/\r?\n/).filter(Boolean);
    return changed.length > 0 && changed.every((path) => path === `specs/features/${featureId}/review.md`);
  } catch {
    return false;
  }
}

/**
 * `state` is the repository's commit and cleanliness. A caller checking several features already
 * knows it, and asking git again for each one is two more process launches every time — which is
 * what made the served console unusable on a project with four features. Left out, it is read
 * here exactly as before.
 */
export async function evidenceProblems(root, project, feature, state = repoState(root)) {
  if (!project.workflow.evidence) return [];
  const rerun = `run "vibecheck verify ${feature.id.slice(0, 3)} --run" on a clean commit`;
  if (!state) return [`evidence: the project needs a git repository so results can be tied to a commit (git init), then ${rerun}`];
  const evidence = await loadEvidence(root, feature.id);
  if (!evidence) return [`evidence: no recorded test, smoke and UI run — ${rerun}`];
  if (evidence.dirty) return [`evidence: last run had uncommitted changes — commit, then ${rerun}`];
  if (evidence.commit !== state.commit && !onlyReviewChanged(root, evidence.commit, state.commit, feature.id)) {
    return [`evidence: code changed since the last run (${evidence.commit.slice(0, 8)} → ${state.commit.slice(0, 8)}) — ${rerun}`];
  }
  const recorded = new Map(evidence.suites.map((result) => [result.suite, result]));
  const wanted = runsFor(project);
  return definedSuites(project).flatMap((suite) => {
    const result = recorded.get(suite);
    if (!result) return [`evidence: ${SUITE_NAMES[suite]} suite not run — ${rerun}`];
    const { runs, passed, flaky } = runCountOf(result);
    // A suite that fails sometimes has already told you it is not clean. Recording it as passing
    // because the last attempt happened to be green is how a known failure reaches production.
    if (flaky) return [`evidence: ${SUITE_NAMES[suite]} suite is flaky — passed ${passed} of ${runs} runs. Fix the flake; a suite that passes sometimes is not passing.`];
    if (!result.ok) return [`evidence: ${SUITE_NAMES[suite]} suite failed (${result.command})`];
    if (runs < wanted) return [`evidence: ${SUITE_NAMES[suite]} suite passed ${runs} run(s), but this project requires ${wanted} — ${rerun}`];
    return [];
  });
}

export function evidenceChecklist(project, feature, evidence, trace) {
  const suites = evidence.suites.map((result) => {
    const { runs, passed, flaky } = runCountOf(result);
    const tally = runs > 1 ? ` — ${passed}/${runs} runs` : '';
    return `- ${flaky ? '⚠️' : result.ok ? '✅' : '❌'} ${SUITE_NAMES[result.suite]}: \`${result.command}\`${tally} (${result.seconds}s)`;
  });
  return [
    `**${feature.id} — ${feature.title} is ready for your sign-off.** Move this issue to Done to mark it done; Vibe-check-cli re-checks everything and records it in the specs.`,
    `Commit ${evidence.commit.slice(0, 8)} · verified ${evidence.at.slice(0, 16).replace('T', ' ')}`,
    `- ✅ Acceptance criteria traced to tests: ${trace.covered.length}/${trace.covered.length + trace.missing.length}`,
    ...suites,
    '- ✅ Docs and diagrams fresh · review has no blocking findings',
  ].join('\n');
}
