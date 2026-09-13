import { contextForFeature, gatherContext, renderContext } from '../context-engine.js';
import { findFeature, listFeatures } from '../features.js';
import { loadProject } from '../project.js';

async function resolveTarget(root, query) {
  try {
    return findFeature(await listFeatures(root), query);
  } catch {
    return null;
  }
}

export async function context({ root, args }) {
  const query = args.join(' ').trim();
  if (!query) throw new Error('Usage: vibekit context <feature id | topic>');
  const project = await loadProject(root);
  const feature = await resolveTarget(root, query);
  const brief = feature ? await contextForFeature(project, feature) : renderContext(await gatherContext(project, query), `Context for "${query}"`);
  console.log(brief || 'No memories or knowledge documents matched (check "vibekit memory status" and "vibekit knowledge status").');
}
