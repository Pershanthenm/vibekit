#!/usr/bin/env node
// Run the whole suite several times over. One green run says the tests passed once; it says
// nothing about whether they pass reliably, and an intermittent failure that slips through here
// becomes a red CI someone else has to chase.
//
// This is the rule the evidence gate applies to projects vibecheck builds, applied to vibecheck
// itself: a suite that passes sometimes is not a passing suite.

import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import process from 'node:process';

const runs = Number(process.argv[2] ?? 3);
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`Usage: node scripts/repeat-tests.js [runs]   (got "${process.argv[2]}")`);
  process.exit(2);
}

// Expanded here rather than by the shell, so this behaves the same on every OS.
const files = globSync('test/*.test.js').sort();
if (!files.length) {
  console.error('No test files found under test/.');
  process.exit(2);
}

const failures = [];
for (let attempt = 1; attempt <= runs; attempt += 1) {
  const started = Date.now();
  console.log(`\n=== run ${attempt}/${runs} — ${files.length} files ===`);
  const status = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`=== run ${attempt}/${runs}: ${status === 0 ? 'pass' : 'FAIL'} in ${seconds}s ===`);
  if (status !== 0) failures.push(attempt);
}

const passed = runs - failures.length;
console.log(`\n${passed}/${runs} runs passed.`);
if (!failures.length) {
  console.log('Clean: the suite passed every time.');
  process.exit(0);
}
// Telling the two apart matters: a flake and a consistent break need different fixes.
console.log(failures.length === runs
  ? 'Broken: the suite failed every time. Fix the failure.'
  : `Flaky: failed on run(s) ${failures.join(', ')}. An intermittent failure is still a failure — fix it rather than re-running until it comes out green.`);
process.exit(1);
