import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { listFeatures, progress } from '../features.js';
import { exists } from '../fsutil.js';
import { docsReport, refreshRoadmap } from '../docs/index.js';
import { managedFiles } from './sync.js';
import { contextForFeature } from '../context-engine.js';
import { contextFor as skillContextFor } from '../generators/workflow.js';
import { isKnowledgeEnabled } from '../knowledge.js';
import { isMemoryEnabled } from '../memory.js';
import { nextAction } from '../next.js';
import { PROJECT_FILE, loadProject } from '../project.js';
import { collectProblems } from './check.js';
import { boardEnabled, mirrorFeature } from '../multica-board.js';
import { pullDone } from '../multica-done.js';

class BlockError extends Error {}

const WORKFLOW_PATHS = /^(specs\/|\.claude\/|\.cursor\/|[^/]+\.md$)/;

async function findProjectRoot(start) {
  let dir = resolve(start);
  while (!(await exists(join(dir, PROJECT_FILE)))) {
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}

async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function featureTable(features) {
  if (!features.length) return 'No features yet.';
  return features
    .map((feature) => {
      const criteria = progress(feature.spec, 'AC');
      const tasks = progress(feature.tasks, 'T');
      return `- ${feature.id} · ${feature.status} · AC ${criteria.done}/${criteria.total} · tasks ${tasks.done}/${tasks.total}`;
    })
    .join('\n');
}

function protocol(project) {
  const { cmd } = skillContextFor(project);
  const { autonomy, engine, enforce } = project.workflow;
  const gates = autonomy === 'gated' ? 'spec approval and plan approval' : 'spec approval';
  const rules = [
    `New or changed behaviour, including bug fixes, starts as a spec: ${cmd('spec-feature')}.`,
    `Advance work with ${cmd('run')}; it executes the next step until a human gate.`,
    `Human gates: ${gates}. Summarise, ask, and wait for an explicit yes.`,
    engine === 'multica'
      ? `Ready blocks of [P] tasks become Multica issues assigned to ${project.multica.agent || 'your Multica agent'}; ${project.multica.remote === 'local' ? 'they run on this machine\'s Multica daemon, clone the project folder and push lane branches back into it (commit first; no git host needed)' : `they work from the "${project.multica.remote}" remote and push lane branches (push first)`}: ${cmd('dispatch')}, then ${cmd('merge-lanes')}.${project.multica.board ? ' Feature status is mirrored to the Multica board.' : ''}`
      : `Ready blocks of [P] tasks run in parallel on ${engine} agents in git worktrees: ${cmd('dispatch')}, then ${cmd('merge-lanes')}.`,
    enforce && 'Hooks enforce this: code edits need a feature in progress, generated files are read-only, and each turn ends with `vibecheck check`.',
    project.docs.enabled && `Living docs: diagrams and documents in \`${project.docs.dir}/\` must match the code. Re-architecting (specs, ADRs, project.json) means updating the affected docs in the same turn — ${cmd('rearchitect')} handles it; features can't be marked done until their docs are fresh (${cmd('docs')}).`,
    isKnowledgeEnabled(project) && `Knowledge (OpenContext): your cross-project library. When starting a project, read the \`${project.knowledge.playbook}\` folder first (\`vibecheck knowledge manifest\`). Search it before designing (\`vibecheck knowledge search "<topic>"\`). Lessons that apply beyond this project go into the playbook via /opencontext-iterate. Finished features are published automatically.`,
    isMemoryEnabled(project) && 'Memory (agentmemory): recall before planning (`vibecheck memory recall "<topic>"` or memory_smart_search); save decisions, gotchas and lessons with their reason (`vibecheck memory remember "<fact>"` or memory_save). Spec approvals, completed features and lane merges are saved automatically.',
  ].filter(Boolean);
  return [
    '# Vibe-check-cli orchestrator protocol',
    'This is a spec-driven project and you are its orchestrator. For every request:',
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
  ]
    .join('\n');
}

const MAX_DOC_NOTES = 8;

async function docsNotice(root, project) {
  const { errors, warnings } = await docsReport(root, project);
  const notes = [...errors, ...warnings].slice(0, MAX_DOC_NOTES);
  if (!notes.length) return '';
  return `## Documentation needing attention\n${notes.map((note) => `- ${note}`).join('\n')}\nUpdate with ${skillContextFor(project).cmd('docs')}; feature docs are required before a feature can be marked done.`;
}

async function featureContext(project, features, featureId) {
  const feature = features.find(({ id }) => id === featureId);
  return feature ? contextForFeature(project, feature) : '';
}

async function boardSync(root, project) {
  if (!boardEnabled(project)) return [];
  const pulled = await pullDone(root, project).catch(() => []);
  return pulled.map((result) => (result.done ? `${result.feature} was marked done on Multica (${result.issue}) and is now recorded as done.` : `${result.feature} was moved to Done on Multica but isn't ready: ${result.problems[0]}. It's back in review.`));
}

async function sessionStart(root) {
  const project = await loadProject(root);
  const boardNotes = await boardSync(root, project);
  const features = await listFeatures(root);
  const action = await nextAction(root, project);
  const gate = action.gate ? ` (waits for the user: ${action.gate})` : '';
  const context = [
    protocol(project),
    '## Current state',
    featureTable(features),
    boardNotes.length && `## From the Multica board\n${boardNotes.map((note) => `- ${note}`).join('\n')}`,
    `Next: ${action.command} — ${action.reason}${gate}`,
    await featureContext(project, features, action.feature),
    await docsNotice(root, project),
  ].filter(Boolean).join('\n\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
}

function projectPath(root, filePath) {
  const path = relative(root, resolve(root, filePath)).split(sep).join('/');
  return path.startsWith('..') || isAbsolute(path) ? null : path;
}

async function preEdit(root, input) {
  const project = await loadProject(root);
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const path = target && projectPath(root, target);
  if (!project.workflow.enforce || !path) return;
  if ((await managedFiles(root, project)).some((file) => file.path === path)) {
    throw new BlockError(`${path} is generated by Vibe-check-cli. Edit specs/project.json and run \`vibecheck sync\` instead.`);
  }
  if (WORKFLOW_PATHS.test(path) || path.startsWith(`${project.docs.dir}/`)) return;
  const features = await listFeatures(root);
  if (features.some((feature) => feature.status === 'in-progress')) return;
  const action = await nextAction(root, project);
  throw new BlockError(
    `Blocked by the spec-driven workflow: no feature is in progress, so ${path} can't be changed yet.\n` +
      `Next step: ${action.command} — ${action.reason}.\n` +
      `For a quick fix, write a small spec (${skillContextFor(project).cmd('spec-feature')} <fix>) and move it to in-progress.`,
  );
}

async function mirrorInProgress(root, project) {
  if (!boardEnabled(project)) return;
  for (const feature of (await listFeatures(root)).filter((entry) => entry.status === 'in-progress')) await mirrorFeature(project, feature);
}

async function stop(root, input) {
  if (input.stop_hook_active) return;
  const project = await loadProject(root);
  await mirrorInProgress(root, project).catch(() => {});
  if (!project.workflow.enforce) return;
  const problems = await collectProblems(root, project);
  if (!problems.length) return;
  throw new BlockError(`vibecheck check found problems. Fix them, or tell the user why they remain:\n- ${problems.join('\n- ')}`);
}

const HANDLERS = { 'session-start': sessionStart, 'pre-edit': preEdit, stop };
const HEALING_EVENTS = ['session-start', 'stop'];

export async function hook({ args }) {
  const handler = HANDLERS[args[0]];
  if (!handler) throw new Error(`Unknown hook "${args[0]}". Use: ${Object.keys(HANDLERS).join(', ')}`);
  const input = await readStdinJson();
  const root = await findProjectRoot(input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!root) return;
  try {
    if (HEALING_EVENTS.includes(args[0])) await refreshRoadmap(root, await loadProject(root));
    await handler(root, input);
  } catch (error) {
    if (!(error instanceof BlockError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
