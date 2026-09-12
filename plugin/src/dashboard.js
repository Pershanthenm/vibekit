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
import { parseTasks, planLanes, readyParallelTasks } from './lanes.js';
import { loadManifest } from './manifest.js';
import { nextAction } from './next.js';
import { reviewProblems } from './review.js';
import { FEATURE_STATUSES } from './schema.js';

/**
 * A generated page must never dirty the working tree: `merge` refuses to run on a dirty tree and
 * the evidence gate records one, so an untracked status.html in specs/ would quietly block the
 * very lifecycle it reports on. .git/vibecheck/ is outside the tree and shared across worktrees,
 * which is also what the evidence records use.
 */
export function dashboardPath(root) {
  try {
    return stateDir(root, 'status.html');
  } catch {
    return join(root, '.vibecheck', 'status.html');
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

async function gatesFor(root, project, feature) {
  return Promise.all(GATES.map(async (gate) => {
    if (!gateEnabled(gate.id, project)) return { id: gate.id, label: gate.label, state: 'off', problems: [] };
    const problems = await gate.problems(root, project, feature).catch((error) => [`${gate.id}: ${error.message}`]);
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
      detail: lane.engine === 'multica' ? `Multica ${lane.issue} · ${lane.agent}` : `${lane.engine ?? 'agent'} · ${lane.commits ?? 0} commits`,
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

async function featureState(root, project, feature, head) {
  return {
    id: feature.id,
    title: feature.title ?? feature.id,
    status: feature.status,
    criteria: progress(feature.spec, 'AC'),
    tasks: progress(feature.tasks, 'T'),
    gates: await gatesFor(root, project, feature),
    lanes: await lanesFor(root, project, feature),
    tests: await testsFor(root, project, feature, head),
  };
}

/** Everything the page shows, as plain JSON. Safe to serialise, diff or publish. */
export async function collectState(root, project, { setup = null, problems = [] } = {}) {
  const features = await listFeatures(root);
  const head = repoState(root)?.commit ?? null;
  const collected = await Promise.all(features.map((feature) => featureState(root, project, feature, head)));
  return {
    tests: testSummary(collected),
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

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (char) => ENTITIES[char]);
const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

const bar = (label, { done, total }) => `
      <div class="bar">
        <span class="bar-label">${escape(label)}</span>
        <span class="track"><span class="fill" style="width:${pct(done, total)}%"></span></span>
        <span class="bar-count">${done}/${total}</span>
      </div>`;

const gateTitle = (gate) => gate.problems.join(' · ') || (gate.state === 'off' ? 'switched off for this project' : 'passing');
const gateChip = (gate) => `<span class="chip ${gate.state}" title="${escape(gateTitle(gate))}">${escape(gate.label)}</span>`;

const laneRow = (lane) => `<li class="lane"><b>${escape(lane.name)}</b> <span class="lane-state">${escape(lane.state)}</span> <span class="muted">${escape(lane.tasks.join(', '))} — ${escape(lane.detail)}</span></li>`;

// The lifecycle read left to right, so "where are we" is answerable at a glance.
function track(status) {
  const index = FEATURE_STATUSES.indexOf(status);
  const steps = FEATURE_STATUSES.map((name, position) => {
    const state = position < index ? 'past' : position === index ? 'now' : 'future';
    return `<span class="step ${state}">${escape(name)}</span>`;
  });
  return `<div class="track-steps">${steps.join('')}</div>`;
}

const SUITE_LABELS = { test: 'tests', smoke: 'smoke', ui: 'UI' };
const STATE_WORDS = { ok: 'passing', flaky: 'FLAKY', failed: 'failing', missing: 'not run' };

// Deliberately spells out "2/3 runs" rather than a tick: a flake read as a pass is the exact
// mistake this whole feature exists to prevent.
function suiteRow(entry) {
  const tally = entry.runs > 1 ? `${entry.passed}/${entry.runs} runs` : entry.runs === 1 ? '1 run' : '';
  const timing = entry.seconds ? `${entry.seconds}s` : '';
  return `<li class="suite ${entry.state}">
        <span class="suite-name">${escape(SUITE_LABELS[entry.suite] ?? entry.suite)}</span>
        <span class="suite-state">${escape(STATE_WORDS[entry.state])}</span>
        <span class="muted">${escape([tally, timing].filter(Boolean).join(' · '))}</span>
      </li>`;
}

function testsPanel(tests) {
  const traced = `${tests.trace.covered}/${tests.trace.covered + tests.trace.missing.length} criteria proven by a test`;
  const notes = [
    tests.stale && 'Evidence was recorded against an older commit — it no longer describes this code.',
    tests.dirty && 'Recorded with uncommitted changes, so it does not count.',
    tests.trace.missing.length && `Untested criteria: ${tests.trace.missing.map((id) => `AC-${id}`).join(', ')}`,
    tests.trace.orphans.length && `Tests reference criteria that are not in the spec: ${tests.trace.orphans.join(', ')}`,
  ].filter(Boolean);
  return `
      <div class="tests">
        <div class="tests-head">
          <b>Tests</b>
          <span class="muted">${escape(traced)}${tests.required > 1 ? ` · ${tests.required} runs required` : ''}${tests.at ? ` · last run ${escape(tests.at.slice(0, 16).replace('T', ' '))}` : ''}</span>
        </div>
        <ul class="suites">${tests.suites.map(suiteRow).join('') || '<li class="suite missing"><span class="muted">No test commands defined for this project.</span></li>'}</ul>
        ${notes.length ? `<ul class="blockers">${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}
      </div>`;
}

function testSummaryPanel(summary) {
  if (!summary.suites) return '';
  const cells = [
    ['ok', summary.ok, 'passing'],
    ['flaky', summary.flaky, 'flaky'],
    ['failed', summary.failed, 'failing'],
    ['missing', summary.missing, 'not run'],
  ].map(([state, count, label]) => `<span class="tally ${state}${count ? '' : ' zero'}"><b>${count}</b> ${escape(label)}</span>`);
  const notes = [
    summary.stale && `${summary.stale} feature(s) have evidence from an older commit`,
    summary.untraced && `${summary.untraced} acceptance criterion/criteria with no test`,
  ].filter(Boolean);
  return `
    <section class="panel">
      <h2>Tests <span class="muted">${summary.suites} suite run(s) across all features</span></h2>
      <div class="tallies">${cells.join('')}</div>
      ${notes.length ? `<ul class="blockers">${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

function featureCard(feature) {
  const blocked = feature.gates.filter((gate) => gate.state === 'blocked');
  return `
    <article class="feature${blocked.length ? ' has-blockers' : ''}">
      <header>
        <h3>${escape(feature.id)} <span class="muted">${escape(feature.title)}</span></h3>
        <span class="status ${escape(feature.status)}">${escape(feature.status)}</span>
      </header>
      ${track(feature.status)}
      ${bar('Criteria', feature.criteria)}
      ${bar('Tasks', feature.tasks)}
      <div class="chips">${feature.gates.map(gateChip).join('')}</div>
      ${testsPanel(feature.tests)}
      ${feature.lanes.length ? `<ul class="lanes">${feature.lanes.map(laneRow).join('')}</ul>` : ''}
      ${blocked.length ? `<ul class="blockers">${blocked.flatMap((gate) => gate.problems).map((problem) => `<li>${escape(problem)}</li>`).join('')}</ul>` : ''}
    </article>`;
}

function setupSection(setup) {
  if (!setup) return '';
  const done = setup.results.filter((result) => result.ok);
  const tools = setup.results.map((result) => `<li class="${result.ok ? 'ok' : 'pending'}">${result.ok ? '✔' : '○'} ${escape(result.name)} <span class="muted">${escape(result.detail ?? '')}</span></li>`);
  const remaining = setup.steps.map((step) => step.tool?.id ?? step.id).join(', ');
  return `
    <section class="panel">
      <h2>Machine setup ${bar('Tools', { done: done.length, total: setup.results.length })}</h2>
      <ul class="tools">${tools.join('')}</ul>
      ${setup.steps.length
        ? `<p class="muted">${setup.steps.length} step(s) still to run: ${escape(remaining)}</p>`
        : '<p class="ok-text">Everything this project needs is installed.</p>'}
    </section>`;
}

const STYLE = `
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#14161a; --muted:#6b7280; --line:#e3e6ea;
          --ok:#137a4d; --ok-bg:#dcfce7; --warn:#9a3412; --warn-bg:#ffedd5; --off:#6b7280; --off-bg:#eef0f3; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --card:#161b22; --ink:#e6edf3; --muted:#8b949e; --line:#30363d;
          --ok:#3fb950; --ok-bg:#0f2e1b; --warn:#f0883e; --warn-bg:#3a2008; --off:#8b949e; --off-bg:#21262d; --accent:#58a6ff; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width:880px; margin:0 auto; }
  h1 { font-size:20px; margin:0; }
  h2 { font-size:15px; margin:0 0 12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  h3 { font-size:14px; margin:0; font-weight:600; }
  .muted { color:var(--muted); font-weight:400; }
  header.top { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  .live { font-size:12px; color:var(--muted); }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--ok); margin-right:6px; }
  .panel, .feature { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:12px; }
  .feature header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; }
  .feature.has-blockers { border-left:3px solid var(--warn); }
  .next { background:var(--card); border:1px solid var(--accent); border-radius:10px; padding:16px; margin-bottom:20px; }
  .next code { background:var(--off-bg); padding:2px 6px; border-radius:4px; word-break:break-all; }
  .status { font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:3px 8px; border-radius:20px; background:var(--off-bg); color:var(--muted); white-space:nowrap; }
  .status.in-progress { background:var(--warn-bg); color:var(--warn); }
  .status.done { background:var(--ok-bg); color:var(--ok); }
  .track-steps { display:flex; gap:4px; margin:10px 0 12px; flex-wrap:wrap; }
  .step { font-size:11px; padding:2px 8px; border-radius:4px; background:var(--off-bg); color:var(--muted); }
  .step.past { background:var(--ok-bg); color:var(--ok); }
  .step.now { background:var(--accent); color:#fff; font-weight:600; }
  .bar { display:flex; align-items:center; gap:10px; margin:6px 0; font-size:12px; }
  .bar-label { width:64px; color:var(--muted); flex:none; }
  .bar-count { width:48px; text-align:right; color:var(--muted); flex:none; }
  .track { flex:1; height:6px; background:var(--off-bg); border-radius:3px; overflow:hidden; min-width:60px; }
  .fill { display:block; height:100%; background:var(--accent); }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
  .chip { font-size:11px; padding:3px 9px; border-radius:20px; background:var(--ok-bg); color:var(--ok); cursor:help; }
  .chip.blocked { background:var(--warn-bg); color:var(--warn); }
  .chip.off { background:var(--off-bg); color:var(--off); text-decoration:line-through; }
  ul { margin:12px 0 0; padding-left:18px; } li { margin:3px 0; }
  .blockers { color:var(--warn); font-size:13px; }
  .lanes { list-style:none; padding:0; font-size:12px; }
  .lane-state { font-size:11px; padding:1px 6px; border-radius:3px; background:var(--off-bg); color:var(--muted); }
  .tests { margin-top:14px; border-top:1px solid var(--line); padding-top:12px; }
  .tests-head { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; font-size:13px; }
  .suites { list-style:none; padding:0; margin:8px 0 0; font-size:12px; }
  .suite { display:flex; gap:10px; align-items:baseline; padding:3px 0; flex-wrap:wrap; }
  .suite-name { width:56px; flex:none; font-weight:600; }
  .suite-state { font-size:11px; padding:1px 8px; border-radius:20px; background:var(--off-bg); color:var(--muted); }
  .suite.ok .suite-state { background:var(--ok-bg); color:var(--ok); }
  .suite.flaky .suite-state { background:var(--warn-bg); color:var(--warn); font-weight:700; letter-spacing:.03em; }
  .suite.failed .suite-state { background:var(--warn-bg); color:var(--warn); }
  .tallies { display:flex; gap:8px; flex-wrap:wrap; }
  .tally { font-size:12px; padding:6px 12px; border-radius:8px; background:var(--off-bg); color:var(--muted); }
  .tally b { font-size:16px; margin-right:4px; }
  .tally.ok:not(.zero) { background:var(--ok-bg); color:var(--ok); }
  .tally.flaky:not(.zero), .tally.failed:not(.zero) { background:var(--warn-bg); color:var(--warn); }
  .tools { list-style:none; padding:0; }
  .tools .ok { color:var(--ok); } .tools .pending { color:var(--muted); }
  .ok-text { color:var(--ok); margin:8px 0 0; }
  @media (max-width:480px) { .bar-label { width:52px; } .feature header { flex-direction:column; align-items:flex-start; } }`;

/**
 * The whole page as one self-contained string: no network, no build step, no dependencies.
 * `live` adds the meta-refresh that keeps a local file current while a job runs; leave it off
 * for a published copy, where a reload would fight whatever is hosting it.
 */
export function renderDashboard(state, { live = false, intervalSeconds = 3 } = {}) {
  const next = state.next;
  const when = new Date(state.project.generatedAt).toLocaleTimeString();
  const nextPanel = next
    ? `<div class="next"><h2>Next</h2><p><b>${escape(next.step)}</b>${next.feature ? ` · ${escape(next.feature)}` : ''} — ${escape(next.reason)}</p><p><code>${escape(next.command)}</code></p>${next.gate ? `<p class="muted">Waiting on you: ${escape(next.gate)}</p>` : ''}</div>`
    : '';
  const problems = state.problems.length
    ? `<section class="panel"><h2>Project problems</h2><ul class="blockers">${state.problems.map((problem) => `<li>${escape(problem)}</li>`).join('')}</ul></section>`
    : '';
  const features = state.features.length
    ? state.features.map(featureCard).join('')
    : '<section class="panel"><p class="muted">No features yet. Create one with <code>vibecheck feature "&lt;name&gt;"</code>.</p></section>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${live ? `<meta http-equiv="refresh" content="${intervalSeconds}">` : ''}
<title>${escape(state.project.name)} — lifecycle</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>${escape(state.project.name)} <span class="muted">lifecycle</span></h1>
    <span class="live">${live ? '<span class="dot"></span>live · ' : ''}updated ${escape(when)}</span>
  </header>
  ${nextPanel}
  ${setupSection(state.setup)}
  ${testSummaryPanel(state.tests ?? { suites: 0 })}
  ${problems}
  ${features}
</div>
</body>
</html>
`;
}
