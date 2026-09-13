import { isAbsolute, join, resolve } from 'node:path';
import { stateDir } from '../evidence.js';
import { writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { renderWizard } from '../wizard-page.js';
import { openInBrowser } from './dashboard.js';

// Same rule as the dashboard: a generated file inside the working tree leaves it dirty, which
// blocks merges and stales evidence. There may also be no git repo yet — the point of the wizard
// is that it can run before a project exists — so fall back to a folder beside it.
function wizardPath(root, out) {
  if (out) return isAbsolute(out) ? out : resolve(root, out);
  try {
    return stateDir(root, 'wizard.html');
  } catch {
    return join(root, '.vibekit', 'wizard.html');
  }
}

export async function wizard({ root, out, open }) {
  // A project is optional: someone can fill this in before anything has been initialised.
  const project = await loadProject(root).catch(() => null);
  const path = wizardPath(root, out);
  await writeText(path, renderWizard({ projectName: project?.project.name ?? '' }));

  console.log(`Wrote ${path}`);
  if (open !== false) openInBrowser(path);
  console.log('  Fill it in, save requirements.json into this project as specs/requirements.json,');
  console.log('  then run: vibekit advise apply');
}
