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

export function stateDir(root, ...parts) {
  const common = git(root, 'rev-parse', '--git-common-dir');
  return join(isAbsolute(common) ? common : join(root, common), 'vibecheck', ...parts);
}

const evidencePath = (root, featureId) => join(stateDir(root, 'evidence'), `${featureId}.json`);
export const definedSuites = (project) => SUITES.filter((suite) => project.commands[suite]);

export function runSuites(project, cwd) {
  return definedSuites(project).map((suite) => {
    const started = Date.now();
    console.log(`\n$ ${project.commands[suite]}`);
    const status = spawnSync(project.commands[suite], { shell: true, stdio: 'inherit', cwd }).status ?? 1;
    return { suite, command: project.commands[suite], ok: status === 0, seconds: Math.round((Date.now() - started) / 1000) };
  });
}

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

export async function evidenceProblems(root, project, feature) {
  if (!project.workflow.evidence) return [];
  const state = repoState(root);
  const rerun = `run "vibecheck verify ${feature.id.slice(0, 3)} --run" on a clean commit`;
  if (!state) return [`evidence: the project needs a git repository so results can be tied to a commit (git init), then ${rerun}`];
  const evidence = await loadEvidence(root, feature.id);
  if (!evidence) return [`evidence: no recorded test, smoke and UI run — ${rerun}`];
  if (evidence.dirty) return [`evidence: last run had uncommitted changes — commit, then ${rerun}`];
  if (evidence.commit !== state.commit) return [`evidence: code changed since the last run (${evidence.commit.slice(0, 8)} → ${state.commit.slice(0, 8)}) — ${rerun}`];
  const recorded = new Map(evidence.suites.map((result) => [result.suite, result]));
  return definedSuites(project).flatMap((suite) => {
    const result = recorded.get(suite);
    if (!result) return [`evidence: ${SUITE_NAMES[suite]} suite not run — ${rerun}`];
    return result.ok ? [] : [`evidence: ${SUITE_NAMES[suite]} suite failed (${result.command})`];
  });
}

export function evidenceChecklist(project, feature, evidence, trace) {
  const suites = evidence.suites.map((result) => `- ${result.ok ? '✅' : '❌'} ${SUITE_NAMES[result.suite]}: \`${result.command}\` (${result.seconds}s)`);
  return [
    `**${feature.id} — ${feature.title} is ready for your sign-off.** Move this issue to Done to mark it done; Vibe-check-cli re-checks everything and records it in the specs.`,
    `Commit ${evidence.commit.slice(0, 8)} · verified ${evidence.at.slice(0, 16).replace('T', ' ')}`,
    `- ✅ Acceptance criteria traced to tests: ${trace.covered.length}/${trace.covered.length + trace.missing.length}`,
    ...suites,
    '- ✅ Docs and diagrams fresh · review has no blocking findings',
  ].join('\n');
}
