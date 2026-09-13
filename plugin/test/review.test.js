import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { repoState } from '../src/evidence.js';
import { parseReview, reviewPath } from '../src/review.js';
import { PASSING_SUITES, TOOL_FREE_PATH, commitAll, fillSpec, gitInit, newProject, patchProject, restoreEnv, setDocsEnabled, writeTracedTests } from './helpers.js';

console.log = () => {};

const ORIGINAL_ENV = { ...process.env };
beforeEach(async () => {
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'vc-home-'));
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  process.env.PATH = TOOL_FREE_PATH;
});
afterEach(() => {
  restoreEnv(ORIGINAL_ENV);
  process.exitCode = 0;
});

const FEATURE = '001-assign-laptop';

/** A feature that satisfies every other done gate: criteria ticked, tests traced, suites passing. */
async function readyToFinish() {
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await run(['feature', '--dir', root, 'Assign laptop']);
  await fillSpec(root, FEATURE, { tasks: ['- [x] T-1 [impl] assign (AC-1) — src/assign.ts'] });
  const spec = join(root, 'specs/features', FEATURE, 'spec.md');
  await writeFile(spec, (await readFile(spec, 'utf8')).replaceAll('- [ ]', '- [x]'));
  for (const status of ['approved', 'planned', 'in-progress']) await run(['status', '--dir', root, '001', status]);
  await writeTracedTests(root, FEATURE, [1]);
  await patchProject(root, PASSING_SUITES);
  gitInit(root);
  await run(['verify', '--dir', root, '001', '--run']);
  return root;
}

async function recordReview(root, { verdict = 'approved', commit, findings = '' } = {}) {
  const sha = commit ?? repoState(root).commit;
  await writeFile(reviewPath(root, FEATURE), `---\nverdict: ${verdict}\ncommit: ${sha}\nreviewer: A. Reviewer\n---\n\n## Findings\n\n${findings}\n`);
  commitAll(root, 'chore: record review');
}

test('every new feature is scaffolded with a review file', async () => {
  const root = await newProject('--yes');
  await run(['feature', '--dir', root, 'Assign laptop']);

  assert.ok(existsSync(reviewPath(root, FEATURE)), 'review.md is missing');
  const review = parseReview(await readFile(reviewPath(root, FEATURE), 'utf8'));
  assert.equal(review.verdict, 'changes-requested', 'a feature starts unreviewed, not approved');
  assert.equal(review.open, 0, 'the empty template placeholders are not findings');
});

// The point of the gate: passing tests are not the same as a reviewed change.
test('a feature that passes every other gate still cannot be done without a review', async () => {
  const root = await readyToFinish();
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /review:/);
});

test('an approved review for the reviewed commit lets the feature finish', async () => {
  const root = await readyToFinish();
  await recordReview(root);
  await run(['verify', '--dir', root, '001', '--run']);

  await run(['status', '--dir', root, '001', 'done']);
  assert.match(await readFile(join(root, 'specs/features', FEATURE, 'spec.md'), 'utf8'), /^status: done$/m);
});

test('a review of older code does not count', async () => {
  const root = await readyToFinish();
  await recordReview(root, { commit: '0000000000000000000000000000000000000000' });
  await run(['verify', '--dir', root, '001', '--run']);

  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /review: code changed since it was reviewed/);
});

test('changes-requested blocks, and so does an unresolved blocker on an approved review', async () => {
  const root = await readyToFinish();
  await recordReview(root, { verdict: 'changes-requested' });
  await run(['verify', '--dir', root, '001', '--run']);
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /review: the reviewer asked for changes/);

  await recordReview(root, { verdict: 'approved', findings: '- [ ] BLOCKER: no authorisation check on the assign endpoint' });
  await run(['verify', '--dir', root, '001', '--run']);
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /review: 1 blocking finding/);
});

test('a missing verdict is reported rather than assumed to be approval', async () => {
  const root = await readyToFinish();
  await writeFile(reviewPath(root, FEATURE), '# Review\n\nLooked fine to me.\n');
  commitAll(root, 'chore: unstructured review');
  await run(['verify', '--dir', root, '001', '--run']);

  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /review: review\.md has no verdict/);
});

test('teams that review elsewhere can turn the gate off', async () => {
  const root = await readyToFinish();
  await patchProject(root, { workflow: { review: false } });
  commitAll(root, 'chore: review off');
  await run(['verify', '--dir', root, '001', '--run']);

  await run(['status', '--dir', root, '001', 'done']);
  assert.match(await readFile(join(root, 'specs/features', FEATURE, 'spec.md'), 'utf8'), /^status: done$/m);
});
