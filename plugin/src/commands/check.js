import { docsReport } from '../docs/index.js';
import { checkFeature, listFeatures } from '../features.js';
import { PROJECT_FILE, loadProject } from '../project.js';
import { validate } from '../schema.js';
import { findDrift } from './sync.js';

export async function collectProblems(root, project) {
  const features = await listFeatures(root);
  return [
    ...validate(project).map((error) => `${PROJECT_FILE}: ${error}`),
    ...(await findDrift(root, project)),
    ...features.flatMap(checkFeature),
    ...(await docsReport(root, project)).errors,
  ];
}

export async function check({ root }) {
  const project = await loadProject(root);
  const problems = await collectProblems(root, project);
  const { warnings } = await docsReport(root, project);
  warnings.forEach((warning) => console.log(`! ${warning}`));
  if (!problems.length) {
    console.log('✔ Specs are valid and generated files are in sync.');
    return;
  }
  problems.forEach((problem) => console.log(`✖ ${problem}`));
  process.exitCode = 1;
}
