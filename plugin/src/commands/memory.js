import { isMemoryEnabled, memoryHealth, recall, remember } from '../memory.js';
import { loadProject } from '../project.js';

const USAGE = 'Usage: vibecheck memory <status | recall "<query>" | remember "<fact>">';

async function status(project) {
  const { ok, detail } = await memoryHealth(project);
  console.log(`${ok ? '✔' : '✖'} ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function recallCommand(project, text) {
  const memories = await recall(project, text);
  if (!memories.length) {
    console.log('No matching memories (or agentmemory is not reachable — see "vibecheck memory status").');
    return;
  }
  memories.forEach((memory) => console.log(`- ${memory}`));
}

async function rememberCommand(project, text) {
  const saved = await remember(project, text, ['note']);
  console.log(saved ? '✔ Saved to agentmemory' : '✖ Not saved — see "vibecheck memory status"');
  if (!saved) process.exitCode = 1;
}

const ACTIONS = { status, recall: recallCommand, remember: rememberCommand };

export async function memory({ root, args }) {
  const [action, ...words] = args;
  const text = words.join(' ').trim();
  const run = ACTIONS[action];
  if (!run || (action !== 'status' && !text)) throw new Error(USAGE);
  const project = await loadProject(root);
  if (!isMemoryEnabled(project)) throw new Error('Memory is off. Set "memory": { "provider": "agentmemory" } in specs/project.json.');
  await run(project, text);
}
