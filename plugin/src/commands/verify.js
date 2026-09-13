import { findFeature, listFeatures } from '../features.js';
import { repoState, runCountOf, runSuites, runsFor, saveEvidence, SUITE_NAMES } from '../evidence.js';
import { loadProject } from '../project.js';
import { testReference, traceFeature } from '../verify.js';

const TRACKED = ['in-progress', 'done'];

async function targets(root, query) {
  const features = await listFeatures(root);
  return query ? [findFeature(features, query)] : features.filter((feature) => TRACKED.includes(feature.status));
}

function printTrace(feature, trace) {
  console.log(`\n${feature.id} [${feature.status}] — ${trace.covered.length}/${trace.covered.length + trace.missing.length} criteria traced to tests`);
  trace.covered.forEach(({ criterion, files }) => console.log(`  ✔ AC-${criterion}  ${files.join(', ')}`));
  trace.missing.forEach((criterion) => console.log(`  ✖ AC-${criterion}  no test named "${testReference(feature, criterion)} …"`));
  trace.orphans.forEach((criterion) => console.log(`  ! ${testReference(feature, criterion)} is referenced by a test but not in the spec`));
}

async function recordRun(root, traces, results) {
  const state = repoState(root);
  const passed = results.every((result) => result.ok) && traces.every(({ trace }) => !trace.missing.length);
  console.log(`\n${results.map((result) => {
    const { runs, passed: green, flaky } = runCountOf(result);
    return `${flaky ? '⚠' : result.ok ? '✔' : '✖'} ${SUITE_NAMES[result.suite]}${runs > 1 ? ` ${green}/${runs}` : ''}`;
  }).join('  ')}`);
  // Naming the flakes separately: they are the results people most often skim past as "passed".
  const flakes = results.filter((result) => result.flaky);
  flakes.forEach((result) => console.log(`⚠ ${SUITE_NAMES[result.suite]} is flaky — ${result.passed} of ${result.runs} runs passed. This will not count as evidence.`));
  if (!state) return console.log('! Not a git repository: results are not recorded as evidence (git init to enable).');
  for (const { feature } of traces) {
    await saveEvidence(root, feature.id, { commit: state.commit, dirty: state.dirty, suites: results });
  }
  console.log(state.dirty ? '! Uncommitted changes: evidence recorded but will not count. Commit, then run again.' : `✔ Evidence recorded for commit ${state.commit.slice(0, 8)}`);
}

export async function verify({ root, args, run: shouldRun, json, repeat }) {
  const project = await loadProject(root);
  const runs = repeat === undefined ? runsFor(project) : Number(repeat);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--repeat must be a positive whole number, got "${repeat}"`);
  const features = await targets(root, args[0]);
  const traces = await Promise.all(features.map(async (feature) => ({ feature, trace: await traceFeature(root, feature) })));
  if (json) console.log(JSON.stringify(traces.map(({ trace }) => trace), null, 2));
  else traces.forEach(({ feature, trace }) => printTrace(feature, trace));
  const untraced = traces.some(({ trace }) => trace.missing.length);
  const results = shouldRun ? runSuites(project, root, { runs }) : [];
  if (shouldRun) await recordRun(root, traces, results);
  if (untraced || results.some((result) => !result.ok)) process.exitCode = 1;
}
