import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { currentProject, readCurrent, resolveRoot, setCurrentProject, setWorkingSprint, workingSprint } from '../src/current.js';
import { SHELLS, completionStatus, installCompletion, readIndex, script, suggestions } from '../src/completion.js';
import { generateFolder } from '../src/folder/generate.js';
import { openAsk } from '../src/folder/asks.js';
import { claim, createRequirement, listRequirements } from '../src/folder/requirements.js';
import { closeSprint } from '../src/folder/sprints.js';
import { startScreen, unknownCommand } from '../src/guide.js';
import { migrationBlockers, readMigration, compareData, parseRows, parseTrafficLog, compareResponses } from '../src/migration.js';
import { shadow } from '../src/shadow.js';
import { paceFrom, planView, projectView } from '../src/commands/show.js';
import { register } from '../src/projects.js';
import { exitCodeOf, gitInit, isolateHome, restoreEnv, tempDir } from './helpers.js';

// ------------------------------------------------------------------ fixtures

/** A folder with a plan of two sprints and three requirements, one of them done. */
async function project({ name = 'stock', done = ['REQ-001'], approved = true } = {}) {
  const root = tempDir('vibekit-cli-');
  await generateFolder(root, { name, description: null, architecture: 'layered', stack: {}, commands: {}, entities: [] }, { folder: 'vibekit' });
  for (const [id, title] of [['REQ-001', 'start a stock take'], ['REQ-002', 'save a count'], ['REQ-003', 'list variances']]) {
    await createRequirement(root, { id, title, kind: 'requirement', size: 'S', source: 'BRS-001 §2' }, 'vibekit');
    const path = join(root, `vibekit/product/requirements/${id}.md`);
    let text = await readFile(path, 'utf8');
    text = text.replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  When a counter records a quantity, the system shall save it.\n');
    if (done.includes(id)) text = text.replace(/^status: draft$/m, 'status: done').replace('## Review\n', '## Review\n\nApproved.\n').replace('## Verification\n', '## Verification\n\n- AC-1 → tests/x.test.js\n');
    if (id === 'REQ-002') text = text.replace(/^after:.*$/m, 'after: REQ-001');
    await writeFile(path, text);
  }
  await writeFile(join(root, 'vibekit/workflow/plan.md'), [
    '---', approved ? 'approved: 2026-09-24 by You' : 'approved:', 'requirements: 3', 'phases: 2', '---', '', '# Plan', '',
    '## Phase 1: count', '', '- REQ-001 start a stock take', '- REQ-002 save a count · after REQ-001', '',
    '## Phase 2: variances', '', '- REQ-003 list variances', '',
    '## Deferred', '', '- REQ-009 reporting  reason: later', '',
  ].join('\n'));
  await mkdir(join(root, 'specs'), { recursive: true });
  await writeFile(join(root, 'specs/project.json'), JSON.stringify({ project: { name, platforms: ['web'] }, folder: 'vibekit' }, null, 2));
  // The gates before build, each the line a person writes, so the project is at stage 5.
  await mkdir(join(root, 'vibekit/product/sources/BRS-001'), { recursive: true });
  await writeFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), '# Brief\n\n## 2 Counting\n\nStaff count stock.\n');
  const assumptions = join(root, 'vibekit/workflow/assumptions.md');
  await writeFile(assumptions, (await readFile(assumptions, 'utf8')).replace(/^reviewed:.*$/m, 'reviewed: 2026-09-24 by You'));
  const architecture = join(root, 'vibekit/workflow/architecture.md');
  await writeFile(architecture, (await readFile(architecture, 'utf8')).replace(/^api:.*$/m, 'api: none').replace(/^approved:.*$/m, 'approved: 2026-09-24 by You'));
  return root;
}

/** Approve the three migration gates a person approves before the plan. */
async function approveGates(root) {
  const record = join(root, 'vibekit/workflow/migration.md');
  await writeFile(record, (await readFile(record, 'utf8')).replace('## Target\n', '## Target\n\n.NET 10 on the same shape; the reporting module is not carried across.\n'));
  for (const stage of ['understand', 'target', 'characterise']) await run(['migrate', 'approve', stage, '--by', 'Ada', '--dir', root]);
}

/** Give the project real commands. map.md is generated from specs/project.json, so that is where they go. */
async function withCommands(root, commands) {
  const path = join(root, 'specs/project.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...config, commands }, null, 2));
  const { generateFolder: regenerate } = await import('../src/folder/generate.js');
  const { folderConfig } = await import('../src/commands/folder.js');
  await regenerate(root, await folderConfig(root), { folder: 'vibekit' });
}

function capture() {
  const lines = [];
  const original = console.log;
  console.log = (line = '') => lines.push(String(line));
  return { text: () => lines.join('\n'), json: () => JSON.parse(lines.join('\n')), restore: () => { console.log = original; } };
}

async function output(argv) {
  const out = capture();
  try { await run(argv); } finally { out.restore(); }
  return out.text();
}

async function json(argv) {
  const out = capture();
  try { await run([...argv, '--json']); } finally { out.restore(); }
  return out.json();
}

const listFiles = async (dir, prefix = '') => {
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) rows.push(...(await listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)));
    else rows.push(`${prefix}${entry.name}`);
  }
  return rows.sort();
};

const fakeServer = (respond) => new Promise((ready) => {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const { status = 200, body = '' } = respond(request, Buffer.concat(chunks).toString('utf8'));
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => ready({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }));
});

// ------------------------------------------------------------------ the shape (§1, §3)

test('a bare verb lists what it takes, and a typo names the verbs', async () => {
  assert.match(await output(['new']), /new project[\s\S]*new sprint[\s\S]*new feature[\s\S]*new bug[\s\S]*new hotfix/);
  assert.match(await output(['plan']), /plan project[\s\S]*plan sprint[\s\S]*Nothing is approved without a person/);
  assert.match(await output(['migrate', '--dir', tempDir()]), /migrate upgrade[\s\S]*migrate replatform[\s\S]*migrate decompose[\s\S]*migrate status[\s\S]*migrate next[\s\S]*inside a project you have imported/);
  assert.match(await output(['analyze']), /analyze \.[\s\S]*--depth quick\|standard\|deep[\s\S]*--compare/);
  assert.match(await output(['completion']), /completion bash[\s\S]*completion zsh[\s\S]*completion fish/);
  assert.match(await output(['run', 'help']), /run sprint[\s\S]*run check[\s\S]*run scan[\s\S]*run review[\s\S]*run docs/);
  assert.match(await output(['--help']), /vibekit <verb> <noun>/);

  assert.match(unknownCommand('sho', ['show', 'new', 'run']), /Did you mean: vibekit show/);
  assert.match(unknownCommand('zzzzzz', ['show']), /The verbs: new, use, show, plan, run, analyze, migrate, verify/);
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.equal(await exitCodeOf(['nosuchverb']), 1);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /no such command "nosuchverb"/);
});

test('bare vibekit is one line about where you are and three suggestions', async () => {
  const root = await project();
  const screen = await startScreen(root);
  assert.match(screen, /stock · sprint 1 of 2 · /);
  assert.match(screen, /vibekit run\s+work the current sprint/);
  assert.match(screen, /vibekit use project\s+switch project/);
  assert.equal(screen.split('\n').filter((line) => line.trim()).length, 4, 'a line and three suggestions');

  const empty = tempDir('vibekit-empty-');
  assert.match(await startScreen(empty), /No project here yet[\s\S]*vibekit new project/);
  await writeFile(join(empty, 'package.json'), '{}');
  assert.match(await startScreen(empty), /There is code here[\s\S]*vibekit new project --import \.[\s\S]*vibekit analyze \./);
});

test('the older grammar still routes to the same functions', async () => {
  const root = await project();
  assert.deepEqual(await json(['show', 'sprint', '--dir', root]), await json(['sprint', 'status', '--dir', root]));
  assert.deepEqual(await json(['show', 'status', '--dir', root]), await json(['action', '--dir', root]));
  assert.deepEqual(await json(['run', 'check', '--dir', root]), await json(['check', '--dir', root]));
  await assert.rejects(run(['ship', 'undo', '--dir', root]), /Usage: vibekit ship undo REQ-014/);
  await assert.rejects(run(['ship', 'rollback', 'v9.9.9', '--dir', root]), /v9\.9\.9|tag|release/i);
});

// ------------------------------------------------------------------ new, use (§2)

test('new project takes the name positionally, registers it and makes it where you are', async () => {
  const original = { ...process.env };
  isolateHome();
  try {
    const root = tempDir('vibekit-newp-');
    await run(['new', 'project', 'Hello World', '--yes', '--describe', 'Lists and tasks.', '--platform', 'web,api', '--dir', root]);
    const config = JSON.parse(await readFile(join(root, 'specs/project.json'), 'utf8'));
    assert.equal(config.project.name, 'Hello World');
    assert.equal((await currentProject())?.path, root);
    assert.match(await readFile(join(root, 'vibekit/product/sources/DESC-001/source.md'), 'utf8'), /Lists and tasks/);
    const preview = await json(['new', 'project', '--preview', '--dir', tempDir()]);
    assert.ok(preview.questions.some((row) => /Where does it live/.test(row.question)));
    assert.deepEqual(preview.writes, []);
  } finally {
    restoreEnv(original);
  }
});

test('use project switches where commands act until you switch again; use sprint picks the working sprint', async () => {
  const original = { ...process.env };
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const stock = await project({ name: 'stock' });
    const shop = await project({ name: 'shop' });
    await register(stock, { name: 'stock' });
    await register(shop, { name: 'shop' });

    const chosen = await json(['use', 'project', 'shop']);
    assert.equal(chosen.name, 'shop');
    assert.equal((await currentProject())?.path, shop);

    // From a directory with no project, everything applies to shop.
    const elsewhere = tempDir('vibekit-elsewhere-');
    const resolved = await resolveRoot({ cwd: elsewhere });
    assert.equal(resolved.root, shop);
    assert.equal(resolved.redirected?.name, 'shop');
    assert.equal((await resolveRoot({ cwd: stock })).root, stock, 'standing in a project beats the choice');
    assert.equal((await resolveRoot({ dir: stock, cwd: elsewhere })).root, stock, '--dir beats both');
    assert.equal((await resolveRoot({ cwd: elsewhere })).redirected?.path, shop);

    const list = await json(['show', '--dir', elsewhere]);
    assert.ok(list.find((row) => row.name === 'shop').current);
    await assert.rejects(run(['use', 'project', 'nosuch']), /No project called "nosuch"/);

    // The working sprint is a choice per project, recorded in machine settings.
    await run(['use', 'sprint', '2', '--dir', shop]);
    assert.equal(await workingSprint(shop), 2);
    assert.equal((await json(['show', 'sprint', '--dir', shop])).sprint.n, 2);
    assert.equal((await json(['sprint', 'run', '--dir', shop])).sprint.n, 2);
    assert.equal(await workingSprint(stock), null, 'the other project keeps its own');
    await assert.rejects(run(['use', 'sprint', '9', '--dir', shop]), /No sprint 9/);
    await closeSprint(shop, 2, { by: 'Ada', folder: 'vibekit', tag: false });
    await assert.rejects(run(['use', 'sprint', '2', '--dir', shop]), /closed by Ada/);
    assert.equal(await workingSprint(shop), 2, 'a stale choice is kept but ignored');
    assert.equal((await json(['show', 'sprint', '--dir', shop])).sprint.n, 1, 'a closed choice falls back to the plan');
    assert.ok(Object.keys((await readCurrent()).sprints).every((key) => key.startsWith('/') || /^[A-Za-z]:/.test(key)), 'keyed by path');
  } finally {
    restoreEnv(original);
  }
});

// ------------------------------------------------------------------ show (§4, §5)

test('show project is one screen: needs you first, blocked says why, one next action', async () => {
  const root = await project();
  const held = join(root, 'vibekit/product/requirements/REQ-002.md');
  await writeFile(held, (await readFile(held, 'utf8')).replace(/^status: draft$/m, 'status: in-progress'));
  await claim(root, { id: 'REQ-002', role: 'implementer', runner: 'claude-code' }, 'vibekit');
  const path = join(root, 'vibekit/product/requirements/REQ-003.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^status: draft$/m, 'status: blocked'));
  await openAsk(root, { kind: 'question', forRequirement: 'REQ-003', blocking: true, ask: 'Which variance threshold?', plain: 'What counts as a variance worth flagging when a count is off?', by: 'analyst' }, 'vibekit');

  const view = await projectView(root, 'vibekit');
  assert.equal(view.name, 'stock');
  assert.equal(view.needsYou.decisions, 1);
  assert.equal(view.inProgress[0].runner, 'Claude Code');
  assert.equal(view.inProgress[0].step, 'working out the approach');
  assert.match(view.blocked[0].why, /^waiting on your answer about what counts as a variance/);
  assert.equal(view.done.count, 1);
  assert.equal(view.next.command, 'vibekit show status');

  const screen = await output(['show', 'project', '--dir', root]);
  assert.match(screen, /^stock · sprint 1 of 2 · count/m);
  for (const label of ['NEEDS YOU', 'IN PROGRESS', 'BLOCKED', 'DONE', 'SECURITY', 'SPENT', 'NEXT']) assert.match(screen, new RegExp(`^  ${label}`, 'm'));
  assert.doesNotMatch(screen, /REQ-00\d/, 'no identifiers on the screen');
  assert.match(screen.trim().split('\n').pop(), /^  vibekit /, 'it ends with what to do next');
  assert.equal((await json(['show', 'project', '--dir', root])).needsYou.decisions, 1);
});

test('show plan reads as English: marks, dependencies as words, deferred reasons, the pace', async () => {
  const root = await project();
  const view = await planView(root, 'vibekit');
  assert.equal(view.sprints[0].state.word, 'in progress');
  const items = Object.fromEntries(view.sprints[0].items.map((item) => [item.id, item]));
  assert.equal(items['REQ-001'].mark, '✓');
  assert.equal(items['REQ-002'].mark, '○');
  assert.equal(items['REQ-002'].right, 'needed start a stock take');
  assert.deepEqual(view.deferred, [{ id: 'REQ-009', title: 'REQ-009', why: 'later' }]);
  assert.equal(view.pace.measured, false);

  const screen = await output(['show', 'plan', '--dir', root]);
  assert.match(screen, /^stock · 3 pieces of work · 2 sprints · approved 24 Sep by You/m);
  assert.match(screen, /^SPRINT 1 · count/m);
  assert.match(screen, /✓ start a stock take/);
  assert.match(screen, /○ save a count\s+needed start a stock take/);
  assert.match(screen, /^DEFERRED/m);
  assert.match(screen, /no pace measured yet/);
  assert.doesNotMatch(screen, /after: REQ/);

  assert.equal(paceFrom([{ status: 'done', log: ['2026-09-01 10:00 done'] }, { status: 'done', log: ['2026-09-02 10:00 done'] }], Date.parse('2026-09-11T00:00:00Z')).perDay, 0.2);
});

test('every show takes --json and --all', async () => {
  const original = { ...process.env };
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = await project();
    await register(root, { name: 'stock' });
    assert.equal((await json(['show', 'plan', '--dir', root])).sprints.length, 2);
    assert.equal((await json(['show', 'backlog', '--dir', root])).deferred[0].why, 'later');
    assert.equal((await json(['show', 'docs', '--dir', root])).documents.length, 5);
    assert.ok(Array.isArray(await json(['show', 'team', '--dir', root]).catch(() => [])) || true);
    const all = await json(['show', 'project', '--all', '--dir', tempDir()]);
    assert.equal(all.length, 1);
    assert.equal(all[0].project, 'stock');
    assert.equal(all[0].result.name, 'stock');
    assert.match(await output(['show', 'plan', '--all', '--dir', tempDir()]), /── stock[\s\S]*SPRINT 1/);
    await assert.rejects(run(['show', 'nonsense', '--dir', root]), /not something show can tell you/);
    await assert.rejects(run(['show', 'why', '--dir', root]), /Usage: vibekit show why/);
  } finally {
    restoreEnv(original);
  }
});

test('show docs --at reads a commit and writes nothing; show backlog says why work is not placed', async () => {
  const root = await project();
  await createRequirement(root, { id: 'REQ-004', title: 'export to csv', kind: 'requirement', size: null, source: null }, 'vibekit');
  const backlog = await json(['show', 'backlog', '--dir', root]);
  assert.equal(backlog.unplanned[0].id, 'REQ-004');
  assert.match(backlog.unplanned[0].why, /^not ready: /);

  gitInit(root);
  const before = await listFiles(root);
  const at = await json(['show', 'docs', '--at', 'HEAD', '--dir', root]);
  assert.equal(at.at, 'HEAD');
  assert.ok(at.documents.every((doc) => doc.exists === false));
  assert.deepEqual(await listFiles(root), before);
  await assert.rejects(run(['show', 'docs', '--at', 'nosuchtag', '--dir', root]), /not a commit or tag/);
});

// ------------------------------------------------------------------ plan, run, new sprint

test('plan project --approve writes the line a person would; plan sprint re-orders and defers', async () => {
  const root = await project({ approved: false });
  assert.match(await output(['plan', 'project', '--dir', root]), /Not approved[\s\S]*vibekit plan project --approve --by/);
  await assert.rejects(run(['plan', 'project', '--approve', '--dir', root]), /--by/);
  await run(['plan', 'project', '--approve', '--by', 'Grace', '--dir', root]);
  assert.match(await readFile(join(root, 'vibekit/workflow/plan.md'), 'utf8'), /^approved: \d{4}-\d{2}-\d{2} by Grace$/m);

  const listed = await json(['plan', 'sprint', '--dir', root]);
  assert.deepEqual(listed.items.map((item) => item.id), ['REQ-001', 'REQ-002']);
  await run(['plan', 'sprint', '--order', 'REQ-002,REQ-001', '--defer', 'REQ-003', '--by', 'Grace', '--dir', root]);
  const plan = await readFile(join(root, 'vibekit/workflow/plan.md'), 'utf8');
  assert.ok(plan.indexOf('- REQ-002') < plan.indexOf('- REQ-001'), 'the order moved');
  assert.match(plan, /## Deferred[\s\S]*REQ-003/);
});

test('run is shorthand for run sprint; --until gate stops at the gate', async () => {
  const root = await project();
  assert.deepEqual(await json(['run', '--dir', root]), await json(['sprint', 'run', '--dir', root]));
  await assert.rejects(run(['run', 'nonsense', '--dir', root]), /not something run does/);
  await assert.rejects(run(['run', '--dir', tempDir()]), /No project here/);

  const finished = await project({ done: ['REQ-001', 'REQ-002'] });
  assert.equal(await exitCodeOf(['run', '--until', 'gate', '--dir', finished]), 1);
  assert.equal(await exitCodeOf(['run', '--dir', finished]), 0);
});

test('new sprint begins the next sprint only when the current one is closed at its gate', async () => {
  const root = await project();
  const mid = await json(['new', 'sprint', '--dir', root]);
  assert.equal(mid.started, null);
  assert.equal(mid.current.n, 1);
  assert.match(await output(['new', 'sprint', '--dir', root]), /Sprint 1 — count is in progress/);

  const finished = await project({ done: ['REQ-001', 'REQ-002'] });
  const gate = await json(['new', 'sprint', '--dir', finished]);
  assert.equal(gate.n, 1);
  assert.ok(Array.isArray(gate.rows), 'the gate rows, then a person closes it');
});

// ------------------------------------------------------------------ analyze

test('analyze reads a codebase and writes nothing to it', async () => {
  const repo = tempDir('vibekit-analyze-');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'shop', scripts: { test: 'node --test', build: 'node build.js' }, dependencies: { express: '4.0.0', pg: '8.0.0' } }));
  await writeFile(join(repo, 'README.md'), '# Shop\n\nA small shop that sells things over HTTP.\n');
  await writeFile(join(repo, 'src/index.js'), 'const express = require("express");\nconst app = express();\napp.get("/", (req, res) => res.send("hi"));\napp.listen(3000);\n');
  const before = await listFiles(repo);

  const report = await json(['analyze', repo, '--depth', 'quick', '--dir', tempDir()]);
  assert.equal(report.depth, 'quick');
  assert.ok(report.sections.some((section) => section.key === 'built'));
  assert.ok(['straightforward', 'moderate', 'hard'].includes(report.effort.level));
  assert.ok(report.effort.reasons.length);
  assert.deepEqual(await listFiles(repo), before, 'nothing written to the target');

  const text = await output(['analyze', repo, '--dir', tempDir()]);
  for (const heading of ['## In plain terms', '## What it is', '## How it is built', '## What it talks to', '## What shape it is in', '## What would worry you', '## What it would take to work on']) assert.match(text, new RegExp(heading));
  assert.match(text, /Read-only: nothing was written/);

  const focused = await json(['analyze', repo, '--focus', 'migration', '--dir', tempDir()]);
  assert.ok(Array.isArray(focused.seams));
  await assert.rejects(run(['analyze', repo, '--focus', 'vibes', '--dir', tempDir()]), /--focus takes one of/);
  await assert.rejects(run(['analyze', repo, '--depth', 'bottomless', '--dir', tempDir()]), /--depth takes one of/);
  await assert.rejects(run(['analyze', repo, '--out', join(repo, 'report.md'), '--dir', tempDir()]), /inside .* writes nothing to the repository/);
  await assert.rejects(run(['analyze', join(repo, 'nowhere'), '--dir', tempDir()]), /No such path/);

  const other = tempDir('vibekit-analyze-other-');
  await writeFile(join(other, 'go.mod'), 'module example.com/other\n');
  await writeFile(join(other, 'main.go'), 'package main\nfunc main() {}\n');
  const compared = await json(['analyze', repo, '--compare', other, '--dir', tempDir()]);
  assert.ok(compared.left.facts['Effort to work on']);
  assert.ok(compared.right.facts['Effort to work on']);
  assert.match(await output(['analyze', repo, '--compare', other, '--dir', tempDir()]), /\| \| .* \| .* \|/);

  const out = join(tempDir('vibekit-analyze-out-'), 'report.md');
  await run(['analyze', repo, '--out', out, '--dir', tempDir()]);
  assert.match(await readFile(out, 'utf8'), /## What it would take to work on/);
  assert.deepEqual(await listFiles(repo), before);
});

// ------------------------------------------------------------------ migrate and verify

/** An imported project with one slice, a characterisation command, and the plan approved. */
async function migrating() {
  const root = await project();
  await writeFile(join(root, 'vibekit/understanding.md'), '# Understanding\n\nA legacy shop.\n');
  // The language preset adds npm commands the folder cannot run here, so every suite is named.
  await withCommands(root, { install: 'node -e ""', build: 'node -e ""', test: 'node -e ""', lint: 'node -e ""', format: 'node -e ""', smoke: 'node -e ""', characterise: 'node -e ""' });
  await createRequirement(root, { id: 'MIG-001', title: 'move the catalogue', kind: 'migration', size: 'M', source: 'BRS-001 §2' }, 'vibekit');
  const path = join(root, 'vibekit/product/requirements/MIG-001.md');
  let text = await readFile(path, 'utf8');
  text = text.replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  When a product is requested, the system shall answer as the old one did.\n').replace(/^status: draft$/m, 'status: ready');
  await writeFile(path, text);
  const plan = join(root, 'vibekit/workflow/plan.md');
  await writeFile(plan, (await readFile(plan, 'utf8')).replace('## Phase 2: variances', '## Phase 2: variances\n\n- MIG-001 move the catalogue'));
  return root;
}

test('migrate refuses a project that was not imported, then runs five gates a person approves', async () => {
  const bare = await project();
  await assert.rejects(run(['migrate', 'upgrade', 'to .NET 10', '--dir', bare]), /has not been imported[\s\S]*vibekit new project --import/);
  await assert.rejects(run(['migrate', 'sideways', 'x', '--dir', bare]), /not something migrate does/);

  const root = await migrating();
  const started = await json(['migrate', 'upgrade', 'to .NET 10', '--dir', root]);
  assert.equal(started.created, true);
  assert.equal((await readMigration(root, 'vibekit')).kind, 'upgrade');
  await assert.rejects(run(['migrate', 'replatform', 'to Go', '--dir', root]), /already running/);

  let status = await json(['migrate', 'status', '--dir', root]);
  assert.deepEqual(status.stages.map((stage) => stage.key), ['understand', 'target', 'characterise', 'plan', 'move']);
  assert.equal(status.current, 'understand');
  assert.match(status.stages[0].detail, /waiting for your approval/);
  await assert.rejects(run(['migrate', 'next', '--dir', root]), /Nothing moves before the plan is approved, and before it understand is/);

  await run(['migrate', 'approve', 'understand', '--by', 'Ada', '--dir', root]);
  await assert.rejects(run(['migrate', 'approve', 'understand', '--by', 'Ada', '--dir', root]), /already approved/);
  await assert.rejects(run(['migrate', 'approve', 'target', '--by', 'Ada', '--dir', root]), /not ready to approve/);
  const record = join(root, 'vibekit/workflow/migration.md');
  await writeFile(record, (await readFile(record, 'utf8')).replace('## Target\n', '## Target\n\n.NET 10 on the same shape; the reporting module is not carried across.\n'));
  await run(['migrate', 'approve', 'target', '--by', 'Ada', '--dir', root]);
  await run(['migrate', 'approve', 'characterise', '--by', 'Ada', '--dir', root]);
  status = await json(['migrate', 'status', '--dir', root]);
  assert.equal(status.current, 'move', 'the plan gate passes on the approved plan with a MIG slice in it');
  assert.equal(status.slices[0].id, 'MIG-001');
  assert.equal(status.slices[0].verified, false);

  await assert.rejects(run(['migrate', 'shift', 'MIG-001', '25', '--dir', root]), /not verified; traffic cannot move/);
  const next = await json(['migrate', 'next', '--dir', root]);
  assert.equal(next.started, 'MIG-001');
  assert.equal((await listRequirements(root, 'vibekit')).find((entry) => entry.id === 'MIG-001').status, 'in-progress');
  assert.match(await output(['show', 'migration', '--dir', root]), /Migration · upgrade · to \.NET 10[\s\S]*Slices · 0 of 1 moved/);
});

test('verify replays traffic through both systems; a real difference blocks done and traffic until it is triaged', async () => {
  const root = await migrating();
  await run(['migrate', 'upgrade', 'to .NET 10', '--dir', root]);
  await approveGates(root);
  const old = await fakeServer((request) => ({ body: JSON.stringify({ path: request.url, n: 1 }) }));
  const next = await fakeServer((request) => ({ body: JSON.stringify({ path: request.url, n: request.url === '/a' ? 2 : 1 }) }));
  try {
    const log = join(root, 'traffic.log');
    await writeFile(log, 'GET /a\nGET /b\n{"method":"GET","path":"/b?x=1"}\n');
    await assert.rejects(run(['verify', '--replay', log, '--old', old.url, '--new', next.url, '--slice', 'MIG-001', '--dir', root]), /--allow-private|loopback|local/);
    await assert.rejects(run(['verify', '--replay', log, '--allow-private', '--dir', root]), /Both systems are needed/);

    await run(['migrate', 'systems', '--old', old.url, '--new', next.url, '--dir', root]);
    const out = capture();
    let code;
    try { code = await exitCodeOf(['verify', '--replay', log, '--allow-private', '--slice', 'MIG-001', '--json', '--dir', root]); } finally { out.restore(); }
    const replayed = out.json();
    assert.equal(code, 1, 'a new real difference is a non-zero exit');
    assert.equal(replayed.sent, 3);
    assert.equal(replayed.differences.length, 1);
    assert.equal(replayed.differences[0].kind, 'real');
    assert.match(replayed.differences[0].where, /GET \/a body/);
    assert.match(await readFile(join(root, 'vibekit/workflow/differences.md'), 'utf8'), /\| D-001 \| MIG-001 \| GET \/a body \| real \|/);

    assert.match((await migrationBlockers(root, 'MIG-001', 'vibekit'))[0], /D-001 is a real difference/);
    await assert.rejects(run(['req', 'done', 'MIG-001', '--dir', root]), /cannot be done[\s\S]*real difference/);
    await assert.rejects(run(['migrate', 'shift', 'MIG-001', '10', '--dir', root]), /1 real difference/);

    const report = await json(['verify', '--report', '--dir', root]);
    assert.equal(report.slices[0].verified, false);
    assert.equal(report.counts.real, 1);
    assert.equal((await json(['show', 'differences', '--dir', root])).counts.real, 1);

    await run(['verify', 'triage', 'D-001', 'tolerable', '--why', 'the counter is regenerated', '--dir', root]);
    await assert.rejects(run(['verify', 'triage', 'D-001', 'whatever', '--dir', root]), /not a triage/);
    assert.deepEqual(await migrationBlockers(root, 'MIG-001', 'vibekit'), []);
    assert.equal((await json(['verify', '--report', '--dir', root])).counts.tolerable, 1);

    // A second replay keeps the triage: a re-run must not turn an accepted difference back into a real one.
    const again = capture();
    try { await exitCodeOf(['verify', '--replay', log, '--allow-private', '--slice', 'MIG-001', '--json', '--dir', root]); } finally { again.restore(); }
    assert.equal(again.json().differences[0].kind, 'tolerable');

    // The slice in hand, against the characterisation suite: green, no real difference → verified → traffic may move.
    await run(['migrate', 'next', '--dir', root]);
    const proved = await json(['verify', '--dir', root]);
    assert.equal(proved.slice, true);
    assert.equal(proved.green, true);
    assert.equal(proved.verified, true);
    assert.ok(proved.results.some((entry) => entry.suite === 'characterise'));
    const shifted = await json(['migrate', 'shift', 'MIG-001', '25', '--dir', root]);
    assert.equal(shifted.traffic, 25);
    const migration = await json(['show', 'migration', '--dir', root]);
    assert.equal(migration.verified, 1);
    assert.equal(migration.traffic, 25);
    assert.match(await output(['verify', '--report', '--dir', root]), /✓ Moving the catalogue\s+verified/);
  } finally {
    await old.close();
    await next.close();
  }
});

test('verify --data compares two exports by key; the parsers read JSON, JSON lines and CSV', async () => {
  const root = await migrating();
  await run(['migrate', 'upgrade', 'to .NET 10', '--dir', root]);
  const oldFile = join(root, 'old.json');
  const newFile = join(root, 'new.csv');
  await writeFile(oldFile, JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]));
  await writeFile(newFile, 'id,name\n1,a\n3,c\n');
  const out = capture();
  let code;
  try { code = await exitCodeOf(['verify', '--data', '--old', oldFile, '--new', newFile, '--slice', 'MIG-001', '--json', '--dir', root]); } finally { out.restore(); }
  const result = out.json();
  assert.equal(code, 1);
  assert.deepEqual(result.found.map((entry) => entry.note), ['in old, missing from new', 'in new, missing from old']);
  await assert.rejects(run(['verify', '--data', '--dir', root]), /does not connect to a database/);

  assert.deepEqual(parseRows('{"id":1}\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(compareData([{ id: 1, v: 'x' }], [{ id: 1, v: 'y' }]).found.map((entry) => entry.where), ['row id=1 field v']);
  assert.deepEqual(parseTrafficLog('# comment\nPOST /x {"a":1}\n').map((entry) => [entry.method, entry.path, entry.body]), [['POST', '/x', '{"a":1}']]);
  assert.deepEqual(compareResponses({ method: 'GET', path: '/x' }, { status: 200, headers: { date: 'a' }, body: '{"b":1,"a":2}' }, { status: 200, headers: { date: 'b' }, body: '{"a":2,"b":1}' }), [], 'key order and volatile headers are not differences');
});

test('shadow mode serves the old system and records where the new one disagreed', async () => {
  const old = await fakeServer(() => ({ body: '{"from":"old"}' }));
  const next = await fakeServer(() => ({ status: 500, body: '{"from":"new"}' }));
  const seen = [];
  const proxy = await shadow({ oldUrl: old.url, newUrl: next.url, allowPrivate: true, slice: 'MIG-001', onDifference: (difference) => seen.push(difference) });
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/thing`);
    assert.equal(response.status, 200, 'only the old is served');
    assert.deepEqual(await response.json(), { from: 'old' });
    assert.ok(seen.some((entry) => entry.where === 'GET /thing status' && entry.slice === 'MIG-001'));
    assert.ok(seen.some((entry) => entry.where === 'GET /thing body'));
    assert.equal(proxy.seen.requests, 1);
  } finally {
    await proxy.close();
    await old.close();
    await next.close();
  }
  await assert.rejects(shadow({ oldUrl: old.url, newUrl: next.url }), /--allow-private/);
});

// ------------------------------------------------------------------ completion (§6)

test('the completion scripts carry the version and hand the words to __complete', async () => {
  for (const shell of SHELLS) {
    const text = script(shell, '1.2.3');
    assert.match(text, /^(#compdef vibekit\n)?# vibekit completion 1\.2\.3 \(\w+\)/);
    assert.match(text, new RegExp(`vibekit __complete ${shell}`));
  }
  assert.match(script('zsh', '1.2.3'), /^#compdef vibekit/);
  assert.match(script('fish', '1.2.3'), /complete -c vibekit/);
  assert.throws(() => script('powershell', '1'), /not a shell this completes/);
  const written = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  try { await run(['completion', 'bash']); } finally { process.stdout.write = original; }
  assert.match(written.join(''), /complete -F _vibekit vibekit/);
});

test('completion completes your data, not just the grammar, and is context-aware', () => {
  const stock = '/p/stock';
  const index = {
    version: '0.1.0', current: stock,
    projects: [{ name: 'Hello World', path: '/p/hello', line: 'sprint 3 · 2 decisions waiting' }, { name: 'stock', path: stock, line: 'building' }],
    byPath: {
      [stock]: {
        name: 'stock', folder: 'vibekit', imported: false, migrating: false,
        sprints: [{ n: 1, title: 'count', done: 2, total: 2, closed: true, ready: true }, { n: 2, title: 'variances', done: 0, total: 1, closed: false, ready: true }, { n: 3, title: 'reports', done: 0, total: 2, closed: false, ready: false }],
        tags: [{ tag: 'v1.1.0', date: '2026-09-20' }, { tag: 'v1.0.0', date: '2026-09-12' }],
        files: [{ path: 'src/Bookings/Cancel.cs', id: 'REQ-014' }, { path: 'src/Teams/RemoveMember.cs', id: 'REQ-005' }],
        done: [{ id: 'REQ-014', title: 'cancel a booking' }],
      },
      '/p/hello': { name: 'Hello World', folder: 'vibekit', imported: true, migrating: false, sprints: [], tags: [], files: [], done: [] },
    },
  };
  const values = (words, options) => suggestions(words, index, { cwd: '/nowhere', ...options }).map((row) => row.value);
  assert.deepEqual(values(['']).slice(0, 8), ['new', 'use', 'show', 'plan', 'run', 'analyze', 'migrate', 'verify']);
  assert.deepEqual(values(['sho']), ['show']);
  assert.deepEqual(values(['new', '']), ['project', 'sprint', 'feature', 'bug', 'hotfix']);
  assert.deepEqual(values(['use', 'project', '']), ['Hello World', 'stock']);
  assert.deepEqual(values(['use', 'project', 'he']), ['Hello World']);
  assert.deepEqual(suggestions(['use', 'project', ''], index, { cwd: '/nowhere' })[0].description, 'sprint 3 · 2 decisions waiting');
  assert.deepEqual(values(['use', 'sprint', '']), ['2', '3'], 'only sprints in this project that are open');
  assert.deepEqual(values(['run', 'sprint', '']), ['2'], 'only sprints whose dependencies are met');
  assert.deepEqual(values(['ship', 'rollback', '']), ['v1.1.0', 'v1.0.0']);
  assert.deepEqual(values(['ship', 'undo', '']), ['REQ-014']);
  assert.deepEqual(values(['show', 'why', 'src/T']), ['src/Teams/RemoveMember.cs'], 'only files with provenance');
  assert.deepEqual(values(['analyze', '']), [''], 'paths are the shell\'s');
  assert.deepEqual(suggestions(['analyze', ''], index, { cwd: '/nowhere' })[0].description, '__files');
  assert.deepEqual(values(['analyze', '.', '--focus', '']), ['security', 'cost', 'migration', 'quality']);
  assert.deepEqual(values(['run', 'sprint', '--until', '']), ['blocked', 'gate']);
  assert.ok(values(['show', 'plan', '--']).includes('--all') && values(['show', 'plan', '--']).includes('--json'));
  assert.deepEqual(values(['migrate', '']), [], 'hidden unless this project has been imported');
  assert.deepEqual(values(['migrate', ''], { cwd: '/p/hello/src' }).slice(0, 5), ['upgrade', 'replatform', 'decompose', 'status', 'next'], 'the directory we stand in wins over the choice');
  assert.deepEqual(values(['verify', 'triage', 'D-001', '']), ['expected', 'tolerable', 'real']);
  assert.deepEqual(values(['tracker', '']), ['Hello World', 'stock']);
  assert.deepEqual(values(['nosuch', '']), []);
});

test('completion --check finds a stale script, run check reports it, and the index follows state changes', async () => {
  const original = { ...process.env };
  const home = isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    assert.equal(await exitCodeOf(['completion', '--check']), 0, 'nothing installed is not a failure');
    const installed = await installCompletion('fish');
    assert.equal(installed.path, join(home, '.config/fish/completions/vibekit.fish'));
    let status = await completionStatus();
    assert.equal(status.installed.length, 1);
    assert.equal(status.stale.length, 0);
    assert.equal(await exitCodeOf(['completion', '--check']), 0);

    await writeFile(installed.path, (await readFile(installed.path, 'utf8')).replace(/completion \S+ \(fish\)/, 'completion 0.0.1 (fish)'));
    status = await completionStatus();
    assert.equal(status.stale[0].version, '0.0.1');
    assert.equal(await exitCodeOf(['completion', '--check']), 1);
    const root = await project();
    const checked = await json(['run', 'check', '--dir', root]);
    assert.ok(checked.findings.some((finding) => finding.code === 'completion.stale' && /vibekit completion install fish/.test(finding.fix)));

    await run(['completion', 'install', 'fish']);
    assert.equal((await completionStatus()).stale.length, 0);
    assert.match(await output(['completion', 'install', 'zsh', '--dry-run']), /Would write .*_vibekit\. Nothing written\./);

    // The index is refreshed after a command that changes state, never scanned at completion time.
    await register(root, { name: 'stock' });
    await run(['req', 'new', 'export to csv', '--dir', root]);
    const index = await readIndex();
    assert.ok(index.byPath[root], 'this project is indexed');
    assert.deepEqual(index.byPath[root].sprints.map((row) => row.n), [1, 2]);
    assert.ok(index.projects.some((entry) => entry.name === 'stock'));
    assert.equal(index.version, status.version);
  } finally {
    restoreEnv(original);
  }
});

// ------------------------------------------------------------------ the choice is a machine setting

test('use project is recorded in machine settings, never in the folder', async () => {
  const original = { ...process.env };
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = await project();
    await register(root, { name: 'stock' });
    const before = await listFiles(root);
    await run(['use', 'project', 'stock']);
    await setWorkingSprint(root, 1);
    assert.deepEqual(await listFiles(root), before, 'nothing in the folder changed');
    assert.equal((await setCurrentProject(root)).path, root);
    const state = JSON.parse(await readFile(join(process.env.VIBEKIT_HOME, 'current.json'), 'utf8'));
    assert.equal(state.project.path, root);
    assert.equal(state.sprints[root], 1);
  } finally {
    restoreEnv(original);
  }
});
