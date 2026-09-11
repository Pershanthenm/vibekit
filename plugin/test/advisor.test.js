import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, test } from 'node:test';
import { STATIC_QUESTIONS } from '../src/advisor/questions.js';
import { nextRound, recommend } from '../src/advisor/recommend.js';
import { initialMenuState, reduceMenu, renderMenu } from '../src/menu.js';
import { run } from '../src/cli.js';
import { CURSOR_CONTEXT, SKILLS } from '../src/generators/workflow.js';
import { BIN, TOOL_FREE_PATH, exitCodeOf, newProject, read } from './helpers.js';

const BASE = { appType: 'internal', scale: 'medium', clients: [], ecosystem: 'mixed', licensing: 'oss-preferred', team: [], data: 'relational', architecture: 'recommend', signin: 'local-mfa', security: [], compliance: 'standard' };
const LAPTOP_APP = { ...BASE, platform: 'web', clients: ['mobile'], ecosystem: 'microsoft', licensing: 'permissive', team: ['csharp', 'typescript'], data: 'reporting', signin: 'sso', security: ['rbac-audit', 'mfa'], compliance: 'privacy', hosting: 'linux', integrations: ['directory', 'devices'], autonomy: 'gated', engine: 'cursor', context: ['docs'] };
const ORIGINAL_ENV = { ...process.env };
const top = (result, layer) => result.layers[layer]?.ranked[0]?.id;

beforeEach(async () => {
  process.env.VIBECHECK_HOME = await mkdtemp(join(tmpdir(), 'vibecheck-home-'));
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  process.env.PATH = TOOL_FREE_PATH;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.exitCode = 0;
});

function walk(persona) {
  const answers = {};
  const rounds = [];
  for (let round = nextRound(answers); !round.complete; round = nextRound(answers)) {
    rounds.push(round);
    for (const question of round.questions) answers[question.id] = persona[question.id] ?? (question.multi ? [] : question.defaults?.[0] ?? question.options[0].id);
  }
  return { answers, rounds, asked: rounds.flatMap((round) => round.questions.map((question) => question.id)) };
}

test('every round, for every kind of developer, fits AskUserQuestion limits', () => {
  for (const platform of ['web', 'mobile', 'desktop', 'backend']) {
    for (const round of walk({ platform, clients: ['web', 'mobile', 'desktop', 'api'] }).rounds) {
      assert.ok(round.questions.length >= 1 && round.questions.length <= 4, `${platform}: ${round.title}`);
      for (const question of round.questions) {
        assert.ok(question.options.length >= 2 && question.options.length <= 4, `${platform}: ${question.id}`);
        assert.ok(question.header.length <= 12, question.id);
      }
    }
  }
});

test('the questions adapt to what you are building', () => {
  const desktop = walk({ platform: 'desktop', data: 'offline', backend: 'none' });
  assert.ok(desktop.asked.includes('desktop') && desktop.asked.includes('database'));
  assert.ok(!desktop.asked.includes('web') && !desktop.asked.includes('mobile') && !desktop.asked.includes('hosting'), 'no web, mobile or hosting questions for a local desktop app');

  const mobileBaas = walk({ platform: 'mobile', backend: 'supabase' });
  assert.ok(mobileBaas.asked.includes('mobile'));
  assert.ok(!mobileBaas.asked.includes('database') && !mobileBaas.asked.includes('hosting'), 'backend-as-a-service brings its own database and hosting');

  const fullStack = walk({ platform: 'web', clients: ['mobile', 'desktop'] });
  for (const layer of ['backend', 'web', 'mobile', 'desktop', 'database', 'hosting']) assert.ok(fullStack.asked.includes(layer), layer);
});

test('recommendations fit web, mobile, desktop and backend developers', () => {
  const laptop = recommend(LAPTOP_APP);
  assert.deepEqual([top(laptop, 'backend'), top(laptop, 'mobile'), top(laptop, 'database')], ['aspnetcore', 'maui', 'postgres']);

  const consumerMobile = recommend({ ...BASE, platform: 'mobile', appType: 'saas', scale: 'small', team: ['typescript'], data: 'documents' });
  assert.deepEqual([top(consumerMobile, 'backend'), top(consumerMobile, 'mobile')], ['supabase', 'react-native']);

  const offlineDesktop = recommend({ ...BASE, platform: 'desktop', scale: 'small', ecosystem: 'opensource', licensing: 'oss-only', team: { other: 'Rust' }, data: 'offline' });
  assert.deepEqual([top(offlineDesktop, 'backend'), top(offlineDesktop, 'desktop'), top(offlineDesktop, 'database')], ['none', 'tauri', 'sqlite']);

  const goService = recommend({ ...BASE, platform: 'backend', appType: 'integration', scale: 'huge', team: { other: 'Go' } });
  assert.equal(top(goService, 'backend'), 'go');

  const flutterDev = recommend({ ...BASE, platform: 'mobile', clients: ['desktop', 'web'], team: { other: 'Dart and Flutter' }, backend: 'supabase', mobile: 'flutter' });
  assert.deepEqual([top(flutterDev, 'desktop'), top(flutterDev, 'web')], ['flutter', 'flutter-web']);
});

test('licensing policies exclude components by their actual licence', () => {
  const excluded = (licensing) => {
    const result = recommend({ ...BASE, platform: 'web', clients: ['desktop'], licensing, backend: 'aspnetcore' });
    return Object.values(result.layers).flatMap((layer) => layer.excluded.map((entry) => entry.id)).sort();
  };
  assert.deepEqual(excluded('permissive'), ['firebase', 'mariadb', 'mongodb', 'mysql', 'qt', 'sqlserver']);
  assert.deepEqual(excluded('oss-only'), ['firebase', 'mongodb', 'sqlserver']);
  assert.deepEqual(excluded('commercial-ok'), []);
  const reason = recommend({ ...BASE, platform: 'web', licensing: 'permissive', backend: 'aspnetcore' }).layers.database.excluded.find((entry) => entry.id === 'mysql').reason;
  assert.match(reason, /GPL-2\.0 is copyleft \(GPL\)/);
});

test('choosing an excluded component explains the licence conflict', async () => {
  const root = await newProject('--yes');
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify({ ...LAPTOP_APP, database: 'mysql' }));
  await assert.rejects(run(['advise', '--dir', root, 'apply']), /Cannot use MySQL 8 Community for database: GPL-2\.0/);
});

test('bring your own stack: Other on any layer, or your own component catalogue', async () => {
  const root = await newProject('--yes');
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify({ ...BASE, platform: 'backend', backend: { other: 'Elixir Phoenix' }, database: 'postgres' }));
  await run(['advise', '--dir', root, 'apply']);
  let project = JSON.parse(await read(root, 'specs/project.json'));
  assert.equal(project.stack.backend, 'Elixir Phoenix');
  assert.match(project.commands.test, /Set the test command/);

  await writeFile(join(process.env.VIBECHECK_HOME, 'components.json'), JSON.stringify([{
    id: 'phoenix', layer: 'backend', label: 'Elixir Phoenix', languages: ['Elixir'], licence: { name: 'MIT', class: 'permissive' },
    summary: 'Fault-tolerant realtime web framework', testing: 'ExUnit', commands: { install: 'mix deps.get', test: 'mix test', lint: 'mix credo' },
  }]));
  await run(['advise', 'prefer', 'phoenix']);
  const result = recommend({ ...BASE, platform: 'backend' }, { preferred: ['phoenix'] });
  assert.ok(result.layers.backend.ranked.some((entry) => entry.id === 'phoenix' && entry.custom));
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify({ ...BASE, platform: 'backend', backend: 'phoenix', database: 'postgres' }));
  await run(['advise', '--dir', root, 'apply']);
  project = JSON.parse(await read(root, 'specs/project.json'));
  assert.deepEqual([project.stack.languages, project.commands.test, project.standards.testing.framework], [['Elixir'], 'mix test', 'ExUnit']);
});

test('the laptop app with the dotnet-vue preset follows the house layout', async () => {
  const root = await newProject('--yes');
  const projectPath = join(root, 'specs/project.json');
  const base = JSON.parse(await readFile(projectPath, 'utf8'));
  await writeFile(projectPath, JSON.stringify({ ...base, project: { ...base.project, name: 'laptop-tracker' } }));
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify(LAPTOP_APP));
  await run(['advise', '--dir', root, 'apply', 'dotnet-vue']);

  const project = JSON.parse(await read(root, 'specs/project.json'));
  assert.deepEqual(project.targets, ['web', 'ios', 'android', 'api']);
  assert.equal(project.stack.hosting, 'Ubuntu Server + Nginx + Docker Compose + systemd');
  assert.match(project.stack.frontend, /^Vue 3/);
  assert.match(project.stack.mobile, /^\.NET MAUI/);
  assert.equal(project.commands.test, 'dotnet test && (cd src/LaptopTracker.WebApp && npm run test:unit)');
  assert.ok(project.architecture.notes.some((note) => /src\/LaptopTracker\.WebApp\//.test(note)));
  assert.equal(project.security.stack, 'aspnetcore');

  const adr = await read(root, 'specs/decisions/0002-technology-selection.md');
  assert.match(adr, /### Backend: ASP\.NET Core \(\.NET 9\) \(MIT\)[\s\S]*### Web: Vue 3 \+ Vite \+ Pinia \(MIT\)[\s\S]*### Database: PostgreSQL 16 \(PostgreSQL License\)[\s\S]*excluded: GPL-2\.0/);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0);
});

test('a local desktop app has no server, hosting or API', async () => {
  const root = await newProject('--yes');
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify({ ...BASE, platform: 'desktop', data: 'offline', licensing: 'oss-only' }));
  await run(['advise', '--dir', root, 'apply']);
  const project = JSON.parse(await read(root, 'specs/project.json'));
  assert.deepEqual(project.targets, ['desktop']);
  assert.deepEqual([project.stack.backend, project.stack.database, project.stack.hosting], ['None (local-only app)', 'SQLite', '']);
  assert.ok(project.stack.other.some((item) => /Signed installers/.test(item)));
  assert.match(project.commands.test, /cargo test/);
});

test('preferences and presets shape recommendations visibly', async () => {
  await run(['advise', 'prefer', 'dotnet-vue']);
  const { recommendFor } = await import('../src/advisor/selection.js');
  const result = await recommendFor(LAPTOP_APP);
  assert.equal(top(result, 'web'), 'vue');
  assert.ok(result.layers.web.ranked[0].reasons.some((reason) => reason.text === 'your preferred choice'));
  await assert.rejects(run(['advise', 'prefer', 'cobol-on-cogs']), /Unknown: cobol-on-cogs/);
});

test('menu keys: arrows wrap, space toggles, enter confirms, Other and cancel', () => {
  const single = STATIC_QUESTIONS.find((question) => question.id === 'appType');
  const multi = STATIC_QUESTIONS.find((question) => question.id === 'clients');
  const press = (question, ...keys) => keys.reduce((state, name) => reduceMenu(state, typeof name === 'string' ? { name } : name, question), initialMenuState());
  assert.equal(press(single, 'up').cursor, single.options.length);
  assert.deepEqual(press(single, 'down', 'return'), { cursor: 1, selected: ['saas'], status: 'submitted' });
  assert.deepEqual(press(multi, 'space', 'down', 'down', 'space', 'return').selected, ['web', 'desktop']);
  assert.equal(press(single, 'up', 'return').status, 'other');
  assert.equal(press(single, { name: 'c', ctrl: true }).status, 'aborted');
  assert.match(renderMenu(press(multi, 'space'), multi).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''), /◉ Web app.*Browser-based UI/);
});

test('init walks the adaptive menus end to end without a terminal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibecheck-wizard-'));
  const child = promisify(execFile)(process.execPath, [BIN, 'init', '--dir', root], { env: { ...process.env } });
  child.child.stdin.end(['laptop-tracker', 'Track company laptops', ...Array(60).fill('')].join('\n') + '\n');
  const { stdout } = await child;
  assert.match(stdout, /── Stack ──[\s\S]*Recommendation[\s\S]*★[\s\S]*Security baseline: \d+ controls/);
  const project = JSON.parse(await read(root, 'specs/project.json'));
  assert.equal(project.project.name, 'laptop-tracker');
  assert.ok((await readdir(join(root, 'specs/decisions'))).some((file) => file.endsWith('technology-selection.md')));
});

test('Cursor gets the terminal wizard instead of chat menus', () => {
  const body = SKILLS.find((skill) => skill.name === 'new-project').body(CURSOR_CONTEXT);
  assert.match(body, /run `vibecheck advise` in the integrated terminal/);
  assert.doesNotMatch(body, /AskUserQuestion/);
});
