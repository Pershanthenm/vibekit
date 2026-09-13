import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { evidenceChecklist, evidenceProblems, runCountOf, runSuites, runsFor, saveEvidence } from '../src/evidence.js';
import { loadProject } from '../src/project.js';
import { normalize, validate } from '../src/schema.js';
import { gitInit, newProject, patchProject, sh, tempDir } from './helpers.js';

console.log = () => {};
process.env.VIBEKIT_NO_OPEN = '1';

const PASSES = 'node -e ""';
const FAILS = 'node -e "process.exit(1)"';

const project = (commands, runs = 1) => normalize({
  project: { name: 'x' },
  commands,
  standards: { testing: { framework: 'node:test', coverage: 80, tdd: true, runs } },
});

// A command that fails only on certain runs, driven by a counter file — the shape of a real flake.
const flakyCommand = (dir, failOn) => {
  const counter = `${dir.replace(/\\/g, '/')}/count`;
  return `node -e "const f=require('fs');const n=(f.existsSync('${counter}')?+f.readFileSync('${counter}','utf8'):0)+1;f.writeFileSync('${counter}',String(n));process.exit(${failOn}===n?1:0)"`;
};

test('a suite is run as many times as asked, and every run counts', () => {
  const result = runSuites(project({ test: PASSES }), process.cwd(), { runs: 3 })[0];

  assert.equal(result.runs, 3);
  assert.equal(result.passed, 3);
  assert.equal(result.ok, true);
  assert.equal(result.flaky, false);
});

// The whole point: green on the last run is not the same as green.
test('a suite that fails on one run out of three is flaky, not passing', () => {
  const dir = tempDir('vc-flaky-');
  const result = runSuites(project({ test: flakyCommand(dir, 2) }), process.cwd(), { runs: 3 })[0];

  assert.equal(result.runs, 3);
  assert.equal(result.passed, 2);
  assert.equal(result.flaky, true, 'passing twice in three is a flake');
  assert.equal(result.ok, false, 'a flaky suite must never be recorded as ok');
});

test('a suite that never passes is failing, not flaky', () => {
  const result = runSuites(project({ test: FAILS }), process.cwd(), { runs: 2 })[0];

  assert.equal(result.passed, 0);
  assert.equal(result.flaky, false, 'consistently broken is a different problem from flaky');
  assert.equal(result.ok, false);
});

test('one run stays the default, so nothing changes for a project that never asked', () => {
  assert.equal(runsFor(normalize({ project: { name: 'x' } })), 1);
  assert.equal(runSuites(project({ test: PASSES }), process.cwd())[0].runs, 1);
});

test('the run count is read from the project', () => {
  assert.equal(runsFor(project({ test: PASSES }, 5)), 5);
});

// Evidence recorded before repeat runs existed has no run count; it described exactly one.
test('older evidence is read as a single run rather than crashing', () => {
  assert.deepEqual(runCountOf({ suite: 'test', ok: true }), { runs: 1, passed: 1, flaky: false });
  assert.deepEqual(runCountOf({ suite: 'test', ok: false }), { runs: 1, passed: 0, flaky: false });
});

// The gate is the part that matters: a flake must stop a feature reaching done.
test('the gate refuses evidence from a flaky suite, and names the tally', async () => {
  const root = await newProject('--yes');
  await patchProject(root, { commands: { test: PASSES, smoke: '', ui: '' }, standards: { testing: { runs: 3 } } });
  gitInit(root);
  const commit = sh(root, 'git', 'rev-parse', 'HEAD').trim();
  await saveEvidence(root, '001-thing', {
    commit, dirty: false,
    suites: [{ suite: 'test', command: PASSES, ok: false, runs: 3, passed: 2, flaky: true, seconds: 1 }],
  });

  const problems = await evidenceProblems(root, await loadProject(root), { id: '001-thing', title: 'Thing' });
  assert.match(problems.join(' '), /flaky — passed 2 of 3 runs/);
});

test('the gate refuses evidence with fewer runs than the project requires', async () => {
  const root = await newProject('--yes');
  await patchProject(root, { commands: { test: PASSES, smoke: '', ui: '' }, standards: { testing: { runs: 3 } } });
  gitInit(root);
  const commit = sh(root, 'git', 'rev-parse', 'HEAD').trim();
  await saveEvidence(root, '001-thing', {
    commit, dirty: false,
    suites: [{ suite: 'test', command: PASSES, ok: true, runs: 1, passed: 1, flaky: false, seconds: 1 }],
  });

  const problems = await evidenceProblems(root, await loadProject(root), { id: '001-thing', title: 'Thing' });
  assert.match(problems.join(' '), /passed 1 run\(s\), but this project requires 3/);
});

test('evidence that meets the required runs passes the gate', async () => {
  const root = await newProject('--yes');
  await patchProject(root, { commands: { test: PASSES, smoke: '', ui: '' }, standards: { testing: { runs: 3 } } });
  gitInit(root);
  const commit = sh(root, 'git', 'rev-parse', 'HEAD').trim();
  await saveEvidence(root, '001-thing', {
    commit, dirty: false,
    suites: [{ suite: 'test', command: PASSES, ok: true, runs: 3, passed: 3, flaky: false, seconds: 1 }],
  });

  const problems = await evidenceProblems(root, await loadProject(root), { id: '001-thing', title: 'Thing' });
  assert.deepEqual(problems, []);
});

test('the sign-off checklist shows the tally and never ticks a flake', async () => {
  const root = await newProject('--yes');
  const settings = { ...await loadProject(root), commands: { test: 'npm test' } };
  const evidence = {
    at: '2026-09-12T14:32:09.000Z', commit: 'abcdef1234', dirty: false,
    suites: [{ suite: 'test', command: 'npm test', ok: false, runs: 3, passed: 2, flaky: true, seconds: 1 }],
  };

  const checklist = evidenceChecklist(settings, { id: '001-thing', title: 'Thing' }, evidence, { covered: [], missing: [] });
  assert.match(checklist, /2\/3 runs/, 'the tally has to be visible to whoever signs off');
  assert.match(checklist, /⚠️/, 'a flake must not be shown with a tick');
  assert.doesNotMatch(checklist, /✅ tests/);
});

test('the project rejects a run count that is not a positive whole number', () => {
  assert.deepEqual(validate(project({ test: PASSES }, 3)).filter((error) => /runs/.test(error)), []);

  const broken = normalize({ project: { name: 'x' }, standards: { testing: { runs: 'three' } } });
  assert.ok(validate(broken).some((error) => /standards\.testing\.runs/.test(error)), 'a typo must fail loudly, not silently disable flake detection');
});

test('--repeat refuses a nonsense value instead of quietly running once', async () => {
  const root = await newProject('--yes');
  await assert.rejects(run(['verify', '--dir', root, '--run', '--repeat', 'lots']), /--repeat must be a positive whole number/);
});

test('--repeat overrides the project setting for one run', async () => {
  const root = await newProject('--yes');
  await patchProject(root, { commands: { test: PASSES }, standards: { testing: { runs: 1 } } });
  const settings = await loadProject(root);

  assert.equal(runsFor(settings), 1);
  assert.equal(runSuites(settings, root, { runs: 4 })[0].runs, 4);
});
