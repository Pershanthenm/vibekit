import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { after, test } from 'node:test';
import { run } from '../src/cli.js';
import { DEFAULT_PORT, serveDashboard } from '../src/commands/dashboard.js';
import { newProject, read, tempDir, writeFileIn } from './helpers.js';

const open = [];
const serve = async (root, options = {}) => {
  const server = await serveDashboard(root, { port: 0, ...options });
  open.push(server);
  return server;
};
after(() => Promise.all(open.map((server) => server.close())));

const get = async (url) => {
  const response = await fetch(url);
  return { status: response.status, body: await response.text(), headers: response.headers };
};

test('the served page is the dashboard', async () => {
  const root = await newProject('--yes');
  const { body, status, headers } = await get((await serve(root)).url);

  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /text\/html/);
  assert.match(body, /<!doctype html>/i);
  assert.match(body, /Overview/);
});

// The whole reason for serving. The written file only changes while a long command happens to be
// running, so a page watching it can sit refreshing stale HTML for as long as you like.
test('every request renders current state, not a cached copy', async () => {
  const root = await newProject('--yes');
  const { url } = await serve(root);

  const before = await get(url);
  assert.doesNotMatch(before.body, /Device register/);

  await run(['feature', '--dir', root, 'Device register']);

  const after = await get(url);
  assert.match(after.body, /Device register/, 'a feature added after the server started must appear');
});

test('nothing is cached between the server and the browser', async () => {
  const root = await newProject('--yes');
  const { headers } = await get((await serve(root)).url);
  assert.match(headers.get('cache-control'), /no-store/);
});

// Serving must not do what writing does: a generated file in the tree makes `merge` refuse to run
// and makes the evidence gate record a dirty commit.
test('serving writes no file into the project', async () => {
  const root = await newProject('--yes');
  const before = (await readdir(root)).sort();

  const { url } = await serve(root);
  await get(url);

  assert.deepEqual((await readdir(root)).sort(), before, 'serving must leave the working tree alone');
});

// The page carries feature titles and blocker text, and blockers quote file paths and review
// comments. Reaching the network has to be something you asked for.
test('it binds to loopback unless asked otherwise', async () => {
  const root = await newProject('--yes');
  const { url } = await serve(root);
  assert.match(url, /^http:\/\/127\.0\.0\.1:/);
});

test('a project that cannot be read shows a page, and the server stays up', async () => {
  const root = await newProject('--yes');
  const healthy = await read(await newProject('--yes'), 'specs/project.json');
  const { url } = await serve(root);
  writeFileIn(root, 'specs/project.json', '{ not json');

  const broken = await get(url);
  assert.equal(broken.status, 503, 'an unreadable project is not a 200');
  assert.match(broken.body, /Waiting for a readable project/);
  assert.match(broken.body, /vibekit check/, 'it has to say how to fix it');

  // Repair it and the same server recovers without a restart.
  writeFileIn(root, 'specs/project.json', healthy);
  assert.equal((await get(url)).status, 200, 'the server must recover, not stay broken');
});

test('a folder with no project serves the waiting page rather than crashing', async () => {
  const { url } = await serve(tempDir('vc-noproject-'));
  const { status, body } = await get(url);
  assert.equal(status, 503);
  assert.match(body, /Waiting for a readable project/);
});

test('the default port is stable, so the URL does not move between runs', () => {
  assert.equal(DEFAULT_PORT, 7332);
});

test('a nonsense port is refused with a message, not a stack trace', async () => {
  const root = await newProject('--yes');
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    await run(['dashboard', '--dir', root, '--serve', '--port', 'seventy']);
  } finally {
    console.error = original;
    process.exitCode = 0;
  }
  assert.match(errors.join('\n'), /--port must be a number/);
});

test('a port already in use is reported clearly', async () => {
  const root = await newProject('--yes');
  const taken = await serve(root);

  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    await run(['dashboard', '--dir', root, '--serve', '--port', String(taken.port)]);
  } finally {
    console.error = original;
    process.exitCode = 0;
  }
  assert.match(errors.join('\n'), /already in use/);
  assert.match(errors.join('\n'), /--port/, 'it must say how to pick another');
});
