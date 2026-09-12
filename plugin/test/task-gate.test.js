import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendTasks, tasksForGaps } from '../src/analyze.js';
import { run } from '../src/cli.js';
import { FAILS, PASSES, PASSING_SUITES, exitCodeOf, fillSpec, gitInit, newProject, patchProject, runHook } from './helpers.js';

console.log = () => {};

const FEATURE = '001-shared-list';
const tasksOf = (root) => readFile(join(root, 'specs/features', FEATURE, 'tasks.md'), 'utf8');

async function featureWith(tasks) {
  const root = await newProject('--yes');
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks });
  return root;
}

// --- Gap 1: analyze could only describe missing work; now it can write it down. ---

test('a criterion with no task becomes a test task and an impl task', () => {
  const feature = {
    id: '001-demo',
    spec: '- [ ] AC-1: Given a device, when assigned, then it is recorded\n- [ ] AC-2: Given a retired device, when assigned, then it is refused\n',
    tasks: '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts\n',
  };

  const lines = tasksForGaps(feature, { untasked: [2], untested: [] });

  assert.deepEqual(lines, [
    '- [ ] T-2 [test] Test AC-2: Given a retired device, when assigned, then it is refused (AC-2)',
    '- [ ] T-3 [impl] Build AC-2: Given a retired device, when assigned, then it is refused (AC-2)',
  ]);
});

// A criterion someone already planned needs the test, not the work planned a second time.
test('a criterion that has a task but no test gets only a test task', () => {
  const feature = { id: '001-demo', spec: '- [ ] AC-1: it is recorded\n', tasks: '- [ ] T-4 [impl] assign (AC-1) — src/devices.ts\n' };

  assert.deepEqual(tasksForGaps(feature, { untasked: [], untested: [1] }), ['- [ ] T-5 [test] Test AC-1: it is recorded (AC-1)']);
});

test('a criterion with neither task nor test is not written down twice', () => {
  const feature = { id: '001-demo', spec: '- [ ] AC-1: it is recorded\n', tasks: '' };

  const lines = tasksForGaps(feature, { untasked: [1], untested: [1] });

  assert.equal(lines.length, 2, 'one test task and one impl task, not three');
  assert.deepEqual(lines.map((line) => line.slice(0, 20)), ['- [ ] T-1 [test] Tes', '- [ ] T-2 [impl] Bui']);
});

test('appending keeps the existing tasks and adds nothing when there is no gap', () => {
  const tasks = '# Tasks\n\n- [ ] T-1 [impl] assign (AC-1) — src/devices.ts\n';

  assert.equal(appendTasks(tasks, []), tasks);
  assert.equal(appendTasks(tasks, ['- [ ] T-2 [test] x (AC-1)']), `${tasks}- [ ] T-2 [test] x (AC-1)\n`);
});

test('analyze --fix writes the missing work into tasks.md', async () => {
  const root = await featureWith(['- [ ] T-1 [impl] assign (AC-1) — src/devices.ts']);

  await exitCodeOf(['analyze', '--dir', root, FEATURE, '--fix']);

  const tasks = await tasksOf(root);
  assert.match(tasks, /T-1 \[impl\] assign \(AC-1\)/, 'the task that was already there survives');
  assert.match(tasks, /T-2 \[test\] Test AC-1/, 'AC-1 has a task but no test, so it gains one');
});

test('analyze without --fix changes nothing', async () => {
  const root = await featureWith(['- [ ] T-1 [impl] assign (AC-1) — src/devices.ts']);
  const before = await tasksOf(root);

  await exitCodeOf(['analyze', '--dir', root, FEATURE]);

  assert.equal(await tasksOf(root), before);
});

// Appending twice would grow tasks.md on every run; the gap is closed by the first append.
test('analyze --fix is idempotent', async () => {
  const root = await featureWith(['- [ ] T-1 [impl] assign (AC-1) — src/devices.ts']);

  await exitCodeOf(['analyze', '--dir', root, FEATURE, '--fix']);
  const once = await tasksOf(root);
  await exitCodeOf(['analyze', '--dir', root, FEATURE, '--fix']);

  assert.equal(await tasksOf(root), once);
});

test('--fix reports what it appended in --json', async () => {
  const root = await featureWith(['- [ ] T-1 [impl] assign (AC-1) — src/devices.ts']);
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await exitCodeOf(['analyze', '--dir', root, FEATURE, '--fix', '--json']);
  } finally {
    console.log = original;
  }

  const { added } = JSON.parse(lines.join('\n'));
  assert.deepEqual(added.map((entry) => entry.feature), [FEATURE]);
  assert.match(added[0].lines[0], /\[test\] Test AC-1/);
});

// An appended task names no files, because nothing knows which files it touches yet. That is the
// next decision, and analyze keeps reporting it until someone makes it.
test('an appended task is still reported until its files are named', async () => {
  const root = await featureWith(['- [ ] T-1 [impl] assign (AC-1) — src/devices.ts']);
  await exitCodeOf(['analyze', '--dir', root, FEATURE, '--fix']);

  assert.equal(await exitCodeOf(['analyze', '--dir', root, FEATURE]), 1);
});

// --- Gap 2: the test run after a finished task was an instruction; now it is a gate. ---

const TASKS = ['- [ ] T-1 [test] assign (AC-1) — tests/list.test.ts', '- [ ] T-2 [impl] assign (AC-1) — src/list.ts'];

async function inProgress(root, testCommand = PASSES) {
  await patchProject(root, { commands: { ...PASSING_SUITES.commands, test: testCommand } });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  await run(['status', '--dir', root, FEATURE, 'in-progress', '--force']);
}

async function tickTask(root, id) {
  const path = join(root, 'specs/features', FEATURE, 'tasks.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(`- [ ] ${id}`, `- [x] ${id}`));
}

test('ticking a task makes the stop hook run the suite, and a failure blocks the turn', async () => {
  const root = await featureWith(TASKS);
  gitInit(root);
  await inProgress(root, FAILS);

  assert.equal((await runHook(root, 'stop', {})).code, 0, 'nothing ticked yet, so the suite is not run');

  await tickTask(root, 'T-1');
  const blocked = await runHook(root, 'stop', {});

  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /fails, and tasks were ticked as done/);
  assert.match(blocked.stderr, /001-shared-list: T-1/, 'it has to say which task');
});

test('a failing gate keeps gating until the suite passes', async () => {
  const root = await featureWith(TASKS);
  gitInit(root);
  await inProgress(root, FAILS);
  await tickTask(root, 'T-1');

  assert.equal((await runHook(root, 'stop', {})).code, 2);
  assert.equal((await runHook(root, 'stop', {})).code, 2, 'a failed run must not be recorded as done');
});

// The suite is the project's, not one task's: it runs once, and only a green run records the
// tasks it covered, so the next turn does not pay for it again.
test('a passing suite lets the turn end and is not run again for the same task', async () => {
  const root = await featureWith(TASKS);
  gitInit(root);
  await inProgress(root, 'node -e "require(\'fs\').appendFileSync(\'ran.txt\', \'x\')"');

  await tickTask(root, 'T-1');
  assert.equal((await runHook(root, 'stop', {})).code, 0, 'a green suite does not block');
  assert.equal((await runHook(root, 'stop', {})).code, 0);
  assert.equal(await readFile(join(root, 'ran.txt'), 'utf8'), 'x', 'the suite ran once, for the one ticked task');

  await tickTask(root, 'T-2');
  assert.equal((await runHook(root, 'stop', {})).code, 0);
  assert.equal(await readFile(join(root, 'ran.txt'), 'utf8'), 'xx', 'the next finished task runs it again');
});

test('the gate is off when the workflow is not enforced', async () => {
  const root = await featureWith(TASKS);
  gitInit(root);
  await inProgress(root, FAILS);
  await patchProject(root, { workflow: { enforce: false } });

  await tickTask(root, 'T-1');
  assert.equal((await runHook(root, 'stop', {})).code, 0);
});
