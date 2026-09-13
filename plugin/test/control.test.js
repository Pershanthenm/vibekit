// The console can change the project, so this is an authorisation test before it is a feature
// test. Two things must hold however the page behaves: knowing the URL is not enough to write,
// and nothing the endpoint accepts may get past a check the CLI itself would apply.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/cli.js';
import { serveDashboard } from '../src/commands/dashboard.js';
import { secret } from '../src/live.js';
import { EXAMPLE, fillSpec, newProject, read } from './helpers.js';

console.log = () => {};

const open = [];
const serve = async (root) => {
  const server = await serveDashboard(root, { port: 0 });
  open.push(server);
  return server;
};
after(() => Promise.all(open.map((server) => server.close())));

/** A request as the page makes it, with whatever token (or none) is being tested. */
const post = (server, body, { token = server.token, type = 'application/json', method = 'POST' } = {}) => fetch(
  `http://127.0.0.1:${server.port}${server.control}`,
  {
    method,
    headers: { ...(type ? { 'content-type': type } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  },
);

const withFeature = async () => {
  const root = await newProject('--from', EXAMPLE);
  await run(['feature', '--dir', root, 'Shared shopping list']);
  return root;
};

const SPEC = 'specs/features/001-shared-shopping-list/spec.md';
const TASKS = 'specs/features/001-shared-shopping-list/tasks.md';

// --- Who may write ---

test('the token is separate from the link: knowing the url is not enough to change anything', async () => {
  const root = await withFeature();
  const server = await serve(root);
  const before = await read(root, SPEC);

  for (const token of [null, secret(), `${server.token}x`, server.token.slice(0, -1)]) {
    const response = await post(server, { action: 'feature.status', id: '001', status: 'approved' }, { token });
    assert.equal(response.status, 401, `a request with ${token ? 'the wrong token' : 'no token'} must be refused`);
  }
  assert.equal(await read(root, SPEC), before, 'and nothing may have changed');
});

test('the token never appears in the page, so a leaked link cannot be replayed into a write', async () => {
  const root = await withFeature();
  const server = await serve(root);

  const page = await (await fetch(server.url)).text();
  assert.ok(!page.includes(server.token), 'the write token must not ship with the page');
  assert.match(page, /__CONTROL__/, 'but the page must know where to send a write once it has one');
});

test('only a POST of JSON is accepted, so another site cannot post a form here', async () => {
  const root = await withFeature();
  const server = await serve(root);

  assert.equal((await post(server, {}, { method: 'GET' })).status, 405);
  // A cross-site form can only send these three content types, and none of them are ours.
  for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']) {
    assert.equal((await post(server, { action: 'task.tick' }, { type })).status, 415, `${type} must be refused`);
  }
});

test('an action that is not on the list is refused without being looked at', async () => {
  const root = await withFeature();
  const server = await serve(root);

  for (const action of ['run', 'exec', 'shell', 'feature.delete', undefined]) {
    const response = await post(server, { action, id: '001' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Unknown action/);
  }
});

// --- What a write actually does ---

test('a status change goes through the same gates the CLI applies, and is refused the same way', async () => {
  const root = await withFeature();
  const server = await serve(root);
  const specPath = join(root, SPEC);
  const before = await readFile(specPath, 'utf8');

  // The spec still has TODOs in it, which is exactly what `vibekit status` refuses to approve.
  const refused = await post(server, { action: 'feature.status', id: '001', status: 'approved' });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.match(body.error, /TODO/i, "the refusal says why, in the CLI's own words");
  assert.equal(await readFile(specPath, 'utf8'), before, 'a refused change writes nothing');
  assert.ok(body.state, 'and the truth comes back with it, so the page can redraw honestly');

  // Once the spec is finished the same request is allowed, and lands in the file.
  await fillSpec(root, '001-shared-shopping-list', { tasks: ['- [ ] T-1 [impl] build it (AC-1)'] });
  const allowed = await post(server, { action: 'feature.status', id: '001', status: 'approved' });
  assert.equal(allowed.status, 200);
  assert.match(await readFile(specPath, 'utf8'), /^status: approved$/m, 'the board and the spec agree, or the board is lying');
  assert.equal((await allowed.json()).state.features[0].status, 'approved');
});

test('a status that is not one of ours is a bad request, not a new status', async () => {
  const root = await withFeature();
  const server = await serve(root);

  const response = await post(server, { action: 'feature.status', id: '001', status: 'shipped' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not a status/);
});

test('ticking a task ticks the box in tasks.md, and only that box', async () => {
  const root = await withFeature();
  await fillSpec(root, '001-shared-shopping-list', {
    tasks: ['- [ ] T-1 [test] prove it (AC-1)', '- [ ] T-2 [impl] build it (AC-1)'],
  });
  const server = await serve(root);
  const tasksPath = join(root, TASKS);

  assert.equal((await post(server, { action: 'task.tick', id: '001', task: 'T-2' })).status, 200);
  const after = await readFile(tasksPath, 'utf8');
  assert.match(after, /- \[x\] T-2/);
  assert.match(after, /- \[ \] T-1/, 'the other task is left alone');

  assert.equal((await post(server, { action: 'task.untick', id: '001', task: 'T-2' })).status, 200);
  assert.match(await readFile(tasksPath, 'utf8'), /- \[ \] T-2/);

  const missing = await post(server, { action: 'task.tick', id: '001', task: 'T-9' });
  assert.equal(missing.status, 400, 'a task that does not exist is not invented');
});

// --- The wizard, served beside the console ---

test('the wizard is served under the same secret path, so one tunnel reaches both', async () => {
  const root = await withFeature();
  const server = await serve(root);

  const page = await fetch(`${server.url}wizard`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /build your spec/i);
  assert.match(html, /Build from here/, 'the served form can hand the answers straight back');
  assert.ok(html.includes(server.control), 'and knows where to send them');

  const wrong = await fetch(`http://127.0.0.1:${server.port}/wizard`);
  assert.equal(wrong.status, 404, 'it is not reachable without the secret path');
});

test('answers sent from the form land where the CLI already looks for them', async () => {
  const root = await withFeature();
  const server = await serve(root);

  const response = await post(server, {
    action: 'requirements.save',
    requirements: { platform: 'web', appType: 'crud', licensing: 'permissive' },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.saved, 'specs/requirements.json');
  assert.deepEqual(JSON.parse(await read(root, 'specs/requirements.json')), { platform: 'web', appType: 'crud', licensing: 'permissive' });
});

test('the form cannot post something that is not a set of answers', async () => {
  const root = await withFeature();
  const server = await serve(root);

  for (const requirements of [undefined, 'platform=web', ['web'], 42]) {
    const response = await post(server, { action: 'requirements.save', requirements });
    assert.equal(response.status, 400, `${JSON.stringify(requirements)} is not an answer sheet`);
  }
});
