import { join } from 'node:path';
import { featureDocs, projectDocs } from '../docs/catalog.js';
import { allDocStates, describe, docsEnabled, refreshRoadmap } from '../docs/index.js';
import { stampDoc } from '../docs/freshness.js';
import { renderDocTemplate } from '../docs/templates.js';
import { findFeature, listFeatures } from '../features.js';
import { exists, writeText } from '../fsutil.js';
import { loadProject } from '../project.js';

const USAGE = 'Usage: vibecheck docs <status | new <kind> [feature] | stamp <path...> [--still-accurate]>';
const FEATURE_KINDS = ['feature', 'design'];
const SYMBOLS = { fresh: '✔', stale: '✖', missing: '✖', todo: '…', unstamped: '…' };

async function status(root, project) {
  await refreshRoadmap(root, project);
  const states = await allDocStates(root, project);
  states.forEach((state) => console.log(`${state.problems.length ? '✖' : SYMBOLS[state.state]} ${state.path} — ${describe(state)}`));
  console.log(`  ${project.docs.dir}/roadmap.md — generated from feature statuses`);
}

async function create(root, project, [kind, featureQuery]) {
  const doc = FEATURE_KINDS.includes(kind)
    ? featureDocs(project, findFeature(await listFeatures(root), featureQuery ?? '')).find((candidate) => candidate.kind === kind)
    : projectDocs(project).find((candidate) => candidate.kind === kind);
  if (!doc) throw new Error(`No "${kind}" document applies here. Kinds: ${[...projectDocs(project).map((d) => d.kind), ...FEATURE_KINDS].join(', ')} (design needs UI states in the plan).`);
  if (await exists(join(root, doc.path))) throw new Error(`${doc.path} already exists.`);
  const featureId = FEATURE_KINDS.includes(kind) ? doc.path.split('/').pop().replace(/\.md$/, '') : undefined;
  await writeText(join(root, doc.path), renderDocTemplate(project, doc, featureId));
  console.log(`✔ Created ${doc.path} (sources: ${doc.sources.join(', ')})`);
}

async function stamp(root, _project, paths, stillAccurate) {
  if (!paths.length) throw new Error(USAGE);
  for (const path of paths) {
    const count = await stampDoc(root, path, { stillAccurate });
    console.log(`✔ Stamped ${path} against ${count} source file(s)`);
  }
}

const ACTIONS = { status, new: create, stamp };

export async function docs({ root, args, 'still-accurate': stillAccurate }) {
  const [action, ...rest] = args;
  const run = ACTIONS[action];
  if (!run) throw new Error(USAGE);
  const project = await loadProject(root);
  if (!docsEnabled(project)) throw new Error('Living docs are off. Set "docs": { "enabled": true } in specs/project.json.');
  await run(root, project, rest, stillAccurate);
}
