import { join } from 'node:path';
import { exists } from '../fsutil.js';
import { nextAction } from '../next.js';
import { PROJECT_FILE, loadProject } from '../project.js';
import { PLUGIN_CONTEXT } from '../generators/workflow.js';

export async function next({ root, json }) {
  const action = (await exists(join(root, PROJECT_FILE)))
    ? await nextAction(root, await loadProject(root))
    : { step: 'new-project', feature: null, command: PLUGIN_CONTEXT.cmd('new-project', '<idea>'), gate: null, reason: 'no specs/project.json yet' };
  if (json) {
    console.log(JSON.stringify(action, null, 2));
    return;
  }
  const gate = action.gate ? ` · waits for you (${action.gate})` : '';
  console.log(`Next: ${action.command} — ${action.reason}${gate}`);
}
