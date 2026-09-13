import { join } from 'node:path';
import { UI_TARGETS } from './docs/catalog.js';
import { readFrontMatter } from './features.js';
import { readText } from './fsutil.js';

export const designDocPath = (project, featureId) => `${project.docs.dir}/design/${featureId}.md`;

/**
 * The targets a feature itself declares, falling back to the project's. A feature with no
 * screens has nothing for a design gate to say, so the gate only applies to the ones that do.
 */
export function featureUiTargets(project, feature) {
  const declared = readFrontMatter(feature.spec ?? '').targets ?? '';
  const listed = declared.replace(/[[\]]/g, '').split(',').map((target) => target.trim()).filter(Boolean);
  const targets = listed.length ? listed : project.targets;
  return targets.filter((target) => UI_TARGETS.includes(target));
}

export function parseDesign(text) {
  if (!text?.trim()) return null;
  const meta = readFrontMatter(text);
  return {
    artboard: (meta.artboard ?? '').trim(),
    canvas: (meta.canvas ?? '').trim(),
    approvedBy: (meta.approved_by ?? '').trim(),
  };
}

/**
 * Building a screen before its design is settled is how a feature gets built twice. This runs
 * at the move to `in-progress` — late enough that the spec and plan exist, early enough that
 * nothing has been built against a layout nobody agreed to.
 */
export async function designProblems(root, project, feature) {
  if (!project.workflow.design || !project.docs.enabled) return [];
  const ui = featureUiTargets(project, feature);
  if (!ui.length) return [];

  const path = designDocPath(project, feature.id);
  const next = `run /vibekit:design on ${feature.id.slice(0, 3)}, settle the layout with the user, and record the approved artboard in ${path}`;
  const design = parseDesign(await readText(join(root, path)));

  if (!design) return [`design: ${feature.id} targets ${ui.join(', ')} but has no design doc — ${next}`];
  if (!design.artboard) {
    return [`design: ${path} names no approved artboard (front matter needs \`artboard: <name or id>\`) — ${next}`];
  }
  return [];
}
