import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadProjectIfAny, toolChecks } from '../machine/health.js';
import { detectPlatform, PLATFORM_NAMES, toolEnv } from '../machine/platform.js';
import { runShell } from '../machine/probe.js';
import { toolsFor } from '../machine/tools.js';
import { createAsker } from '../menu.js';
import { runHealthCheck } from './health.js';

const MANUAL = /^(Use|Install|Start|Create) /;
const VERBS = { install: 'Install', configure: 'Configure', start: 'Start', update: 'Update', enable: 'Enable' };
const SERVICE_WAIT_MS = 90000;
const POLL_MS = 2000;
const logDir = () => join(process.env.VIBECHECK_HOME || join(homedir(), '.vibe-check-cli'), 'logs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const step = (tool, kind, command) => ({ tool, kind, command, manual: !command || MANUAL.test(command), interactive: (tool.interactive ?? []).includes(kind) });

const FOLLOW_UPS = ['configure', 'start'];
const REPAIRS = ['update', 'enable'];

export function planSteps(results, platform) {
  return results.filter((result) => !result.ok && !result.unknown).flatMap(({ tool, action }) => {
    if (REPAIRS.includes(action)) return [step(tool, action, tool[action])];
    if (action) return FOLLOW_UPS.slice(FOLLOW_UPS.indexOf(action)).filter((kind) => tool[kind]).map((kind) => step(tool, kind, tool[kind]));
    const install = step(tool, 'install', tool.install[platform]);
    return install.manual ? [install] : [install, ...FOLLOW_UPS.filter((kind) => tool[kind]).map((kind) => step(tool, kind, tool[kind]))];
  });
}

async function startInBackground(step) {
  await mkdir(logDir(), { recursive: true });
  const logPath = join(logDir(), `${step.tool.id}.log`);
  const log = openSync(logPath, 'a');
  spawn(step.command, { shell: true, detached: true, stdio: ['ignore', log, log], env: toolEnv() }).unref();
  for (let waited = 0; waited < SERVICE_WAIT_MS; waited += POLL_MS) {
    if ((await step.tool.check()).ok) return true;
    await sleep(POLL_MS);
  }
  console.log(`  ! still starting — see ${logPath}`);
  return false;
}

const confirmQuestion = (step) => ({
  id: 'confirm', header: VERBS[step.kind], noOther: true,
  question: `${VERBS[step.kind]} ${step.tool.name}? (${step.tool.why})\n    ${step.command}`,
  options: [{ id: 'yes', label: 'Yes, run it', description: '' }, { id: 'skip', label: 'Skip for now', description: '' }],
});

async function runStep(step, platform, yes, asker) {
  if (step.manual) {
    console.log(`  → ${step.tool.name}: ${step.command ?? 'no automatic install for this platform'}`);
    return 'manual';
  }
  if (!yes && (await asker.choose(confirmQuestion(step))) !== 'yes') return 'skipped';
  const background = step.kind === 'start' && step.tool.id === 'agentmemory';
  const ok = background ? await startInBackground(step) : runShell(step.command, platform) === 0;
  if (ok && step.tool.after) console.log(`  → next: ${step.tool.after}`);
  return ok ? 'done' : 'failed';
}

export async function planFor(root, { platform = detectPlatform(), tools, only = [] } = {}) {
  const project = await loadProjectIfAny(root);
  const selected = (tools ?? toolsFor(project)).filter((tool) => !only.length || only.includes(tool.id));
  const results = await toolChecks(project, platform, selected);
  return { project, platform, results, steps: planSteps(results, platform) };
}

export async function runSetup({ root, platform = detectPlatform(), tools, only = [], yes = false, dryRun = false, asker }) {
  const { project, results, steps } = await planFor(root, { platform, tools, only });
  console.log(`vibecheck setup · ${PLATFORM_NAMES[platform]}${project ? ` · for project ${project.project.name}` : ' · machine-wide'}`);
  results.filter((result) => result.ok).forEach((result) => console.log(`  ✔ ${result.name} — ${result.detail}`));
  if (!steps.length) {
    console.log('✔ Nothing to install or start.');
    return { done: [], skipped: [], failed: [], manual: [] };
  }
  console.log(`\nPlan (${steps.length} step${steps.length === 1 ? '' : 's'}):`);
  steps.forEach((step) => console.log(`  ${step.manual ? '·' : '→'} ${step.kind} ${step.tool.name}: ${step.command ?? 'manual'}`));
  if (dryRun) return { planned: steps };
  const outcomes = { done: [], skipped: [], failed: [], manual: [] };
  const deferred = new Set();
  for (const next of steps) {
    if (next.kind !== 'install' && outcomes.failed.includes(next.tool.id)) continue;
    if (deferred.has(next.tool.id)) continue;
    if (yes && next.interactive) {
      console.log(`\n→ ${next.tool.name} needs you for the next step (browser sign-in or prompts). Run it in Cursor's terminal:\n    ${next.command}`);
      outcomes.manual.push(next.tool.id);
      deferred.add(next.tool.id);
      continue;
    }
    console.log(`\n${{ install: 'Installing', configure: 'Configuring', start: 'Starting', update: 'Updating', enable: 'Enabling' }[next.kind]} ${next.tool.name}…`);
    outcomes[await runStep(next, platform, yes, asker)].push(next.tool.id);
  }
  return outcomes;
}

function printJsonPlan({ platform, project, results, steps }) {
  console.log(JSON.stringify({
    platform,
    project: project?.project.name ?? null,
    ready: results.filter((result) => result.ok).map((result) => ({ id: result.tool.id, name: result.name, detail: result.detail })),
    steps: steps.map((entry) => ({ id: entry.tool.id, name: entry.tool.name, why: entry.tool.why, kind: entry.kind, command: entry.command, manual: entry.manual, interactive: entry.interactive, after: entry.tool.after ?? null })),
  }, null, 2));
}

export async function setup({ root, yes, 'dry-run': dryRun, only, json }) {
  const ids = only ? only.split(',').map((id) => id.trim()) : [];
  if (json) return printJsonPlan(await planFor(root, { only: ids }));
  const asker = yes || dryRun ? null : createAsker();
  try {
    const outcomes = await runSetup({ root, yes, dryRun, asker, only: ids });
    if (dryRun) return console.log('\nDry run: nothing was changed. Run "vibecheck setup" to go ahead.');
    if (outcomes.failed.length) console.log(`\n✖ Failed: ${outcomes.failed.join(', ')} — see the output above.`);
    if (outcomes.done.length) console.log('\nOpen a new terminal so PATH changes apply, then run "vibecheck health --live".');
    const { groups } = await runHealthCheck(root);
    const remaining = Object.values(groups).flat().filter((result) => !result.ok && !result.unknown);
    console.log(remaining.length ? `\n${remaining.length} item(s) still need attention: vibecheck health` : '\n✔ All set on this machine.');
  } finally {
    asker?.close();
  }
}

export async function version() {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  console.log(`Vibe-check-cli ${pkg.version}`);
}
