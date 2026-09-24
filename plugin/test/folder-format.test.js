import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { ARCHITECTURES } from '../src/architectures.js';
import { runChecks } from '../src/folder/checks.js';
import { generateFolder } from '../src/folder/generate.js';
import { LOCAL_MARKER, hasHeader, headerSource, stripHeader } from '../src/folder/header.js';
import { BUDGET_CAP, FOLDER_FILES, POINTERS, authoredPaths, generatedPaths } from '../src/folder/layout.js';
import { estimateProseTokens } from '../src/tokens.js';
import { newProject } from './helpers.js';

const CONFIG = {
  name: 'bookings',
  description: 'A booking system for gyms: members book classes and staff manage schedules.',
  users: ['members', 'studio staff'],
  architecture: 'clean',
  stack: { language: '.NET 10', web: 'Vue 3', database: 'PostgreSQL 17' },
  commands: { install: 'dotnet restore', build: 'dotnet build -warnaserror', test: 'dotnet test', lint: 'dotnet format --verify-no-changes' },
  entities: [
    { name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] },
    { name: 'Payment', class: 'financial', fields: [{ name: 'amount', type: 'decimal' }] },
  ],
};

const newRepo = () => mkdtemp(join(tmpdir(), 'vibekit-folder-'));
const read = (root, path) => readFile(join(root, path), 'utf8');

async function walk(dir, base = dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, found);
    else found.push(relative(base, full).split(sep).join('/'));
  }
  return found;
}

test('a fresh run writes every declared path and nothing else', async () => {
  const root = await newRepo();
  const result = await generateFolder(root, CONFIG);

  const allowed = [...POINTERS.map((file) => file.path), ...authoredPaths().map((path) => `vibekit/${path}`), ...generatedPaths().map((path) => (path.startsWith('vibekit/') ? path : path)), '.gitignore'];
  for (const path of generatedPaths()) allowed.push(POINTERS.some((p) => p.path === path) ? path : `vibekit/${path}`);
  const globs = FOLDER_FILES.filter((file) => file.glob).map((file) => new RegExp(`^vibekit/${file.path.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`));
  const stateOrStage = /^vibekit\/(?:\.state\/|workflow\/stages\/)/;

  const unexpected = (await walk(root)).filter((path) => !allowed.includes(path) && !globs.some((glob) => glob.test(path)) && !stateOrStage.test(path));
  assert.deepEqual(unexpected, [], `wrote paths the layout does not declare: ${unexpected.join(', ')}`);
  assert.ok(result.written.includes('CLAUDE.md'));
  assert.ok(result.written.includes('vibekit/workflow/stages/5-build.md'), 'the stage prompts are shipped as files, or the workflow is locked inside the app');
});

test('running twice produces byte-identical output', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const before = new Map();
  for (const path of await walk(root)) if (!path.includes('.state/')) before.set(path, await read(root, path));

  await generateFolder(root, CONFIG);
  const after = new Map();
  for (const path of await walk(root)) if (!path.includes('.state/')) after.set(path, await read(root, path));

  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the second run changed which files exist');
  for (const [path, content] of before) assert.equal(after.get(path), content, `${path} differs between two runs of the same config`);
});

test('map.md differs for every architecture, or the answer never reached the generator', async () => {
  const seen = new Map();
  for (const architecture of Object.keys(ARCHITECTURES)) {
    const root = await newRepo();
    await generateFolder(root, { ...CONFIG, architecture });
    const body = await read(root, 'vibekit/product/map.md');
    const clash = [...seen.entries()].find(([, other]) => other === body);
    assert.ok(!clash, `${architecture} and ${clash?.[0]} produced identical map.md`);
    seen.set(architecture, body);
  }
});

test('the test command map.md prints is the one that was configured', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const map = await read(root, 'vibekit/product/map.md');
  assert.ok(map.includes('dotnet test'), 'the stack answer did not reach map.md');
  assert.ok(!map.includes('pytest'), 'map.md printed a command from another stack');
});

test('a generated file whose header a human removed is skipped, reported, and the run continues', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);

  const claimed = 'These are our rules now, hand written.\n';
  await writeFile(join(root, 'vibekit/standards/code-style.md'), claimed);

  const result = await generateFolder(root, CONFIG);
  assert.ok(result.skipped.includes('vibekit/standards/code-style.md'), `expected a skip, got ${result.skipped.join(', ')}`);
  assert.equal(await read(root, 'vibekit/standards/code-style.md'), claimed, 'a hand-edited file was overwritten');
  assert.ok(result.written.includes('vibekit/product/map.md'), 'one skipped file stopped the rest of the run');
});

test('an authored file is created once and never touched again', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const mine = '# Rules\n\nNo dependency may be added on a Friday.\n';
  await writeFile(join(root, 'vibekit/standards/rules.md'), mine);

  const result = await generateFolder(root, CONFIG);
  assert.equal(await read(root, 'vibekit/standards/rules.md'), mine);
  assert.ok(result.kept.includes('vibekit/standards/rules.md'));
});

test('a team can edit a stage prompt and keep it', async () => {
  // The prompts are the product's actual prompts, versioned in the repo. That is what
  // file-driven means: a team that needs a different process edits the file.
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const mine = '---\nstage: 1\n---\n\nOur own clarify prompt.\n';
  await writeFile(join(root, 'vibekit/workflow/stages/1-clarify.md'), mine);

  await generateFolder(root, CONFIG);
  assert.equal(await read(root, 'vibekit/workflow/stages/1-clarify.md'), mine);
});

test('every generated file carries its header and names its source; no authored file does', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);

  for (const path of generatedPaths()) {
    const full = POINTERS.some((pointer) => pointer.path === path) ? path : `vibekit/${path}`;
    const content = await read(root, full);
    assert.ok(hasHeader(content), `${full} has no generated header`);
    assert.ok(headerSource(content), `${full} does not name its source`);
  }
  for (const path of authoredPaths()) {
    assert.ok(!hasHeader(await read(root, `vibekit/${path}`)), `authored file vibekit/${path} carries a generated header`);
  }
});

test("a team's own additions below the local marker survive a rewrite", async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  await writeFile(join(root, 'CLAUDE.md'), `${await read(root, 'CLAUDE.md')}\n${LOCAL_MARKER}\n\nAlways run the integration suite before pushing.\n`);

  await generateFolder(root, CONFIG);
  const rewritten = await read(root, 'CLAUDE.md');
  assert.ok(rewritten.includes('Always run the integration suite before pushing.'), 'a local addition was lost on rewrite');
  assert.ok(hasHeader(rewritten), 'the rewrite lost the generated header');
});

test('the pointer sends every agent to status.md first', async () => {
  // A session resumes by reading files, not by remembering a chat. status.md is what names the
  // stage and the prompt, so it has to be read before anything else.
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  for (const name of ['CLAUDE.md', 'AGENTS.md', '.cursorrules']) {
    const body = await read(root, name);
    const order = body.indexOf('status.md');
    assert.ok(order > -1, `${name} does not mention status.md`);
    assert.ok(order < body.indexOf('standards/'), `${name} does not put status.md first in the load order`);
  }
});

test('a skill body dropped into lib/ is indexed, and the index stays an index', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  await mkdir(join(root, 'vibekit/skills/lib'), { recursive: true });
  await writeFile(join(root, 'vibekit/skills/lib/tenant-scoping.md'), '# Tenant scoping\n\nUse when a query crosses customers.\n');

  await generateFolder(root, { ...CONFIG, skills: [{ name: 'tenant-scoping', triggers: ['tenant', 'multi-tenant', 'TenantId'] }] });
  const index = await read(root, 'vibekit/skills/index.yml');
  assert.ok(index.includes('triggers: [tenant, multi-tenant, TenantId]'));

  // The header is a fixed cost that amortises across forty skills; the check is per entry.
  const entries = (index.match(/^- name:/gm) ?? []).length;
  assert.ok(estimateProseTokens(stripHeader(index)) / entries <= 30, 'a skill body has leaked into the index');
});

test('no always-loaded file exceeds its own budget, and the total is well under the cap', async () => {
  const root = await newRepo();
  const { budget } = await generateFolder(root, CONFIG);
  const over = budget.rows.filter((row) => row.budget && row.tokens > row.budget).map((row) => `${row.path} ${row.tokens}/${row.budget}`);
  assert.deepEqual(over, [], `over budget: ${over.join(', ')}`);
  assert.ok(budget.passes, `always-loaded is ${budget.alwaysLoaded}, over the ${BUDGET_CAP} cap`);
  assert.ok(budget.rows.some((row) => row.path === 'CLAUDE.md'), 'the pointer file is charged');
  assert.equal(budget.rows.filter((row) => row.path.endsWith('.cursorrules')).length, 0, 'only one pointer is charged, not all three');
});

test('a long project description cannot blow the pointer budget', async () => {
  const root = await newRepo();
  const wordy = 'A booking system for gyms covering classes, memberships, card payments through a provider, '
    + 'statutory notices, waiting lists, and the reporting finance needs at year end.';
  const { budget } = await generateFolder(root, { ...CONFIG, description: wordy });
  const pointer = budget.rows.find((row) => row.path === 'CLAUDE.md');
  assert.ok(pointer.tokens <= pointer.budget, `pointer is ${pointer.tokens} tokens against a ${pointer.budget} budget`);
});

test('entities.md leads with the instruction that stops an agent inventing a field, and classifies everything', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const entities = await read(root, 'vibekit/product/entities.md');
  assert.ok(entities.includes('stop and propose it. Do not invent one.'));
  assert.ok(entities.includes('## Booking'));
  assert.ok(/class: financial/.test(entities), 'Payment is not classified, so nothing downstream can protect it');
});

test('delivery is optional, and none means no delivery area at all', async () => {
  const none = await newRepo();
  await generateFolder(none, CONFIG, { delivery: 'none' });
  await assert.rejects(read(none, 'vibekit/delivery/pipeline.spec.md'));

  const full = await newRepo();
  await generateFolder(full, CONFIG, { delivery: 'full' });
  await read(full, 'vibekit/delivery/environments.md');
  await read(full, 'vibekit/delivery/observability.md');
});

test('state is git-ignored, along with worktrees and .env', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const ignore = await read(root, '.gitignore');
  for (const entry of ['vibekit/.state/', '.vibekit-worktrees/', '.env']) assert.ok(ignore.includes(entry), `${entry} is not ignored`);

  await generateFolder(root, CONFIG);
  const lines = (await read(root, '.gitignore')).split('\n').filter((line) => line.trim() === 'vibekit/.state/');
  assert.equal(lines.length, 1, 'the ignore entry was added twice');
});

test('memory and the asks inbox are never collapsed in a diff', async () => {
  // What an agent decided to remember, and what it asked, is the review.
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const attributes = await read(root, '.gitattributes');
  assert.ok(attributes.includes('vibekit/memory/** -linguist-generated'));
  assert.ok(attributes.includes('vibekit/workflow/asks/** -linguist-generated'));
});

test('the folder name is a setting, and the pointers follow it', async () => {
  const root = await newRepo();
  await generateFolder(root, CONFIG, { folder: 'docs/vibekit' });
  assert.ok((await read(root, 'CLAUDE.md')).includes('docs/vibekit/'));
  assert.ok((await read(root, '.gitattributes')).includes('docs/vibekit/product/map.md linguist-generated=true'));
  await read(root, 'docs/vibekit/workflow/status.md');
});

test('a freshly generated folder passes, and says what is still unfilled', async () => {
  // Green on day one, or a team learns to ignore the check. But a fresh folder that reported
  // nothing would be lying: the starter guardrails deliberately name no real path yet.
  const root = await newRepo();
  await generateFolder(root, CONFIG);
  const result = await runChecks(root);
  const errors = result.findings.filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.message).join('\n'));
  assert.ok(result.passes);
  assert.ok(result.findings.some((entry) => entry.code === 'guardrail.todo'), 'the unfilled guardrail is still reported, as a warning');
});

test('an ask with no stage does not produce a file whose name starts with a dash', async () => {
  // `stage:` parses as '' rather than null when the front matter leaves it blank, so the
  // `?? 'general'` fallback never fired and the answers landed in `-answers.md`.
  const { answerAsk, openAsk } = await import('../src/folder/asks.js');
  const root = await newProject('--yes');

  const opened = await openAsk(root, { ask: 'Do refunds go to the original card?', plain: 'Where does a refund go?' });
  await answerAsk(root, opened.id, { answer: 'Back to the original card.', by: 'Grace Hopper' });

  const { readdir } = await import('node:fs/promises');
  const written = await readdir(join(root, 'vibekit/workflow/answers'));
  assert.ok(written.length, 'the answer is recorded outside the ask');
  assert.ok(written.every((name) => !name.startsWith('-')), `a leading dash is hostile to every shell tool: ${written.join(', ')}`);
  assert.ok(written.includes('general-answers.md'), `expected general-answers.md, got ${written.join(', ')}`);
});
