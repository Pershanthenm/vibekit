import { basename, join, resolve } from 'node:path';
import { exists } from '../fsutil.js';
import { createAsker } from '../menu.js';
import { PROJECT_FILE, assertValid, readProjectFile, saveProject } from '../project.js';
import { normalize } from '../schema.js';
import { interactiveAdvice } from './advise.js';
import { sync } from './sync.js';

async function describeProduct(root, asker) {
  const name = await asker.text('Project name', basename(root));
  const description = await asker.text('One-line description (optional)');
  return normalize({ project: { name, description } });
}

async function writeAndSync(root, project, force) {
  assertValid(project);
  await saveProject(root, project);
  console.log(`✔ Wrote ${PROJECT_FILE}`);
  await sync({ root, force });
}

export async function init({ root, force, from, yes }) {
  if ((await exists(join(root, PROJECT_FILE))) && !force) {
    throw new Error(`${PROJECT_FILE} already exists. Edit it and run "vibecheck sync", re-run "vibecheck advise", or pass --force.`);
  }
  if (from) return writeAndSync(root, normalize(await readProjectFile(resolve(from))), force);
  if (yes) return writeAndSync(root, normalize({ project: { name: basename(root) } }), force);
  const asker = createAsker();
  try {
    await saveProject(root, await describeProduct(root, asker));
    await interactiveAdvice(root, { force, asker });
  } finally {
    asker.close();
  }
  console.log('\nNext: open this folder in Cursor, start Claude Code and run /vibe-check-cli:new-project (or /vibe-check-cli:run).');
}
