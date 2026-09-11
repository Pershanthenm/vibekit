import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findFeature, listFeatures } from '../features.js';
import { exists, writeText } from '../fsutil.js';
import { assertCleanTree, git, isInstalled, runLogged, worktreeBase } from '../git.js';
import { contextForFeature } from '../context-engine.js';
import { parseTasks, planLanes, readyParallelTasks } from '../lanes.js';
import { createManifestWriter, loadManifest } from '../manifest.js';
import { loadProject } from '../project.js';
import { ENGINES } from '../schema.js';
import { dispatchToMultica } from '../multica-lanes.js';
import { describeRoute, routeLanes } from '../routes.js';

const AGENTS = {
  cursor: { binaries: ['cursor-agent', 'agent'], args: (prompt) => ['-p', '--force', '--output-format', 'text', prompt] },
  claude: { binaries: ['claude'], args: (prompt) => ['-p', prompt, '--permission-mode', 'acceptEdits'] },
};

function resolveAgent(engine) {
  const { binaries, args } = AGENTS[engine];
  const binary = binaries.find(isInstalled);
  if (!binary) throw new Error(`No ${engine} CLI found (looked for ${binaries.join(', ')}). Install it or use --engine manual.`);
  return { binary, args };
}

const contextSection = (context) =>
  context ? `\n${context}\n\nRespect these earlier decisions and documented pitfalls unless your tasks say otherwise; spec and plan win on conflict.\n` : '';

function lanePrompt(project, feature, lane, context) {
  const verify = ['lint', 'typecheck', 'test'].map((name) => project.commands[name]).filter(Boolean).map((c) => `\`${c}\``);
  return `You are one of several parallel agents implementing feature ${feature.id} ("${feature.title}") in an isolated git worktree.

Your tasks, from specs/features/${feature.id}/tasks.md:
${lane.tasks.map((task) => `- ${task.text}`).join('\n')}

Read first: AGENTS.md, specs/features/${feature.id}/spec.md and specs/features/${feature.id}/plan.md.
${contextSection(context)}
Rules:
- Touch only the files your tasks name. Other agents are editing other files at the same time.
- Do not edit anything under specs/. The orchestrator ticks tasks after merging.
- Follow AGENTS.md; tests must prove the acceptance criteria your tasks reference.
- Verify with ${verify.join(', ')} before committing.
- Commit on this branch with Conventional Commit messages that include the task id, e.g. "feat: T-4 add list sharing endpoint".
- If a task cannot be done as specified, commit what is safe and explain the blocker in your final message.
`;
}

async function prepareLanes(root, project, feature, lanes, context) {
  const base = worktreeBase(root);
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  await mkdir(base, { recursive: true });
  const prepared = [];
  for (const lane of lanes) {
    const path = join(base, `${feature.id}-${lane.name}`);
    if (await exists(path)) throw new Error(`${path} already exists. Merge or remove earlier lanes first.`);
    const branch = `vc/${feature.id}/${lane.name}`;
    git(root, 'worktree', 'add', '-b', branch, path, baseCommit);
    await writeText(`${path}.prompt.md`, lanePrompt(project, feature, lane, context));
    prepared.push({ name: lane.name, engine: lane.engine, branch, path, promptPath: `${path}.prompt.md`, logPath: `${path}.log`, tasks: lane.tasks.map((task) => task.id), state: 'ready' });
  }
  return { feature: feature.id, baseCommit, lanes: prepared };
}

async function runLane({ project, manifest, lane, agent, save }) {
  lane.state = 'running';
  await save(manifest);
  const { install } = project.commands;
  const installCode = install ? await runLogged(install, [], { cwd: lane.path, logPath: lane.logPath }) : 0;
  const prompt = await readFile(lane.promptPath, 'utf8');
  const exitCode = installCode === 0 ? await runLogged(agent.binary, agent.args(prompt), { cwd: lane.path, logPath: lane.logPath }) : installCode;
  lane.state = exitCode === 0 ? 'finished' : 'failed';
  lane.exitCode = exitCode;
  lane.commits = Number(git(lane.path, 'rev-list', '--count', `${manifest.baseCommit}..HEAD`));
  await save(manifest);
  console.log(`${exitCode === 0 ? '✔' : '✖'} ${lane.name} ${lane.state} — ${lane.commits} commit(s) · log: ${lane.logPath}`);
}

function printManualSteps(manifest, lanes = manifest.lanes) {
  if (!lanes.length) return;
  console.log('\nManual lanes — start one Cursor agent per lane:');
  lanes.forEach((lane) => {
    console.log(`\n  ${lane.name} (${lane.tasks.join(', ')})`);
    console.log(`    Cursor window: open ${lane.path}, start an agent, paste ${lane.promptPath}`);
    console.log(`    or CLI:        cd "${lane.path}" && cursor-agent "$(cat "${lane.promptPath}")"`);
  });
  console.log(`\nWhen the lanes have committed their work: vibecheck merge ${manifest.feature}`);
}

async function assertDispatchable(root, feature) {
  if (feature.status !== 'in-progress') throw new Error(`${feature.id} must be in-progress (vibecheck status ${feature.id} in-progress).`);
  if (await loadManifest(root, feature.id)) throw new Error(`Lanes for ${feature.id} are already dispatched. Run "vibecheck merge ${feature.id}" first.`);
  assertCleanTree(root, 'commit first so the lanes start from your latest specs and code');
}

export async function dispatch({ root, args, engine, 'dry-run': dryRun }) {
  const project = await loadProject(root);
  const feature = findFeature(await listFeatures(root), args[0] ?? '');
  const chosen = engine ?? project.workflow.engine;
  if (!ENGINES.includes(chosen)) throw new Error(`--engine must be one of: ${ENGINES.join(', ')}`);
  const planned = planLanes(readyParallelTasks(parseTasks(feature.tasks)), project.workflow.maxLanes);
  if (!planned.length) throw new Error(`${feature.id} has no ready [P] tasks — the next open task is sequential.`);
  const lanes = routeLanes(planned, { ...project, workflow: { ...project.workflow, engine: chosen } });
  if (dryRun) {
    lanes.forEach((lane) => console.log(`${lane.name} → ${describeRoute(lane, chosen)}: ${lane.tasks.map((task) => task.id).join(', ')}`));
    return;
  }
  await assertDispatchable(root, feature);
  const save = createManifestWriter(root);
  const context = await contextForFeature(project, feature, 'Context from memory and your knowledge library');
  if (chosen === 'multica') {
    const manifest = await dispatchToMultica({ root, project, feature, lanes, briefFor: (lane) => lanePrompt(project, feature, lane, context) });
    await save(manifest);
    manifest.lanes.forEach((lane) => console.log(`✔ ${lane.name} → Multica ${lane.issue} (assigned to ${lane.agent}, branch ${lane.branch})`));
    console.log(`\nWatch the board, or: vibecheck lanes ${feature.id}. When lanes are in review: vibecheck merge ${feature.id}`);
    return;
  }
  const agents = Object.fromEntries([...new Set(lanes.map((lane) => lane.engine))].filter((name) => name !== 'manual').map((name) => [name, resolveAgent(name)]));
  const manifest = await prepareLanes(root, project, feature, lanes, context);
  await save(manifest);
  console.log(`✔ ${manifest.lanes.length} lane(s) ready in ${worktreeBase(root)}${context ? ' · shared context added to each brief' : ''}`);
  const headless = manifest.lanes.filter((lane) => lane.engine !== 'manual');
  printManualSteps(manifest, manifest.lanes.filter((lane) => lane.engine === 'manual'));
  if (!headless.length) return;
  headless.forEach((lane) => console.log(`▶ ${lane.name} → ${agents[lane.engine].binary}`));
  await Promise.all(headless.map((lane) => runLane({ project, manifest, lane, agent: agents[lane.engine], save })));
  console.log(`\nNext: vibecheck merge ${feature.id}`);
}
