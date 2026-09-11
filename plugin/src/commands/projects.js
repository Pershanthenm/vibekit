import { join } from 'node:path';
import { homedir } from 'node:os';
import { exists } from '../fsutil.js';
import { listFeatures } from '../features.js';
import { nextAction } from '../next.js';
import { loadProject } from '../project.js';
import { forgetMissing, readRegistry } from '../registry.js';

async function describe(entry) {
  if (!(await exists(join(entry.path, 'specs', 'project.json')))) return { ...entry, missing: true };
  const project = await loadProject(entry.path);
  const features = await listFeatures(entry.path);
  const next = await nextAction(entry.path, project).catch(() => null);
  return { ...entry, done: features.filter((feature) => feature.status === 'done').length, total: features.length, next: next ? `${next.command}${next.gate ? ' (waiting for you)' : ''}` : '' };
}

export async function projects({ json, prune }) {
  if (prune) console.log(`✔ Removed ${await forgetMissing()} missing project(s) from the list`);
  const entries = await Promise.all((await readRegistry()).map(describe));
  if (json) return console.log(JSON.stringify(entries, null, 2));
  if (!entries.length) return console.log(`No projects yet. Create one in a folder under ${join(homedir(), 'projects')} and run /vibe-check-cli:new-project.`);
  entries.forEach((entry) => {
    console.log(`${entry.name}\n  ${entry.path}`);
    console.log(entry.missing ? '  ! folder no longer exists (vibecheck projects --prune removes it)' : `  ${entry.done}/${entry.total} features done${entry.next ? ` · next: ${entry.next}` : ''}`);
  });
}
