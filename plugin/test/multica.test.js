import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { STATIC_QUESTIONS } from '../src/advisor/questions.js';
import { EXAMPLE, PASSING_SUITES, approveReview, commitAll, exitCodeOf, fillSpec, gitInit, installFakeMultica, newProject, patchProject, read, restoreEnv, runHook, setDocsEnabled, sh, tempDir, writeFileIn, writeTracedTests } from './helpers.js';

// A filesystem path goes into these patterns verbatim, and on Windows it is full of
// backslashes, which a RegExp would read as escapes.
const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FEATURE = '001-shared-list';
const TASKS = [
  '- [x] T-1 [impl] contracts (AC-1) — packages/core/list.ts',
  '- [ ] T-2 [impl] API (AC-1) — apps/api/list.ts [P]',
  '- [ ] T-3 [impl] web (AC-1) — apps/web/list.tsx [P]',
];
const ORIGINAL_ENV = { ...process.env };
let fake;

beforeEach(async () => {
  fake = await installFakeMultica();
  Object.assign(process.env, fake.env, { AGENTMEMORY_URL: 'http://127.0.0.1:9', VIBECHECK_HOME: await mkdtemp(join(tmpdir(), 'sf-home-')) });
});

afterEach(() => {
  restoreEnv(ORIGINAL_ENV);
  process.exitCode = 0;
});

async function configure(root, multica) {
  const path = join(root, 'specs/project.json');
  const project = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...project, workflow: { ...project.workflow, engine: 'multica' }, multica: { ...project.multica, ...multica } }, null, 2));
  await run(['sync', '--dir', root]);
}

async function inProgressWithRemote({ push = true } = {}) {
  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await configure(root, { agent: 'Lambda', board: true, remote: 'origin' });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  await run(['status', '--dir', root, FEATURE, 'in-progress', '--force']);
  gitInit(root);
  const remote = await mkdtemp(join(tmpdir(), 'sf-remote-'));
  sh(remote, 'git', 'init', '-q', '--bare');
  sh(root, 'git', 'remote', 'add', 'origin', remote);
  if (push) sh(root, 'git', 'push', '-q', 'origin', 'main');
  return { root, remote };
}

function agentPushes(remote, baseCommit, branch, file) {
  const clone = tempDir('vibecheck-clone-');
  sh(clone, 'git', 'clone', '-q', remote, '.');
  sh(clone, 'git', 'config', 'user.email', 'agent@example.com');
  sh(clone, 'git', 'config', 'user.name', 'Agent');
  sh(clone, 'git', 'checkout', '-q', '-b', branch, baseCommit);
  writeFileIn(clone, file, 'done\n');
  commitAll(clone, 'feat: lane work');
  sh(clone, 'git', 'push', '-q', 'origin', branch);
}

test('lanes become Multica issues and pushed branches merge back', async () => {
  const { root, remote } = await inProgressWithRemote();
  await run(['dispatch', '--dir', root, FEATURE]);

  const state = await fake.state();
  const feature = state.issues.find((issue) => issue.metadata.vibecheck_feature === FEATURE && !issue.metadata.vibecheck_lane);
  const lanes = state.issues.filter((issue) => issue.metadata.vibecheck_lane);
  assert.equal(lanes.length, 2);
  assert.ok(lanes.every((issue) => issue.assignee === 'Lambda' && issue.parent === feature.key && issue.project === 'proj-1'));
  const baseCommit = sh(root, 'git', 'rev-parse', 'HEAD').trim();
  assert.match(lanes[0].description, new RegExp(`T-2 \\[impl\\] API[\\s\\S]*Start from commit ${baseCommit} and create branch \`vc/${FEATURE}/lane-1\``));

  agentPushes(remote, baseCommit, `vc/${FEATURE}/lane-1`, 'apps/api.ts');
  await fake.update((current) => { current.issues.find((issue) => issue.key === lanes[0].key).status = 'in_review'; });
  assert.equal(await exitCodeOf(['merge', '--dir', root, FEATURE]), 1, 'lane-2 is still running');
  assert.ok(existsSync(join(root, 'apps/api.ts')));
  const afterFirst = await fake.state();
  assert.equal(afterFirst.issues.find((issue) => issue.key === lanes[0].key).status, 'in_review', 'merged lanes wait for verification');
  assert.match(afterFirst.comments.at(-1).content, /Merged vc\/001-shared-list\/lane-1 into main\. It moves to Done once tests, smoke and UI pass/);

  await fake.update((current) => { current.issues.find((issue) => issue.key === lanes[1].key).status = 'cancelled'; });
  assert.equal(await exitCodeOf(['merge', '--dir', root, FEATURE]), 0);
  await assert.rejects(run(['merge', '--dir', root, FEATURE]), /No dispatched lanes/, 'all lanes resolved, manifest cleared');
});

test('dispatch explains what Multica needs: a pushed commit and an agent', async () => {
  const unpushed = await inProgressWithRemote({ push: false });
  await assert.rejects(run(['dispatch', '--dir', unpushed.root, FEATURE]), /is not on origin yet[\s\S]*git push origin HEAD/);

  const noAgent = await inProgressWithRemote();
  await configure(noAgent.root, { agent: '' });
  sh(noAgent.root, 'git', 'commit', '-qam', 'chore: config');
  sh(noAgent.root, 'git', 'push', '-q', 'origin', 'main');
  await assert.rejects(run(['dispatch', '--dir', noAgent.root, FEATURE]), /Set multica\.agent/);
});

test('feature status is mirrored to the Multica board without duplicates', async () => {
  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await configure(root, { board: true });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  let issues = (await fake.state()).issues;
  assert.deepEqual(issues.map((issue) => [issue.title, issue.status]), [[`${FEATURE} — Shared list`, 'todo']]);
  assert.match(issues[0].description, /AC-1:[\s\S]*Spec: specs\/features\/001-shared-list\/spec\.md/);

  await run(['status', '--dir', root, FEATURE, 'in-progress', '--force']);
  await run(['multica', '--dir', root, 'sync']);
  await run(['multica', '--dir', root, 'sync']);
  issues = (await fake.state()).issues;
  const feature = issues.find((issue) => issue.metadata.vibecheck_kind === 'feature');
  const tasks = issues.filter((issue) => issue.metadata.vibecheck_task);
  assert.equal(feature.status, 'in_progress');
  assert.deepEqual(tasks.map((issue) => [issue.title, issue.status, issue.parent]), [['T-1 contracts (AC-1)', 'done', feature.key], ['T-2 API (AC-1)', 'todo', feature.key], ['T-3 web (AC-1)', 'todo', feature.key]]);
  assert.equal(issues.length, 4, 'no duplicates after repeated syncs');
});

test('without Multica installed the workflow still runs and status explains why', async () => {
  process.env.PATH = '/usr/bin:/bin';
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await configure(root, { board: true });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  assert.match(await read(root, `specs/features/${FEATURE}/spec.md`), /^status: approved$/m);
  assert.equal(await exitCodeOf(['multica', '--dir', root, 'status']), 1);
});

test('health check and the advisor both know about Multica', async () => {
  const server = createServer((request, response) => response.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.FAKE_MULTICA_SERVER = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = await newProject('--yes');
    await configure(root, { agent: 'Lambda' });
    assert.equal(await exitCodeOf(['multica', '--dir', root, 'status']), 0);
  } finally {
    server.close();
  }
  assert.ok(STATIC_QUESTIONS.find((question) => question.id === 'engine').options.some((option) => option.id === 'multica'));

  const root = await newProject('--yes');
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify({ platform: 'web', engine: 'multica', backend: 'nestjs', database: 'postgres' }));
  await run(['advise', '--dir', root, 'apply']);
  const project = JSON.parse(await read(root, 'specs/project.json'));
  assert.deepEqual([project.workflow.engine, project.multica.board, project.multica.remote], ['multica', true, 'local']);
  await configure(root, { agent: 'Lambda' });
  const start = JSON.parse((await runHook(root, 'session-start', {}, fake.env)).stdout).hookSpecificOutput.additionalContext;
  assert.match(start, /become Multica issues assigned to Lambda; they run on this machine's Multica daemon, clone the project folder[\s\S]*mirrored to the Multica board/);
});

async function localProject() {
  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await configure(root, { agent: 'Lambda', board: true });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  await run(['status', '--dir', root, FEATURE, 'in-progress', '--force']);
  gitInit(root);
  return root;
}

function localAgentPushes(root, branch, file) {
  const clone = tempDir('vibecheck-clone-');
  const base = sh(root, 'git', 'rev-parse', 'HEAD').trim();
  sh(clone, 'git', 'clone', '-q', root, '.');
  sh(clone, 'git', 'config', 'user.email', 'agent@example.com');
  sh(clone, 'git', 'config', 'user.name', 'Agent');
  sh(clone, 'git', 'checkout', '-q', '-b', branch, base);
  writeFileIn(clone, file, 'ok\n');
  commitAll(clone, 'chore: agent');
  sh(clone, 'git', 'push', '-q', 'origin', branch);
}

test('local mode: agents on this machine clone the project folder, no git host needed', async () => {
  const root = await localProject();
  assert.equal(sh(root, 'git', 'remote').trim(), '', 'no remote at all');
  await run(['dispatch', '--dir', root, FEATURE]);
  const lanes = (await fake.state()).issues.filter((issue) => issue.metadata.vibecheck_lane);
  assert.match(lanes[0].description, new RegExp(`Delivery \\(Multica, on this machine\\)[\\s\\S]*git clone "${escapeForRegExp(root)}" lane[\\s\\S]*git push origin vc/${FEATURE}/lane-1`));

  localAgentPushes(root, `vc/${FEATURE}/lane-1`, 'apps/api.ts');
  localAgentPushes(root, `vc/${FEATURE}/lane-2`, 'apps/web.ts');
  await fake.update((current) => current.issues.filter((issue) => issue.metadata.vibecheck_lane).forEach((issue) => { issue.status = 'in_review'; }));
  assert.equal(await exitCodeOf(['merge', '--dir', root, FEATURE]), 0);
  assert.ok(existsSync(join(root, 'apps/api.ts')) && existsSync(join(root, 'apps/web.ts')));
  const laneStatus = async () => (await fake.state()).issues.filter((issue) => issue.metadata.vibecheck_lane).map((issue) => issue.status);
  assert.deepEqual(await laneStatus(), ['in_review', 'in_review'], 'merged, not yet verified');

  await patchProject(root, PASSING_SUITES);
  await writeTracedTests(root, FEATURE);
  commitAll(root, 'chore: suites and traced tests');
  assert.equal(await exitCodeOf(['verify', '--dir', root, FEATURE, '--run']), 0);
  assert.deepEqual(await laneStatus(), ['done', 'done'], 'lanes close once verification passes');
  assert.match((await fake.state()).comments.at(-1).content, /Verified at [0-9a-f]{8}: ✅ test · ✅ smoke · ✅ ui\. Done\./);
});

test('local mode needs the Multica daemon running on this machine', async () => {
  const root = await localProject();
  process.env.FAKE_MULTICA_DAEMON = 'stopped';
  await assert.rejects(run(['dispatch', '--dir', root, FEATURE]), /daemon is not running[\s\S]*multica daemon start/);
});

test('selftest proves a real round trip, then cleans up', async () => {
  const root = await localProject();
  process.env.VIBECHECK_POLL_MS = '50';
  const selftest = exitCodeOf(['multica', '--dir', root, 'selftest', '--timeout', '120']);
  let issue;
  while (!issue) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    issue = (await fake.state()).issues.find((entry) => entry.title === 'vibecheck self-test' && entry.metadata.vibecheck_selftest);
  }
  assert.match(issue.description, /\.vibecheck-selftest[\s\S]*git clone/);
  localAgentPushes(root, issue.metadata.vibecheck_selftest, '.vibecheck-selftest');
  await fake.update((current) => { current.issues.find((entry) => entry.key === issue.key).status = 'in_review'; });
  assert.equal(await selftest, 0);
  const after = await fake.state();
  assert.equal(after.issues.find((entry) => entry.key === issue.key).status, 'done');
  assert.equal(sh(root, 'git', 'branch', '--list', 'vc/selftest-*').trim(), '', 'test branch removed');
});

test('selftest reports a timeout when no agent picks the issue up', async () => {
  const root = await localProject();
  process.env.VIBECHECK_POLL_MS = '50';
  assert.equal(await exitCodeOf(['multica', '--dir', root, 'selftest', '--timeout', '1']), 1);
  assert.equal((await fake.state()).issues.find((entry) => entry.title === 'vibecheck self-test').status, 'cancelled');
});

async function readyFeature() {
  const root = await localProject();
  await patchProject(root, PASSING_SUITES);
  const tasksPath = join(root, 'specs/features', FEATURE, 'tasks.md');
  const specPath = join(root, 'specs/features', FEATURE, 'spec.md');
  await writeFile(tasksPath, (await readFile(tasksPath, 'utf8')).replaceAll('- [ ]', '- [x]'));
  await writeFile(specPath, (await readFile(specPath, 'utf8')).replace(/- \[ \] AC-/g, '- [x] AC-'));
  await writeTracedTests(root, FEATURE);
  commitAll(root, 'feat: shared list');
  assert.equal(await exitCodeOf(['verify', '--dir', root, FEATURE, '--run']), 0);
  return root;
}

const featureIssue = async () => (await fake.state()).issues.find((issue) => issue.metadata.vibecheck_kind === 'feature');
const specStatus = async (root) => (await read(root, `specs/features/${FEATURE}/spec.md`)).match(/^status: (.*)$/m)[1];

test('features are marked done on Multica, then verified and recorded', async () => {
  const root = await readyFeature();
  await approveReview(root, FEATURE);
  await run(['status', '--dir', root, FEATURE, 'done']);
  assert.equal(await specStatus(root), 'in-progress', 'marking done locally only asks for sign-off');
  const issue = await featureIssue();
  assert.equal(issue.status, 'in_review');
  assert.match((await fake.state()).comments.at(-1).content, /ready for your sign-off[\s\S]*Acceptance criteria traced to tests: 1\/1[\s\S]*✅ tests:[\s\S]*✅ smoke[\s\S]*✅ UI/);

  const { nextAction } = await import('../src/next.js');
  const { loadProject } = await import('../src/project.js');
  const waiting = await nextAction(root, await loadProject(root));
  assert.deepEqual([waiting.step, waiting.gate, waiting.command], ['board-done', 'board-done', `Mark Multica ${issue.key} done on the board`]);

  await fake.update((current) => { current.issues.find((entry) => entry.key === issue.key).status = 'done'; });
  const start = JSON.parse((await runHook(root, 'session-start', {}, fake.env)).stdout).hookSpecificOutput.additionalContext;
  assert.match(start, /From the Multica board[\s\S]*001-shared-list was marked done on Multica \(SPEC-\d+\) and is now recorded as done/);
  assert.equal(await specStatus(root), 'done');
  const after = await fake.state();
  assert.match(after.comments.at(-1).content, /Recorded as done in the specs/);
  assert.ok(after.issues.filter((entry) => entry.metadata.vibecheck_task).every((entry) => entry.status === 'done'), 'every task shows as done on the board');
});

test('a board sign-off on stale code is sent back to review with the reason', async () => {
  const root = await readyFeature();
  await approveReview(root, FEATURE);
  await run(['status', '--dir', root, FEATURE, 'done']);
  await writeFile(join(root, 'late-change.ts'), 'export const late = true;\n');
  commitAll(root, 'feat: late change');
  const issue = await featureIssue();
  await fake.update((current) => { current.issues.find((entry) => entry.key === issue.key).status = 'done'; });

  await run(['multica', '--dir', root, 'pull']);
  assert.equal(await specStatus(root), 'in-progress');
  assert.equal((await featureIssue()).status, 'in_review');
  assert.match((await fake.state()).comments.at(-1).content, /Can't record this as done yet:[\s\S]*code changed since the last run[\s\S]*Moved back to In review/);
});

test('--force cannot mark done locally when sign-off lives on Multica; turning it off restores local done', async () => {
  const root = await localProject();
  await assert.rejects(run(['status', '--dir', root, FEATURE, 'done', '--force']), /marked done on Multica, and --force cannot skip its checks/);

  const ready = await readyFeature();
  await patchProject(ready, { multica: { doneOnBoard: false } });
  commitAll(ready, 'chore: local done');
  assert.equal(await exitCodeOf(['verify', '--dir', ready, FEATURE, '--run']), 0);
  await approveReview(ready, FEATURE);
  await run(['status', '--dir', ready, FEATURE, 'done']);
  assert.equal(await specStatus(ready), 'done');
});
