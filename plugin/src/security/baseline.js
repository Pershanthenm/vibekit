import { join } from 'node:path';
import { listFeatures, nextFeatureId } from '../features.js';
import { writeMissing, writeText } from '../fsutil.js';
import { featureFiles } from '../generators/feature.js';
import { securityControls } from './render.js';

const AC_LINE = /^- \[[ x]\] AC-(\d+):/;
const marker = (id) => `(security: ${id})`;

async function ensureFeature(root, project, title) {
  const features = await listFeatures(root);
  const id = nextFeatureId(features, title);
  await writeMissing(root, featureFiles({ id, title, targets: project.targets }));
  return (await listFeatures(root)).find((feature) => feature.id === id);
}

async function targetFeature(root, project) {
  const features = await listFeatures(root);
  const foundation = features.find((feature) => /foundation/i.test(feature.id));
  if (foundation?.status === 'draft') return foundation;
  const baseline = features.find((feature) => /security-baseline/.test(feature.id));
  if (baseline) return baseline;
  return ensureFeature(root, project, foundation ? 'Security baseline' : 'Foundation');
}

function insertCriteria(spec, lines) {
  const rows = spec.split('\n');
  const sectionStart = rows.findIndex((row) => /^## Acceptance criteria/.test(row));
  const sectionEnd = rows.findIndex((row, index) => index > sectionStart && /^## /.test(row));
  const lastCriterion = rows.reduce((last, row, index) => (index > sectionStart && (sectionEnd === -1 || index < sectionEnd) && AC_LINE.test(row) ? index : last), sectionStart + 1);
  rows.splice(lastCriterion + 1, 0, ...lines);
  return rows.join('\n');
}

export async function addSecurityCriteria(root, project) {
  const feature = await targetFeature(root, project);
  const numbers = feature.spec.split('\n').map((row) => Number(row.match(AC_LINE)?.[1])).filter(Boolean);
  const missing = securityControls(project).filter((item) => !feature.spec.includes(marker(item.id)));
  const lines = missing.map((item, index) => `- [ ] AC-${Math.max(0, ...numbers) + index + 1}: ${item.acceptance} ${marker(item.id)}`);
  if (lines.length) await writeText(join(feature.dir, 'spec.md'), insertCriteria(feature.spec, lines));
  return { featureId: feature.id, added: lines.length };
}
