// The page itself: a pure function from the collected state to one self-contained HTML string.
// Kept apart from the collector so the two can be read, and changed, independently.
//
// The chrome — rail, title bar, cards, palette — comes from page-chrome.js, which the wizard also
// uses, so project tracking and the setup form are one product rather than two that resemble
// each other.
//
// No scripts and no network requests, on purpose. The page is opened from a file:// path while a
// build runs, often on a locked-down machine, and it has to render identically there, offline,
// with nothing loaded. That rules out client-side filtering, so navigation is anchors in the rail
// and one scannable index table — which is faster to use anyway.

import { escape, shell } from './page-chrome.js';
import { FEATURE_STATUSES } from './schema.js';

const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const SUITE_LABELS = { test: 'Unit', smoke: 'Smoke', ui: 'UI' };
const STATE_WORDS = { ok: 'Passing', flaky: 'Flaky', failed: 'Failing', missing: 'Not run' };
const STAGE_WORDS = { draft: 'Draft', approved: 'Approved', planned: 'Planned', 'in-progress': 'In progress', done: 'Done' };

const anchor = (id) => `feature-${String(id).replace(/[^a-zA-Z0-9-]/g, '')}`;
const meter = (done, total) => `<span class="meter" title="${done} of ${total}"><span class="meter-fill" style="width:${pct(done, total)}%"></span></span>`;

// ── Rail ────────────────────────────────────────────────────────────────────────────────────

// The rail is the table of contents. A section that would be empty is left out rather than
// offered as a dead link.
function railItems(state) {
  const unhealthy = (state.tests?.flaky ?? 0) + (state.tests?.failed ?? 0);
  return [
    { href: '#overview', label: 'Overview', icon: 'home', current: true },
    state.features.length && { href: '#features', label: 'Features', icon: 'board' },
    state.tests?.suites && { href: '#tests', label: 'Tests', icon: 'tests', pip: unhealthy ? 'rd' : '' },
    state.setup && { href: '#setup', label: 'Environment', icon: 'tools' },
    state.problems.length && { href: '#issues', label: `Issues (${state.problems.length})`, icon: 'issues', pip: 'am' },
  ].filter(Boolean);
}

// ── Key figures ─────────────────────────────────────────────────────────────────────────────

const kpi = (label, value, note, tone = '') => `
        <div class="st2 ${tone}">
          <span class="lb2">${escape(label)}</span>
          <span class="vl2">${escape(String(value))}</span>
          <span class="ft2">${escape(note)}</span>
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
        <div class="callout">
          <b>Do this next</b>
          <p style="margin:0 0 8px"><b style="display:inline;color:var(--tx)">${escape(STAGE_WORDS[next.step] ?? next.step)}</b>${next.feature ? ` — ${escape(next.feature)}` : ''} · ${escape(next.reason)}</p>
          <p style="margin:0"><code>${escape(next.command)}</code></p>
          ${next.gate ? `<p class="small" style="margin:8px 0 0">Waiting on you: ${escape(next.gate)}</p>` : ''}
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
                <td>${suites.length ? `<span class="pill ${escape(worst)}">${escape(STATE_WORDS[worst])}</span>` : '<span class="faint">—</span>'}</td>
                <td class="num">${blocked.length ? `<span class="pill failed">${blocked.length}</span>` : '<span class="faint">—</span>'}</td>
              </tr>`;
}

function overview(state) {
  const table = state.features.length ? `
          <div class="tablewrap">
            <table>
              <thead><tr><th>Feature</th><th>Stage</th><th>Tasks</th><th>Tests</th><th>Blocked</th></tr></thead>
              <tbody>${state.features.map(indexRow).join('')}</tbody>
            </table>
          </div>` : '<p class="muted">No features yet. Create one with <code>vibecheck feature "&lt;name&gt;"</code>.</p>';
  return `
      <section id="overview" class="cd">
        <h2>Overview</h2>
        <p class="cs">Every feature, where it sits in the lifecycle, and what is holding it up.</p>
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
  return `<div class="kpis" style="margin:0">${cells.map(([state, count, label]) => `
          <div class="st2 ${count ? state : ''}">
            <span class="lb2">${escape(label)}</span>
            <span class="vl2">${count}</span>
            <span class="ft2">${count === 1 ? 'suite' : 'suites'}</span>
          </div>`).join('')}</div>`;
}

function testsSection(state) {
  const summary = state.tests;
  if (!summary?.suites) return '';
  const notes = [
    summary.stale && `${plural(summary.stale, 'feature')} ${summary.stale === 1 ? 'carries' : 'carry'} evidence from an older commit`,
    summary.untraced && `${summary.untraced} acceptance criteria with no test`,
  ].filter(Boolean);
  return `
      <section id="tests" class="cd">
        <div class="hdr">
          <div>
            <h2>Tests</h2>
            <p class="cs" style="margin:4px 0 0">${plural(summary.suites, 'suite')} across all features</p>
          </div>
          <span class="tg ${summary.flaky + summary.failed ? 'g-rd' : summary.missing ? 'g-am' : 'g-lime'}">${summary.ok}/${summary.suites} healthy</span>
        </div>
        ${testTallies(summary)}
        ${notes.length ? `<ul class="notes warn">${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}
        <p class="callout warn"><b>Flaky is not passing</b>A suite that passes on some runs and not others is <b style="display:inline;color:var(--tx)">flaky</b>, and does not count as evidence.</p>
      </section>`;
}

function suiteRow(entry) {
  const tally = entry.runs > 1 ? `${entry.passed}/${entry.runs} runs` : entry.runs === 1 ? '1 run' : '—';
  return `
                <tr class="${escape(entry.state)}">
                  <td>${escape(SUITE_LABELS[entry.suite] ?? entry.suite)}</td>
                  <td><span class="pill ${escape(entry.state)}">${escape(STATE_WORDS[entry.state])}</span></td>
                  <td class="num">${escape(tally)}</td>
                  <td class="num">${entry.seconds ? `${entry.seconds}s` : '<span class="faint">—</span>'}</td>
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
    ? `<div class="tablewrap"><table>
              <thead><tr><th>Suite</th><th>Result</th><th>Runs</th><th>Time</th><th>Command</th></tr></thead>
              <tbody>${tests.suites.map(suiteRow).join('')}</tbody>
            </table></div>`
    : '<p class="faint small">No test commands defined for this project.</p>';
  const meta = `${tests.trace.covered}/${total} criteria proven by a test${tests.required > 1 ? ` · ${tests.required} runs required` : ''}${tests.at ? ` · last run ${tests.at.slice(0, 16).replace('T', ' ')}` : ''}`;
  return `
        <div class="section">
          <div class="section-head">
            <span class="eyebrow">Tests</span>
            <span class="faint small">${escape(meta)}</span>
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
          <div class="section-head"><span class="eyebrow">Lanes</span><span class="faint small">${plural(lanes.length, 'lane')}</span></div>
          ${lanes.map((lane) => `
          <div class="li">
            <span class="pill ${lane.state === 'done' ? 'ok' : 'neutral'}">${escape(lane.state)}</span>
            <span class="bd"><b>${escape(lane.name)}</b><i>${escape(lane.tasks.join(', '))} — ${escape(lane.detail)}</i></span>
          </div>`).join('')}
        </div>`;
}

function progressSection(feature) {
  return `
        <div class="section g g2">
          <div class="bar"><span class="bar-label">Criteria</span>${meter(feature.criteria.done, feature.criteria.total)}<span class="bar-count">${feature.criteria.done}/${feature.criteria.total}</span></div>
          <div class="bar"><span class="bar-label">Tasks</span>${meter(feature.tasks.done, feature.tasks.total)}<span class="bar-count">${feature.tasks.done}/${feature.tasks.total}</span></div>
        </div>`;
}

function featureCard(feature) {
  const blocked = feature.gates.filter((gate) => gate.state === 'blocked');
  const blockers = blocked.flatMap((gate) => gate.problems);
  return `
      <article id="${anchor(feature.id)}" class="cd${blocked.length ? ' has-blockers' : ''}">
        <div class="hdr" style="margin-bottom:0">
          <div>
            <span class="eyebrow num">${escape(feature.id)}</span>
            <h2 style="margin-top:4px">${escape(feature.title)}</h2>
          </div>
          <span style="display:flex;align-items:center;gap:10px">
            <span class="badge ${escape(feature.status)}">${escape(STAGE_WORDS[feature.status] ?? feature.status)}</span>
            <a class="totop" href="#overview" title="Back to the overview">↑</a>
          </span>
        </div>
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
      <section id="setup" class="cd">
        <div class="hdr">
          <div><h2>Environment</h2><p class="cs" style="margin:4px 0 0">What this project needs on the machine it runs on.</p></div>
          <span class="tg ${setup.steps.length ? 'g-am' : 'g-lime'}">${done.length}/${setup.results.length} ready</span>
        </div>
        <div class="tablewrap"><table>
          <thead><tr><th>Tool</th><th>State</th><th>Detail</th></tr></thead>
          <tbody>${setup.results.map((result) => `
            <tr><td>${escape(result.name)}</td><td><span class="pill ${result.ok ? 'ok' : 'neutral'}">${result.ok ? 'Ready' : 'Pending'}</span></td><td class="faint">${escape(result.detail ?? '')}</td></tr>`).join('')}
          </tbody>
        </table></div>
        ${setup.steps.length
          ? `<p class="faint small" style="margin-top:12px">${plural(setup.steps.length, 'step')} still to run: ${escape(remaining)}</p>`
          : '<p class="small" style="margin-top:12px;color:var(--lime)">Everything this project needs is installed.</p>'}
      </section>`;
}

function issuesSection(problems) {
  if (!problems.length) return '';
  return `
      <section id="issues" class="cd">
        <div class="hdr">
          <div><h2>Issues</h2><p class="cs" style="margin:4px 0 0">Specs and generated files that disagree.</p></div>
          <span class="tg g-am">${plural(problems.length, 'item')}</span>
        </div>
        <details${problems.length <= 8 ? ' open' : ''}>
          <summary>Show them</summary>
          <ul class="notes warn">${problems.map((problem) => `<li>${escape(problem)}</li>`).join('')}</ul>
        </details>
      </section>`;
}

// Only what this page adds on top of the shared chrome.
const PAGE_STYLE = `
.totop{color:var(--tx3);font-size:15px;padding:3px 8px;border-radius:8px;text-decoration:none}
.totop:hover{background:var(--surf2);color:var(--tx);text-decoration:none}
.has-blockers{border-left:3px solid var(--am)}
#features{display:block}`;

/**
 * The whole page as one self-contained string. `live` adds the meta-refresh that keeps a local
 * file current while a job runs; leave it off for a copy being shared rather than watched.
 */
export function renderDashboard(state, { live = false, intervalSeconds = 3 } = {}) {
  const meta = [state.project.engine, state.project.autonomy === 'gated' ? 'gated' : 'auto-plan'].filter(Boolean);
  const when = new Date(state.project.generatedAt).toLocaleTimeString();
  const features = state.features.length
    ? `<section id="features">${state.features.map(featureCard).join('')}</section>`
    : '';

  return shell({
    title: `${state.project.name} — lifecycle`,
    name: state.project.name,
    sub: `Delivery lifecycle${meta.length ? ` · ${meta.join(' · ')}` : ''}`,
    nav: railItems(state),
    right: `<span class="stamp">${live ? '<span class="dot"></span>Live · ' : ''}Updated ${escape(when)}</span>`,
    head: live ? `<meta http-equiv="refresh" content="${intervalSeconds}">\n` : '',
    style: PAGE_STYLE,
    body: [kpiRow(state), overview(state), testsSection(state), setupSection(state.setup), issuesSection(state.problems), features]
      .filter(Boolean).join('\n'),
  });
}
