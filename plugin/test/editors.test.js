// Choosing which editors a project carries adapters for.
//
// MULTI-EDITOR AC-7: given specs/project.json lists editors: ["claude", "antigravity"], when sync
// runs, then only those adapters are written.
//
// The part worth being careful about is not writing fewer files — it is taking the others away.
// Deleting something a person has edited because a list changed would be the worst thing this
// command could do, so that case is tested before the happy path.
//
// The paths below are the ones the adapters actually generate, read off them rather than assumed.
// Note the Claude adapter writes nothing unless `workflow.skills` is "project": by default its
// skills come from the installed plugin, so listing "claude" is about what is *not* written.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { exists } from '../src/fsutil.js';
import { editorsOf } from '../src/generators/index.js';
import { normalize, validate } from '../src/schema.js';
import { EXAMPLE, newProject, patchProject } from './helpers.js';

console.log = () => {};

const CURSOR = '.cursor/rules/vibecheck-workflow.mdc';
const ANTIGRAVITY = '.agents/rules/vibecheck-workflow.md';
const WINDSURF = '.windsurf/rules/vibecheck-workflow.md';

const has = (root, path) => exists(join(root, path));

// --- The default, and the migration path ---

test('a project that says nothing about editors gets all of them, as it always did', () => {
  assert.deepEqual(normalize({}).editors, ['claude', 'cursor', 'antigravity', 'windsurf']);
  assert.deepEqual(
    editorsOf({}),
    ['claude', 'cursor', 'antigravity', 'windsurf'],
    'a project.json written before the field existed keeps every adapter it already had',
  );
});

test('the list has to name editors that exist, and at least one of them', () => {
  assert.deepEqual(validate(normalize({ editors: ['claude', 'antigravity'] })).filter((error) => /editor/.test(error)), []);
  assert.match(validate(normalize({ editors: ['vim'] })).join('\n'), /unknown editors: vim/);
  assert.match(validate(normalize({ editors: [] })).join('\n'), /at least one editor/);
});

// --- AC-7 ---

test('only the listed adapters are written', async () => {
  const root = await newProject('--from', EXAMPLE);
  assert.ok(await has(root, CURSOR), 'every adapter is there to begin with');
  assert.ok(await has(root, WINDSURF));

  await patchProject(root, { editors: ['claude', 'antigravity'] });

  assert.ok(await has(root, ANTIGRAVITY), 'the editor it asked for stays');
  assert.equal(await has(root, CURSOR), false, 'and the ones it did not are gone');
  assert.equal(await has(root, WINDSURF), false);
});

test('AGENTS.md is written whatever the list says, because it is not an editor adapter', async () => {
  const root = await newProject('--from', EXAMPLE);

  await patchProject(root, { editors: ['claude'] });

  assert.ok(await has(root, 'AGENTS.md'), 'the project reads it, and so do people');
});

test('an adapter file you have edited is never deleted', async () => {
  const root = await newProject('--from', EXAMPLE);
  const mine = join(root, CURSOR);
  await writeFile(mine, 'my own rules, nothing generated about them');

  await patchProject(root, { editors: ['claude'] });

  assert.equal(await readFile(mine, 'utf8'), 'my own rules, nothing generated about them');
});

test('turning an editor back on writes its adapter again', async () => {
  const root = await newProject('--from', EXAMPLE);
  await patchProject(root, { editors: ['claude'] });
  assert.equal(await has(root, ANTIGRAVITY), false);

  await patchProject(root, { editors: ['claude', 'antigravity'] });

  assert.ok(await has(root, ANTIGRAVITY));
});

test('a file that is deliberately absent does not read as drift', async () => {
  const root = await newProject('--from', EXAMPLE);
  await patchProject(root, { editors: ['claude', 'antigravity'] });

  await run(['check', '--dir', root]);

  assert.notEqual(process.exitCode, 1, 'check must not report the adapters this project turned off');
  process.exitCode = 0;
});
