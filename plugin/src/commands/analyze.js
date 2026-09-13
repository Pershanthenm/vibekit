import { join } from 'node:path';
import { analyzeFeature, appendTasks, tasksForGaps } from '../analyze.js';
import { writeText } from '../fsutil.js';
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
  report.untested = trace.missing;
  return report;
}

/**
 * The gap the report could only describe: acceptance criteria with no task, and criteria with no
 * test, written into tasks.md as work. Everything else analyze finds is a contradiction between
 * artefacts, which a person has to settle — see tasksForGaps.
 */
async function appendMissingWork(root, features, reports) {
  const added = [];
  for (const feature of features) {
    const report = reports.find((entry) => entry.feature === feature.id);
    const lines = tasksForGaps(feature, { untasked: report.untasked, untested: report.untested });
    if (!lines.length) continue;
    await writeText(join(feature.dir, 'tasks.md'), appendTasks(feature.tasks, lines));
    added.push({ feature: feature.id, lines });
  }
  return added;
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

export async function analyze({ root, args, json, fix }) {
  await loadProject(root);
  const features = await listFeatures(root);
  if (!features.length) {
    if (json) return console.log(JSON.stringify({ features: [], problems: [] }, null, 2));
    return console.log('No features yet. Create one with "vibekit feature \'<name>\'".');
  }

  const chosen = args[0] ? [findFeature(features, args[0])] : features;
  const reports = [];
  for (const feature of chosen) reports.push(await reportFor(root, feature));
  const problems = reports.flatMap((report) => report.problems);
  const added = fix ? await appendMissingWork(root, chosen, reports) : [];

  if (json) return console.log(JSON.stringify({ features: reports, problems, added }, null, 2));

  reports.forEach(print);
  if (added.length) {
    const total = added.reduce((count, entry) => count + entry.lines.length, 0);
    console.log(`
${total} task(s) appended:`);
    for (const entry of added) for (const line of entry.lines) console.log(`  ${entry.feature}  ${line}`);
    console.log('Each needs the files it touches (`— path/a, path/b`) before lanes can be dispatched; rerun analyze to see which.');
  }
  if (!problems.length) {
    console.log('\n✔ Every feature is internally consistent.');
    return;
  }
  console.log(`\n${problems.length} problem(s) across ${new Set(problems.map((problem) => problem.feature)).size} feature(s).`);
  console.log('These are contradictions between the spec, the plan, the tasks and the tests — fix the artefacts, not the report.');
  process.exitCode = 1;
}
