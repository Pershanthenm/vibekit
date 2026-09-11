import { join } from 'node:path';
import { readRequirements } from '../advisor/selection.js';
import { refreshRoadmap } from '../docs/index.js';
import { readText, writeMissing } from '../fsutil.js';
import { publishKnowledge } from '../knowledge.js';
import { remember } from '../memory.js';
import { assertValid, loadProject, saveProject } from '../project.js';
import { addSecurityCriteria } from './baseline.js';
import { renderSecurityWorkflow } from './ci.js';
import { findControl } from './controls.js';
import { resolveSecurity } from './questions.js';

export const SECURITY_ANSWERS_FILE = 'specs/security-answers.json';
const WORKFLOW_PATH = '.github/workflows/security.yml';

export async function requirementsOrEmpty(root) {
  return readRequirements(root).catch(() => ({}));
}

export async function readSecurityAnswers(root, from) {
  const text = await readText(from ?? join(root, SECURITY_ANSWERS_FILE));
  return text ? JSON.parse(text) : {};
}

function memorySummary(project) {
  const titles = project.security.controls.map((id) => findControl(id).title);
  const risks = project.security.acceptedRisks.map((risk) => findControl(risk.id)?.title ?? risk.id);
  return [`Security baseline for ${project.project.name} (${project.nfr.security}): ${titles.join('; ')}.`, risks.length && `Accepted risks: ${risks.join('; ')}.`].filter(Boolean).join('\n');
}

export async function applySecurity(root, rawAnswers) {
  const project = await loadProject(root);
  const { answers, controls, acceptedRisks, notes } = resolveSecurity(await requirementsOrEmpty(root), rawAnswers);
  const updated = { ...project, security: { ...project.security, answers, controls, acceptedRisks, notes } };
  assertValid(updated);
  await saveProject(root, updated);
  const workflow = renderSecurityWorkflow(updated);
  const created = workflow ? await writeMissing(root, [{ path: WORKFLOW_PATH, content: workflow }]) : [];
  const criteria = await addSecurityCriteria(root, updated);
  await refreshRoadmap(root, updated);
  const saved = await remember(updated, memorySummary(updated), ['security']);
  return { project: updated, criteria, workflowCreated: created.includes(WORKFLOW_PATH), saved };
}

export async function publishSecurity(root, project) {
  const content = await readText(join(root, 'specs/security.md'));
  return content ? publishKnowledge(project, { name: 'security-baseline', description: 'Security baseline and controls', content }) : false;
}
