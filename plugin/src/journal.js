import { join } from 'node:path';
import { sectionOf } from './context-engine.js';
import { readText } from './fsutil.js';
import { publishKnowledge } from './knowledge.js';
import { remember } from './memory.js';

const ACCEPTANCE_LINE = /^- \[[ x]\] (AC-\d+:.*)$/gim;
const MAX_CRITERIA = 8;
const VERDICT_HEADING = '(?:\\d+\\.\\s*)?\\**Verdict\\**';

export const criteriaOf = (spec) => [...spec.matchAll(ACCEPTANCE_LINE)].slice(0, MAX_CRITERIA).map(([, line]) => line.trim());
const today = () => new Date().toISOString().slice(0, 10);

async function specApproved(project, feature) {
  const problem = sectionOf(feature.spec, 'Problem');
  const outOfScope = sectionOf(feature.spec, 'Out of scope');
  const content = [
    `Spec approved: ${feature.id} "${feature.title}".`,
    problem && `Problem: ${problem}`,
    `Acceptance criteria: ${criteriaOf(feature.spec).join(' | ')}`,
    outOfScope && `Out of scope: ${outOfScope}`,
  ].filter(Boolean).join('\n');
  return { memory: await remember(project, content, [`feature:${feature.id}`, 'spec']) };
}

function featureRecord(project, feature, { plan, review }) {
  return [
    `# ${feature.id} — ${feature.title}`,
    `> Project: ${project.project.name} · completed ${today()} · source: specs/features/${feature.id}/`,
    `## Problem\n\n${sectionOf(feature.spec, 'Problem') || 'n/a'}`,
    `## Acceptance criteria\n\n${criteriaOf(feature.spec).map((line) => `- ${line}`).join('\n')}`,
    `## Approach\n\n${sectionOf(plan, 'Approach') || 'n/a'}`,
    `## Review verdict\n\n${sectionOf(review, VERDICT_HEADING) || 'n/a'}`,
  ].join('\n\n') + '\n';
}

async function featureDone(project, feature) {
  const [plan, review] = await Promise.all(['plan.md', 'review.md'].map(async (name) => (await readText(join(feature.dir, name))) ?? ''));
  const verdict = sectionOf(review, VERDICT_HEADING) || review.slice(0, 600);
  const summary = [`Feature done: ${feature.id} "${feature.title}".`, verdict && `Review verdict: ${verdict}`].filter(Boolean).join('\n');
  const [memory, knowledge] = await Promise.all([
    remember(project, summary, [`feature:${feature.id}`, 'done']),
    publishKnowledge(project, { name: feature.id, description: `Feature record: ${feature.title}`, content: featureRecord(project, feature, { plan, review }) }),
  ]);
  return { memory, knowledge };
}

const MILESTONES = { approved: specApproved, done: featureDone };

export async function recordStatusChange(project, feature) {
  const record = MILESTONES[feature.status];
  return record ? record(project, feature) : {};
}

export async function recordMerge(project, featureId, outcomes) {
  const lines = outcomes.map(({ lane, outcome }) => `${lane.name} (${lane.tasks.join(', ')}): ${outcome}`);
  if (!lines.length) return false;
  return remember(project, `Parallel lanes for ${featureId}:\n${lines.join('\n')}`, [`feature:${featureId}`, 'lanes']);
}
