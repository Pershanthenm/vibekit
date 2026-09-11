import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFeature } from '../src/analyze.js';
import { run } from '../src/cli.js';
import { exitCodeOf, fillSpec, newProject, writeTracedTests } from './helpers.js';

console.log = () => {};

const feature = (spec, tasks, overrides = {}) => ({ id: '001-demo', status: 'draft', spec, tasks, plan: 'A plan.', ...overrides });
const kinds = (report) => report.problems.map((problem) => problem.kind);

const TWO_CRITERIA = `---
id: 001-demo
---
- [ ] AC-1: Given a device, when assigned, then it is recorded
- [ ] AC-2: Given a retired device, when assigned, then it is refused
`;

test('a feature whose artefacts agree reports no problems', () => {
  const report = analyzeFeature(feature(TWO_CRITERIA, [
    '- [ ] T-1 [test] assign (AC-1) — tests/assign.test.ts',
    '- [ ] T-2 [impl] refuse retired (AC-2) — src/devices.ts',
  ].join('\n')));

  assert.deepEqual(report.problems, []);
  assert.equal(report.criteria, 2);
  assert.equal(report.covered, 2);
  assert.equal(report.tasks, 2);
});

test('an acceptance criterion with no task is reported', () => {
  const report = analyzeFeature(feature(TWO_CRITERIA, '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts'));

  assert.deepEqual(kinds(report), ['untasked']);
  assert.match(report.problems[0].message, /AC-2 has no task/);
  assert.equal(report.covered, 1);
});

test('a task pointing at a criterion the spec does not define is reported', () => {
  const report = analyzeFeature(feature(TWO_CRITERIA, [
    '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts',
    '- [ ] T-2 [impl] refuse (AC-2) — src/retire.ts',
    '- [ ] T-3 [impl] export (AC-9) — src/export.ts',
  ].join('\n')));

  assert.ok(kinds(report).includes('orphan-task'));
  assert.match(report.problems.find((problem) => problem.kind === 'orphan-task').message, /AC-9, which the spec does not define/);
});

test('a task naming no criterion, and one naming no files, are both reported', () => {
  const report = analyzeFeature(feature(TWO_CRITERIA, [
    '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts',
    '- [ ] T-2 [impl] refuse retired (AC-2)',
    '- [ ] T-3 [impl] tidy up — src/misc.ts',
  ].join('\n')));

  const messages = report.problems.filter((problem) => problem.kind === 'orphan-task').map((problem) => problem.message);
  assert.ok(messages.some((message) => /T-2 names no files/.test(message)), messages.join(' | '));
  assert.ok(messages.some((message) => /T-3 names no acceptance criterion/.test(message)), messages.join(' | '));
});

// [P] promises a task shares no files with any other open task; lanes rely on it.
test('two [P] tasks sharing a file are reported, because lanes would collide', () => {
  const report = analyzeFeature(feature(TWO_CRITERIA, [
    '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts [P]',
    '- [ ] T-2 [impl] refuse (AC-2) — src/devices.ts [P]',
  ].join('\n')));

  assert.ok(kinds(report).includes('parallel-clash'));
  assert.match(report.problems.find((problem) => problem.kind === 'parallel-clash').message, /T-1 and T-2 are both \[P\] but share src\/devices\.ts/);
});

test('tasks that do not overlap may both be [P]', () => {
  const report = analyzeFeature(feature(TWO_CRITERIA, [
    '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts [P]',
    '- [ ] T-2 [impl] refuse (AC-2) — src/retire.ts [P]',
  ].join('\n')));

  assert.ok(!kinds(report).includes('parallel-clash'));
});

test('an undecided criterion is surfaced rather than passed over', () => {
  const spec = '- [ ] AC-1: Given a device, when exported, then TODO decide the format\n';
  const report = analyzeFeature(feature(spec, '- [ ] T-1 [impl] export (AC-1) — src/export.ts'));

  assert.ok(kinds(report).includes('vague'));
  assert.match(report.problems.find((problem) => problem.kind === 'vague').message, /AC-1 is not decided yet/);
});

test('a planned feature with an unfinished plan is reported', () => {
  const tasks = '- [ ] T-1 [impl] assign (AC-1) — src/devices.ts\n- [ ] T-2 [impl] refuse (AC-2) — src/retire.ts';
  assert.ok(!kinds(analyzeFeature(feature(TWO_CRITERIA, tasks, { status: 'planned' }))).includes('unplanned'));
  assert.ok(kinds(analyzeFeature(feature(TWO_CRITERIA, tasks, { status: 'planned', plan: '## Approach\n\nTODO\n' }))).includes('unplanned'));
  assert.ok(kinds(analyzeFeature(feature(TWO_CRITERIA, tasks, { status: 'planned', plan: '   ' }))).includes('unplanned'));
});

test('missing artefacts are reported rather than silently passing', () => {
  assert.ok(kinds(analyzeFeature(feature('# Spec\n\nNo criteria here.', ''))).includes('empty'));
  assert.ok(kinds(analyzeFeature(feature(TWO_CRITERIA, ''))).includes('empty'));
});

test('vibecheck analyze exits 1 on contradictions and 0 once they are resolved', async () => {
  const root = await newProject('--yes');
  await run(['feature', '--dir', root, 'Assign laptop']);
  await fillSpec(root, '001-assign-laptop', { tasks: ['- [ ] T-1 [impl] assign (AC-1) — src/assign.ts'] });

  assert.equal(await exitCodeOf(['analyze', '--dir', root]), 1, 'an untested criterion is a contradiction');

  await writeTracedTests(root, '001-assign-laptop', [1]);
  assert.equal(await exitCodeOf(['analyze', '--dir', root, '001']), 0, 'once tasks and tests line up, analyze passes');
});
