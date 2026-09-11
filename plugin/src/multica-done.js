import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { listFeatures, setFrontMatterValue } from './features.js';
import { readText, writeText } from './fsutil.js';
import { refreshRoadmap } from './docs/index.js';
import { recordStatusChange } from './journal.js';
import { evidenceChecklist, loadEvidence, stateDir } from './evidence.js';
import { findFeatureIssue, upsertFeatureIssue } from './multica-board.js';
import { commentOn, multicaInstalled, refOf, setIssueStatus } from './multica.js';
import { transitionProblems } from './transitions.js';
import { traceFeature } from './verify.js';

export const doneOnBoard = (project) => Boolean(project.multica.board && project.multica.doneOnBoard && multicaInstalled());

const requestPath = (root, featureId) => join(stateDir(root, 'done-requests'), `${featureId}.json`);

export async function doneRequest(root, featureId) {
  try {
    const text = await readText(requestPath(root, featureId));
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function requestDone(root, project, feature) {
  const issue = await upsertFeatureIssue(project, feature, { status: 'in_review' });
  const evidence = await loadEvidence(root, feature.id);
  await commentOn(issue, evidenceChecklist(project, feature, evidence, await traceFeature(root, feature)));
  await writeText(requestPath(root, feature.id), `${JSON.stringify({ issue, commit: evidence.commit, at: new Date().toISOString() }, null, 2)}\n`);
  return issue;
}

export async function recordDone(root, project, feature, issue) {
  await writeText(join(feature.dir, 'spec.md'), setFrontMatterValue(feature.spec, 'status', 'done'));
  const done = { ...feature, status: 'done', spec: setFrontMatterValue(feature.spec, 'status', 'done') };
  await refreshRoadmap(root, project);
  await recordStatusChange(project, done);
  await upsertFeatureIssue(project, done);
  await rm(requestPath(root, feature.id), { force: true });
  if (issue) await commentOn(issue, 'Recorded as done in the specs by Vibe-check-cli.');
  return done;
}

export async function pullDone(root, project) {
  if (!doneOnBoard(project)) return [];
  const results = [];
  for (const feature of (await listFeatures(root)).filter((entry) => entry.status === 'in-progress')) {
    const issue = await findFeatureIssue(project, feature);
    if (issue?.status !== 'done') continue;
    const ref = refOf(issue);
    const problems = await transitionProblems(root, project, { ...feature, status: 'done', spec: setFrontMatterValue(feature.spec, 'status', 'done') });
    if (problems.length) {
      await setIssueStatus(ref, 'in_review');
      await commentOn(ref, `Can't record this as done yet:\n${problems.map((problem) => `- ${problem}`).join('\n')}\n\nMoved back to In review.`);
      results.push({ feature: feature.id, issue: ref, done: false, problems });
      continue;
    }
    await recordDone(root, project, feature, ref);
    results.push({ feature: feature.id, issue: ref, done: true });
  }
  return results;
}
