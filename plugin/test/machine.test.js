import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { runHealthCheck } from '../src/commands/health.js';
import { planSteps, runSetup } from '../src/commands/setup.js';
import { toolChecks } from '../src/machine/health.js';
import { httpOk } from '../src/machine/probe.js';
import { TOOLS, toolsFor } from '../src/machine/tools.js';
import { BIN, TOOL_FREE_PATH, exitCodeOf, gitInit, installFakeBin, isolateHome, newProject, posix, restoreEnv, sh, startFakeAgentmemory, startFakeHttp } from './helpers.js';

const ORIGINAL_ENV = { ...process.env };
const NODE_DIR = dirname(process.execPath);

// A `#!/bin/sh` script with no extension is not runnable on Windows, and the code under test
// resolves commands through PATHEXT. Each stand-in is a Node script paired with a .cmd shim,
// which is what installFakeBin writes, so the same fixtures work on every platform.
async function fakeBin(scripts) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-bin-'));
  for (const [name, source] of Object.entries(scripts)) await installFakeBin(dir, name, source);
  return dir;
}

const replies = (cases) => `#!/usr/bin/env node
const out = ${JSON.stringify(cases)};
const key = process.argv[2] ?? '';
const value = key in out ? out[key] : out['*'];
if (value !== undefined) console.log(value);
`;

// Docker is required of every project now, so a machine that is meant to be healthy has to
// answer for it too.
const HEALTHY = (claudeAnswer = 'VIBEKIT_OK') => ({
  claude: replies({
    '--version': '2.1.300 (Claude Code)',
    plugin: 'vibekit@vibekit enabled\nagentmemory@agentmemory enabled',
    '-p': claudeAnswer,
  }),
  agent: replies({ '--version': 'cursor-agent 2026.09', '-p': 'CURSOR_OK' }),
  oc: replies({ '--version': 'oc 1.4.0', search: '[]' }),
  agentmemory: replies({ '*': 'agentmemory 0.9' }),
  docker: replies({ info: 'Server Version: 27.0.3', '*': 'Docker version 27.0.3' }),
  vibekit: `#!/usr/bin/env node
require('child_process').spawnSync(process.execPath, [${JSON.stringify(BIN)}, ...process.argv.slice(2)], { stdio: 'inherit' });
`,
});

beforeEach(async () => {
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'sf-home-'));
});

afterEach(() => {
  restoreEnv(ORIGINAL_ENV);
  process.exitCode = 0;
});

async function projectOnHealthyMachine(claudeAnswer) {
  process.env.VIBEKIT_CURSOR_DIR = join(await mkdtemp(join(tmpdir(), 'vc-cursor-')), '.cursor');
  await run(['cursor-agents']);
  const memory = await startFakeAgentmemory();
  process.env.PATH = [await fakeBin(HEALTHY(claudeAnswer)), TOOL_FREE_PATH].join(delimiter);
  process.env.AGENTMEMORY_URL = memory.url;
  const root = await newProject('--yes');
  gitInit(root);
  return { root, memory, close: () => memory.close() };
}

test('health --live passes when every piece works, end to end', async () => {
  const { root, close } = await projectOnHealthyMachine();
  try {
    const report = await runHealthCheck(root, { live: true });
    const failing = Object.values(report.groups).flat().filter((result) => !result.ok);
    assert.deepEqual(failing.map((result) => `${result.name}: ${result.detail}`), []);
    assert.ok(report.groups.Live.some((result) => result.name === 'agentmemory saves and recalls' && result.ok));
    assert.ok(report.groups.Project.some((result) => result.name === 'hooks run on this machine' && result.ok));
    assert.equal(await exitCodeOf(['health', '--dir', root, '--live']), 0);
    assert.equal(await exitCodeOf(['doctor', '--dir', root]), 0, 'the old command name still works');
  } finally {
    await close();
  }
});

test('the live check catches a Claude Code without the vibekit hooks', async () => {
  const { root, close } = await projectOnHealthyMachine('MISSING');
  try {
    const live = (await runHealthCheck(root, { live: true })).groups.Live;
    const claude = live.find((result) => result.name.startsWith('Claude Code'));
    assert.equal(claude.ok, false);
    assert.match(claude.fix, /claude plugin install vibekit@vibekit/);
  } finally {
    await close();
  }
});

// Read from the tool definitions rather than from a live check. toolChecks only reports a fix
// for a tool it found missing, and the search path deliberately includes %APPDATA%\npm and the
// other well-known install dirs, so a machine that genuinely has Claude Code installed can no
// longer simulate its absence by scrubbing PATH. What this test cares about is the command
// itself, which is a property of the tool, not of this machine.
test('fixes are the right commands for each operating system', () => {
  const installFor = (id, platform) => TOOLS.find((tool) => tool.id === id).install[platform];
  assert.equal(installFor('claude', 'macos'), 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(installFor('claude', 'windows'), 'winget install Anthropic.ClaudeCode');
  assert.equal(installFor('cursor-agent', 'windows'), "irm 'https://cursor.com/install?win32=true' | iex");
  assert.equal(installFor('cursor-agent', 'linux'), 'curl https://cursor.com/install -fsS | bash');
  assert.match(installFor('agentmemory', 'windows'), /WSL2/);
});

test('the checklist follows the project configuration', async () => {
  const root = await newProject('--yes');
  const path = join(root, 'specs/project.json');
  const base = JSON.parse(await readFile(path, 'utf8'));
  const ids = (overrides) => toolsFor({ ...base, ...overrides, workflow: { ...base.workflow, ...overrides.workflow } }).map((tool) => tool.id);

  // Docker, the Cursor CLI and agentmemory are required of every project, so they are not
  // engine-dependent any more. What still follows the configuration is the rest.
  const lean = ids({ workflow: { engine: 'claude' }, memory: { ...base.memory, provider: 'none' }, knowledge: { ...base.knowledge, provider: 'none' } });
  assert.ok(['node', 'git', 'claude', 'vibekit-plugin', 'vibekit-cli'].every((id) => lean.includes(id)), lean.join(', '));
  assert.ok(!lean.includes('opencontext'), 'a project with no knowledge provider does not need OpenContext');

  for (const engine of ['claude', 'cursor']) {
    const required = ids({ workflow: { engine } });
    assert.ok(['docker', 'cursor-agent', 'agentmemory'].every((id) => required.includes(id)), `${engine}: ${required.join(', ')}`);
  }
});

test('setup --dry-run shows the plan and changes nothing; installs are followed by service starts', async () => {
  process.env.PATH = TOOL_FREE_PATH;
  isolateHome();
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
  process.env.PATH = [bin, TOOL_FREE_PATH].join(delimiter);
  process.env.VC_TEST_PIDFILE = pidFile;
  const shellBin = posix(bin);
  const widget = {
    id: 'widget', name: 'Widget', why: 'test', needed: () => true,
    check: async () => ({ ok: sh(bin, 'sh', '-c', `test -x ${shellBin}/widget && echo yes || echo no`).trim() === 'yes', detail: '' }),
    install: { linux: `printf '#!/bin/sh\\necho widget 1.0\\n' > ${shellBin}/widget && chmod +x ${shellBin}/widget` },
  };
  const service = {
    id: 'agentmemory', name: 'Service', why: 'test', needed: () => true,
    check: async () => ({ ok: await httpOk(`http://127.0.0.1:${port}/`), detail: '' }),
    install: { linux: 'true' },
    // The path goes through the environment rather than into the command text. Embedded, it is a
    // JS string literal inside a shell string inside a spawn — three layers of quoting, and on
    // Windows it came out with its separators stripped, which dropped the pid file into the
    // repository root instead of the temp directory. An env var has no escaping rules to lose.
    start: `"${process.execPath}" -e "require('fs').writeFileSync(process.env.VC_TEST_PIDFILE, String(process.pid)); require('http').createServer((q, s) => s.end('ok')).listen(${port})"`,
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
  process.env.PATH = TOOL_FREE_PATH;
  isolateHome();
  // This goes through the CLI, which detects the real platform. Pin it: on native Windows the
  // agentmemory install is manual (it needs WSL2), so no start step follows it — correct, but
  // it would make this assertion about step ordering pass or fail depending on who ran it.
  process.env.VIBEKIT_PLATFORM = 'linux';
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

test('non-interactive setup hands sign-in steps to the user and skips what depends on them', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'vc-interactive-'));
  process.env.PATH = [bin, TOOL_FREE_PATH].join(delimiter);
  const tool = {
    id: 'svc', name: 'Service', why: 'test', needed: () => true, interactive: ['configure'],
    check: async () => ({ ok: false, detail: '' }),
    install: { linux: `echo install >> ${posix(bin)}/log` }, configure: `echo configure >> ${posix(bin)}/log`, start: `echo start >> ${posix(bin)}/log`,
  };
  const outcomes = await runSetup({ root: bin, platform: 'linux', tools: [tool], yes: true });
  const log = await readFile(join(bin, 'log'), 'utf8');
  assert.equal(log.trim(), 'install', 'only the install ran');
  assert.deepEqual([outcomes.done, outcomes.manual], [['svc'], ['svc']]);
});
