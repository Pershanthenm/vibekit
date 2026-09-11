import { join, resolve } from 'node:path';
import { FEATURES_DIR, findFeature, listFeatures, nextFeatureId, setFrontMatterValue } from '../features.js';
import { readFile } from 'node:fs/promises';
import { writeMissing, writeText } from '../fsutil.js';
import { refreshRoadmap } from '../docs/index.js';
import { mirrorFeature } from '../multica-board.js';
import { doneOnBoard, requestDone } from '../multica-done.js';
import { transitionProblems } from '../transitions.js';
import { featureFiles } from '../generators/feature.js';
import { recordStatusChange } from '../journal.js';
import { loadProject } from '../project.js';
import { extractRequirements, renderCriteria, summarise } from '../requirements.js';
import { FEATURE_STATUSES } from '../schema.js';

export async function feature({ root, args, from }) {
  const title = args.join(' ').trim();
  if (!title) throw new Error('Usage: vibecheck feature "<feature name>" [--from <requirements file>]');
  const project = await loadProject(root);
  const id = nextFeatureId(await listFeatures(root), title);
  await writeMissing(root, featureFiles({ id, title, targets: project.targets }));
  await refreshRoadmap(root, project);
  console.log(`✔ Created ${FEATURES_DIR}/${id}/ (spec.md, plan.md, tasks.md, review.md)`);
  if (from) await seedFromRequirements(root, id, resolve(from));
}

/**
 * Seeds the spec from requirements someone already wrote, rather than making them retype it
 * into menus. Lines that cannot be tested as written are kept, marked, and counted — dropping
 * them would hide the work still to do.
 */
async function seedFromRequirements(root, id, source) {
  const text = await readFile(source, 'utf8').catch(() => null);
  if (text === null) throw new Error(`--from: cannot read ${source}`);
  const requirements = extractRequirements(text);
  if (!requirements.length) {
    console.log(`
! No requirements found in ${source}. Expected bullets, a numbered list, or sentences saying what must happen.`);
    console.log('  Write the spec with /vibe-check-cli:spec-feature instead.');
    return;
  }

  const specPath = join(root, FEATURES_DIR, id, 'spec.md');
  const spec = await readFile(specPath, 'utf8');
  await writeText(specPath, spec.replace(/- \[ \] AC-1:.*$/m, renderCriteria(requirements)));
  console.log(`
${summarise(requirements, source)}`);
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
