import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { closestCommand, startScreen, unknownCommand } from '../src/guide.js';
import { exitCodeOf, newProject, tempDir } from './helpers.js';

process.env.VIBEKIT_NO_OPEN = '1';

const COMMANDS = ['init', 'adopt', 'dashboard', 'wizard', 'check', 'verify', 'list', 'health', 'merge'];

const quietly = async (work) => {
  const original = console.log;
  console.log = () => {};
  try {
    return await work();
  } finally {
    console.log = original;
  }
};

// The bug this replaced: a mistyped command printed the help and exited 0, so a script — or a
// person skimming — could not tell a typo from a successful run.
test('an unknown command fails, and says so', async () => {
  assert.equal(await exitCodeOf(['dashbaord']), 1);
});

test('a near miss suggests the command that was meant', () => {
  assert.equal(closestCommand('dashbaord', COMMANDS), 'dashboard');
  assert.equal(closestCommand('verfiy', COMMANDS), 'verify');
  assert.equal(closestCommand('helth', COMMANDS), 'health');
  assert.match(unknownCommand('dashbaord', COMMANDS), /Did you mean .*dashboard/);
});

// A wrong guess is worse than none: it sends someone off to read about the wrong thing.
test('something unrelated gets no guess', () => {
  assert.equal(closestCommand('deploy', COMMANDS), null);
  const message = unknownCommand('deploy', COMMANDS);
  assert.match(message, /no such command "deploy"/);
  assert.doesNotMatch(message, /Did you mean/);
});

test('an empty folder is told where to start, not handed every command', async () => {
  const screen = await startScreen(tempDir('vc-empty-'));

  assert.match(screen, /No project here yet/);
  assert.match(screen, /vibekit wizard/);
  assert.match(screen, /vibekit init/);
  assert.doesNotMatch(screen, /vibekit dispatch/, 'dispatch is meaningless before a project exists');
  assert.doesNotMatch(screen, /vibekit merge/);
});

// Suggesting `init` over a real codebase invites someone to scaffold on top of their own work.
test('a folder that already has code is offered adopt first', async () => {
  const root = tempDir('vc-code-');
  await writeFile(join(root, 'package.json'), '{"name":"legacy"}');

  const screen = await startScreen(root);
  assert.match(screen, /There is code here/);
  assert.ok(screen.indexOf('vibekit adopt') < screen.indexOf('vibekit init'), 'adopt must come first');
  assert.match(screen, /Not sure\? Run vibekit adopt/);
});

test('a real project is told what to do next, with the command to run', async () => {
  const root = await newProject('--yes');
  const screen = await startScreen(root);

  assert.match(screen, /0 features · 0 done/);
  assert.match(screen, /Do this next/);
  assert.match(screen, /Also useful/);
  assert.match(screen, /vibekit dashboard/);
});

test('a project with features reports how many, and how many are done', async () => {
  const root = await newProject('--yes');
  await quietly(() => run(['feature', '--dir', root, 'Device register']));

  const screen = await startScreen(root);
  assert.match(screen, /1 feature · 0 done/, 'one feature must not read as "1 features"');
});

// Output gets piped into files, CI logs and other tools; escape codes would end up in all three.
test('no colour escapes when nothing is watching', async () => {
  const screen = await startScreen(tempDir('vc-plain-'));
  assert.doesNotMatch(screen, new RegExp(String.fromCharCode(27)), 'ANSI codes must not reach a pipe');
});

test('an unreadable project says so rather than crashing', async () => {
  const root = await newProject('--yes');
  await writeFile(join(root, 'specs/project.json'), '{ not json');

  const screen = await startScreen(root);
  assert.match(screen, /could not be read/);
  assert.match(screen, /vibekit check/);
});
