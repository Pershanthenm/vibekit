import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { parseIndex, renderIndex, scanStandards, selectStandards } from '../src/standards.js';

console.log = () => {};

const standard = (description, globs) => `---\ndescription: "${description}"\n${globs ? `globs: "${globs}"\n` : ''}---\n\n# Standard\n\n- A rule.\n`;

async function library() {
  const root = await mkdtemp(join(tmpdir(), 'vibecheck-standards-'));
  await mkdir(join(root, 'standards', 'api'), { recursive: true });
  await mkdir(join(root, 'standards', 'database'), { recursive: true });
  await writeFile(join(root, 'standards/api/response-format.md'), standard('API response envelope structure, status codes'));
  await writeFile(join(root, 'standards/api/error-handling.md'), standard('Error code conventions, exception handling', 'src/**/*Controller*'));
  await writeFile(join(root, 'standards/database/migrations.md'), standard('Migration safety, reversibility'));
  await writeFile(join(root, 'standards/naming-conventions.md'), standard('File, class and variable naming conventions'));
  return root;
}

test('standards are found in domain folders, with root reserved for the top level', async () => {
  const entries = await scanStandards(await library());
  const ids = entries.map((entry) => `${entry.domain}/${entry.name}`);

  assert.deepEqual(ids, ['api/error-handling', 'api/response-format', 'database/migrations', 'root/naming-conventions']);
  assert.equal(entries.find((entry) => entry.name === 'response-format').description, 'API response envelope structure, status codes');
});

test('the index round-trips through render and parse', async () => {
  const entries = await scanStandards(await library());
  const parsed = parseIndex(renderIndex(entries));

  assert.equal(parsed.length, entries.length);
  assert.deepEqual(parsed.map((entry) => entry.path), entries.map((entry) => entry.path));
  const errors = parsed.find((entry) => entry.name === 'error-handling');
  assert.equal(errors.description, 'Error code conventions, exception handling');
  assert.equal(errors.globs, 'src/**/*Controller*');
  assert.equal(parsed.find((entry) => entry.name === 'naming-conventions').path, 'standards/naming-conventions.md');
});

// The point of the index: read one small file, then load only what matches.
test('injection returns the relevant standards and leaves the rest alone', async () => {
  const entries = parseIndex(renderIndex(await scanStandards(await library())));

  const hits = selectStandards(entries, { query: 'add an error response to the orders API' });
  const names = hits.map((hit) => hit.name);
  assert.ok(names.includes('error-handling'), names.join(', '));
  assert.ok(names.includes('response-format'), names.join(', '));
  assert.ok(!names.includes('migrations'), 'an unrelated standard must not be injected');
});

test('a standard whose globs match a touched file always wins', async () => {
  const entries = parseIndex(renderIndex(await scanStandards(await library())));

  const hits = selectStandards(entries, { query: 'unrelated wording', paths: ['src/Web/OrdersController.cs'] });
  assert.equal(hits[0].name, 'error-handling');
  assert.equal(hits[0].matchedBy, 'globs');
});

test('no match returns nothing rather than injecting the whole library', async () => {
  const entries = parseIndex(renderIndex(await scanStandards(await library())));
  assert.deepEqual(selectStandards(entries, { query: 'kubernetes autoscaling' }), []);
});

test('vibecheck standards index writes the index, and inject reads it', async () => {
  const root = await library();
  await run(['standards', 'index', '--dir', root]);

  const index = await readFile(join(root, 'standards/index.yml'), 'utf8');
  assert.match(index, /^api:$/m);
  assert.match(index, /^ {2}response-format:$/m);
  assert.match(index, /^ {4}description: "API response envelope structure, status codes"$/m);
  assert.match(index, /^root:$/m, 'top-level standards are indexed under the reserved root key');
  assert.ok(index.indexOf('root:') > index.indexOf('database:'), 'root comes last so domains read first');

  await run(['standards', 'inject', 'error handling for the API', '--dir', root]);
});

// --paths must be a declared CLI option: parseArgs rejects unknown flags before the command runs.
test('the --paths flag reaches the command', async () => {
  const root = await library();
  await run(['standards', 'index', '--dir', root]);
  await run(['standards', 'inject', 'tidy up', '--paths', 'src/Web/OrdersController.cs', '--dir', root]);
});

test('indexing an empty library says so instead of writing a misleading index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibecheck-standards-'));
  await mkdir(join(root, 'standards'), { recursive: true });
  await run(['standards', 'index', '--dir', root]);

  await assert.rejects(readFile(join(root, 'standards/index.yml'), 'utf8'), /ENOENT/);
});
