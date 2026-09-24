import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIEFS, compareRuns, readGolden, runBrief, snapshot, unchanged } from '../src/fixtures.js';
import './helpers.js';

/**
 * §32 — the three fixture briefs against their golden outputs, in VibeKit's own CI. A prompt or
 * check edit that changes what a brief is asked about fails here as a diff in expected questions,
 * and `npm run golden` records it once somebody has read the diff and agreed.
 */
test('the three fixture briefs still produce their golden questions, findings and folder', async () => {
  const golden = await readGolden();
  assert.ok(golden, 'fixtures/golden.json exists — `npm run golden` writes it');
  for (const name of Object.keys(BRIEFS)) {
    const run = await runBrief(name);
    const diff = compareRuns(golden[name], snapshot(run));
    assert.ok(unchanged(diff), `${name} moved:\n${JSON.stringify(diff, null, 2)}\nIf that is intended: npm run golden`);
  }
});

test('the ugly brief is ugly on purpose: no sections, a wish, a TBD, and two things to redact', async () => {
  const golden = await readGolden();
  const ugly = golden.ugly;
  assert.equal(ugly.sections, 0);
  assert.ok(ugly.gaps.some((line) => /numbered sections/.test(line)));
  assert.ok(ugly.gaps.some((line) => /"fast", "secure" or "easy"/.test(line)));
  assert.ok(ugly.gaps.some((line) => /still to be decided/.test(line)));
  assert.ok(ugly.gaps.some((line) => /2 thing\(s\) that must be redacted/.test(line)));
  assert.equal(golden.small.gaps.length, 0, 'the small brief is clean');
  assert.ok(golden.medium.obligations.length >= 8);
});
