import { join } from 'node:path';
import { FEATURES_DIR, findFeature, listFeatures, nextFeatureId, setFrontMatterValue } from '../features.js';
import { writeMissing, writeText } from '../fsutil.js';
import { refreshRoadmap } from '../docs/index.js';
import { mirrorFeature } from '../multica-board.js';
import { doneOnBoard, requestDone } from '../multica-done.js';
import { transitionProblems } from '../transitions.js';
import { featureFiles } from '../generators/feature.js';
import { recordStatusChange } from '../journal.js';
import { loadProject } from '../project.js';
import { FEATURE_STATUSES } from '../schema.js';

export async function feature({ root, args }) {
  const title = args.join(' ').trim();
  if (!title) throw new Error('Usage: vibecheck feature "<feature name>"');
  const project = await loadProject(root);
  const id = nextFeatureId(await listFeatures(root), title);
  await writeMissing(root, featureFiles({ id, title, targets: project.targets }));
  await refreshRoadmap(root, project);
  console.log(`✔ Created ${FEATURES_DIR}/${id}/ (spec.md, plan.md, tasks.md)`);
}

export async function status({ root, args, force = false }) {
  const [query, next] = args;
  if (!query || !FEATURE_STATUSES.includes(next)) {
    throw new Error(`Usage: vibecheck status <feature> <${FEATURE_STATUSES.join('|')}>`);
  }
  const current = findFeature(await listFeatures(root), query);
  const updated = { ...current, status: next, spec: setFrontMatterValue(current.spec, 'status', next) };
  const project = await loadProject(root);
  const problems = await transitionProblems(root, project, updated);
  if (problems.length && !force) {
    throw new Error(`Cannot move ${current.id} to "${next}":\n  - ${problems.join('\n  - ')}`);
  }
  if (next === 'done' && doneOnBoard(project)) {
    if (problems.length) throw new Error('Features are marked done on Multica, and --force cannot skip its checks. Fix the problems above first.');
    const issue = await requestDone(root, project, current);
    console.log(`✔ ${current.id} is ready: Multica ${issue} moved to In review with the evidence.`);
    console.log(`  Mark it done on the Multica board. Vibe-check-cli re-checks and records it at the next session start, or run: vibecheck multica pull`);
    return;
  }
  await writeText(join(current.dir, 'spec.md'), updated.spec);
  await refreshRoadmap(root, project);
  const [saved, boardIssue] = await Promise.all([recordStatusChange(project, updated), mirrorFeature(project, updated)]);
  const notes = [saved.memory && 'saved to agentmemory', saved.knowledge && 'published to OpenContext', boardIssue && `Multica ${boardIssue}`].filter(Boolean);
  console.log(`✔ ${current.id}: ${current.status} → ${next}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
}
