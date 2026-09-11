import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { toSnippets } from '../src/memory.js';
import { EXAMPLE, exitCodeOf, fillSpec, gitInit, newProject, read, runHook, setDocsEnabled, startFakeAgentmemory } from './helpers.js';
import { worktreeBase } from '../src/git.js';

const FEATURE = '001-shared-list';
const TASKS = ['- [ ] T-1 [impl] API (AC-1) — api.ts [P]', '- [ ] T-2 [impl] web (AC-1) — web.tsx [P]'];

afterEach(() => {
  delete process.env.AGENTMEMORY_URL;
  process.exitCode = 0;
});

async function projectWithMemory(url) {
  process.env.AGENTMEMORY_URL = url;
  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  return root;
}

test('approving a spec and finishing lanes are saved to agentmemory', async () => {
  const memory = await startFakeAgentmemory();
  try {
    const root = await projectWithMemory(memory.url);
    await run(['status', '--dir', root, FEATURE, 'approved']);
    const [specMemory] = memory.saved;
    assert.match(specMemory.content, /Spec approved: 001-shared-list "Shared list"[\s\S]*AC-1/);
    assert.deepEqual(specMemory.concepts, ['vibecheck', 'project:mealmate', `feature:${FEATURE}`, 'spec']);

    await run(['status', '--dir', root, FEATURE, 'in-progress']);
    gitInit(root);
    await run(['dispatch', '--dir', root, FEATURE, '--engine', 'manual']);
    await exitCodeOf(['merge', '--dir', root, FEATURE]);
    assert.equal(memory.saved.length, 1, 'lanes with no commits yet are not remembered');
  } finally {
    await memory.close();
  }
});

test('recalled memories reach the session context and every lane brief', async () => {
  const memory = await startFakeAgentmemory(['Chose Postgres row-level security for shared lists because households span accounts']);
  try {
    const root = await projectWithMemory(memory.url);
    const start = JSON.parse((await runHook(root, 'session-start', {}, { AGENTMEMORY_URL: memory.url })).stdout);
    assert.match(start.hookSpecificOutput.additionalContext, /Relevant context for 001-shared-list[\s\S]*From past sessions \(agentmemory\)[\s\S]*row-level security/);

    await run(['status', '--dir', root, FEATURE, 'approved']);
    await run(['status', '--dir', root, FEATURE, 'in-progress']);
    gitInit(root);
    await run(['dispatch', '--dir', root, FEATURE, '--engine', 'manual']);
    assert.match(await read(worktreeBase(root), `${FEATURE}-lane-2.prompt.md`), /Context from memory and your knowledge library[\s\S]*row-level security/);
  } finally {
    await memory.close();
  }
});

test('workflow keeps working when agentmemory is down', async () => {
  const root = await projectWithMemory('http://127.0.0.1:9');
  await run(['status', '--dir', root, FEATURE, 'approved']);
  assert.match(await read(root, `specs/features/${FEATURE}/spec.md`), /^status: approved$/m);
  assert.equal(await exitCodeOf(['memory', '--dir', root, 'status']), 1);
  const start = await runHook(root, 'session-start', {}, { AGENTMEMORY_URL: 'http://127.0.0.1:9' });
  assert.equal(start.code, 0);
});

test('memory can be turned off entirely', async () => {
  const root = await newProject('--yes');
  const projectPath = join(root, 'specs/project.json');
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  await writeFile(projectPath, JSON.stringify({ ...project, memory: { ...project.memory, provider: 'none' } }));
  await run(['sync', '--dir', root]);
  assert.doesNotMatch(await read(root, 'AGENTS.md'), /## Memory/);
  await assert.rejects(run(['memory', '--dir', root, 'recall', 'auth']), /Memory is off/);
});

test('settings enable the agentmemory plugin and marketplace', async () => {
  const root = await newProject('--yes');
  const settings = JSON.parse(await read(root, '.claude/settings.json'));
  assert.equal(settings.enabledPlugins['agentmemory@agentmemory'], true);
  assert.equal(settings.extraKnownMarketplaces.agentmemory.source.repo, 'rohitg00/agentmemory');
});

test('search results are parsed defensively', () => {
  assert.deepEqual(toSnippets({ results: [{ memory: { title: 'a' } }, { content: 'b\n  c' }, {}] }), ['a', 'b c']);
  assert.deepEqual(toSnippets(['x']), ['x']);
  assert.deepEqual(toSnippets(null), []);
});
