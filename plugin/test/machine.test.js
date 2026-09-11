import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { runHealthCheck } from '../src/commands/health.js';
import { planSteps, runSetup } from '../src/commands/setup.js';
import { toolChecks } from '../src/machine/health.js';
import { httpOk } from '../src/machine/probe.js';
import { toolsFor } from '../src/machine/tools.js';
import { BIN, exitCodeOf, gitInit, newProject, sh, startFakeAgentmemory } from './helpers.js';

const ORIGINAL_ENV = { ...process.env };
const NODE_DIR = dirname(process.execPath);

async function fakeBin(scripts) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-bin-'));
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), `#!/bin/sh\n${body}\n`);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

const HEALTHY = (claudeAnswer = 'VIBECHECK_OK') => ({
  claude: `case "$1" in --version) echo "2.1.300 (Claude Code)";; plugin) echo "vibe-check-cli@vibe-check-cli enabled"; echo "agentmemory@agentmemory enabled";; -p) echo "${claudeAnswer}";; esac`,
  agent: 'case "$1" in --version) echo "cursor-agent 2026.09";; -p) echo "CURSOR_OK";; esac',
  oc: 'case "$1" in --version) echo "oc 1.4.0";; search) echo "[]";; esac',
  agentmemory: 'echo "agentmemory 0.9"',
  vibecheck: `exec "${process.execPath}" "${BIN}" "$@"`,
});

beforeEach(async () => {
  process.env.VIBECHECK_HOME = await mkdtemp(join(tmpdir(), 'sf-home-'));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.exitCode = 0;
});

async function projectOnHealthyMachine(claudeAnswer) {
  process.env.VIBECHECK_CURSOR_DIR = join(await mkdtemp(join(tmpdir(), 'vc-cursor-')), '.cursor');
  await run(['cursor-agents']);
  const memory = await startFakeAgentmemory();
  process.env.PATH = `${await fakeBin(HEALTHY(claudeAnswer))}:${NODE_DIR}:/usr/bin:/bin`;
  process.env.AGENTMEMORY_URL = memory.url;
  const root = await newProject('--yes');
  gitInit(root);
  return { root, memory };
}

test('health --live passes when every piece works, end to end', async () => {
  const { root, memory } = await projectOnHealthyMachine();
  try {
    const report = await runHealthCheck(root, { live: true });
    const failing = Object.values(report.groups).flat().filter((result) => !result.ok);
    assert.deepEqual(failing.map((result) => `${result.name}: ${result.detail}`), []);
    assert.ok(report.groups.Live.some((result) => result.name === 'agentmemory saves and recalls' && result.ok));
    assert.ok(report.groups.Project.some((result) => result.name === 'hooks run on this machine' && result.ok));
    assert.equal(await exitCodeOf(['health', '--dir', root, '--live']), 0);
    assert.equal(await exitCodeOf(['doctor', '--dir', root]), 0, 'the old command name still works');
  } finally {
    await memory.close();
  }
});

test('the live check catches a Claude Code without the vibecheck hooks', async () => {
  const { root, memory } = await projectOnHealthyMachine('MISSING');
  try {
    const live = (await runHealthCheck(root, { live: true })).groups.Live;
    const claude = live.find((result) => result.name.startsWith('Claude Code'));
    assert.equal(claude.ok, false);
    assert.match(claude.fix, /claude plugin install vibe-check-cli@vibe-check-cli/);
  } finally {
    await memory.close();
  }
});

test('fixes are the right commands for each operating system', async () => {
  process.env.PATH = `${NODE_DIR}:/usr/bin:/bin`;
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  const fixFor = async (platform, id) => (await toolChecks(null, platform)).find((result) => result.tool.id === id).fix;
  assert.equal(await fixFor('macos', 'claude'), 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(await fixFor('windows', 'claude'), 'winget install Anthropic.ClaudeCode');
  assert.equal(await fixFor('windows', 'cursor-agent'), "irm 'https://cursor.com/install?win32=true' | iex");
  assert.equal(await fixFor('linux', 'cursor-agent'), 'curl https://cursor.com/install -fsS | bash');
  assert.match(await fixFor('windows', 'agentmemory'), /WSL2/);
});

test('the checklist follows the project configuration', async () => {
  const root = await newProject('--yes');
  const path = join(root, 'specs/project.json');
  const base = JSON.parse(await readFile(path, 'utf8'));
  const ids = (overrides) => toolsFor({ ...base, ...overrides, workflow: { ...base.workflow, ...overrides.workflow }, multica: { ...base.multica, ...overrides.multica } }).map((tool) => tool.id);

  const lean = ids({ workflow: { engine: 'claude' }, memory: { ...base.memory, provider: 'none' }, knowledge: { ...base.knowledge, provider: 'none' } });
  assert.deepEqual(lean, ['node', 'git', 'claude', 'vibecheck-plugin', 'vibecheck-cli', 'cursor-agents']);
  assert.ok(ids({ workflow: { engine: 'cursor' } }).includes('cursor-agent'));
  const multica = ids({ workflow: { engine: 'multica' } });
  assert.ok(multica.includes('multica') && multica.includes('docker') && !multica.includes('cursor-agent'));
});

test('setup --dry-run shows the plan and changes nothing; installs are followed by service starts', async () => {
  process.env.PATH = `${NODE_DIR}:/usr/bin:/bin`;
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  const root = await mkdtemp(join(tmpdir(), 'sf-machine-'));
  const { planned } = await runSetup({ root, platform: 'linux', dryRun: true });
  assert.ok(planned.some((entry) => entry.tool.id === 'claude' && entry.kind === 'install'));
  const memorySteps = planned.filter((entry) => entry.tool.id === 'agentmemory').map((entry) => entry.kind);
  assert.deepEqual(memorySteps, ['install', 'start']);
  const windows = planSteps(await toolChecks(null, 'windows'), 'windows');
  assert.ok(windows.find((entry) => entry.tool.id === 'agentmemory').manual, 'no automatic agentmemory install on native Windows');
});

test('setup runs installs, re-checks, and starts services in the background', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'sf-installed-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const pidFile = join(bin, 'service.pid');
  process.env.PATH = `${bin}:${NODE_DIR}:/usr/bin:/bin`;
  const widget = {
    id: 'widget', name: 'Widget', why: 'test', needed: () => true,
    check: async () => ({ ok: sh(bin, 'sh', '-c', `test -x ${bin}/widget && echo yes || echo no`).trim() === 'yes', detail: '' }),
    install: { linux: `printf '#!/bin/sh\\necho widget 1.0\\n' > ${bin}/widget && chmod +x ${bin}/widget` },
  };
  const service = {
    id: 'agentmemory', name: 'Service', why: 'test', needed: () => true,
    check: async () => ({ ok: await httpOk(`http://127.0.0.1:${port}/`), detail: '' }),
    install: { linux: 'true' },
    start: `"${process.execPath}" -e "require('fs').writeFileSync('${pidFile}', String(process.pid)); require('http').createServer((q, s) => s.end('ok')).listen(${port})"`,
  };
  try {
    const outcomes = await runSetup({ root: bin, platform: 'linux', tools: [widget, service], yes: true });
    assert.deepEqual(outcomes.done, ['widget', 'agentmemory', 'agentmemory']);
    assert.ok((await widget.check()).ok && (await service.check()).ok);
  } finally {
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
    if (pid) process.kill(pid);
  }
});

test('version works and the bootstrap script is valid shell', async () => {
  assert.equal(await exitCodeOf(['version']), 0);
  sh(process.cwd(), 'bash', '-n', join(dirname(BIN), '..', 'scripts', 'bootstrap.sh'));
});

test('setup --json gives Claude a plan to turn into a menu', async () => {
  process.env.PATH = `${NODE_DIR}:/usr/bin:/bin`;
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  const root = await mkdtemp(join(tmpdir(), 'vc-json-'));
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await run(['setup', '--dir', root, '--json']);
  } finally {
    console.log = original;
  }
  const plan = JSON.parse(lines.join('\n'));
  assert.ok(plan.ready.some((entry) => entry.id === 'node'));
  const claude = plan.steps.find((entry) => entry.id === 'claude');
  assert.deepEqual([claude.kind, claude.manual, typeof claude.command], ['install', false, 'string']);
  assert.deepEqual(plan.steps.filter((entry) => entry.id === 'agentmemory').map((entry) => entry.kind), ['install', 'start']);
});

test('the Claude panel gets setup and health commands', async () => {
  const { SKILLS } = await import('../src/generators/workflow.js');
  const setupSkill = SKILLS.find((skill) => skill.name === 'setup');
  assert.equal(setupSkill.userOnly, true, 'installing software only happens when the user asks');
  assert.ok(SKILLS.some((skill) => skill.name === 'health' && !skill.userOnly));
  assert.ok(!SKILLS.some((skill) => skill.name === 'doctor'), 'no leftover doctor skill');
});

test('steps that need a browser sign-in are flagged for the terminal, not run by Claude', async () => {
  const { planSteps } = await import('../src/commands/setup.js');
  const multica = (await import('../src/machine/tools.js')).TOOLS.find((tool) => tool.id === 'multica');
  const steps = planSteps([{ ok: false, tool: multica }], 'macos');
  assert.deepEqual(steps.map((entry) => [entry.kind, entry.interactive]), [['install', false], ['configure', true], ['start', false]]);
  assert.match(steps[0].command, /install\.sh \| bash -s -- --with-server/, 'the Mac install includes the self-hosted server');
});

test('non-interactive setup hands sign-in steps to the user and skips what depends on them', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'vc-interactive-'));
  process.env.PATH = `${bin}:${NODE_DIR}:/usr/bin:/bin`;
  const tool = {
    id: 'svc', name: 'Service', why: 'test', needed: () => true, interactive: ['configure'],
    check: async () => ({ ok: false, detail: '' }),
    install: { linux: `echo install >> ${bin}/log` }, configure: `echo configure >> ${bin}/log`, start: `echo start >> ${bin}/log`,
  };
  const outcomes = await runSetup({ root: bin, platform: 'linux', tools: [tool], yes: true });
  const log = await readFile(join(bin, 'log'), 'utf8');
  assert.equal(log.trim(), 'install', 'only the install ran');
  assert.deepEqual([outcomes.done, outcomes.manual], [['svc'], ['svc']]);
});
