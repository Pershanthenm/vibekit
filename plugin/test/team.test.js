import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { planFor } from '../src/commands/setup.js';
import { TOOL_FREE_PATH, installFakeBin, newProject } from './helpers.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const KEYS = ['VIBECHECK_REPO_DIR', 'CLAUDE_CONFIG_DIR', 'VIBECHECK_CURSOR_DIR', 'VIBECHECK_HOME', 'PATH', 'AGENTMEMORY_URL'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let repo;
let claudeHome;

const FAKE_CLAUDE = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args === 'plugin list --json') console.log('[{"id":"draw-io@claude-drawio-skill","version":"1.0.0","enabled":true},{"id":"my-local@my-folder","enabled":true},{"id":"vibe-check-cli@vibe-check-cli","enabled":true}]');
else if (args === 'plugin marketplace list --json') console.log(process.env.FAKE_TEAMMATE ? '[{"name":"vibe-check-cli","source":"directory","path":"/x"}]' : '[{"name":"claude-drawio-skill","source":"github","repo":"example/claude-drawio-skill"},{"name":"my-folder","source":"directory","path":"/somewhere"},{"name":"vibe-check-cli","source":"directory","path":"/x"}]');
else if (args === '--version') console.log('2.1.268 (Claude Code)');
`;

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'vc-team-'));
  repo = join(base, 'vibe-check-cli');
  await cp(REPO, repo, { recursive: true, filter: (source) => !source.includes('node_modules') });
  claudeHome = join(base, 'claude');
  await mkdir(join(claudeHome, 'skills', 'enterprise-dotnet-architect', 'references'), { recursive: true });
  await writeFile(join(claudeHome, 'skills', 'enterprise-dotnet-architect', 'SKILL.md'), '---\nname: enterprise-dotnet-architect\ndescription: House .NET + Vue standards.\n---\nUse Clean Architecture.\n');
  await writeFile(join(claudeHome, 'skills', 'enterprise-dotnet-architect', 'references', 'layers.md'), '# Layers\n');
  await mkdir(join(claudeHome, 'skills', 'run'), { recursive: true });
  await writeFile(join(claudeHome, 'skills', 'run', 'SKILL.md'), '---\nname: run\ndescription: clashes\n---\n');
  await mkdir(join(claudeHome, 'agents'), { recursive: true });
  await writeFile(join(claudeHome, 'agents', 'db-expert.md'), '---\nname: db-expert\ndescription: PostgreSQL tuning specialist.\ntools: Read, Grep, Bash\n---\nYou tune queries.\n');
  const bin = join(base, 'bin');
  await mkdir(bin);
  await installFakeBin(bin, 'claude', FAKE_CLAUDE);
  Object.assign(process.env, {
    VIBECHECK_REPO_DIR: repo, CLAUDE_CONFIG_DIR: claudeHome, VIBECHECK_CURSOR_DIR: join(base, 'cursor'),
    VIBECHECK_HOME: join(base, 'home'), PATH: [bin, TOOL_FREE_PATH].join(delimiter), AGENTMEMORY_URL: 'http://127.0.0.1:9',
  });
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  process.exitCode = 0;
});

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('team capture puts your skills, subagents and plugins into the plugin', async () => {
  const before = (await json(join(repo, 'plugin/.claude-plugin/plugin.json'))).version;
  await run(['team', 'capture', '--repo', repo]);

  assert.ok((await readdir(join(repo, 'plugin/skills'))).includes('enterprise-dotnet-architect'));
  assert.equal(await readFile(join(repo, 'plugin/skills/enterprise-dotnet-architect/references/layers.md'), 'utf8'), '# Layers\n', 'supporting files travel with the skill');
  assert.ok((await readdir(join(repo, 'plugin/agents'))).includes('db-expert.md'));
  assert.match(await readFile(join(repo, 'plugin/skills/run/SKILL.md'), 'utf8'), /Autopilot/, 'a clashing personal skill never replaces a built-in one');

  const manifest = await json(join(repo, 'plugin/.claude-plugin/plugin.json'));
  const marketplace = await json(join(repo, '.claude-plugin/marketplace.json'));
  assert.deepEqual(manifest.dependencies, [{ name: 'draw-io', marketplace: 'claude-drawio-skill' }], 'shareable plugins become dependencies; local-folder ones do not');
  assert.deepEqual(marketplace.allowCrossMarketplaceDependenciesOn, ['claude-drawio-skill']);
  assert.notEqual(manifest.version, before, 'the version moves so Claude Code refreshes its copy');
  assert.equal(marketplace.plugins[0].version, manifest.version);
  assert.deepEqual(await json(join(repo, 'team/plugins.json')), [{ name: 'draw-io', marketplace: 'claude-drawio-skill', source: { source: 'github', repo: 'example/claude-drawio-skill' } }]);
});

test('a teammate\'s setup adds the team marketplaces first, then installs', async () => {
  await run(['team', 'capture', '--repo', repo]);
  process.env.FAKE_TEAMMATE = '1';
  const { steps } = await planFor(repo, { only: ['team-marketplaces', 'vibecheck-plugin'] });
  delete process.env.FAKE_TEAMMATE;
  assert.deepEqual(steps.map((step) => step.tool.id), ['team-marketplaces', 'vibecheck-plugin']);
  assert.equal(steps[0].command, 'claude plugin marketplace add "example/claude-drawio-skill"');
});

test('Cursor gets the team subagents and skills too', async () => {
  await run(['team', 'capture', '--repo', repo]);
  await run(['cursor-kit']);
  const cursor = process.env.VIBECHECK_CURSOR_DIR;
  const expert = await readFile(join(cursor, 'agents', 'db-expert.md'), 'utf8');
  assert.match(expert, /^---\nname: db-expert\ndescription: "PostgreSQL tuning specialist\."\nmodel: inherit\nreadonly: true\nis_background: false\n---/, 'converted to Cursor format; read-only because it has no write tools');
  assert.equal(await readFile(join(cursor, 'skills', 'vibe-check-cli', 'enterprise-dotnet-architect', 'SKILL.md'), 'utf8'), await readFile(join(claudeHome, 'skills', 'enterprise-dotnet-architect', 'SKILL.md'), 'utf8'));
  await run(['cursor-kit', '--remove']);
  assert.deepEqual(await readdir(join(cursor, 'agents')), []);
  await assert.rejects(readdir(join(cursor, 'skills', 'vibe-check-cli')));
});

test('vibecheck projects lists every project on this machine, and flags missing ones', async () => {
  const first = await newProject('--yes');
  const second = await newProject('--yes');
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await run(['projects', '--json']);
  } finally {
    console.log = original;
  }
  const listed = JSON.parse(lines.join('\n'));
  assert.deepEqual(listed.map((entry) => entry.path).sort(), [first, second].sort());
  assert.ok(listed.every((entry) => entry.total === 0 && !entry.missing));
});
