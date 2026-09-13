// The page itself: state in, one self-contained HTML string out.
//
// Every piece of markup comes from dashboard-render.js, which this file renders with on the
// server and then ships to the browser as source. That is deliberate: the page has to work with
// scripts blocked — it is opened from a file:// path on locked-down machines — so the server
// writes every section out flat, and the script, where it runs, replaces that with the routed
// view. One module generates both, so the fallback cannot quietly rot.
//
// Nothing here is fetched from a network at render time. Atlas is inlined, the only external
// request is the Inter stylesheet, and the page reads correctly without it.

import { STREAM_SCRIPT } from './dashboard-stream.js';
import { escape, navItems, renderAll } from './dashboard-render.js';
import { renderScanAll } from './scan-render.js';
import { CHROME_SCRIPT, browserSource, navLink, shell } from './page-chrome.js';

/** Only what this page adds on top of the design system. */
const PAGE_STYLE = `
#static{display:grid;gap:var(--gutter)}
/* The design system styles gate marks on a board card. In a table they need saying again, or the
   four gates read as the single meaningless word "TERD". */
.table .gates{display:flex;gap:4px;flex-wrap:wrap}
.table .gates span{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:10px;font-weight:700}
.table .gates span.ok{background:var(--ok-bg);color:var(--ok-fg)}
.table .gates span.fail{background:var(--danger-bg);color:var(--danger-fg)}
.table .gates span.na{background:var(--surface-2);color:var(--fg-muted)}
.row-actions a{width:28px;height:28px;border-radius:var(--r-sm);display:grid;place-items:center;color:var(--fg-muted)}
.row-actions a:hover{background:var(--surface-2);color:var(--fg)}
.task h4 a:hover{text-decoration:underline}
body.offline .live i{background:var(--warn-fg)}
body.offline .live::after{content:"· reconnecting"}
#console .lane + .lane{margin-top:var(--sp-4)}
#console .lane h3{font-size:var(--text-sm);font-weight:600;color:var(--fg-muted);margin-bottom:6px}`;

// `</script>` inside the embedded JSON would end the block early; escaping < prevents that.
const embed = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Routing, re-rendering and — where the server offers one — the writes.
 *
 * The write token is asked for, never embedded. If it shipped in the page then the URL would be
 * the credential again, and a URL leaks through history, screenshots and link previews. Reading
 * needs the secret path; changing the project needs something the page was never given.
 */
const APP_SCRIPT = `
let DATA = window.__VIBEKIT__;
const CONTROL = window.__CONTROL__ || null;
const SCAN_URL = window.__SCAN_URL__ || null;
const ctx = { writable: Boolean(CONTROL) };
let route = { name: 'overview', arg: null };

const host = document.getElementById('page');
const staticView = document.getElementById('static');
const view = document.createElement('section');
view.className = 'page active';

function parseHash() {
  const parts = (location.hash.replace(/^#\\//, '') || 'overview').split('/');
  return { name: parts[0] || 'overview', arg: parts[1] || null };
}

function titleOf(where) {
  if (where.name === 'feature') {
    const feature = DATA.features.find((entry) => entry.id === where.arg);
    return feature ? feature.title : 'Feature';
  }
  if (SCAN_PAGES[where.name]) return SCAN_PAGES[where.name].title;
  return (PAGES[where.name] || PAGES.overview).title;
}

// The scan is a separate read from the lifecycle state: it walks every spec, every recorded run
// and every document, which is far too much to redo on the one-second tick the stream uses.
let SCAN = window.__SCAN__ || null;
let picked = [];
let lastRun = null;

async function rescan() {
  if (!SCAN_URL) return;
  try {
    const response = await fetch(SCAN_URL, { cache: 'no-store' });
    if (response.ok) SCAN = await response.json();
  } catch {
    // Offline or the server stopped; the page keeps the scan it already has and says when it was.
  }
}

function renderCurrent() {
  if (!SCAN_PAGES[route.name]) return renderPage(route.name, route.arg, DATA, ctx);
  if (!SCAN) return '<div class="card"><div class="empty"><b>No scan yet</b>Run vibekit scan, or open this page from the served console.</div></div>';
  const plan = fixPlanFor(SCAN, picked);
  if (route.name === 'plan') return pagePlan(SCAN, ctx, picked, plan);
  if (route.name === 'execute') return pageExecute(SCAN, ctx, picked, lastRun);
  return SCAN_PAGES[route.name].render(SCAN, ctx, picked);
}

// What the view last rendered. Compared before touching anything: on a page asking for state
// every two seconds, almost every update has nothing new in it, and the cheapest update is the
// one that never reaches the DOM.
let painted = null;

function paint() {
  painted = apply(view, renderCurrent(), painted);
  const title = titleOf(route);
  document.title = DATA.project.name + ' — ' + title;
  document.getElementById('crumb').innerHTML =
    '<span>VibeKit</span><span>/</span><span>' + escape(DATA.project.name) + '</span><span>/</span><b>' + escape(title) + '</b>';
  const active = route.name === 'feature' ? 'features' : route.name;
  const counts = { features: String(DATA.features.length), tests: DATA.tests.ok + '/' + DATA.tests.suites, issues: String(issuesOf(DATA).length) };
  for (const link of document.querySelectorAll('#nav a')) {
    link.classList.toggle('active', link.dataset.route === active);
    const pip = link.querySelector('.pill');
    if (pip && counts[link.dataset.route] !== undefined) pip.textContent = counts[link.dataset.route];
  }
}

function go() {
  const next = parseHash();
  const same = next.name === route.name && next.arg === route.arg;
  route = next;
  if (!same) painted = null;
  if (same || reduced) {
    paint();
    if (!same) scrollTo({ top: 0, behavior: 'auto' });
  } else {
    view.classList.add('leaving');
    setTimeout(() => { view.classList.remove('leaving'); paint(); scrollTo({ top: 0, behavior: 'auto' }); }, 120);
  }
  if (innerWidth <= 860) document.body.classList.remove('nav-open');
}

/** Replace the state and redraw in place, keeping where the reader was. */
function update(next) {
  DATA = next;
  // No scroll to save: the tree is patched in place, so where you were reading stays where it was.
  paint();
}
window.__update__ = update;

// --- Writes -------------------------------------------------------------------------------
// The token is asked for once per browser and kept there. A JSON content type means a form on
// another site cannot forge one of these requests without the browser asking us first.

const token = () => stored('vibekit-token');

function askToken() {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask on';
    mask.innerHTML = '<div class="modal"><h3>Write token</h3>' +
      '<p>Changing the project needs the token this server printed when it started. It is kept in this browser only.</p>' +
      '<div class="form mt-4"><label>Token<input class="input" type="password" id="tokenInput" autocomplete="off" spellcheck="false"></label></div>' +
      '<div class="actions"><button type="button" class="btn btn-ghost" id="tokenCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="tokenSave">Save</button></div></div>';
    document.body.append(mask);
    const input = mask.querySelector('#tokenInput');
    input.focus();
    const close = (value) => { mask.remove(); resolve(value); };
    mask.querySelector('#tokenCancel').addEventListener('click', () => close(null));
    mask.querySelector('#tokenSave').addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return close(null);
      store('vibekit-token', value);
      close(value);
    });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') mask.querySelector('#tokenSave').click(); });
  });
}

async function act(action, body) {
  if (!CONTROL) return false;
  const key = token() || await askToken();
  if (!key) return false;
  let response;
  try {
    response = await fetch(CONTROL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(Object.assign({ action: action }, body)),
    });
  } catch {
    toast('The server is not reachable');
    return false;
  }
  if (response.status === 401 || response.status === 403) {
    store('vibekit-token', '');
    toast('That token was not accepted');
    return false;
  }
  const result = await response.json().catch(() => ({}));
  if (result.state) update(result.state);
  if (!response.ok) {
    // A refusal is the server's call, never the page's: it holds the gates and the files.
    toast(result.error || 'Refused');
    return false;
  }
  // The action's own payload where it has one, so a caller can show what actually happened.
  return result.result || true;
}

// --- Interactions -------------------------------------------------------------------------

// --- The scan: choosing what to fix, and running it ----------------------------------------
// The selection lives in the page. It is a question about what to do next, not a fact about the
// project, so it is never written anywhere and never survives a reload.

document.addEventListener('change', (event) => {
  const box = event.target.closest && event.target.closest('[data-pick]');
  if (!box) return;
  const id = box.dataset.pick;
  picked = box.checked ? [...new Set([...picked, id])] : picked.filter((entry) => entry !== id);
  // Only the counts move; re-rendering the table here would fight the reader's scroll position.
  for (const link of document.querySelectorAll('.page-head p')) {
    if (/selected/.test(link.textContent)) link.textContent = link.textContent.replace(/\\d+ selected/, picked.length + ' selected');
  }
  for (const button of document.querySelectorAll('a[href="#/plan"]')) {
    button.textContent = button.textContent.replace(/\\(\\d+\\)/, '(' + picked.length + ')');
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest && event.target.closest('#pickFixable, #runPlan, #sevTabs button');
  if (!target) return;

  if (target.id === 'pickFixable') {
    picked = SCAN.findings.filter((entry) => entry.action).map((entry) => entry.id);
    return paint();
  }

  if (target.id === 'runPlan') {
    target.classList.add('loading');
    const result = await act('scan.run', { ids: picked });
    target.classList.remove('loading');
    if (!result) return;
    lastRun = result;
    if (result.scan) SCAN = result.scan;
    // Only findings that still exist can stay selected: the fixed ones are gone.
    picked = picked.filter((id) => SCAN.findings.some((entry) => entry.id === id));
    location.hash = '#/execute';
    return paint();
  }

  // Severity filter: hide rows rather than re-render, so a long list does not jump.
  for (const button of document.querySelectorAll('#sevTabs button')) button.classList.toggle('on', button === target);
  const severity = target.dataset.sev;
  for (const row of document.querySelectorAll('#findingsCard tbody tr')) {
    const entry = SCAN.findings.find((item) => item.id === row.dataset.finding);
    row.hidden = Boolean(severity) && (!entry || entry.severity !== severity);
  }
});

document.addEventListener('input', (event) => {
  if (!event.target.closest || !event.target.closest('#findingSearch')) return;
  const needle = event.target.value.trim().toLowerCase();
  for (const row of document.querySelectorAll('#findingsCard tbody tr')) {
    const entry = SCAN.findings.find((item) => item.id === row.dataset.finding);
    const hay = entry ? (entry.title + ' ' + (entry.file || '')).toLowerCase() : '';
    row.hidden = Boolean(needle) && !hay.includes(needle);
  }
});

document.addEventListener('click', (event) => {
  const tab = event.target.closest && event.target.closest('#ftabs button');
  if (!tab) return;
  for (const button of document.querySelectorAll('#ftabs button')) button.classList.toggle('on', button === tab);
  const stage = tab.dataset.stage;
  for (const row of document.querySelectorAll('#featuresCard tbody tr')) {
    const feature = DATA.features.find((entry) => entry.id === row.dataset.feature);
    row.hidden = Boolean(stage) && (!feature || feature.status !== stage);
  }
});

// --- The tunnel: closing the way in, without closing the console ------------------------------

document.addEventListener('click', async (event) => {
  const target = event.target.closest && event.target.closest('[data-tunnel]');
  if (!target) return;
  const wanted = target.dataset.tunnel;
  target.classList.add('loading');
  const result = await act(wanted === 'stop' ? 'tunnel.stop' : 'tunnel.start', {});
  target.classList.remove('loading');
  if (!result) return;
  // Said plainly, because someone reading over the tunnel is about to lose this page.
  toast(wanted === 'stop' ? 'The tunnel is closed. The console is still running here.' : 'Tunnel open');
});

// --- The queue: pressing Build it is the whole gesture ----------------------------------------
// There is no separate start. The server adds the entry and begins working through the queue, so
// the button reports what the server did rather than what the page hopes will happen.

document.addEventListener('click', async (event) => {
  const target = event.target.closest && event.target.closest('[data-queue], [data-unqueue], #queueClear');
  if (!target) return;

  if (target.id === 'queueClear') {
    const cleared = await act('queue.clear', {});
    if (cleared) toast(cleared.removed ? 'Cleared ' + cleared.removed : 'Nothing to clear');
    return;
  }

  if (target.dataset.unqueue) {
    if (await act('queue.remove', { entry: target.dataset.unqueue })) toast('Removed from the queue');
    return;
  }

  const id = target.dataset.queue;
  target.classList.add('loading');
  const queued = await act('queue.add', { id: id });
  target.classList.remove('loading');
  if (queued) toast(queued.added ? id + ' is queued — an agent is starting' : id + ' is already queued');
});

let dragged = null;
document.addEventListener('dragstart', (event) => {
  const card = event.target.closest && event.target.closest('.task[data-id]');
  if (!card) return;
  dragged = card.dataset.id;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragged);
});
document.addEventListener('dragend', () => {
  for (const card of document.querySelectorAll('.task.dragging')) card.classList.remove('dragging');
  for (const column of document.querySelectorAll('.col.over')) column.classList.remove('over');
});
document.addEventListener('dragover', (event) => {
  const column = event.target.closest && event.target.closest('.col');
  if (!column || !dragged) return;
  event.preventDefault();
  for (const other of document.querySelectorAll('.col.over')) if (other !== column) other.classList.remove('over');
  column.classList.add('over');
});
document.addEventListener('drop', async (event) => {
  const column = event.target.closest && event.target.closest('.col');
  if (!column || !dragged) return;
  event.preventDefault();
  const id = dragged;
  dragged = null;
  const feature = DATA.features.find((entry) => entry.id === id);
  if (!feature || feature.status === column.dataset.col) return paint();
  const moved = await act('feature.status', { id: id, status: column.dataset.col });
  // A refused move is never shown as a move: redrawing from the state puts the card back.
  if (moved) toast(id + ' is now ' + STAGE_WORDS[column.dataset.col]);
  else paint();
});

addEventListener('hashchange', go);

// The server-rendered sections are what a browser with no script shows. Once there is a script,
// the routed view replaces them entirely rather than sitting beside a second copy of everything.
if (staticView) staticView.remove();
host.append(view);
route = parseHash();
paint();
`;

/**
 * The whole page as one self-contained string.
 *
 * `live` adds the meta-refresh that keeps a local file current while a job runs; `stream`
 * replaces it with a server-sent-events connection that re-renders in place. `control` is the
 * URL that accepts writes — present only when the console is being served.
 */
export function renderDashboard(state, { live = false, intervalSeconds = 3, stream = false, control = null, scan = null, scanUrl = null } = {}) {
  const meta = [state.project.engine, state.project.autonomy === 'gated' ? 'gated' : 'auto-plan'].filter(Boolean);
  const when = new Date(state.project.generatedAt).toLocaleTimeString();
  const ctx = { writable: Boolean(control) };
  const stamp = stream
    ? `<span class="live"><i></i>Live · Updated <span id="updated">${escape(when)}</span></span>`
    : `<span class="badge ${live ? 'ok' : 'neutral'}">${live ? 'Live · ' : ''}Updated ${escape(when)}</span>`;

  const script = [
    CHROME_SCRIPT,
    browserSource(),
    `window.__VIBEKIT__ = ${embed(state)};`,
    scan ? `window.__SCAN__ = ${embed(scan)};` : '',
    scanUrl ? `window.__SCAN_URL__ = ${embed(scanUrl)};` : '',
    control ? `window.__CONTROL__ = ${embed(control)};` : '',
    APP_SCRIPT,
    stream ? STREAM_SCRIPT : '',
  ].filter(Boolean).join('\n');

  // Two groups, because they answer different questions: where the work has got to, and what is
  // wrong with it. The scan links only appear where there is a scan behind them.
  const rail = [
    '<div class="nav-label">Project</div>',
    `<nav class="nav" id="nav" aria-label="Project">${navItems(state).map(navLink).join('')}\n    </nav>`,
    ...(scan ? [
      '<div class="nav-label">Scan</div>',
      `<nav class="nav" id="scanNav" aria-label="Scan">${[
        { href: '#/scan', label: 'Report', icon: 'doc', route: 'scan' },
        { href: '#/findings', label: 'Findings', icon: 'issues', route: 'findings', pip: String(scan.findings.length) },
        { href: '#/plan', label: 'Fix plan', icon: 'board', route: 'plan' },
        { href: '#/execute', label: 'Execution', icon: 'arrow', route: 'execute' },
      ].map(navLink).join('')}\n    </nav>`,
    ] : []),
  ].join('\n    ');

  return shell({
    title: `${state.project.name} — lifecycle`,
    name: state.project.name,
    sub: `Delivery lifecycle${meta.length ? ` · ${meta.join(' · ')}` : ''}`,
    // The rail is narrow and clips; the engine and autonomy are already in the topbar subtitle.
    brand: 'Delivery lifecycle',
    crumb: state.project.name,
    rail,
    foot: `    <div class="side-foot"><div class="user">
      <div class="avatar" style="background:var(--surface-2);color:var(--fg)">${escape(state.project.name.slice(0, 1).toUpperCase())}</div>
      <div><b>${escape(state.project.name)}</b><span>specs/project.json</span></div>
    </div></div>`,
    right: stamp,
    head: live && !stream ? `<meta http-equiv="refresh" content="${intervalSeconds}">\n` : '',
    style: PAGE_STYLE,
    script,
    body: `      <div id="static">\n${renderAll(state, ctx)}${scan ? `\n<hr class="divider">\n${renderScanAll(scan, ctx)}` : ''}\n      </div>`,
  });
}
