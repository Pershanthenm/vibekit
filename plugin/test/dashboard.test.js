import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { collectState, dashboardPath, renderDashboard } from '../src/dashboard.js';
import { saveEvidence } from '../src/evidence.js';
import { loadProject, saveProject } from '../src/project.js';
import { gitInit, newProject, patchProject, sh } from './helpers.js';

console.log = () => {};
process.env.VIBECHECK_NO_OPEN = '1';

const withFeature = async () => {
  const root = await newProject('--yes');
  await run(['feature', '--dir', root, 'Device register']);
  return root;
};

test('the state says where every feature sits in the lifecycle', async () => {
  const root = await withFeature();
  const state = await collectState(root, await loadProject(root));

  assert.equal(state.features.length, 1);
  const feature = state.features[0];
  assert.equal(feature.status, 'draft');
  assert.ok(feature.criteria.total >= 1, 'criteria are counted');
  assert.equal(typeof feature.tasks.done, 'number');
  assert.ok(state.next, 'the page must be able to say what happens next');
  assert.match(state.project.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// A gate switched off is not a gate that passed, and the page must not imply it is.
test('gates report blocked, passing or switched off — never one disguised as another', async () => {
  const root = await withFeature();
  const project = await loadProject(root);

  const on = await collectState(root, project);
  const ids = on.features[0].gates.map((gate) => gate.id);
  assert.deepEqual(ids, ['traceability', 'evidence', 'review', 'design']);
  assert.ok(on.features[0].gates.some((gate) => gate.state === 'blocked'), 'a fresh feature has no evidence or review yet');

  await saveProject(root, { ...project, workflow: { ...project.workflow, review: false, evidence: false } });
  const off = await collectState(root, await loadProject(root));
  const byId = Object.fromEntries(off.features[0].gates.map((gate) => [gate.id, gate.state]));
  assert.equal(byId.review, 'off');
  assert.equal(byId.evidence, 'off');
});

test('a blocked gate carries the reason, so the page can say what to do', async () => {
  const root = await withFeature();
  const state = await collectState(root, await loadProject(root));
  const review = state.features[0].gates.find((gate) => gate.id === 'review');

  assert.equal(review.state, 'blocked');
  assert.ok(review.problems.length, 'a blocked gate with no reason is useless to the reader');
  assert.match(review.problems.join(' '), /review/i);
});

test('the page is self-contained: no network, no build step', () => {
  const html = renderDashboard({
    project: { name: 'device-register', generatedAt: '2026-09-12T14:32:09.000Z', engine: 'cursor', autonomy: 'gated' },
    next: { step: 'spec', feature: '001-device-register', command: 'vibecheck feature', gate: 'spec-approval', reason: 'needs approval' },
    setup: null,
    problems: [],
    features: [],
  });

  assert.doesNotMatch(html, /<script/i, 'no scripts: the page must work from file:// with nothing loaded');
  assert.doesNotMatch(html, /https?:\/\//, 'no external fetches — it has to render with no network');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /device-register/);
});

test('live adds the refresh, static leaves it out', () => {
  const state = { project: { name: 'x', generatedAt: '2026-09-12T14:32:09.000Z' }, next: null, setup: null, problems: [], features: [] };

  assert.match(renderDashboard(state, { live: true }), /http-equiv="refresh"/);
  assert.doesNotMatch(renderDashboard(state, { live: false }), /http-equiv="refresh"/);
});

// Feature titles and problem text reach the page verbatim; neither may break out of the markup.
test('text from the project cannot inject markup', () => {
  const html = renderDashboard({
    project: { name: '<img src=x onerror=alert(1)>', generatedAt: '2026-09-12T14:32:09.000Z' },
    next: null,
    setup: null,
    problems: ['<script>alert(2)</script>'],
    features: [],
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;img src=x/);
});

test('the command writes the page where the project can find it', async () => {
  const root = await withFeature();
  await run(['dashboard', '--dir', root]);

  const html = await readFile(dashboardPath(root), 'utf8');
  assert.match(html, /lifecycle/);
  assert.match(html, /001-device-register/);
  assert.match(html, /http-equiv="refresh"/, 'the file the CLI opens has to keep itself current');
});

test('--static drops the refresh, for a copy that is not a local browser', async () => {
  const root = await withFeature();
  await run(['dashboard', '--dir', root, '--static', '--out', 'share.html']);

  const html = await readFile(join(root, 'share.html'), 'utf8');
  assert.doesNotMatch(html, /http-equiv="refresh"/);
});

test('a project with no features says so instead of rendering an empty page', async () => {
  const root = await newProject('--yes');
  await run(['dashboard', '--dir', root]);

  const html = await readFile(dashboardPath(root), 'utf8');
  assert.match(html, /No features yet/);
});

// Found the hard way: an untracked specs/status.html made `merge` refuse to run and would have
// made the evidence gate record a dirty tree. A page that reports on the lifecycle must not be
// able to block it, so it is written outside the working tree.
test('writing the page leaves the working tree clean', async () => {
  const root = await withFeature();
  gitInit(root);

  await run(['dashboard', '--dir', root]);

  const dirty = sh(root, 'git', 'status', '--porcelain').trim();
  assert.equal(dirty, '', `the status page dirtied the tree: ${dirty}`);
  assert.ok(!dashboardPath(root).includes(`${root}${sep}specs`), 'the page must not live in specs/');
});

test('a suite with no recorded run says "not run", never nothing', async () => {
  const root = await withFeature();
  const state = await collectState(root, await loadProject(root));

  const suites = state.features[0].tests.suites;
  assert.ok(suites.length, 'the defined suites must appear even before anything has been run');
  assert.ok(suites.every((entry) => entry.state === 'missing'));
  assert.equal(state.tests.missing, suites.length);
  assert.equal(state.tests.ok, 0);
});

// The reason this dashboard exists: a flake must look like a problem, not a pass.
test('a flaky suite is shown as FLAKY with its tally, not as a tick', async () => {
  const root = await withFeature();
  await patchProject(root, { commands: { test: 'node -e ""', smoke: '', ui: '' } });
  gitInit(root);
  const commit = sh(root, 'git', 'rev-parse', 'HEAD').trim();
  await saveEvidence(root, '001-device-register', {
    commit, dirty: false,
    suites: [{ suite: 'test', command: 'node -e ""', ok: false, runs: 3, passed: 2, flaky: true, seconds: 4 }],
  });

  const state = await collectState(root, await loadProject(root));
  assert.equal(state.features[0].tests.suites[0].state, 'flaky');
  assert.equal(state.tests.flaky, 1);

  const html = renderDashboard(state);
  assert.match(html, /FLAKY/);
  assert.match(html, /2\/3 runs/);
});

test('evidence from an older commit is called stale, not shown as passing', async () => {
  const root = await withFeature();
  await patchProject(root, { commands: { test: 'node -e ""', smoke: '', ui: '' } });
  gitInit(root);
  await saveEvidence(root, '001-device-register', {
    commit: '0000000000000000000000000000000000000000', dirty: false,
    suites: [{ suite: 'test', command: 'node -e ""', ok: true, runs: 3, passed: 3, flaky: false, seconds: 4 }],
  });

  const state = await collectState(root, await loadProject(root));
  assert.equal(state.features[0].tests.stale, true);
  assert.equal(state.tests.stale, 1);
  assert.match(renderDashboard(state), /no longer describes this code/);
});

test('the page names untested criteria rather than only counting them', async () => {
  const root = await withFeature();
  const state = await collectState(root, await loadProject(root));

  if (state.features[0].tests.trace.missing.length) {
    assert.match(renderDashboard(state), /Untested criteria: AC-/);
    assert.ok(state.tests.untraced > 0);
  }
});

// The dashboard reports on the work; it must never be able to stop it.
test('a broken task list is reported on the page, not thrown at the caller', async () => {
  const root = await withFeature();
  await writeFile(join(root, 'specs/features/001-device-register/tasks.md'), 'not a task list at all\n');

  const state = await collectState(root, await loadProject(root));
  assert.equal(state.features.length, 1);
  assert.equal(state.features[0].tasks.total, 0);
});
