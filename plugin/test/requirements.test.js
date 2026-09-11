import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { extractRequirements, readiness, renderCriteria } from '../src/requirements.js';
import { newProject } from './helpers.js';

console.log = () => {};

const DOC = `# Device register

## Intake
- The operator must record a laptop with its serial so that it is tracked.
- A user must not create a duplicate serial; the system rejects it.
- Asset tags should be easy to enter.

## Reporting
- Reports should be fast.
- TODO decide whether cost is stored.
`;

test('requirements are read from bullets, with the heading they sat under', () => {
  const found = extractRequirements(DOC);

  assert.equal(found.length, 5);
  assert.equal(found[0].section, 'Intake');
  assert.equal(found[3].section, 'Reporting');
  assert.match(found[0].statement, /^The operator must record a laptop/);
  assert.equal(found[0].line, 4, 'the line number is kept so a person can find it again');
});

test('a numbered list and plain sentences are read too', () => {
  const found = extractRequirements('1. The user must sign in so that the system records who acted.\nThe service shall reject an expired token and log the attempt.\n');
  assert.equal(found.length, 2);
});

// The point: say which lines cannot be tested, and why, in words someone can act on.
test('untestable requirements are identified with a reason', () => {
  const found = extractRequirements(DOC);
  const vague = found.find((requirement) => requirement.statement.startsWith('Asset tags'));
  const undecided = found.find((requirement) => requirement.statement.startsWith('TODO'));

  assert.equal(vague.testable, false);
  assert.ok(vague.problems.some((problem) => /unmeasurable/.test(problem)), vague.problems.join('; '));
  assert.ok(undecided.problems.some((problem) => /not decided yet/.test(problem)));

  const good = found.find((requirement) => requirement.statement.startsWith('The operator'));
  assert.equal(good.testable, true, good.problems.join('; '));
});

test('readiness says whether the document is a good starting point', () => {
  assert.equal(readiness(extractRequirements(DOC)).detailed, false, 'three of five untestable is thin');

  const solid = extractRequirements([
    '- The user must see an error when the serial is a duplicate so that it is not created.',
    '- The admin must be able to delete a device so that the register records the removal.',
    '- The operator must scan a tag so that the device is shown.',
  ].join('\n'));
  assert.equal(readiness(solid).detailed, true);
  assert.equal(readiness([]).detailed, false);
});

test('vague requirements are kept and marked, never dropped', () => {
  const rendered = renderCriteria(extractRequirements(DOC));

  assert.equal(rendered.split('\n').length, 5, 'every requirement becomes a criterion');
  assert.match(rendered, /- \[ \] AC-1: The operator must record/);
  assert.match(rendered, /AC-3: Asset tags[\s\S]*TODO\(unknown\)/, 'a vague one is marked, not discarded');
  assert.doesNotMatch(rendered.split('\n')[0], /TODO\(unknown\)/, 'a testable one carries no marker');
});

test('vibecheck feature --from seeds the spec from a requirements document', async () => {
  const root = await newProject('--yes');
  const doc = join(await mkdtemp(join(tmpdir(), 'vc-reqs-')), 'requirements.md');
  await writeFile(doc, DOC);

  await run(['feature', '--dir', root, 'Device register', '--from', doc]);

  const spec = await readFile(join(root, 'specs/features/001-device-register/spec.md'), 'utf8');
  assert.match(spec, /AC-1: The operator must record a laptop/);
  assert.match(spec, /AC-5: TODO decide whether cost is stored/);
  assert.match(spec, /TODO\(unknown\)/, 'the gaps travel into the spec so they cannot be forgotten');
});

test('a document with no requirements says so instead of writing an empty spec', async () => {
  const root = await newProject('--yes');
  const doc = join(await mkdtemp(join(tmpdir(), 'vc-reqs-')), 'empty.md');
  await writeFile(doc, '# Notes\n\nSome prose that asks for nothing.\n');

  await run(['feature', '--dir', root, 'Device register', '--from', doc]);
  const spec = await readFile(join(root, 'specs/features/001-device-register/spec.md'), 'utf8');
  assert.match(spec, /AC-1: TODO/, 'the untouched template remains');
});

test('an unreadable requirements file is reported, not ignored', async () => {
  const root = await newProject('--yes');
  await assert.rejects(run(['feature', '--dir', root, 'Device register', '--from', join(root, 'nope.md')]), /cannot read/);
});
