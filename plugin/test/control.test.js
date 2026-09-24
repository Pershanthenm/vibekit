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
import { EXAMPLE, newProject, read } from './helpers.js';
import { generateFolder } from '../src/folder/generate.js';
import { claim, setStatus, writeSection } from '../src/folder/requirements.js';
import { listAsks, openAsk } from '../src/folder/asks.js';

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

const REQUIREMENT = `---
id: REQ-001
title: Cancel a booking
kind: requirement
size: M
status: ready
entities: [Booking]
source: BRS-001 §4.2
after: []
assumes: []
---

## Acceptance

- AC-1  When a booking is cancelled, the system shall set its status to \`cancelled\`.

## Security

Touches Booking.

## Approach

## Verification

## Review

## Log
`;

const withRequirement = async () => {
  const root = await newProject('--from', EXAMPLE);
  await generateFolder(root, { name: 'bookings', commands: { test: 't' }, entities: [{ name: 'Booking', class: 'internal' }] });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(root, 'vibekit/product/requirements/REQ-001.md'), REQUIREMENT);
  return root;
};
const withFeature = withRequirement;

// --- Who may write ---

test('the token is separate from the link: knowing the url is not enough to change anything', async () => {
  const root = await withRequirement();
  const server = await serve(root);
  const path = 'vibekit/product/requirements/REQ-001.md';
  const before = await read(root, path);

  for (const token of [null, secret(), `${server.token}x`, server.token.slice(0, -1)]) {
    const response = await post(server, { action: 'req.status', id: 'REQ-001', status: 'done' }, { token });
    assert.equal(response.status, 401, `a request with ${token ? 'the wrong token' : 'no token'} must be refused`);
  }
  assert.equal(await read(root, path), before, 'and nothing may have changed');
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
  const root = await withRequirement();
  const server = await serve(root);
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  const before = await readFile(path, 'utf8');

  // Nobody has reviewed it, which is exactly what `vibekit req done` refuses.
  const refused = await post(server, { action: 'req.status', id: 'REQ-001', status: 'done' });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.match(body.error, /## Review/, "the refusal says why, in the CLI's own words");
  assert.equal(await readFile(path, 'utf8'), before, 'a refused change writes nothing');

  // The same request is allowed once a reviewer has actually written a verdict and a mapping.
  await writeSection(root, 'REQ-001', 'Evidence', '- test exit 0');
  await writeSection(root, 'REQ-001', 'Review', 'approved');
  await writeSection(root, 'REQ-001', 'Verification', 'AC-1 → Cancel_AC1');
  const allowed = await post(server, { action: 'req.status', id: 'REQ-001', status: 'done' });
  assert.equal(allowed.status, 200);
  assert.match(await readFile(path, 'utf8'), /^status: done$/m, 'the board and the file agree, or the board is lying');
});

test('a status that is not one of ours is a bad request, not a new status', async () => {
  const root = await withRequirement();
  const server = await serve(root);

  const response = await post(server, { action: 'req.status', id: 'REQ-001', status: 'shipped' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not a status/);
});

test('the page cannot close a requirement an agent is still holding', async () => {
  const root = await withRequirement();
  await setStatus(root, 'REQ-001', 'in-progress', { by: 'agent' });
  await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'claude-code' });
  await writeSection(root, 'REQ-001', 'Evidence', '- test exit 0');
  await writeSection(root, 'REQ-001', 'Review', 'approved');
  await writeSection(root, 'REQ-001', 'Verification', 'AC-1 → t');
  const server = await serve(root);

  const refused = await post(server, { action: 'req.status', id: 'REQ-001', status: 'done' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /still held by implementer/);

  // Releasing is a move the page may make, and then closing is allowed.
  assert.equal((await post(server, { action: 'req.release', id: 'REQ-001' })).status, 200);
  assert.equal((await post(server, { action: 'req.status', id: 'REQ-001', status: 'done' })).status, 200);
});

test('answering an ask from the page writes the same files the CLI writes', async () => {
  const root = await withRequirement();
  await openAsk(root, {
    kind: 'question', stage: 1, by: 'analyst', ask: 'Who may cancel a booking?',
    why: 'It decides the policy.', plain: 'Who is allowed to cancel a booking?',
  });
  const server = await serve(root);

  const response = await post(server, { action: 'ask.answer', id: 'Q-001', answer: 'The member and any staff member.' });
  assert.equal(response.status, 200);
  const [ask] = await listAsks(root);
  assert.equal(ask.status, 'answered');
  assert.match(ask.answer, /any staff member/);
  assert.match(await readFile(join(root, 'vibekit/workflow/answers/1-answers.md'), 'utf8'), /any staff member/);
});

test('an answer with no words is refused, so an ask is never closed by an empty click', async () => {
  const root = await withRequirement();
  await openAsk(root, { kind: 'question', by: 'analyst', ask: 'Who may cancel?', why: 'Policy.', plain: 'Who can cancel?' });
  const server = await serve(root);
  assert.equal((await post(server, { action: 'ask.answer', id: 'Q-001', answer: '   ' })).status, 400);
});

// --- §57 actions beyond status: a note, a size, an added requirement ---

test('the page can add a requirement, size it and leave a note, through the same functions the CLI uses', async () => {
  const root = await withFeature();
  const server = await serve(root);

  const added = await post(server, { action: 'req.add', title: 'members can cancel a booking' });
  assert.equal(added.status, 200);
  const id = (await added.json()).result.id;
  assert.match(id, /^REQ-\d+$/);

  const sized = await post(server, { action: 'req.size', id, size: 'm' });
  assert.equal(sized.status, 200);
  assert.match(await read(root, `vibekit/product/requirements/${id}.md`), /^size: M$/m);

  const noted = await post(server, { action: 'note.add', id, text: 'talk to ops before building this' });
  assert.equal(noted.status, 200);
  assert.match(await read(root, `vibekit/product/requirements/${id}.md`), /## Notes\n\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+: talk to ops/);

  const bad = await post(server, { action: 'req.size', id, size: 'XL' });
  assert.equal(bad.status, 400);

  // A note on an ask finds the ask's file by its id, however the file was named.
  await openAsk(root, { kind: 'question', by: 'analyst', ask: 'Who may cancel?', why: 'Policy.', plain: 'Who can cancel?' });
  const onAsk = await post(server, { action: 'note.add', id: 'Q-001', text: 'ask ops' });
  assert.equal(onAsk.status, 200);
  const { readdir } = await import('node:fs/promises');
  const askFile = (await readdir(join(root, 'vibekit/workflow/asks'))).find((name) => name.startsWith('Q-001'));
  assert.match(await read(root, `vibekit/workflow/asks/${askFile}`), /## Notes\n\n- .*: ask ops/);
});
