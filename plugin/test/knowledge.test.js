import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { toResults } from '../src/knowledge.js';
import { EXAMPLE, TOOL_FREE_PATH, exitCodeOf, fillSpec, installFakeOpenContext, newProject, patchProject, read, restoreEnv, runHook, setDocsEnabled, startFakeAgentmemory, writeTracedTests } from './helpers.js';

const FEATURE = '001-shared-list';
const ORIGINAL_ENV = { ...process.env };
const PITFALL = { title: 'Pitfall: Expo push tokens', path: '/lib/playbook/expo.md', snippet: 'Push tokens rotate on reinstall; never key users by token' };

beforeEach(() => {
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
});

afterEach(() => {
  restoreEnv(ORIGINAL_ENV);
  process.exitCode = 0;
});

async function useFakeOpenContext(results) {
  const fake = await installFakeOpenContext(results);
  Object.assign(process.env, fake.env);
  return fake;
}

async function finishedFeature() {
  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await patchProject(root, { workflow: { evidence: false } });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: ['- [ ] T-1 [impl] build it (AC-1)'] });
  const dir = join(root, 'specs/features', FEATURE);
  await writeFile(join(dir, 'plan.md'), '# Plan\n\n## Approach\n\nRow-level security per household.\n');
  await writeFile(join(dir, 'review.md'), '# Review\n\n## Verdict\n\nNo blocking issues.\n');
  for (const name of ['spec.md', 'tasks.md']) {
    await writeFile(join(dir, name), (await readFile(join(dir, name), 'utf8')).replaceAll('- [ ]', '- [x]'));
  }
  await writeTracedTests(root, FEATURE);
  return root;
}

test('finishing a feature publishes a feature record to the OpenContext library', async () => {
  const fake = await useFakeOpenContext();
  const root = await finishedFeature();
  for (const status of ['approved', 'planned', 'in-progress', 'done']) await run(['status', '--dir', root, FEATURE, status]);

  const record = await readFile(join(fake.contextsRoot, 'projects/mealmate', `${FEATURE}.md`), 'utf8');
  assert.match(record, /# 001-shared-list — Shared list[\s\S]*AC-1[\s\S]*Row-level security[\s\S]*No blocking issues/);
  assert.match(await readFile(fake.log, 'utf8'), /folder create projects\/mealmate[\s\S]*doc create projects\/mealmate 001-shared-list\.md/);
});

test('knowledge publish shares product, architecture and ADRs', async () => {
  const fake = await useFakeOpenContext();
  const root = await newProject('--from', EXAMPLE);
  await run(['knowledge', '--dir', root, 'publish']);
  for (const name of ['product', 'architecture', 'standards', 'adr-0001-architecture-style']) {
    await readFile(join(fake.contextsRoot, 'projects/mealmate', `${name}.md`), 'utf8');
  }
});

test('one brief merges agentmemory and OpenContext for sessions and lanes', async () => {
  const fake = await useFakeOpenContext([PITFALL]);
  const memory = await startFakeAgentmemory(['Households share lists via invite links, not emails']);
  try {
    const root = await newProject('--from', EXAMPLE);
    await run(['feature', '--dir', root, 'Shared list']);
    await fillSpec(root, FEATURE, { tasks: ['- [ ] T-1 [impl] api (AC-1) — api.ts [P]'] });
    const env = { ...fake.env, AGENTMEMORY_URL: memory.url };
    const start = JSON.parse((await runHook(root, 'session-start', {}, env)).stdout).hookSpecificOutput.additionalContext;
    assert.match(start, /Relevant context for 001-shared-list/);
    assert.match(start, /From past sessions \(agentmemory\)\n- Households share lists via invite links/);
    assert.match(start, /From your knowledge library \(OpenContext\)\n- Pitfall: Expo push tokens — Push tokens rotate[\s\S]*read: \/lib\/playbook\/expo\.md/);
    assert.match(start, /\d+\. Knowledge \(OpenContext\)/);
  } finally {
    await memory.close();
  }
});

test('playbook manifest is available for new projects', async () => {
  await useFakeOpenContext();
  const root = await newProject('--yes');
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    await run(['knowledge', '--dir', root, 'manifest']);
  } finally {
    console.log = originalLog;
  }
  assert.match(lines.join('\n'), /Preferred stack/);
});

test('without the oc CLI everything still works and status explains why', async () => {
  process.env.PATH = TOOL_FREE_PATH;
  const root = await finishedFeature();
  for (const status of ['approved', 'planned', 'in-progress', 'done']) await run(['status', '--dir', root, FEATURE, status]);
  assert.match(await read(root, `specs/features/${FEATURE}/spec.md`), /^status: done$/m);
  assert.equal(await exitCodeOf(['knowledge', '--dir', root, 'status']), 1);
});

test('knowledge off removes guidance and commands refuse', async () => {
  const root = await newProject('--yes');
  const projectPath = join(root, 'specs/project.json');
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  await writeFile(projectPath, JSON.stringify({ ...project, knowledge: { ...project.knowledge, provider: 'none' } }));
  await run(['sync', '--dir', root]);
  assert.doesNotMatch(await read(root, 'AGENTS.md'), /## Knowledge library/);
  await assert.rejects(run(['knowledge', '--dir', root, 'search', 'auth']), /Knowledge is off/);
});

test('oc search output is parsed defensively', () => {
  assert.deepEqual(toResults(JSON.stringify([{ rel_path: 'a/b.md', description: 'desc' }])), [{ title: 'a/b.md', path: 'a/b.md', snippet: 'desc' }]);
  assert.deepEqual(toResults('not json'), []);
  assert.deepEqual(toResults(JSON.stringify({ docs: [{}] })), []);
});

test('knowledge folders must stay inside the library', async () => {
  const { validate, normalize } = await import('../src/schema.js');
  assert.deepEqual(validate(normalize({ knowledge: { folder: '' } })), []);
  assert.equal(validate(normalize({ knowledge: { folder: '../etc' } })).length, 1);
  assert.equal(validate(normalize({ knowledge: { playbook: '/abs' } })).length, 1);
});
