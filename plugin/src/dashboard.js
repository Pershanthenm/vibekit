// A page you can leave open while the project builds itself: where every feature sits in the
// lifecycle, which gates are blocking, which lanes are running, and what happens next.
//
// One collector and one renderer, deliberately. The same state feeds the local file the CLI
// opens during a long job and any copy published elsewhere, so the two can never disagree.

import { join } from 'node:path';
import { designProblems } from './design.js';
import { definedSuites, evidenceProblems, loadEvidence, repoState, runCountOf, runsFor, stateDir } from './evidence.js';
import { traceFeature } from './verify.js';
import { checkFeature, listFeatures, progress } from './features.js';
import { filesOfTask, parseTasks, planLanes, readyParallelTasks } from './lanes.js';
import { loadManifest } from './manifest.js';
import { nextAction } from './next.js';
import { isDraining, readQueue } from './queue.js';
import { reviewProblems } from './review.js';
export { renderDashboard } from './dashboard-view.js';

/**
 * A generated page must never dirty the working tree: `merge` refuses to run on a dirty tree and
 * the evidence gate records one, so an untracked status.html in specs/ would quietly block the
 * very lifecycle it reports on. .git/vibekit/ is outside the tree and shared across worktrees,
 * which is also what the evidence records use.
 */
export function dashboardPath(root) {
  try {
    return stateDir(root, 'status.html');
  } catch {
    return join(root, '.vibekit', 'status.html');
  }
}

// Traceability is the one gate with no module of its own: checkFeature already reports a
// criterion with no task, which is exactly what it means for a feature to be untraceable.
const traceProblems = async (root, project, feature) => (project.workflow.traceability
  ? checkFeature(feature).filter((problem) => /AC-|traceab/i.test(problem))
  : []);

const GATES = [
  { id: 'traceability', label: 'Traceability', problems: traceProblems },
  { id: 'evidence', label: 'Evidence', problems: evidenceProblems },
  { id: 'review', label: 'Review', problems: reviewProblems },
  { id: 'design', label: 'Design', problems: designProblems },
];

// A gate switched off in project.json is not "passing" — it is not in play, and saying so is
// the difference between an honest board and a misleading one.
const gateEnabled = (id, project) => (id === 'design' ? project.workflow.design && project.docs.enabled : project.workflow[id]);

// `repo` is read once per collection and handed to every gate that wants it. Each git call is a
// process launch, and doing it per gate per feature is what a page refreshing every second turns
// into a machine that cannot answer.
async function gatesFor(root, project, feature, repo) {
  return Promise.all(GATES.map(async (gate) => {
    if (!gateEnabled(gate.id, project)) return { id: gate.id, label: gate.label, state: 'off', problems: [] };
    const problems = await gate.problems(root, project, feature, repo).catch((error) => [`${gate.id}: ${error.message}`]);
    return { id: gate.id, label: gate.label, state: problems.length ? 'blocked' : 'ok', problems };
  }));
}

async function lanesFor(root, project, feature) {
  const manifest = await loadManifest(root, feature.id).catch(() => null);
  if (manifest) {
    return manifest.lanes.map((lane) => ({
      name: lane.name,
      state: lane.state,
      tasks: lane.tasks,
      detail: `${lane.engine ?? 'agent'} · ${lane.commits ?? 0} commits`,
    }));
  }
  // Nothing dispatched yet: show what would run, so the parallelism is visible before it starts.
  return planLanes(readyParallelTasks(parseTasks(feature.tasks)), project.workflow.maxLanes)
    .map((lane) => ({ name: lane.name, state: 'ready', tasks: lane.tasks.map((task) => task.id), detail: `${project.workflow.engine} · not dispatched` }));
}

/**
 * What the tests actually say about this feature: the last recorded run of each suite, whether
 * that run still describes the current commit, and how many acceptance criteria are proven by a
 * test. A suite with no evidence is reported as such — never as an absence of bad news.
 */
async function testsFor(root, project, feature, head) {
  const evidence = await loadEvidence(root, feature.id).catch(() => null);
  const trace = await traceFeature(root, feature).catch(() => ({ covered: [], missing: [], orphans: [] }));
  const recorded = new Map((evidence?.suites ?? []).map((result) => [result.suite, result]));
  const suites = definedSuites(project).map((suite) => {
    const result = recorded.get(suite);
    if (!result) return { suite, state: 'missing', command: project.commands[suite], runs: 0, passed: 0, seconds: 0 };
    const { runs, passed, flaky } = runCountOf(result);
    return {
      suite,
      state: flaky ? 'flaky' : result.ok ? 'ok' : 'failed',
      command: result.command,
      runs,
      passed,
      seconds: result.seconds ?? 0,
    };
  });
  return {
    suites,
    required: runsFor(project),
    at: evidence?.at ?? null,
    commit: evidence?.commit ?? null,
    dirty: Boolean(evidence?.dirty),
    // Evidence taken against a different commit describes code that no longer exists.
    stale: Boolean(evidence?.commit && head && evidence.commit !== head),
    trace: { covered: trace.covered.length, missing: trace.missing, orphans: trace.orphans ?? [] },
  };
}

const TEST_STATES = ['ok', 'flaky', 'failed', 'missing'];

/** One line for the top of the page: how much of the test story is actually good news. */
function testSummary(features) {
  const suites = features.flatMap((feature) => feature.tests.suites);
  const counts = Object.fromEntries(TEST_STATES.map((state) => [state, suites.filter((suite) => suite.state === state).length]));
  return {
    ...counts,
    suites: suites.length,
    stale: features.filter((feature) => feature.tests.stale).length,
    untraced: features.reduce((total, feature) => total + feature.tests.trace.missing.length, 0),
  };
}

// `- [ ] T-4 [impl] Build the revoke endpoint (AC-2) — src/routes/devices.js` is a line a person
// wrote for another person, and it reads perfectly well once the notation is lifted off it. This
// takes it apart so the page can show the sentence, and put the id, the kind, the criteria and the
// files where they belong — rather than printing the raw line and calling it a task list.
const KIND = /\[(test|impl|docs)\]/i;
const CRITERIA = /\(AC-([\d,\s-]+)\)/i;

function describeTasks(text) {
  return parseTasks(text ?? '').map((task) => {
    const files = filesOfTask(task);
    const criteria = (task.text.match(CRITERIA)?.[1] ?? '').split(/[,\s]+/).filter(Boolean);
    const what = task.text
      .replace(/^T-\d+\s*/, '')
      .replace(KIND, '')
      .replace(/\[P\]/g, '')
      .replace(CRITERIA, '')
      .replace(/—.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      id: task.id,
      done: task.done,
      parallel: task.parallel,
      kind: (task.text.match(KIND)?.[1] ?? 'impl').toLowerCase(),
      what: what || task.text,
      criteria,
      files,
    };
  });
}

/** The body of one `## Section` of a spec, without parsing the whole document. */
function sectionOf(spec, name) {
  const lines = String(spec ?? '').split('\n');
  const heading = `## ${name}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

const unwritten = (text) => !text || text.trim().toUpperCase().startsWith('TODO');

/**
 * What this feature is, in the words whoever specified it used.
 *
 * The page led with gates and evidence, which answers "is it allowed to move" and not "what is
 * this". Both come from the spec, so neither is invented: where the template's TODOs are still
 * there, this returns nothing and the page says plainly that nobody has written it down — which is
 * more useful than a heading with placeholder text under it.
 */
function describeSpec(spec) {
  const stories = sectionOf(spec, 'User stories')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line && !line.toUpperCase().startsWith('TODO'));
  const problem = sectionOf(spec, 'Problem');
  return { problem: unwritten(problem) ? '' : problem, stories };
}

async function featureState(root, project, feature, repo) {
  return {
    id: feature.id,
    title: feature.title ?? feature.id,
    status: feature.status,
    about: describeSpec(feature.spec),
    criteria: progress(feature.spec, 'AC'),
    tasks: progress(feature.tasks, 'T'),
    taskList: describeTasks(feature.tasks),
    gates: await gatesFor(root, project, feature, repo),
    lanes: await lanesFor(root, project, feature),
    tests: await testsFor(root, project, feature, repo?.commit ?? null),
  };
}

/** Everything the page shows, as plain JSON. Safe to serialise, diff or publish. */
export async function collectState(root, project, { setup = null, problems = [], tunnel = null } = {}) {
  const features = await listFeatures(root);
  const repo = repoState(root);
  const collected = await Promise.all(features.map((feature) => featureState(root, project, feature, repo)));
  const queue = await readQueue(root).catch(() => ({ entries: [] }));
  return {
    tests: testSummary(collected),
    queue: { entries: queue.entries, draining: isDraining(root) },
    // What the running server is doing, which no file records: whether there is a way in from
    // outside right now. Null where the page was rendered by the CLI rather than served.
    tunnel,
    project: {
      name: project.project.name,
      generatedAt: new Date().toISOString(),
      engine: project.workflow.engine,
      autonomy: project.workflow.autonomy,
    },
    next: await nextAction(root, project).catch(() => null),
    setup,
    problems,
    features: collected,
  };
}

