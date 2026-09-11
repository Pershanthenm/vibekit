import { criteriaOf } from './journal.js';
import { sectionOf } from './context-engine.js';
import { parseTasks } from './lanes.js';
import { createIssue, ensureProject, findIssues, multicaInstalled, refOf, setIssueStatus, setMetadata } from './multica.js';

export const BOARD_STATUS = { draft: 'backlog', approved: 'todo', planned: 'todo', 'in-progress': 'in_progress', done: 'done' };

export const boardEnabled = (project) => project.multica.board && multicaInstalled();

function featureDescription(feature) {
  return [
    sectionOf(feature.spec, 'Problem'),
    criteriaOf(feature.spec).map((line) => `- ${line}`).join('\n'),
    `Spec: specs/features/${feature.id}/spec.md (source of truth; managed by vibecheck)`,
  ].filter(Boolean).join('\n\n');
}

const TASK_STAGES = ['planned', 'in-progress', 'done'];
const taskTitle = (task) => task.text.replace(/\s*—.*$/, '').replace(/\s*\[(test|impl|docs|P)\]/gi, '').trim();

async function upsertIssue({ keys, projectId, status, create }) {
  const [existing] = await findIssues(keys, projectId);
  if (existing) {
    const ref = refOf(existing);
    if (existing.status !== status) await setIssueStatus(ref, status);
    return ref;
  }
  const ref = await createIssue({ ...create, project: projectId, status });
  await setMetadata(ref, keys);
  return ref;
}

async function syncTasks(project, feature, projectId, parent) {
  if (!TASK_STAGES.includes(feature.status)) return;
  for (const task of parseTasks(feature.tasks)) {
    const status = task.done ? 'done' : feature.status === 'in-progress' ? 'todo' : 'backlog';
    await upsertIssue({
      keys: { vibecheck_project: project.project.name, vibecheck_feature: feature.id, vibecheck_task: task.id },
      projectId, status,
      create: { title: taskTitle(task), description: `Task ${task.id} of ${feature.id}. Marked done by Vibe-check-cli once verified.`, parent },
    });
  }
}

export async function findFeatureIssue(project, feature) {
  const [issue] = await findIssues({ vibecheck_project: project.project.name, vibecheck_feature: feature.id, vibecheck_kind: 'feature' }, await ensureProject(project));
  return issue ?? null;
}

export async function upsertFeatureIssue(project, feature, { status } = {}) {
  const projectId = await ensureProject(project);
  const ref = await upsertIssue({
    keys: { vibecheck_project: project.project.name, vibecheck_feature: feature.id, vibecheck_kind: 'feature' },
    projectId, status: status ?? BOARD_STATUS[feature.status] ?? 'backlog',
    create: { title: `${feature.id} — ${feature.title}`, description: featureDescription(feature) },
  });
  await syncTasks(project, feature, projectId, ref);
  return ref;
}

export async function mirrorFeature(project, feature) {
  if (!boardEnabled(project)) return null;
  try {
    return await upsertFeatureIssue(project, feature);
  } catch {
    return null;
  }
}
