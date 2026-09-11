import { analyzeFeature } from '../analyze.js';
import { findFeature, listFeatures } from '../features.js';
import { loadProject } from '../project.js';
import { traceFeature } from '../verify.js';

const LABELS = {
  untasked: 'Acceptance criteria with no task',
  'orphan-task': 'Tasks that do not line up with the spec',
  unplanned: 'Missing or unfinished plan',
  vague: 'Not decided yet',
  'parallel-clash': 'Parallel tasks that share files',
  empty: 'Missing artefacts',
  untested: 'Acceptance criteria with no test',
};

async function reportFor(root, feature) {
  const report = analyzeFeature(feature);
  const trace = await traceFeature(root, feature);
  for (const criterion of trace.missing) {
    report.problems.push({ kind: 'untested', feature: feature.id, message: `AC-${criterion} has no test naming it` });
  }
  report.tested = trace.covered.length;
  return report;
}

function print(report) {
  const { criteria, covered, tasks, tested, taskProgress } = report;
  console.log(`\n${report.feature} [${report.status}] — ${covered}/${criteria} criteria have tasks, ${tested}/${criteria} have tests, tasks ${taskProgress.done}/${tasks}`);
  if (!report.problems.length) return console.log('  ✔ spec, plan, tasks and tests agree');

  const byKind = new Map();
  for (const problem of report.problems) byKind.set(problem.kind, [...(byKind.get(problem.kind) ?? []), problem]);
  for (const [kind, problems] of byKind) {
    console.log(`  ${LABELS[kind] ?? kind}:`);
    for (const problem of problems) console.log(`    ✖ ${problem.message}`);
  }
}

export async function analyze({ root, args, json }) {
  await loadProject(root);
  const features = await listFeatures(root);
  if (!features.length) {
    if (json) return console.log(JSON.stringify({ features: [], problems: [] }, null, 2));
    return console.log('No features yet. Create one with "vibecheck feature \'<name>\'".');
  }

  const chosen = args[0] ? [findFeature(features, args[0])] : features;
  const reports = [];
  for (const feature of chosen) reports.push(await reportFor(root, feature));
  const problems = reports.flatMap((report) => report.problems);

  if (json) return console.log(JSON.stringify({ features: reports, problems }, null, 2));

  reports.forEach(print);
  if (!problems.length) {
    console.log('\n✔ Every feature is internally consistent.');
    return;
  }
  console.log(`\n${problems.length} problem(s) across ${new Set(problems.map((problem) => problem.feature)).size} feature(s).`);
  console.log('These are contradictions between the spec, the plan, the tasks and the tests — fix the artefacts, not the report.');
  process.exitCode = 1;
}
