// The scan makes claims about a project, and the console can act on them. Both halves are tested
// here: that a finding is derived from something the repository really says, and that running its
// fix runs the same command a terminal would — behind the same token as every other write.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/cli.js';
import { serveDashboard } from '../src/commands/dashboard.js';
import { loadProject } from '../src/project.js';
import { collectScan, fixPlanFor, scoreOf } from '../src/scan.js';
import { EXAMPLE, exitCodeOf, fillSpec, newProject, read } from './helpers.js';

console.log = () => {};

const open = [];
const serve = async (root) => {
  const server = await serveDashboard(root, { port: 0 });
  open.push(server);
  return server;
};
after(() => Promise.all(open.map((server) => server.close())));

const post = (server, body, token = server.token) => fetch(`http://127.0.0.1:${server.port}${server.control}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

const withFeature = async () => {
  const root = await newProject('--from', EXAMPLE);
  await run(['feature', '--dir', root, 'Shared shopping list']);
  return root;
};

const TASKS = 'specs/features/001-shared-shopping-list/tasks.md';
const scanOf = async (root) => collectScan(root, await loadProject(root));

// --- What it says ---

test('every finding points at something the project actually says', async () => {
  const root = await withFeature();
  // A criterion with no task is a fact about tasks.md, not a judgement about the code.
  await fillSpec(root, '001-shared-shopping-list', { tasks: ['- [ ] T-1 [impl] build it (AC-1) — src/list.js'] });
  const scan = await scanOf(root);

  assert.ok(scan.findings.length, 'a scaffolded project has work outstanding, and the scan should say so');
  for (const entry of scan.findings) {
    assert.ok(entry.id.startsWith('S-'), 'every finding is addressable');
    assert.ok(['critical', 'high', 'medium', 'low'].includes(entry.severity));
    assert.ok(Object.keys(scan.categories).includes(entry.category), `${entry.category} is not a category`);
    assert.ok(entry.title.trim().length, 'a finding with no title tells nobody anything');
  }
});

// The whole reason the category appears in the output: silence must never read as safety.
test('security is reported as not scanned, never as zero findings', async () => {
  const root = await withFeature();
  const scan = await scanOf(root);

  assert.equal(scan.categories.security, 0);
  assert.ok(scan.notScanned.some((gap) => gap.category === 'security'), 'the gap has to be stated');
  assert.doesNotMatch(JSON.stringify(scan.scanned), /security/, 'security must not be claimed as checked');
  assert.match(scan.notScanned.find((gap) => gap.category === 'security').why, /scanner/i);

  assert.equal(await exitCodeOf(['scan', '--dir', root, '--json']), 0);
});

test('the score falls by severity, and never flatters', async () => {
  assert.equal(scoreOf([]), 100);
  assert.equal(scoreOf([{ severity: 'low' }]), 99);
  assert.equal(scoreOf([{ severity: 'critical' }]), 82);
  assert.equal(scoreOf([{ severity: 'medium' }, { severity: 'medium' }]), 92);
  // Enough open findings cannot push it below zero, or wrap around into a good number.
  assert.equal(scoreOf(Array.from({ length: 40 }, () => ({ severity: 'critical' }))), 0);
});

test('a selection resolves to commands, and says which findings no command can fix', async () => {
  const root = await withFeature();
  await fillSpec(root, '001-shared-shopping-list', { tasks: ['- [ ] T-1 [impl] build it (AC-1) — src/list.js'] });
  const scan = await scanOf(root);
  const fixable = scan.findings.find((entry) => entry.action);
  const manual = scan.findings.find((entry) => !entry.action);
  assert.ok(fixable, 'some findings are fixable by a command');

  const plan = fixPlanFor(scan, [fixable.id, ...(manual ? [manual.id] : [])]);
  assert.ok(plan.steps.some((step) => step.action === fixable.action));
  assert.ok(plan.steps.every((step) => step.command.startsWith('vibecheck ')), 'every step is a real command');
  if (manual) assert.ok(plan.manual.some((entry) => entry.id === manual.id), 'and the rest are handed back, not silently dropped');
});

// --- Running the fixes ---

test('running a fix runs the real command and changes the real file', async () => {
  const root = await withFeature();
  // One criterion with a task, the others without: `analyze --fix` appends the missing work.
  await fillSpec(root, '001-shared-shopping-list', { tasks: ['- [ ] T-1 [impl] build it (AC-1) — src/list.js'] });
  const before = await read(root, TASKS);
  const scan = await scanOf(root);
  const ids = scan.findings.filter((entry) => entry.action === 'analyze.fix').map((entry) => entry.id);
  assert.ok(ids.length, 'an untasked or untested criterion is fixable by appending the task');

  const server = await serve(root);
  const response = await post(server, { action: 'scan.run', ids });

  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.ok(result.ran.length, 'something ran');
  assert.ok(result.ran.every((step) => step.ok), `every step succeeded: ${JSON.stringify(result.ran)}`);
  assert.notEqual(await read(root, TASKS), before, 'the file really changed');
  assert.ok(result.scan, 'and the project was rescanned, so the page shows what is true now');
});

test('running a fix needs the write token, like every other change', async () => {
  const root = await withFeature();
  const server = await serve(root);
  const scan = await scanOf(root);
  const ids = scan.findings.filter((entry) => entry.action).map((entry) => entry.id);

  assert.equal((await post(server, { action: 'scan.run', ids }, null)).status, 401);
  assert.equal((await post(server, { action: 'scan.run', ids }, 'not-the-token')).status, 401);
});

test('a request naming findings this scan does not have is refused', async () => {
  const root = await withFeature();
  const server = await serve(root);

  for (const ids of [['S-99'], [], 'S-01', [7]]) {
    assert.equal((await post(server, { action: 'scan.run', ids })).status, 400, `${JSON.stringify(ids)} must be refused`);
  }
});

test('selecting only findings no command can fix is refused, not faked', async () => {
  const root = await withFeature();
  const scan = await scanOf(root);
  const manual = scan.findings.filter((entry) => !entry.action).map((entry) => entry.id);
  if (!manual.length) return; // Nothing to assert on a project with no such findings.

  const server = await serve(root);
  const response = await post(server, { action: 'scan.run', ids: manual });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /person/i);
});

// --- Over the tunnel ---

test('the scan is served under the secret path, and readable without the write token', async () => {
  const root = await withFeature();
  const server = await serve(root);

  const feed = await fetch(`${server.url}scan.json`);
  assert.equal(feed.status, 200);
  const scan = await feed.json();
  assert.ok(Array.isArray(scan.findings));
  assert.ok(scan.notScanned.some((gap) => gap.category === 'security'));

  assert.equal((await fetch(`http://127.0.0.1:${server.port}/scan.json`)).status, 404, 'not without the secret path');
});

test('the served page carries the scan, its routes and the not-scanned warning', async () => {
  const root = await withFeature();
  const server = await serve(root);
  const html = await (await fetch(server.url)).text();

  for (const hash of ['/scan', '/findings']) {
    assert.ok(html.includes(`id="${hash}"`), `${hash} must be readable before any script runs`);
  }
  assert.match(html, /was not scanned/, 'the coverage gap is on the page, not only in the data');
  assert.match(html, /__SCAN__/, 'and the scan travels with the page so it renders offline too');
});

test('the written page is read-only: it offers no way to run anything', async () => {
  const root = await withFeature();
  await run(['scan', '--dir', root, '--out', join(root, 'scan.html')]);
  const html = await readFile(join(root, 'scan.html'), 'utf8');

  // The inlined render source mentions every control it can draw, so the question is what the
  // server actually rendered — the markup before the script — and whether anything set a URL to
  // send a write to.
  const rendered = html.slice(0, html.indexOf('<script'));
  assert.match(rendered, /Scan report/);
  assert.doesNotMatch(html, /__CONTROL__ =/, 'a file:// page has nothing to send a request to');
  assert.doesNotMatch(rendered, /id="runPlan"/, 'so it must not draw a button that cannot work');
  assert.doesNotMatch(rendered, /data-pick=/, 'nor checkboxes that lead nowhere');
  assert.match(rendered, /Read-only/, 'and it should say why');
});
