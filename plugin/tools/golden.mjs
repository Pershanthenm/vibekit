/**
 * The workflow fixtures' golden outputs. §32.  `npm run golden [-- --check]`
 *
 * Runs the three fixture briefs and writes fixtures/golden.json — the questions clarify raises,
 * the asks ingest opens, the check findings, the generated folder. `--check` compares instead of
 * writing and exits non-zero on a difference, which is how VibeKit's own CI sees a prompt edit as a
 * diff in expected questions rather than as a surprise on a customer's project.
 */
import { writeFile } from 'node:fs/promises';
import { GOLDEN_PATH, compareRuns, readGolden, runAll, snapshot, unchanged } from '../src/fixtures.js';

const check = process.argv.includes('--check');
const runs = await runAll();
const fresh = Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, snapshot(run)]));

if (!check) {
  await writeFile(GOLDEN_PATH, `${JSON.stringify(fresh, null, 2)}\n`);
  console.log(`✔ ${GOLDEN_PATH}`);
  for (const [name, run] of Object.entries(fresh)) console.log(`  ${name.padEnd(8)} ${run.sections} section(s) · ${run.statements} obligation(s) · ${run.gaps.length} gap(s) · ${run.asks.length} ask(s) · ${run.findings.length} finding(s) · ${run.files.length} file(s)`);
  process.exit(0);
}

const golden = await readGolden();
if (!golden) { console.error('No fixtures/golden.json yet. Run `npm run golden` once to write it.'); process.exit(1); }
let failed = false;
for (const [name, run] of Object.entries(fresh)) {
  const diff = compareRuns(golden[name] ?? {}, run);
  if (unchanged(diff)) { console.log(`✔ ${name}: unchanged`); continue; }
  failed = true;
  console.log(`✖ ${name}: the fixture moved`);
  for (const key of ['gaps', 'asks', 'findings', 'files']) {
    for (const item of diff[key].added) console.log(`    + ${key}: ${item}`);
    for (const item of diff[key].removed) console.log(`    - ${key}: ${item}`);
  }
}
if (failed) console.log('\n  A prompt or check changed what a brief is asked about. If that is intended, `npm run golden` records it.');
process.exit(failed ? 1 : 0);
