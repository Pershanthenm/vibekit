import { listFeatures, progress } from './features.js';
import { contextFor } from './generators/workflow.js';
import { doneRequest } from './multica-done.js';

const PRIORITY = ['in-progress', 'planned', 'approved', 'draft'];

async function awaitingBoard(root, feature) {
  try {
    return await doneRequest(root, feature.id);
  } catch {
    return null;
  }
}

function stepFor(feature, project) {
  const tasks = progress(feature.tasks, 'T');
  const planGate = project.workflow.autonomy === 'gated' ? 'plan-approval' : null;
  switch (feature.status) {
    case 'in-progress':
      return tasks.done === tasks.total
        ? { step: 'review', skill: 'review-feature', gate: null, reason: 'all tasks are ticked' }
        : { step: 'implement', skill: 'implement-feature', gate: null, reason: `${tasks.total - tasks.done} of ${tasks.total} tasks open` };
    case 'planned':
      return { step: 'implement', skill: 'implement-feature', gate: planGate, reason: 'plan and tasks are ready' };
    case 'approved':
      return { step: 'plan', skill: 'plan-feature', gate: null, reason: 'spec is approved' };
    default:
      return { step: 'spec', skill: 'spec-feature', gate: 'spec-approval', reason: 'spec needs completing and your approval' };
  }
}

export async function nextAction(root, project) {
  const { cmd } = contextFor(project);
  const features = await listFeatures(root);
  const feature = PRIORITY.flatMap((status) => features.filter((f) => f.status === status))[0];
  if (!feature) {
    const reason = features.length ? 'every feature is done' : 'no features yet';
    return { step: 'idle', feature: null, command: cmd('spec-feature', '<new feature>'), gate: 'spec-approval', reason };
  }
  const request = feature.status === 'in-progress' ? await awaitingBoard(root, feature) : null;
  if (request) return { step: 'board-done', gate: 'board-done', feature: feature.id, command: `Mark Multica ${request.issue} done on the board`, reason: 'ready and waiting for your sign-off on Multica' };
  const { skill, ...step } = stepFor(feature, project);
  return { ...step, feature: feature.id, command: cmd(skill, feature.id) };
}
