// The page itself: a pure function from the collected state to one self-contained HTML string.
// Kept apart from the collector so the two can be read, and changed, independently.
//
// No scripts and no network requests, on purpose. The page is opened from a file:// path while a
// build runs, often on a locked-down machine, and it has to render identically there, offline,
// with nothing loaded. That rules out client-side filtering, so navigation is anchors, a sticky
// bar and one scannable index table — which is faster to use anyway.

import { FEATURE_STATUSES } from './schema.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (char) => ENTITIES[char]);
const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const SUITE_LABELS = { test: 'Unit', smoke: 'Smoke', ui: 'UI' };
const STATE_WORDS = { ok: 'Passing', flaky: 'Flaky', failed: 'Failing', missing: 'Not run' };
const STAGE_WORDS = { draft: 'Draft', approved: 'Approved', planned: 'Planned', 'in-progress': 'In progress', done: 'Done' };

const anchor = (id) => `feature-${String(id).replace(/[^a-zA-Z0-9-]/g, '')}`;
const meter = (done, total) => `<span class="meter" title="${done} of ${total}"><span class="meter-fill" style="width:${pct(done, total)}%"></span></span>`;

// ── Header ──────────────────────────────────────────────────────────────────────────────────

function appBar(state, live) {
  const meta = [state.project.engine, state.project.autonomy === 'gated' ? 'gated' : 'auto-plan'].filter(Boolean);
  const when = new Date(state.project.generatedAt).toLocaleTimeString();
  return `
  <header class="appbar">
    <div class="wrap bar">
      <div class="brand">
        <span class="mark" aria-hidden="true">VC</span>
        <span class="brand-text">
          <span class="brand-name">${escape(state.project.name)}</span>
          <span class="brand-sub">Delivery lifecycle${meta.length ? ` · ${escape(meta.join(' · '))}` : ''}</span>
        </span>
      </div>
      <span class="stamp">${live ? '<span class="dot" aria-hidden="true"></span>Live · ' : ''}Updated ${escape(when)}</span>
    </div>
  </header>`;
}

function subNav(state) {
  const links = [
    ['#overview', 'Overview'],
    state.tests?.suites && ['#tests', 'Tests'],
    state.setup && ['#setup', 'Environment'],
    state.problems.length && ['#issues', `Issues (${state.problems.length})`],
    state.features.length && ['#features', 'Features'],
  ].filter(Boolean);
  return `
  <nav class="subnav" aria-label="Sections">
    <div class="wrap navrow">${links.map(([href, label]) => `<a href="${href}">${escape(label)}</a>`).join('')}</div>
  </nav>`;
}

// ── Key figures ─────────────────────────────────────────────────────────────────────────────

const kpi = (label, value, note, tone = '') => `
      <div class="kpi ${tone}">
        <span class="kpi-label">${escape(label)}</span>
        <span class="kpi-value">${escape(String(value))}</span>
        <span class="kpi-note">${escape(note)}</span>
      </div>`;

function kpiRow(state) {
  const features = state.features;
  const done = features.filter((feature) => feature.status === 'done').length;
  const tasks = features.reduce((sum, feature) => ({ done: sum.done + feature.tasks.done, total: sum.total + feature.tasks.total }), { done: 0, total: 0 });
  const blocked = features.flatMap((feature) => feature.gates.filter((gate) => gate.state === 'blocked')).length;
  const tests = state.tests ?? { ok: 0, flaky: 0, failed: 0, missing: 0, suites: 0 };
  const unhealthy = tests.flaky + tests.failed;
  const testNote = unhealthy
    ? `${plural(unhealthy, 'suite')} flaky or failing`
    : tests.missing ? `${plural(tests.missing, 'suite')} never run` : 'all recorded runs green';
  return `
    <section class="kpis" aria-label="Key figures">
      ${kpi('Features complete', `${done}/${features.length}`, features.length ? `${pct(done, features.length)}% of scope` : 'none yet')}
      ${kpi('Tasks ticked', `${tasks.done}/${tasks.total}`, tasks.total ? `${pct(tasks.done, tasks.total)}% of planned work` : 'no tasks yet')}
      ${kpi('Suites healthy', `${tests.ok}/${tests.suites}`, testNote, unhealthy ? 'bad' : tests.missing ? 'warn' : 'good')}
      ${kpi('Gates blocking', blocked, blocked ? 'must clear before done' : 'nothing in the way', blocked ? 'warn' : 'good')}
    </section>`;
}

// ── Overview ────────────────────────────────────────────────────────────────────────────────

function nextPanel(next) {
  if (!next) return '';
  return `
      <div class="next">
        <span class="eyebrow">Next action</span>
        <p class="next-line"><b>${escape(STAGE_WORDS[next.step] ?? next.step)}</b>${next.feature ? ` — ${escape(next.feature)}` : ''}<span class="muted"> · ${escape(next.reason)}</span></p>
        <p><code>${escape(next.command)}</code></p>
        ${next.gate ? `<p class="muted small">Waiting on you: ${escape(next.gate)}</p>` : ''}
      </div>`;
}

// One row per feature, so the whole programme is readable without scrolling through the cards.
function indexRow(feature) {
  const blocked = feature.gates.filter((gate) => gate.state === 'blocked');
  const suites = feature.tests.suites;
  const worst = ['failed', 'flaky', 'missing', 'ok'].find((state) => suites.some((suite) => suite.state === state)) ?? 'missing';
  return `
          <tr>
            <td><a href="#${anchor(feature.id)}">${escape(feature.id)}</a><span class="row-title">${escape(feature.title)}</span></td>
            <td><span class="badge ${escape(feature.status)}">${escape(STAGE_WORDS[feature.status] ?? feature.status)}</span></td>
            <td class="num">${feature.tasks.done}/${feature.tasks.total} ${meter(feature.tasks.done, feature.tasks.total)}</td>
            <td>${suites.length ? `<span class="pill ${escape(worst)}">${escape(STATE_WORDS[worst])}</span>` : '<span class="muted">—</span>'}</td>
            <td class="num">${blocked.length ? `<span class="pill failed">${blocked.length}</span>` : '<span class="muted">—</span>'}</td>
          </tr>`;
}

function overview(state) {
  const table = state.features.length ? `
      <div class="tablewrap">
        <table class="index">
          <thead><tr><th>Feature</th><th>Stage</th><th>Tasks</th><th>Tests</th><th>Blocked</th></tr></thead>
          <tbody>${state.features.map(indexRow).join('')}</tbody>
        </table>
      </div>` : '<p class="muted">No features yet. Create one with <code>vibecheck feature "&lt;name&gt;"</code>.</p>';
  return `
    <section id="overview" class="panel">
      <h2>Overview</h2>
      ${nextPanel(state.next)}
      ${table}
    </section>`;
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────

function testTallies(summary) {
  const cells = [
    ['ok', summary.ok, 'Passing'],
    ['flaky', summary.flaky, 'Flaky'],
    ['failed', summary.failed, 'Failing'],
    ['missing', summary.missing, 'Not run'],
  ];
  return `<div class="tallies">${cells.map(([state, count, label]) => `
        <span class="tally ${state}${count ? '' : ' zero'}"><b>${count}</b><span>${escape(label)}</span></span>`).join('')}</div>`;
}

function testsSection(state) {
  const summary = state.tests;
  if (!summary?.suites) return '';
  const notes = [
    summary.stale && `${plural(summary.stale, 'feature')} ${summary.stale === 1 ? 'carries' : 'carry'} evidence from an older commit`,
    summary.untraced && `${summary.untraced} acceptance criteria with no test`,
  ].filter(Boolean);
  return `
    <section id="tests" class="panel">
      <h2>Tests <span class="muted small">${plural(summary.suites, 'suite')} across all features</span></h2>
      ${testTallies(summary)}
      ${notes.length ? `<ul class="notes warn">${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}
      <p class="muted small">A suite that passes on some runs and not others is <b>flaky</b>, and does not count as evidence.</p>
    </section>`;
}

function suiteRow(entry) {
  const tally = entry.runs > 1 ? `${entry.passed}/${entry.runs} runs` : entry.runs === 1 ? '1 run' : '—';
  return `
            <tr class="${escape(entry.state)}">
              <td>${escape(SUITE_LABELS[entry.suite] ?? entry.suite)}</td>
              <td><span class="pill ${escape(entry.state)}">${escape(STATE_WORDS[entry.state])}</span></td>
              <td class="num">${escape(tally)}</td>
              <td class="num">${entry.seconds ? `${entry.seconds}s` : '<span class="muted">—</span>'}</td>
              <td><code class="cmd">${escape(entry.command || '—')}</code></td>
            </tr>`;
}

function featureTests(tests) {
  const total = tests.trace.covered + tests.trace.missing.length;
  const notes = [
    tests.stale && 'Evidence was recorded against an older commit — it no longer describes this code.',
    tests.dirty && 'Recorded with uncommitted changes, so it does not count.',
    tests.trace.missing.length && `Untested criteria: ${tests.trace.missing.map((id) => `AC-${id}`).join(', ')}`,
    tests.trace.orphans.length && `Tests reference criteria that are not in the spec: ${tests.trace.orphans.join(', ')}`,
  ].filter(Boolean);
  const body = tests.suites.length
    ? `<div class="tablewrap"><table class="suites">
          <thead><tr><th>Suite</th><th>Result</th><th>Runs</th><th>Time</th><th>Command</th></tr></thead>
          <tbody>${tests.suites.map(suiteRow).join('')}</tbody>
        </table></div>`
    : '<p class="muted small">No test commands defined for this project.</p>';
  const meta = `${tests.trace.covered}/${total} criteria proven by a test${tests.required > 1 ? ` · ${tests.required} runs required` : ''}${tests.at ? ` · last run ${tests.at.slice(0, 16).replace('T', ' ')}` : ''}`;
  return `
      <div class="section">
        <div class="section-head">
          <span class="eyebrow">Tests</span>
          <span class="muted small">${escape(meta)}</span>
        </div>
        ${body}
        ${notes.length ? `<ul class="notes warn">${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}
      </div>`;
}

// ── Features ────────────────────────────────────────────────────────────────────────────────

function stageTrack(status) {
  const index = FEATURE_STATUSES.indexOf(status);
  return `<ol class="stages">${FEATURE_STATUSES.map((name, position) => {
    const state = position < index ? 'past' : position === index ? 'now' : 'future';
    return `<li class="stage ${state}">${escape(STAGE_WORDS[name] ?? name)}</li>`;
  }).join('')}</ol>`;
}

const gateTitle = (gate) => gate.problems.join(' · ') || (gate.state === 'off' ? 'switched off for this project' : 'passing');
const gateChip = (gate) => `<span class="chip ${gate.state}" title="${escape(gateTitle(gate))}">${escape(gate.label)}</span>`;

function lanesSection(lanes) {
  if (!lanes.length) return '';
  return `
      <div class="section">
        <div class="section-head"><span class="eyebrow">Lanes</span><span class="muted small">${plural(lanes.length, 'lane')}</span></div>
        <ul class="lanes">${lanes.map((lane) => `
          <li><b>${escape(lane.name)}</b> <span class="pill ${lane.state === 'done' ? 'ok' : 'neutral'}">${escape(lane.state)}</span> <span class="muted small">${escape(lane.tasks.join(', '))} — ${escape(lane.detail)}</span></li>`).join('')}
        </ul>
      </div>`;
}

function progressSection(feature) {
  return `
      <div class="section grid2">
        <div class="bar"><span class="bar-label">Criteria</span>${meter(feature.criteria.done, feature.criteria.total)}<span class="bar-count">${feature.criteria.done}/${feature.criteria.total}</span></div>
        <div class="bar"><span class="bar-label">Tasks</span>${meter(feature.tasks.done, feature.tasks.total)}<span class="bar-count">${feature.tasks.done}/${feature.tasks.total}</span></div>
      </div>`;
}

function featureCard(feature) {
  const blocked = feature.gates.filter((gate) => gate.state === 'blocked');
  const blockers = blocked.flatMap((gate) => gate.problems);
  return `
    <article id="${anchor(feature.id)}" class="panel feature${blocked.length ? ' has-blockers' : ''}">
      <header class="feature-head">
        <span class="feature-id">
          <span class="feature-code">${escape(feature.id)}</span>
          <span class="feature-title">${escape(feature.title)}</span>
        </span>
        <span class="head-right">
          <span class="badge ${escape(feature.status)}">${escape(STAGE_WORDS[feature.status] ?? feature.status)}</span>
          <a class="totop" href="#overview" title="Back to the overview">↑</a>
        </span>
      </header>
      ${stageTrack(feature.status)}
      ${progressSection(feature)}
      <div class="section">
        <div class="section-head"><span class="eyebrow">Gates</span></div>
        <div class="chips">${feature.gates.map(gateChip).join('')}</div>
      </div>
      ${featureTests(feature.tests)}
      ${lanesSection(feature.lanes)}
      ${blockers.length ? `<details class="blockers" open>
        <summary>${plural(blockers.length, 'blocker')}</summary>
        <ul class="notes warn">${blockers.map((problem) => `<li>${escape(problem)}</li>`).join('')}</ul>
      </details>` : ''}
    </article>`;
}

// ── Environment and issues ──────────────────────────────────────────────────────────────────

function setupSection(setup) {
  if (!setup) return '';
  const done = setup.results.filter((result) => result.ok);
  const remaining = setup.steps.map((step) => step.tool?.id ?? step.id).join(', ');
  return `
    <section id="setup" class="panel">
      <h2>Environment <span class="muted small">${done.length}/${setup.results.length} tools ready</span></h2>
      ${meter(done.length, setup.results.length)}
      <div class="tablewrap"><table class="suites">
        <thead><tr><th>Tool</th><th>State</th><th>Detail</th></tr></thead>
        <tbody>${setup.results.map((result) => `
          <tr><td>${escape(result.name)}</td><td><span class="pill ${result.ok ? 'ok' : 'neutral'}">${result.ok ? 'Ready' : 'Pending'}</span></td><td class="muted">${escape(result.detail ?? '')}</td></tr>`).join('')}
        </tbody>
      </table></div>
      ${setup.steps.length
        ? `<p class="muted small">${plural(setup.steps.length, 'step')} still to run: ${escape(remaining)}</p>`
        : '<p class="good small">Everything this project needs is installed.</p>'}
    </section>`;
}

function issuesSection(problems) {
  if (!problems.length) return '';
  return `
    <section id="issues" class="panel">
      <h2>Issues <span class="muted small">${plural(problems.length, 'item')}</span></h2>
      <details${problems.length <= 8 ? ' open' : ''}>
        <summary>Specs and generated files</summary>
        <ul class="notes warn">${problems.map((problem) => `<li>${escape(problem)}</li>`).join('')}</ul>
      </details>
    </section>`;
}

// ── Styles ──────────────────────────────────────────────────────────────────────────────────

const STYLE = `
  :root {
    color-scheme: light dark;
    --bg:#f4f5f7; --surface:#fff; --raised:#fbfcfd; --ink:#1a1d21; --muted:#5c6773; --faint:#8a94a0;
    --line:#dfe3e8; --line-strong:#c9d0d8;
    --accent:#1f4fd8; --accent-soft:#eaf0ff;
    --good:#0f7a45; --good-bg:#e3f6ea; --warn:#8a4b09; --warn-bg:#fdf0dc; --bad:#a4232b; --bad-bg:#fdeaea;
    --shadow:0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0c1016; --surface:#141a22; --raised:#1a212b; --ink:#e6ecf3; --muted:#9aa7b4; --faint:#6f7c8a;
      --line:#252e3a; --line-strong:#33404f;
      --accent:#6c9bff; --accent-soft:#16223c;
      --good:#4ec27a; --good-bg:#0f2a1b; --warn:#e0994a; --warn-bg:#2e2109; --bad:#f2777a; --bad-bg:#2e1214;
      --shadow:none;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1080px; margin:0 auto; padding:0 20px; }
  a { color:var(--accent); }
  code { font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background:var(--raised); border:1px solid var(--line); padding:1px 6px; border-radius:4px; }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:var(--muted); } .faint { color:var(--faint); }
  .small { font-size:12px; } .good { color:var(--good); }

  .appbar { background:var(--surface); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:3; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:60px; flex-wrap:wrap; padding-block:10px; }
  .brand { display:flex; align-items:center; gap:12px; min-width:0; }
  .mark { width:32px; height:32px; border-radius:6px; background:var(--accent); color:#fff; flex:none;
    display:grid; place-items:center; font-size:12px; font-weight:700; letter-spacing:.04em; }
  .brand-text { display:flex; flex-direction:column; min-width:0; }
  .brand-name { font-size:16px; font-weight:650; letter-spacing:-.01em; }
  .brand-sub { font-size:12px; color:var(--muted); }
  .stamp { font-size:12px; color:var(--muted); white-space:nowrap; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--good); margin-right:6px; }

  .subnav { background:var(--surface); border-bottom:1px solid var(--line); position:sticky; top:60px; z-index:2; }
  .navrow { display:flex; gap:4px; overflow-x:auto; }
  .navrow a { padding:10px 12px; font-size:13px; color:var(--muted); text-decoration:none;
    border-bottom:2px solid transparent; white-space:nowrap; }
  .navrow a:hover { color:var(--ink); border-bottom-color:var(--line-strong); }

  main { padding:24px 0 64px; }

  .kpis { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:20px; }
  .kpi { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:14px 16px;
    display:flex; flex-direction:column; gap:2px; box-shadow:var(--shadow); }
  .kpi-label { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); font-weight:600; }
  .kpi-value { font-size:26px; font-weight:650; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
  .kpi-note { font-size:12px; color:var(--muted); }
  .kpi.good .kpi-value { color:var(--good); }
  .kpi.warn .kpi-value { color:var(--warn); }
  .kpi.bad .kpi-value { color:var(--bad); }

  .panel { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:18px 20px;
    margin-bottom:14px; box-shadow:var(--shadow); scroll-margin-top:120px; }
  h2 { font-size:15px; font-weight:650; margin:0 0 14px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); font-weight:600; }
  .section { margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
  .section-head { display:flex; gap:10px; align-items:baseline; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; }

  .next { background:var(--accent-soft); border:1px solid var(--accent); border-radius:6px; padding:14px 16px; margin-bottom:16px; }
  .next p { margin:6px 0 0; }
  .next-line { font-size:14px; }

  .tablewrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--faint);
    font-weight:600; padding:8px 10px; border-bottom:1px solid var(--line-strong); white-space:nowrap; }
  td { padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:middle; }
  tbody tr:last-child td { border-bottom:0; }
  tbody tr:hover { background:var(--raised); }
  .index td:first-child a { font-weight:600; text-decoration:none; }
  .row-title { display:block; color:var(--muted); font-size:12px; }
  .cmd { font-size:11px; white-space:nowrap; }

  .badge { font-size:11px; font-weight:600; padding:3px 9px; border-radius:4px; background:var(--raised);
    border:1px solid var(--line-strong); color:var(--muted); white-space:nowrap; }
  .badge.in-progress { background:var(--warn-bg); border-color:transparent; color:var(--warn); }
  .badge.done { background:var(--good-bg); border-color:transparent; color:var(--good); }
  .badge.approved, .badge.planned { background:var(--accent-soft); border-color:transparent; color:var(--accent); }
  .pill { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; background:var(--raised);
    color:var(--muted); border:1px solid var(--line); white-space:nowrap; }
  .pill.ok { background:var(--good-bg); color:var(--good); border-color:transparent; }
  .pill.flaky { background:var(--warn-bg); color:var(--warn); border-color:transparent; text-transform:uppercase; letter-spacing:.04em; }
  .pill.failed { background:var(--bad-bg); color:var(--bad); border-color:transparent; }
  .pill.missing, .pill.neutral { background:var(--raised); color:var(--muted); }

  .meter { display:inline-block; vertical-align:middle; width:72px; height:5px; background:var(--line);
    border-radius:3px; overflow:hidden; margin-left:8px; }
  .meter-fill { display:block; height:100%; background:var(--accent); }
  .bar { display:flex; align-items:center; gap:8px; font-size:12px; }
  .bar-label { color:var(--muted); width:62px; flex:none; }
  .bar .meter { flex:1; width:auto; margin-left:0; }
  .bar-count { color:var(--muted); font-variant-numeric:tabular-nums; width:46px; text-align:right; flex:none; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; }

  .stages { display:flex; gap:6px; list-style:none; padding:0; margin:14px 0 0; flex-wrap:wrap; }
  .stage { font-size:11px; padding:3px 10px; border-radius:4px; background:var(--raised);
    border:1px solid var(--line); color:var(--faint); }
  .stage.past { background:var(--good-bg); border-color:transparent; color:var(--good); }
  .stage.now { background:var(--accent); border-color:transparent; color:#fff; font-weight:600; }

  .feature-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .feature-id { display:flex; flex-direction:column; min-width:0; }
  .feature-code { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .feature-title { font-size:15px; font-weight:650; letter-spacing:-.01em; }
  .head-right { display:flex; align-items:center; gap:10px; }
  .totop { text-decoration:none; color:var(--faint); font-size:14px; padding:2px 6px; border-radius:4px; }
  .totop:hover { background:var(--raised); color:var(--ink); }
  .feature.has-blockers { border-left:3px solid var(--warn); }

  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; font-weight:600; padding:3px 10px; border-radius:20px;
    background:var(--good-bg); color:var(--good); cursor:help; }
  .chip.blocked { background:var(--bad-bg); color:var(--bad); }
  .chip.off { background:var(--raised); color:var(--faint); text-decoration:line-through; }

  .tallies { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .tally { background:var(--raised); border:1px solid var(--line); border-radius:6px; padding:12px 14px;
    display:flex; flex-direction:column; gap:2px; color:var(--muted); }
  .tally b { font-size:22px; font-weight:650; font-variant-numeric:tabular-nums; }
  .tally span { font-size:12px; }
  .tally.ok:not(.zero) { background:var(--good-bg); border-color:transparent; color:var(--good); }
  .tally.flaky:not(.zero) { background:var(--warn-bg); border-color:transparent; color:var(--warn); }
  .tally.failed:not(.zero) { background:var(--bad-bg); border-color:transparent; color:var(--bad); }
  .tally.zero { color:var(--faint); }

  .notes { margin:10px 0 0; padding-left:18px; font-size:13px; }
  .notes.warn { color:var(--warn); }
  .notes li { margin:3px 0; }
  .lanes { list-style:none; padding:0; margin:0; font-size:13px; }
  .lanes li { padding:4px 0; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }
  details { margin-top:14px; }
  summary { cursor:pointer; font-size:12px; font-weight:600; color:var(--muted);
    text-transform:uppercase; letter-spacing:.05em; padding:4px 0; }
  summary:hover { color:var(--ink); }
  .blockers summary { color:var(--warn); }

  @media (max-width:860px) {
    .kpis { grid-template-columns:repeat(2,1fr); }
    .tallies { grid-template-columns:repeat(2,1fr); }
  }
  @media (max-width:560px) {
    .grid2 { grid-template-columns:1fr; }
    .subnav, .appbar { position:static; }
    .panel { padding:16px; }
  }`;

/**
 * The whole page as one self-contained string. `live` adds the meta-refresh that keeps a local
 * file current while a job runs; leave it off for a copy being shared rather than watched.
 */
export function renderDashboard(state, { live = false, intervalSeconds = 3 } = {}) {
  const features = state.features.length
    ? `<section id="features">${state.features.map(featureCard).join('')}</section>`
    : '';
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
${appBar(state, live)}
${subNav(state)}
<main class="wrap">
  ${kpiRow(state)}
  ${overview(state)}
  ${testsSection(state)}
  ${setupSection(state.setup)}
  ${issuesSection(state.problems)}
  ${features}
</main>
</body>
</html>
`;
}
