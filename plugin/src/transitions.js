import { checkFeature } from './features.js';
import { docsGate } from './docs/index.js';
import { designProblems } from './design.js';
import { evidenceProblems } from './evidence.js';
import { reviewProblems } from './review.js';
import { traceabilityProblems } from './verify.js';

export async function transitionProblems(root, project, updated) {
  const done = updated.status === 'done';
  const traced = done && project.workflow.traceability ? await traceabilityProblems(root, updated) : [];
  const evidence = done ? await evidenceProblems(root, project, updated) : [];
  const review = done ? await reviewProblems(root, project, updated) : [];
  const design = updated.status === 'in-progress' ? await designProblems(root, project, updated) : [];
  return [...checkFeature(updated), ...traced, ...(await docsGate(root, project, updated)), ...evidence, ...review, ...design];
}
