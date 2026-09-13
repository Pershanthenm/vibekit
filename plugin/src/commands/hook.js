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
import { gateSummary, testGate } from '../task-gate.js';
import { PROJECT_FILE, loadProject } from '../project.js';
import { collectProblems } from './check.js';

class BlockError extends Error {}

// What may be written without a feature in progress: the specification itself, the editor
// adapters, the top-level markdown, and `assessment/` — which adopt and assess write, and which
// changes no code. Blocking those would block the very work that decides what the features are.
const WORKFLOW_PATHS = /^(specs\/|assessment\/|\.claude\/|\.cursor\/|\.agents\/|[^/]+\.md$)/;

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
    `Ready blocks of [P] tasks run in parallel on ${engine} agents in git worktrees: ${cmd('dispatch')}, then ${cmd('merge-lanes')}.`,
    enforce && 'Hooks enforce this: code edits need a feature in progress, generated files are read-only, and each turn ends with `vibekit check`.',
    project.docs.enabled && `Living docs: diagrams and documents in \`${project.docs.dir}/\` must match the code. Re-architecting (specs, ADRs, project.json) means updating the affected docs in the same turn — ${cmd('rearchitect')} handles it; features can't be marked done until their docs are fresh (${cmd('docs')}).`,
    isKnowledgeEnabled(project) && `Knowledge (OpenContext): your cross-project library. When starting a project, read the \`${project.knowledge.playbook}\` folder first (\`vibekit knowledge manifest\`). Search it before designing (\`vibekit knowledge search "<topic>"\`). Lessons that apply beyond this project go into the playbook via /opencontext-iterate. Finished features are published automatically.`,
    isMemoryEnabled(project) && 'Memory (agentmemory): recall before planning (`vibekit memory recall "<topic>"` or memory_smart_search); save decisions, gotchas and lessons with their reason (`vibekit memory remember "<fact>"` or memory_save). Spec approvals, completed features and lane merges are saved automatically.',
  ].filter(Boolean);
  return [
    '# VibeKit orchestrator protocol',
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

async function sessionStart(root) {
  const project = await loadProject(root);
  const features = await listFeatures(root);
  const action = await nextAction(root, project);
  const gate = action.gate ? ` (waits for the user: ${action.gate})` : '';
  const context = [
    protocol(project),
    '## Current state',
    featureTable(features),
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
    throw new BlockError(`${path} is generated by VibeKit. Edit specs/project.json and run \`vibekit sync\` instead.`);
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

// Ticking a task used to be enough to move on; the test run after it was an instruction an agent
// could simply not follow. This runs the suite for itself and refuses to end the turn on a failure.
async function testsForFinishedTasks(root, project) {
  const gate = await testGate(root, project, await listFeatures(root)).catch(() => null);
  if (!gate || gate.ok) return;
  if (!gate.ran) {
    process.stderr.write(`vibekit: could not run \`${gate.command}\` after ${gateSummary(gate)} — ${gate.reason}. Run it yourself before going further.
`);
    return;
  }
  throw new BlockError(
    `\`${gate.command}\` fails, and tasks were ticked as done since it last passed (${gateSummary(gate)}).
` +
      `Fix the failures before ending the turn, or untick the tasks.
${gate.output}`,
  );
}

async function stop(root, input) {
  if (input.stop_hook_active) return;
  const project = await loadProject(root);
  if (!project.workflow.enforce) return;
  await testsForFinishedTasks(root, project);
  const problems = await collectProblems(root, project);
  if (!problems.length) return;
  throw new BlockError(`vibekit check found problems. Fix them, or tell the user why they remain:\n- ${problems.join('\n- ')}`);
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
