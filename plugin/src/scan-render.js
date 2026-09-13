// The scan surface: report, findings, plan, execution.
//
// Same arrangement as dashboard-render.js and for the same reason — the server renders these
// functions into the page it writes, and the identical source runs in the browser, so the version
// someone reads with scripts blocked and the version that updates live can never disagree.
// page-chrome.js strips the `export` keywords and the one import below before inlining it.
//
// The rule this file exists to keep: never let an absence of scanning read as an absence of
// problems. `scan.notScanned` is rendered before anything else on the report, in the same weight
// as a finding, because a clean-looking security row nobody scanned is worse than no row at all.

import { badge, cmd, empty, escape, icon, plural } from './dashboard-render.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const SEVERITY_WORDS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const CATEGORY_WORDS = {
  security: 'Security', evidence: 'Evidence', traceability: 'Traceability',
  planning: 'Planning', generated: 'Generated files', docs: 'Documentation',
};
// Chart colours, not status colours: these identify a category in a stacked bar, where the
// severity badges beside them carry the meaning.
export const CATEGORY_INK = {
  security: '#ff5a4e', evidence: '#ffb628', traceability: '#4f8cff',
  planning: '#cdf34a', generated: '#a78bfa', docs: '#9a9aad',
};
const EFFORT_WORDS = { S: '~1h', M: '~half a day', L: '~2 days' };

// Said once, in one place: exactly what evidence each category is derived from.
const SOURCE_NOTE = {
  evidence: 'Recorded test runs, the commit they ran against, and which criteria a test names.',
  traceability: 'Whether every acceptance criterion has a task, and every task a criterion.',
  planning: "Whether a feature's own files support the status it claims.",
  generated: 'Whether generated files still match the specs that generated them.',
  docs: 'Whether documents are stamped against the sources they describe.',
};

const sevBadge = (severity) => `<span class="badge sev-${severity}">${SEVERITY_WORDS[severity] ?? severity}</span>`;
const catBadge = (category) => `<span class="badge neutral no-dot"><i style="width:8px;height:8px;border-radius:2px;background:${CATEGORY_INK[category]};margin-right:6px;display:inline-block"></i>${escape(CATEGORY_WORDS[category] ?? category)}</span>`;

/** The health ring. The number is 100 minus the weight of everything still open — nothing softer. */
export function scoreRing(score) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const tone = score >= 80 ? '' : score >= 55 ? 'warn' : 'bad';
  const word = score >= 80 ? 'Healthy' : score >= 55 ? 'Needs attention' : 'At risk';
  return `<div class="score">
        <svg viewBox="0 0 104 104" role="img" aria-label="Health score ${score} out of 100">
          <circle class="ring-bg" cx="52" cy="52" r="${radius}" fill="none" stroke-width="9"/>
          <circle class="ring ${tone}" cx="52" cy="52" r="${radius}" fill="none" stroke-width="9"
            stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${(circumference * (1 - score / 100)).toFixed(1)}" transform="rotate(-90 52 52)"/>
          <text class="num" x="52" y="56" text-anchor="middle">${score}</text>
          <text class="lbl" x="52" y="72" text-anchor="middle">HEALTH</text>
        </svg>
        <div class="txt"><b>${word}</b><span>Every open finding costs points, weighted by severity. It rises only when something is actually fixed.</span></div>
      </div>`;
}

const severityScale = (scan) => {
  const most = Math.max(1, ...SEVERITIES.map((severity) => scan.counts[severity] ?? 0));
  return `<div class="sev-scale">${SEVERITIES.map((severity) => {
    const count = scan.counts[severity] ?? 0;
    const tone = severity === 'critical' || severity === 'high' ? 'danger' : severity === 'medium' ? 'warn' : '';
    return `<div class="r">${sevBadge(severity)}<span class="bar sm"><i class="${tone}" style="--w:${Math.round((count / most) * 100)}%"></i></span><b>${count}</b></div>`;
  }).join('')}</div>`;
};

const categoryBar = (scan) => {
  const total = scan.findings.length || 1;
  const present = Object.keys(CATEGORY_WORDS).filter((category) => (scan.categories[category] ?? 0) > 0);
  if (!present.length) return '<p class="t-caption">Nothing found in the categories this scan covers.</p>';
  return `<div class="stack-bar">${present.map((category) =>
    `<i style="width:${((scan.categories[category] / total) * 100).toFixed(1)}%;background:${CATEGORY_INK[category]}"></i>`).join('')}</div>
      <div class="cat-legend">${present.map((category) =>
    `<div><i style="background:${CATEGORY_INK[category]}"></i>${escape(CATEGORY_WORDS[category])}<b>${scan.categories[category]}</b></div>`).join('')}</div>`;
};

/** Where findings cluster. A file with four of them is usually one problem, not four. */
const hotspots = (scan) => {
  const byFile = new Map();
  for (const entry of scan.findings) {
    if (!entry.file) continue;
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  }
  const rows = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  if (!rows.length) return '<p class="t-caption">No findings name a file.</p>';
  return `<div class="hot">${rows.map(([file, found]) => `<div class="f"><code title="${escape(file)}">${escape(file)}</code>
        <div class="cnt">${SEVERITIES.map((severity) => {
    const count = found.filter((entry) => entry.severity === severity).length;
    return count ? `<span class="badge sev-${severity} no-dot" style="padding:0 6px">${count}</span>` : '';
  }).join('')}</div></div>`).join('')}</div>`;
};

/**
 * What was and was not looked at. Rendered as prominently as the findings themselves: a report
 * listing no security problems because nothing looked for them has to say so.
 */
export const coverageNote = (scan) => (scan.notScanned ?? []).map((gap) => `<div class="alert warn">${icon('issues')}
        <div><b>${escape(CATEGORY_WORDS[gap.category] ?? gap.category)} was not scanned</b><p>${escape(gap.why)}</p></div>
      </div>`).join('');

const flow = (scan, selected) => {
  const steps = [
    ['SCAN', plural(scan.project.features, 'feature'), 'checks that already exist'],
    ['CLASSIFY', plural(scan.findings.length, 'finding'), 'by severity and category'],
    ['SELECT', `${selected.length} chosen`, 'what to fix now'],
    ['PLAN', 'commands resolved', 'one per kind of fix'],
    ['EXECUTE', 'fixes run', 'output streamed here'],
  ];
  const at = selected.length ? 2 : 1;
  return `<div class="flow">${steps.map(([key, title, detail], index) =>
    `<div class="st ${index < at ? 'done' : index === at ? 'now' : ''}"><span class="k">${key}</span><b>${escape(title)}</b><span>${escape(detail)}</span></div>`).join('')}</div>`;
};

/** One finding as a table row. `selected` drives the checkbox; it is page state, not project state. */
export function findingRow(entry, index, selected = [], ctx = {}) {
  const checked = selected.includes(entry.id) ? ' checked' : '';
  return `<tr style="animation-delay:${index * 25}ms" data-key="finding-${escape(entry.id)}" data-finding="${escape(entry.id)}">
            <td>${ctx.writable ? `<input type="checkbox" class="check" data-pick="${escape(entry.id)}"${checked} aria-label="Select ${escape(entry.id)}">` : ''}</td>
            <td><div class="cell-primary"><div><b>${escape(entry.title)}</b>
              <span class="finding-loc">${escape(entry.id)}${entry.file ? ` · ${escape(entry.file)}` : ''}</span></div></div></td>
            <td>${sevBadge(entry.severity)}</td>
            <td class="col-optional-2">${catBadge(entry.category)}</td>
            <td class="t-muted nowrap">${escape(entry.effort)} · ${EFFORT_WORDS[entry.effort] ?? ''}</td>
            <td>${entry.action ? badge('info', 'Fixable') : badge('neutral', 'Needs you')}</td>
          </tr>`;
}

const findingsTable = (findings, selected, ctx) => (findings.length
  ? `<div class="table-wrap"><table class="table">
          <thead><tr><th style="width:36px"></th><th>Finding</th><th>Severity</th><th class="col-optional-2">Category</th><th>Effort</th><th>Fix</th></tr></thead>
          <tbody class="rows-anim">${findings.map((entry, index) => findingRow(entry, index, selected, ctx)).join('')}</tbody></table></div>`
  : empty('Nothing found', 'Every check this scan runs came back clean.'));

// --- Pages ----------------------------------------------------------------------------------

export function pageScan(scan, ctx, selected = []) {
  return `
      <div class="page-head seq">
        <div style="--i:0"><h2>Scan report</h2><p>${escape(scan.project.name)}${scan.project.commit ? ` · ${escape(scan.project.commit.slice(0, 7))}` : ''} · ${plural(scan.project.features, 'feature')} · ${plural(scan.findings.length, 'finding')}</p></div>
        <div class="cluster" style="--i:1">${cmd('vibecheck scan')}<a class="btn btn-ghost" href="#/findings">All findings</a></div>
      </div>
      <div class="seq" style="--i:2">${flow(scan, selected)}</div>
      <div class="seq" style="--i:3">${coverageNote(scan)}</div>
      <div class="grid seq" style="--seq-base:70ms">
        <div class="card span-4" style="--i:4"><div class="card-head"><div class="card-title">Health<small>Weighted by what is open</small></div></div>${scoreRing(scan.score)}</div>
        <div class="card span-4" style="--i:5"><div class="card-head"><div class="card-title">By severity<small>${scan.counts.critical} critical · ${scan.counts.high} high</small></div></div>${severityScale(scan)}</div>
        <div class="card span-4" style="--i:6"><div class="card-head"><div class="card-title">By category<small>${plural(scan.findings.length, 'finding')}</small></div></div>${categoryBar(scan)}</div>
        <div class="card span-7" style="--i:7">
          <div class="card-head"><div class="card-title">Worst first<small>Highest severity</small></div><a class="btn btn-subtle btn-sm" href="#/findings">View all</a></div>
          ${findingsTable(scan.findings.slice(0, 6), selected, ctx)}
        </div>
        <div class="span-5 stack" style="--i:8">
          <div class="card"><div class="card-head"><div class="card-title">Hotspot files<small>Where findings cluster</small></div></div>${hotspots(scan)}</div>
          <div class="card"><div class="card-head"><div class="card-title">What this scan checks</div></div>
            <div class="todo">${(scan.scanned ?? []).map((category) => `<div class="item">${badge('ok', 'Checked', false)}
              <div><b>${escape(CATEGORY_WORDS[category] ?? category)}</b><span>${escape(SOURCE_NOTE[category] ?? '')}</span></div><span></span></div>`).join('')}</div>
          </div>
        </div>
      </div>`;
}

export function pageFindings(scan, ctx, selected = []) {
  const fixable = scan.findings.filter((entry) => entry.action).length;
  return `
      <div class="page-head seq">
        <div style="--i:0"><h2>Findings</h2><p>${plural(scan.findings.length, 'finding')} · ${fixable} a command can fix, ${scan.findings.length - fixable} need you · ${selected.length} selected</p></div>
        <div class="cluster" style="--i:1">
          ${ctx.writable ? '<button type="button" class="btn btn-ghost" id="pickFixable">Select everything fixable</button>' : ''}
          ${ctx.writable ? `<a class="btn btn-primary" href="#/plan">Review plan (${selected.length})</a>` : ''}
        </div>
      </div>
      <div class="card seq" style="--i:2" id="findingsCard">
        <div class="toolbar">
          <div class="tabs" id="sevTabs"><button type="button" class="on" data-sev="">All</button>${SEVERITIES.map((severity) =>
    `<button type="button" data-sev="${severity}">${SEVERITY_WORDS[severity]}<span class="count">${scan.counts[severity] ?? 0}</span></button>`).join('')}</div>
          <label class="field grow">${icon('issues')}<input id="findingSearch" placeholder="Search findings or files" aria-label="Search findings"></label>
        </div>
        ${ctx.writable ? '' : `<div class="alert info mb-3">${icon('info')}<div><b>Read-only</b><p>Selecting and running fixes needs the served console. Open the link the project printed, or run the commands in a terminal.</p></div></div>`}
        ${findingsTable(scan.findings, selected, ctx)}
      </div>`;
}

export function pagePlan(scan, ctx, selected = [], plan = null) {
  const chosen = scan.findings.filter((entry) => selected.includes(entry.id));
  if (!chosen.length) {
    return `
      <div class="page-head seq"><div style="--i:0"><h2>Fix plan</h2><p>Nothing selected yet</p></div></div>
      <div class="card seq" style="--i:1">${empty('The plan is empty', 'Choose findings on the findings page, then come back.')}
        <div class="cluster" style="justify-content:center"><a class="btn btn-primary" href="#/findings">Go to findings</a></div>
      </div>`;
  }
  const steps = plan?.steps ?? [];
  const manual = plan?.manual ?? [];
  let order = 0;
  return `
      <div class="page-head seq">
        <div style="--i:0"><h2>Fix plan</h2><p>${plural(chosen.length, 'finding')} selected · ${steps.length} command${steps.length === 1 ? '' : 's'} to run · ${manual.length} for you</p></div>
        <div class="cluster" style="--i:1">
          <a class="btn btn-ghost" href="#/findings">Change selection</a>
          ${ctx.writable ? `<button type="button" class="btn btn-primary cta-focus" id="runPlan"${steps.length ? '' : ' disabled'}>${icon('arrow')}Run ${steps.length} fix${steps.length === 1 ? '' : 'es'}</button>` : ''}
        </div>
      </div>
      <div class="grid seq" style="--seq-base:60ms">
        <div class="span-8 stack" style="--i:2">
          <div class="plan-group">
            <div class="gh">${icon('check')}The console runs these<span class="badge info">${steps.length}</span></div>
            ${steps.length ? steps.map((step) => `<div class="plan-item" data-step="${escape(step.action)}">
              <span class="ord">${++order}</span>
              <div><b>${escape(step.label)}</b><span>${escape(step.detail)} Covers ${escape(step.covers.join(', '))}.</span></div>
              <div class="meta">${cmd(step.command)}</div>
            </div>`).join('') : '<div class="plan-item"><span class="ord">—</span><div><b>Nothing here can be fixed by a command</b><span>Everything selected needs a decision.</span></div><div class="meta"></div></div>'}
          </div>
          <div class="plan-group">
            <div class="gh">${icon('issues')}These need you<span class="badge neutral">${manual.length}</span></div>
            ${manual.length ? manual.map((entry) => `<div class="plan-item">
              <span class="ord">·</span>
              <div><b>${escape(entry.title)}</b><span>${escape(entry.id)} — no command can decide this one.</span></div>
              <div class="meta">${entry.command ? cmd(entry.command) : ''}</div>
            </div>`).join('') : '<div class="plan-item"><span class="ord">·</span><div><b>Nothing</b><span>Every selected finding has a command behind it.</span></div><div class="meta"></div></div>'}
          </div>
        </div>
        <div class="span-4 stack" style="--i:3">
          <div class="card"><div class="card-head"><div class="card-title">How this runs</div></div>
            <div class="setting"><div><b>One process per fix</b><span>The same command a terminal would run</span></div></div>
            <div class="setting"><div><b>Stops at the first failure</b><span>A failed step never hides behind a later one</span></div></div>
            <div class="setting"><div><b>Output streams here</b><span>Into the console at the bottom of the page</span></div></div>
            <div class="setting"><div><b>Rescans afterwards</b><span>The report then shows what is true, not what was asked for</span></div></div>
          </div>
          <div class="card"><div class="card-head"><div class="card-title">Estimated effort<small>The whole selection</small></div></div>
            <div class="value" style="font-size:26px;font-weight:700">${plan?.hours ?? 0}<small class="t-muted" style="font-size:var(--text-md);margin-left:4px">hours</small></div>
            <p class="t-caption mt-2">A rough size, including the parts no command can do.</p>
          </div>
        </div>
      </div>`;
}

export function pageExecute(scan, ctx, selected = [], run = null) {
  const ran = run?.ran ?? [];
  const done = ran.filter((step) => step.ok).length;
  const percent = ran.length ? Math.round((done / ran.length) * 100) : 0;
  return `
      <div class="page-head seq">
        <div style="--i:0"><h2>Execution</h2><p>${run ? `${done} of ${ran.length} fixes finished${run.stopped ? ' — stopped at a failure' : ''}` : 'Nothing has been run from here yet'}</p></div>
        <div class="cluster" style="--i:1"><a class="btn btn-ghost" href="#/plan">Back to the plan</a></div>
      </div>
      <div class="exec-bar seq" style="--i:2">
        <div><div class="t-caption" style="color:var(--fg-inverse-muted)">Progress</div><b style="font-size:var(--text-2xl)">${percent}%</b></div>
        <span class="bar"><i style="--w:${percent}%"></i></span>
        <div class="cluster">${badge(ran.length && !run?.stopped ? 'ok' : 'neutral', `${done} finished`)}${run?.stopped ? badge('danger', 'stopped') : ''}</div>
      </div>
      <div class="grid seq" style="--seq-base:60ms">
        <div class="card span-7" style="--i:3"><div class="card-head"><div class="card-title">What ran</div></div>
          ${ran.length ? `<div class="timeline">${ran.map((step) => `<div class="t ${step.ok ? 'done' : ''}">
            <i>${icon(step.ok ? 'check' : 'cross')}</i>
            <div><b>${escape(step.command)}</b><span>${step.ok ? `Finished · covers ${escape(step.covers.join(', '))}` : `Exited with ${escape(String(step.code ?? 'no status'))} — nothing after this ran`}</span></div>
            <time>${step.ok ? 'done' : 'failed'}</time></div>`).join('')}</div>`
    : empty('Nothing has run', 'Select findings, review the plan, then run it.')}
          ${run?.manual?.length ? `<div class="mt-4"><div class="t-overline mb-3">Still yours to do</div><div class="todo">${run.manual.map((entry) =>
    `<div class="item">${badge('neutral', 'Manual', false)}<div><b>${escape(entry.title)}</b><span>${escape(entry.id)}</span></div><span></span></div>`).join('')}</div></div>` : ''}
        </div>
        <div class="span-5 stack" style="--i:4">
          <div class="card"><div class="card-head"><div class="card-title">Health after this run</div></div>${scoreRing(scan.score)}</div>
          <div class="alert info">${icon('info')}<div><b>The output is below</b><p>Everything these commands print streams into the console at the bottom of this page, the same way a dispatched agent's output does.</p></div></div>
        </div>
      </div>`;
}

export const SCAN_PAGES = {
  scan: { title: 'Scan report', icon: 'doc', render: pageScan },
  findings: { title: 'Findings', icon: 'issues', render: pageFindings },
  plan: { title: 'Fix plan', icon: 'board', render: pagePlan },
  execute: { title: 'Execution', icon: 'arrow', render: pageExecute },
};

/**
 * The scan pages a browser with no script is given. Plan and execution are left out on purpose:
 * both are about a selection, and there is no selection without a script to make one.
 */
export function renderScanAll(scan, ctx) {
  const section = (hash, html) => `<section id="${hash}" style="scroll-margin-top:12px;display:grid;gap:var(--gutter)">${html}</section>`;
  return [
    section('/scan', pageScan(scan, ctx, [])),
    section('/findings', pageFindings(scan, ctx, [])),
  ].join('\n<hr class="divider">\n');
}
