import { join } from 'node:path';
import { listFeatures } from '../features.js';
import { readText, writeText } from '../fsutil.js';
import { featureDocs, isSpecOnly, projectDocs } from './catalog.js';
import { listProjectFiles } from './files.js';
import { docState, isReady } from './freshness.js';
import { renderRoadmap } from './roadmap.js';

export const docsEnabled = (project) => project.docs.enabled;
export const roadmapPath = (project) => `${project.docs.dir}/roadmap.md`;
const TRACKED_STATUSES = ['in-progress', 'done'];
const GATED_STATUSES = ['planned', 'in-progress', 'done'];

export async function roadmapFile(root, project) {
  return { path: roadmapPath(project), content: renderRoadmap(project, await listFeatures(root)) };
}

export async function refreshRoadmap(root, project) {
  if (!docsEnabled(project)) return;
  const { path, content } = await roadmapFile(root, project);
  if ((await readText(join(root, path))) !== content) await writeText(join(root, path), content);
}

async function statesFor(root, docs) {
  const files = await listProjectFiles(root);
  return Promise.all(docs.map((doc) => docState(root, files, doc)));
}

export async function allDocStates(root, project) {
  const features = (await listFeatures(root)).filter((feature) => TRACKED_STATUSES.includes(feature.status));
  return statesFor(root, [...projectDocs(project), ...features.flatMap((feature) => featureDocs(project, feature))]);
}

export function describe(state) {
  const reasons = {
    missing: `missing — create it: vibecheck docs new ${state.kind}${state.kind === 'feature' || state.kind === 'design' ? ` ${state.path.split('/').pop().replace(/\.md$/, '')}` : ''}`,
    todo: 'still has TODOs',
    unstamped: 'written but never stamped',
    stale: 'its sources changed since it was last stamped',
    fresh: 'fresh',
  };
  return [reasons[state.state], ...state.problems].join('; ');
}

export async function docsGate(root, project, feature) {
  if (!docsEnabled(project) || !GATED_STATUSES.includes(feature.status)) return [];
  const [architecture, ...otherProjectDocs] = projectDocs(project);
  const required = feature.status === 'done' ? [architecture, ...otherProjectDocs, ...featureDocs(project, feature)] : [architecture];
  const states = await statesFor(root, required);
  return states.filter((state) => !isReady(state)).map((state) => `docs: ${state.path} — ${describe(state)}`);
}

const isDriftError = (state) => state.problems.length || (state.stamped && state.state === 'stale' && isSpecOnly(state.sources));

export async function docsReport(root, project) {
  if (!docsEnabled(project)) return { errors: [], warnings: [] };
  const states = await allDocStates(root, project);
  const errors = states.filter(isDriftError).map((state) => `docs: ${state.path} — ${describe(state)}; the architecture changed, update the document now`);
  const warnings = states.filter((state) => !isReady(state) && !isDriftError(state)).map((state) => `docs: ${state.path} — ${describe(state)}`);
  return { errors, warnings };
}
