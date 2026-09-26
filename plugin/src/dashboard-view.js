import { CHROME_SCRIPT, browserSource, shell } from './page-chrome.js';
import { escape, renderAll } from './dashboard-render.js';

/**
 * The served page. Specification §57.
 *
 * One screen, four cards, ordered by what needs a human most. There is no navigation and no
 * routing: the whole point is a decision somebody can make in one read, on a phone, between other
 * things. A page with tabs asks the reader to remember where they were, which is exactly what the
 * plain-language rule exists to avoid.
 */

const embed = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const PAGE_STYLE = `
.wrap{max-width:980px;margin:0 auto;padding-block:8px 48px}
.next{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;
  background:var(--surface-2);border:1px solid var(--border);border-left:3px solid var(--accent);
  border-radius:10px;padding:14px 16px;margin-bottom:14px}
.next.human{border-left-color:var(--danger-fg)}
.next .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-muted)}
.next p{margin:2px 0 0;font-weight:600}
.strip{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px;font-size:13px;color:var(--fg-muted)}
.bar{background:var(--surface-2);border-radius:99px;height:8px;overflow:hidden;flex:1;min-width:140px}
.bar i{display:block;height:100%;background:var(--accent);border-radius:99px}
.bar.thin{height:6px;max-width:220px}
.bar.danger i{background:var(--danger-fg)}
.cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px}
.card-head{margin-bottom:12px}
.card-title{display:flex;gap:8px;align-items:center}
.card-title h2{font-size:16px;margin:0}
.card-title .ic{width:18px;height:18px;color:var(--fg-muted)}
.pip{background:var(--danger-bg);color:var(--danger-fg);border-radius:99px;font-size:11px;font-weight:700;padding:1px 7px}
.card-sub{margin:2px 0 0;font-size:12.5px;color:var(--fg-muted)}
.items{display:flex;flex-direction:column;gap:14px}
.item{border:1px solid var(--border);border-radius:9px;padding:12px}
.item.blocking{border-left:3px solid var(--danger-fg)}
.plain{margin:0 0 6px;font-size:14.5px;line-height:1.5}
.why{margin:6px 0 0;font-size:13px;color:var(--fg-muted)}
.checkpoint{margin:8px 0 0;padding:8px 10px;background:var(--bg-subtle,#f5f6f8);border-radius:6px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.options{margin:8px 0;padding-left:20px;font-size:13.5px}
.options li{margin:3px 0}
.item-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.act{font:inherit;font-size:13px;font-weight:500;padding:8px 14px;border-radius:999px;cursor:pointer;
  border:1px solid var(--fg);background:var(--fg);color:var(--bg)}
.act.ghost{background:transparent;color:var(--fg);border-color:var(--border)}
.act:disabled{opacity:.5;cursor:default}
.detail{margin:0}
.detail summary{cursor:pointer;font-size:12px;color:var(--fg-muted)}
.detail-body{padding:8px 0 0}
.mono{font-family:var(--mono,ui-monospace,monospace);font-size:12px;color:var(--fg-muted);margin:0}
.criteria{margin:6px 0 0;padding-left:18px;font-size:13px}
.criteria li{margin:4px 0}
.stage{margin:0 0 8px;font-size:14px}
.columns{display:flex;gap:12px;overflow-x:auto;padding-top:10px}
.column{min-width:150px;flex:1}
.column-head{display:flex;justify-content:space-between;font-size:11.5px;text-transform:uppercase;
  letter-spacing:.05em;color:var(--fg-muted);margin-bottom:6px}
.chip{background:var(--surface-2);border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:13px}
.chip b{display:block;font-weight:600}
.chip.danger{border-left:2px solid var(--danger-fg)}
.chip.accent{border-left:2px solid var(--accent)}
.chip.ok{border-left:2px solid var(--ok-fg)}
.findings{margin:8px 0 0;padding-left:18px;font-size:13.5px}
.findings li{margin:4px 0}
.ok-line{display:flex;gap:6px;align-items:center;font-size:13.5px;color:var(--ok-fg);margin:8px 0 0}
.ok-line .ic{width:16px;height:16px}
.empty{font-size:13.5px;color:var(--fg-muted);margin:4px 0 0}
.muted{color:var(--fg-muted)}
.small{font-size:12px}
.tunnel{margin-top:18px;border:1px dashed var(--border);border-radius:10px;padding:14px}
.tunnel.on{border-style:solid}
.tunnel .qr{width:132px;height:132px;image-rendering:pixelated;margin-top:8px}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--fg);color:var(--bg);
  padding:9px 16px;border-radius:8px;font-size:13.5px;opacity:0;pointer-events:none;transition:opacity .2s}
.toast.show{opacity:1}
.hero{display:grid;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:14px}
.hero .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-muted)}
.hero h2{margin:2px 0 0;font-size:20px;letter-spacing:-.01em}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{background:var(--surface-2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;border-left:3px solid var(--border-strong)}
.kpi b{font-size:22px;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi span{font-size:12px;color:var(--fg-muted)}
.kpi.danger{border-left-color:var(--danger-fg)}.kpi.ok{border-left-color:var(--ok-fg)}.kpi.accent{border-left-color:var(--accent)}.kpi.warn{border-left-color:var(--warn-fg)}
.choices{display:grid;gap:8px;margin:10px 0 4px}
.act.choice{display:flex;align-items:center;gap:10px;text-align:left;background:var(--surface-2);color:var(--fg);border:1px solid var(--border);padding:11px 12px;min-height:44px;font-weight:500}
.act.choice:hover{border-color:var(--accent);background:var(--accent-tint,var(--surface-2))}
.act.choice .n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:99px;background:var(--accent);color:#fff;font-size:12px;font-weight:700;flex:none}
.act.danger{background:var(--danger-fg);border-color:var(--danger-fg)}
.act.sq{padding:6px 8px;min-width:36px;display:inline-grid;place-items:center}
.act.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.ic-sm{width:14px;height:14px;vertical-align:-2px}
.add{display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap}
.add .input{flex:1;min-width:200px;min-height:44px}
.column.current{background:var(--accent-tint,transparent);border-radius:10px;padding:6px}
.column.closed{opacity:.7}
.column-head em{font-style:normal;text-transform:none;letter-spacing:0;color:var(--fg);margin-left:4px}
.chip .step{display:block;font-size:12px;color:var(--fg-muted);margin-top:2px}
.chip-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.chip-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.chip-actions .act{font-size:12px;padding:6px 10px}
.chip.bug{border-left:2px solid var(--danger-fg)}
.sizes{display:inline-flex;gap:2px}
.log{margin:6px 0 0;padding-left:16px;font-size:12px;color:var(--fg-muted)}
.frameworks{display:grid;gap:8px;margin:10px 0}
.framework{display:grid;grid-template-columns:120px 1fr auto;gap:10px;align-items:center;font-size:13px}
.fw-name{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}
.fw-nums{color:var(--fg-muted);font-size:12px;white-space:nowrap}
.stack-bar{display:flex;height:10px;border-radius:99px;overflow:hidden;background:var(--surface-2)}
.stack-bar i{display:block;height:100%}.stack-bar i.ok{background:var(--ok-fg)}.stack-bar i.danger{background:var(--danger-fg)}.stack-bar i.neutral{background:var(--border-strong)}
.badge.sev-high{background:var(--danger-bg);color:var(--danger-fg)}.badge.sev-medium{background:var(--warn-bg);color:var(--warn-fg)}.badge.sev-low{background:var(--surface-2);color:var(--fg-muted)}
.timeline-list{margin:8px 0;padding-left:18px;font-size:13.5px}.timeline-list li{margin:4px 0}.timeline-list li.done{color:var(--fg-muted)}.timeline-list li.now b{color:var(--accent)}
.doclist,.team{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:8px}
.doclist li,.team li{display:flex;gap:8px;align-items:center;font-size:13.5px}
.team .avatar.sm{width:26px;height:26px;font-size:12px;display:inline-grid;place-items:center;border-radius:99px;background:var(--surface-2)}
.act{min-height:36px}
@media (max-width:640px){.cards{grid-template-columns:1fr}.wrap{padding-inline:4px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.framework{grid-template-columns:1fr;gap:4px}.act{min-height:44px}}
`;

/**
 * The client. It re-renders from the payload and posts actions through the same control endpoint
 * the CLI writes through, so a decision made here and a decision made in a terminal go through
 * the same checks. A page that could move a card the CLI would refuse would be a way around the
 * gates rather than a view of them.
 */
const APP_SCRIPT = `
(function () {
  var state = window.__VIBEKIT__;
  var control = window.__CONTROL__ || null;
  var host = document.getElementById('static');

  function paint() { host.innerHTML = renderAll(state, { writable: Boolean(control) }); }

  function toast(message) {
    var el = document.getElementById('toast');
    el.textContent = message; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // §57 — offline, actions queue on the device and replay in order on reconnect. The queue lives
  // in localStorage under this console's own address, so two consoles never share one.
  var QUEUE_KEY = control ? 'vibekit-queue:' + control.url : null;
  function readQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (error) { return []; } }
  function writeQueue(items) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)); } catch (error) {} paintQueue(); }
  function paintQueue() {
    var el = document.getElementById('queued');
    if (!el) return;
    var n = readQueue().length;
    el.textContent = n ? n + ' decision' + (n === 1 ? '' : 's') + ' queued — sent when you are back online' : '';
  }

  // What the page believed about the target when the decision was made. The server compares it
  // with the file, so a decision about a situation that has since changed is shown again, not applied.
  function statusOf(action, id) {
    var list = action.indexOf('req.') === 0 ? (state.requirements || []) : action.indexOf('ask.') === 0 ? (state.asks || []) : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].status || null;
    return null;
  }

  function headers() {
    return { 'content-type': 'application/json', 'authorization': 'Bearer ' + control.token, 'x-vibekit-token': control.token };
  }

  // 'done' | 'refused' | 'unreachable'
  async function deliver(entry, reconfirmed) {
    try {
      var payload = Object.assign({ action: entry.action }, entry.body, { decidedAt: entry.at });
      if (entry.expect && entry.expect.status && !reconfirmed) payload.expect = entry.expect;
      var response = await fetch(control.url, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
      var result = await response.json().catch(function () { return {}; });
      if (result.state) { state = result.state; paint(); }
      if (response.status === 409 && result.changed) {
        if (window.confirm(result.error + '\\n\\nApply it anyway?')) return deliver(entry, true);
        toast('Not applied.');
        return 'refused';
      }
      if (!response.ok) { toast(result.error || 'Refused.'); return 'refused'; }
      toast((result.result && result.result.message) || result.message || 'Done.');
      return 'done';
    } catch (error) { return 'unreachable'; }
  }

  async function replay() {
    var items = readQueue();
    while (items.length) {
      var outcome = await deliver(items[0]);
      if (outcome === 'unreachable') break;   // still offline: the rest waits, in order
      items = items.slice(1);
      writeQueue(items);
    }
  }

  async function send(action, body) {
    if (!control) return toast('This page is read-only.');
    var entry = { action: action, body: body, expect: { status: statusOf(action, body.id) }, at: new Date().toISOString() };
    if (navigator.onLine === false) {
      writeQueue(readQueue().concat([entry]));
      return toast('Offline — queued. It is sent when you are back.');
    }
    if (await deliver(entry) === 'unreachable') {
      writeQueue(readQueue().concat([entry]));
      toast('Could not reach the server — queued.');
    }
  }

  window.addEventListener('online', replay);
  if (QUEUE_KEY) { paintQueue(); replay(); }
  if ('serviceWorker' in navigator && window.__SW_URL__) navigator.serviceWorker.register(window.__SW_URL__).catch(function () {});

  // Who is acting. Behind Cloudflare Access the server knows from the login and ignores this; on
  // the shared-token console it is the name that goes on the approval line and the commit.
  function whoAmI() {
    var name = null;
    try { name = localStorage.getItem('vibekit-name'); } catch (error) {}
    if (!name) {
      name = window.prompt('Your name, for the approval line and the commit');
      if (!name) return null;
      try { localStorage.setItem('vibekit-name', name); } catch (error) {}
    }
    return name;
  }

  // The order of the sprint a card sits in, with one id moved up or down by a step.
  function reordered(id, direction) {
    var sprints = (state.sprints && state.sprints.sprints) || [];
    for (var i = 0; i < sprints.length; i++) {
      var ids = sprints[i].ids.slice();
      var at = ids.indexOf(id);
      if (at === -1) continue;
      var to = at + direction;
      if (to < 0 || to >= ids.length) return null;
      ids.splice(at, 1); ids.splice(to, 0, id);
      return ids;
    }
    return null;
  }

  document.addEventListener('click', function (event) {
    var copy = event.target.closest && event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard && navigator.clipboard.writeText(copy.getAttribute('data-copy'));
      return toast('Copied.');
    }
    var button = event.target.closest && event.target.closest('.act');
    if (!button || button.type === 'submit') return;
    var id = button.getAttribute('data-id');
    var act = button.getAttribute('data-act');

    if (act === 'option') return send('ask.answer', { id: id, answer: button.getAttribute('data-option') });
    if (act === 'answer' || act === 'reject') {
      var answer = window.prompt(act === 'answer' ? 'Your answer, in your own words' : 'Why not?');
      if (!answer) return;
      return send('ask.' + (act === 'answer' ? 'answer' : 'reject'), { id: id, answer: answer });
    }
    if (act === 'keep' || act === 'not-lesson') return send('memory.accept', { id: id, accept: act === 'keep', by: whoAmI() });
    if (act === 'approve') { var who = whoAmI(); if (!who) return; return send('gate.approve', { stage: id, by: who }); }
    if (act === 'reject-gate') {
      var note = window.prompt('What has to change before this stage can pass?');
      if (!note) return;
      return send('gate.approve', { stage: id, by: whoAmI(), reject: true, note: note });
    }
    if (act === 'done') return send('req.status', { id: id, status: 'done' });
    if (act === 'release') return send('req.release', { id: id });
    if (act === 'start') {
      var runner = window.prompt('Which runner takes it? (claude-code, cursor, api)', 'claude-code');
      if (!runner) return;
      return send('req.start', { id: id, runner: runner, role: 'implementer' });
    }
    if (act === 'size') return send('req.size', { id: id, size: button.getAttribute('data-size') });
    if (act === 'severity') return send('bug.severity', { id: id, severity: button.getAttribute('data-severity') });
    if (act === 'up' || act === 'down') {
      var order = reordered(id, act === 'up' ? -1 : 1);
      if (!order) return toast('Already at the edge of its sprint.');
      return send('plan.reorder', { order: order, by: whoAmI() });
    }
    if (act === 'defer') {
      if (!window.confirm('Move this out of the plan, into Deferred?')) return;
      return send('plan.reorder', { order: [], defer: [id], by: whoAmI() });
    }
    if (act === 'note') {
      var text = window.prompt('Your note — it is written to the file with your name and the time');
      if (!text) return;
      return send('note.add', { id: id, text: text, by: whoAmI() });
    }
    if (act === 'hotfix') {
      var broken = window.prompt('What is broken in production? One sentence, as a person sees it');
      if (!broken) return;
      return send('req.hotfix', { title: broken });
    }
  });

  // The two forms: add a piece of work, log a bug. Plain forms so the keyboard's return key works.
  document.addEventListener('submit', function (event) {
    var form = event.target.closest && event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    var title = (form.elements.title.value || '').trim();
    if (!title) return;
    var which = form.getAttribute('data-form');
    send('req.add', which === 'bug' ? { title: title, kind: 'bug', size: 'S' } : { title: title });
    form.reset();
  });

  window.__VIBEKIT_APPLY__ = function (next) { state = next; paint(); };
  paint();
})();
`;

const STREAM_SCRIPT = `
(function () {
  if (!window.__STREAM_URL__) return;
  var source = new EventSource(window.__STREAM_URL__);
  source.addEventListener('state', function (event) {
    try { window.__VIBEKIT_APPLY__(JSON.parse(event.data)); } catch (error) {}
  });
})();
`;

/**
 * §57 — "a progressive web app: installable on a phone, works offline for reading". The worker
 * caches the page itself and nothing else: the feeds and the control endpoint always go to the
 * network, because a stale answer to "what needs me" is worse than none, and a queued decision is
 * the page's job, not the worker's. Network first, so an online reader always sees the live page.
 */
export const serviceWorker = (prefix) => `// generated by vibekit · the tracker's offline shell
var SHELL = ${JSON.stringify(`${prefix}/`)};
var CACHE = 'vibekit-tracker-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname !== SHELL && url.pathname !== SHELL.slice(0, -1)) return;
  event.respondWith(fetch(event.request).then(function (response) {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) { cache.put(SHELL, copy); });
    return response;
  }).catch(function () {
    return caches.match(SHELL).then(function (cached) {
      return cached || new Response('Offline, and this page has not been opened here before.', { status: 503, headers: { 'content-type': 'text/plain' } });
    });
  }));
});
`;

export const webManifest = ({ name, start }) => ({
  name: `${name} — tracker`,
  short_name: name.slice(0, 12),
  start_url: start,
  scope: start,
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#000000',
  icons: [],
});

export function renderDashboard(state, { live = false, intervalSeconds = 3, stream = false, control = null, streamUrl = null, prefix = null } = {}) {
  const when = new Date(state.project.generatedAt).toLocaleTimeString();
  const ctx = { writable: Boolean(control) };
  const stamp = stream
    ? `<span class="live"><i></i>Live · Updated <span id="updated">${escape(when)}</span></span>`
    : `<span class="badge ${live ? 'ok' : 'neutral'}">${live ? 'Live · ' : ''}Updated ${escape(when)}</span>`;

  const script = [
    CHROME_SCRIPT,
    browserSource(),
    `window.__VIBEKIT__ = ${embed(state)};`,
    control ? `window.__CONTROL__ = ${embed(control)};` : '',
    streamUrl ? `window.__STREAM_URL__ = ${embed(streamUrl)};` : '',
    prefix ? `window.__SW_URL__ = ${embed(`${prefix}/sw.js`)};` : '',
    APP_SCRIPT,
    stream ? STREAM_SCRIPT : '',
  ].filter(Boolean).join('\n');
  const pwa = prefix ? `<link rel="manifest" href="${escape(`${prefix}/manifest.webmanifest`)}">\n<meta name="theme-color" content="#000000">\n` : '';

  return shell({
    title: `${state.project.name} — tracker`,
    name: state.project.name,
    sub: `Stage ${state.stage.n} · ${state.stage.name}`,
    brand: 'Tracker',
    crumb: state.project.name,
    // One scrolling screen; the rail jumps to its sections. §70's screens, in the order a person needs them.
    navLabel: state.project.name,
    nav: [
      { href: '#card-needs-you', label: 'Needs you', icon: 'ask', pip: (state.needsYou ?? []).length ? String(state.needsYou.length) : '' },
      { href: '#card-where', label: 'Board', icon: 'board' },
      { href: '#card-bugs', label: 'Bugs', icon: 'issues', pip: (state.bugs ?? []).filter((bug) => bug.status !== 'done').length ? String((state.bugs ?? []).filter((bug) => bug.status !== 'done').length) : '' },
      { href: '#card-security', label: 'Security', icon: 'shield' },
      { href: '#card-cost', label: 'Cost', icon: 'doc' },
      { href: '#card-schedule', label: 'Schedule', icon: 'clock' },
      { href: '#card-docs', label: 'Docs', icon: 'doc' },
      { href: '#card-team', label: 'Team', icon: 'features' },
    ],
    foot: `    <div class="side-foot"><div class="user">
      <div class="avatar" style="background:var(--surface-2);color:var(--fg)">${escape(state.project.name.slice(0, 1).toUpperCase())}</div>
      <div><b>${escape(state.project.name)}</b><span>${escape(state.folder)}/</span></div>
    </div></div>`,
    right: stamp,
    head: `${pwa}${live && !stream ? `<meta http-equiv="refresh" content="${intervalSeconds}">\n` : ''}`,
    style: PAGE_STYLE,
    script,
    body: `      <div class="wrap"><p class="small muted" id="queued" role="status"></p><div id="static">\n${renderAll(state, ctx)}\n      </div></div>\n      <div class="toast" id="toast" role="status"></div>`,
  });
}
