// The look shared by every page this CLI generates: the dashboard and the wizard.
//
// It lives in one place because the alternative — two stylesheets that are meant to match — drifts
// the first time either one is touched. Both pages call `shell()`, so a change to the rail, the
// cards or the palette lands on both at once.
//
// Two deliberate departures from the design it is based on:
//
//   * No web fonts. The dashboard is opened from a file:// path while a build runs, often on a
//     locked-down machine, and a blocked font request would leave it rendering in Times. System
//     faces are already installed everywhere and cost nothing to fetch.
//   * No scripts in the chrome itself. Rail navigation is anchors, not click handlers, so the
//     dashboard stays script-free; the wizard adds its own script for the form.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (char) => ENTITIES[char]);

// ── Icons ───────────────────────────────────────────────────────────────────────────────────
// Stroked 24×24 paths, drawn by CSS `stroke: currentColor` so they invert with the rail state.

export const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  tests: '<path d="m9 11 2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
  tools: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  issues: '<path d="M12 8v5M12 17h.01"/><path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  stack: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  spark: '<path d="m12 2 2.6 6.6L21 10l-5 4.4L17.5 21 12 17.6 6.5 21 8 14.4 3 10l6.4-1.4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
};

/** The brand mark: three orbits around a small node graph. Inline so it needs no asset. */
const MARK = `
<svg class="mk" width="30" height="30" viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="vcA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c8ff5c"/><stop offset="1" stop-color="#5cb82f"/></linearGradient>
    <linearGradient id="vcB" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fd92c"/><stop offset="1" stop-color="#2f7a34"/></linearGradient>
  </defs>
  <path d="M50 9a41 41 0 1 1-29 12" fill="none" stroke="url(#vcA)" stroke-width="7.5" stroke-linecap="round"/>
  <ellipse cx="50" cy="50" rx="41" ry="24" fill="none" stroke="url(#vcB)" stroke-width="5.5" opacity=".55" transform="rotate(38 50 50)"/>
  <ellipse cx="50" cy="50" rx="41" ry="24" fill="none" stroke="url(#vcB)" stroke-width="5.5" opacity=".35" transform="rotate(-38 50 50)"/>
  <circle cx="50" cy="50" r="21" fill="url(#vcA)"/>
  <g stroke="#14210f" stroke-width="2.6" stroke-linecap="round" fill="#14210f">
    <circle cx="42" cy="43" r="3"/><circle cx="42" cy="57" r="3"/><circle cx="59" cy="50" r="3.4"/>
    <path d="M45 43.5 56 49"/><path d="M45 56.5 56 51"/></g>
</svg>`;

// ── Styles ──────────────────────────────────────────────────────────────────────────────────

export const THEME = `
:root{
  color-scheme:dark light;
  --bg:#0a0b0a; --surf:#121412; --surf2:#191c19; --surf3:#232722;
  --line:rgba(255,255,255,.07); --line2:rgba(255,255,255,.13);
  --tx:#f4f5f2; --tx2:#9ea19a; --tx3:#6b6f68;
  --lime:#b6f24a; --lime2:#8fd92c; --cy:#22d3ee; --vi:#a78bfa; --am:#fbbf24; --rd:#fb7185;
  --grad:linear-gradient(135deg,#c8ff5c,#8fd92c);
  --r:18px; --rail:72px;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: light){
  :root:not([data-t="dark"]){
    --bg:#f4f5f1; --surf:#fff; --surf2:#fafaf8; --surf3:#eeeeec;
    --line:rgba(23,23,23,.09); --line2:rgba(23,23,23,.16);
    --tx:#171717; --tx2:#5e5e5c; --tx3:#83837f;
    --lime:#5f9e0c; --lime2:#4c7f08; --grad:linear-gradient(135deg,#8fd92c,#5f9e0c);
    --am:#9a6a00; --rd:#c2384c; --vi:#6d4bd6; --cy:#0e7d95;
  }
}
:root[data-t="light"]{
  --bg:#f4f5f1; --surf:#fff; --surf2:#fafaf8; --surf3:#eeeeec;
  --line:rgba(23,23,23,.09); --line2:rgba(23,23,23,.16);
  --tx:#171717; --tx2:#5e5e5c; --tx3:#83837f;
  --lime:#5f9e0c; --lime2:#4c7f08; --grad:linear-gradient(135deg,#8fd92c,#5f9e0c);
  --am:#9a6a00; --rd:#c2384c; --vi:#6d4bd6; --cy:#0e7d95;
}

*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.55 var(--sans);
  -webkit-font-smoothing:antialiased;min-height:100vh}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(680px 460px at 88% -6%,rgba(182,242,74,.10),transparent 60%),
             radial-gradient(520px 400px at 4% 2%,rgba(52,211,153,.05),transparent 58%)}
a{color:var(--lime);text-decoration:none}
a:hover{text-decoration:underline}
code{font:12px/1.5 var(--mono);background:var(--surf2);border:1px solid var(--line);
  padding:1px 6px;border-radius:5px;color:var(--tx2)}
pre{background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:15px 17px;
  overflow:auto;font:12px/1.75 var(--mono);color:var(--tx2);margin:0}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:var(--tx2)} .faint{color:var(--tx3)} .small{font-size:12.5px}

/* ── shell ── */
.shell{display:flex;min-height:100vh;position:relative;z-index:1}
.side{width:var(--rail);flex-shrink:0;background:var(--surf);border-right:1px solid var(--line);
  position:sticky;top:0;height:100vh;display:flex;flex-direction:column;align-items:center;
  padding:14px 0;gap:3px}
.sbrand{display:grid;place-items:center;width:100%;padding:4px 0 16px}
.mk{filter:drop-shadow(0 0 12px rgba(182,242,74,.28))}
.nb{width:46px;height:46px;display:grid;place-items:center;border-radius:14px;color:var(--tx2);
  position:relative;flex-shrink:0;transition:background .2s,color .2s}
.nb:hover{background:var(--surf2);color:var(--tx);text-decoration:none}
.nb.on{background:var(--grad);color:#0d1108;box-shadow:0 6px 20px rgba(182,242,74,.22)}
.nb svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8}
.nb .pip{position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--am)}
.nb .pip.rd{background:var(--rd)}
.nb.on .pip{box-shadow:0 0 0 2px #0d1108}
.nb .lbl{position:absolute;left:calc(100% + 12px);top:50%;transform:translateY(-50%);
  background:var(--surf2);border:1px solid var(--line2);border-radius:10px;padding:6px 11px;
  font-size:12.5px;color:var(--tx);white-space:nowrap;opacity:0;pointer-events:none;
  transition:opacity .18s;z-index:30}
.nb:hover .lbl{opacity:1}

.mainarea{flex:1;min-width:0}
.tbar{min-height:70px;display:flex;align-items:center;gap:16px;padding:12px 26px;flex-wrap:wrap}
.crumb{display:flex;flex-direction:column;min-width:0}
.crumb b{font-size:17px;font-weight:600;letter-spacing:-.4px}
.crumb i{font-style:normal;font-size:12.5px;color:var(--tx3);margin-top:2px}
.tright{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.stamp{display:flex;align-items:center;gap:8px;background:var(--surf);border:1px solid var(--line);
  border-radius:999px;padding:7px 14px;font-size:12.5px;color:var(--tx2);white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;background:var(--lime);
  box-shadow:0 0 0 3px rgba(182,242,74,.16)}
.wrap{padding:6px 26px 64px;max-width:1360px}

/* ── cards ── */
.cd{background:var(--surf);border:1px solid var(--line);border-radius:var(--r);padding:20px 22px;
  margin-bottom:16px;scroll-margin-top:20px}
.cd > h2{font-size:15.5px;font-weight:600;letter-spacing:-.25px;margin:0 0 4px;
  display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.cs{font-size:12.5px;color:var(--tx3);margin:0 0 16px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px}
.hdr > div{min-width:0}
.eyebrow{font-size:10.5px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--tx3)}
.g{display:grid;gap:16px}
.g2{grid-template-columns:1fr 1fr}
.section{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.section-head{display:flex;gap:10px;align-items:baseline;justify-content:space-between;
  margin-bottom:10px;flex-wrap:wrap}

/* ── stat cards ── */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}
.st2{background:var(--surf);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;
  display:flex;flex-direction:column;gap:4px}
.st2 .lb2{font-size:12.5px;color:var(--tx2);font-weight:500}
.st2 .vl2{font-family:var(--sans);font-size:30px;font-weight:600;letter-spacing:-1.1px;
  margin-top:8px;line-height:1;font-variant-numeric:tabular-nums}
.st2 .ft2{font-size:12.5px;color:var(--tx3);margin-top:8px}
.st2.good .vl2{color:var(--lime)}
.st2.warn .vl2{color:var(--am)}
.st2.bad .vl2{color:var(--rd)}

/* ── pills, badges, chips ── */
.tg{font-size:11.5px;font-weight:600;padding:4px 11px;border-radius:999px;white-space:nowrap;
  background:var(--surf3);color:var(--tx3)}
.g-lime{background:rgba(182,242,74,.14);color:var(--lime)}
.g-cy{background:rgba(34,211,238,.14);color:var(--cy)}
.g-vi{background:rgba(167,139,250,.15);color:var(--vi)}
.g-am{background:rgba(251,191,36,.15);color:var(--am)}
.g-rd{background:rgba(251,113,133,.15);color:var(--rd)}
.pill{font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap;
  background:var(--surf3);color:var(--tx3)}
.pill.ok{background:rgba(182,242,74,.14);color:var(--lime)}
.pill.flaky{background:rgba(251,191,36,.15);color:var(--am)}
.pill.failed{background:rgba(251,113,133,.15);color:var(--rd)}
.pill.missing,.pill.neutral{background:var(--surf3);color:var(--tx3)}
.badge{font-size:11.5px;font-weight:600;padding:4px 11px;border-radius:8px;white-space:nowrap;
  background:var(--surf3);color:var(--tx3)}
.badge.approved,.badge.planned{background:rgba(34,211,238,.13);color:var(--cy)}
.badge.in-progress{background:rgba(251,191,36,.15);color:var(--am)}
.badge.done{background:rgba(182,242,74,.14);color:var(--lime)}
.chip{font-size:11.5px;font-weight:600;padding:4px 11px;border-radius:999px;cursor:help;
  background:rgba(182,242,74,.13);color:var(--lime)}
.chip.blocked{background:rgba(251,113,133,.15);color:var(--rd)}
.chip.off{background:var(--surf3);color:var(--tx3);text-decoration:line-through}
.chips{display:flex;gap:7px;flex-wrap:wrap}

/* ── tables ── */
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);
  font-weight:600;padding:12px 15px;background:var(--surf2);border-bottom:1px solid var(--line);
  white-space:nowrap}
td{padding:12px 15px;border-bottom:1px solid var(--line);vertical-align:middle;color:var(--tx2)}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:rgba(182,242,74,.035)}
.row-title{display:block;color:var(--tx3);font-size:12px;margin-top:2px}
.cmd{font-size:11px;white-space:nowrap}

/* ── meters ── */
.meter{display:inline-block;vertical-align:middle;width:76px;height:5px;background:var(--surf3);
  border-radius:3px;overflow:hidden;margin-left:8px}
.meter-fill{display:block;height:100%;background:var(--grad)}
.bar{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--tx2)}
.bar-label{color:var(--tx3);width:64px;flex:none}
.bar .meter{flex:1;width:auto;margin-left:0}
.bar-count{color:var(--tx2);font-variant-numeric:tabular-nums;width:52px;text-align:right;flex:none}

/* ── key/value rows and lists ── */
.kv2{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:11px 0;
  border-bottom:1px solid var(--line);font-size:13.5px;color:var(--tx2)}
.kv2:last-child{border-bottom:0}
.kv2 b{font-size:14.5px;font-weight:600;color:var(--tx)}
.li{display:flex;align-items:center;gap:13px;padding:12px 0;border-bottom:1px solid var(--line)}
.li:last-child{border-bottom:0}
.li .bd{flex:1;min-width:0}
.li .bd b{display:block;font-size:13.5px;font-weight:500;color:var(--tx)}
.li .bd i{font-style:normal;display:block;font-size:12.5px;color:var(--tx3);margin-top:2px}

/* ── stepper: the lifecycle on the dashboard, the wizard's own progress ── */
.stages{display:flex;gap:7px;list-style:none;padding:0;margin:16px 0 0;flex-wrap:wrap}
.stage{font-size:11.5px;padding:4px 11px;border-radius:8px;background:var(--surf2);
  border:1px solid var(--line);color:var(--tx3)}
.stage.past{background:rgba(182,242,74,.11);border-color:transparent;color:var(--lime)}
.stage.now{background:var(--grad);border-color:transparent;color:#0d1108;font-weight:600}

/* ── notes ── */
.notes{margin:12px 0 0;padding-left:20px;font-size:13px;color:var(--tx2)}
.notes li{margin:4px 0}
.notes.warn{color:var(--am)}
.callout{margin-top:16px;padding:14px 16px;border-radius:14px;font-size:13.5px;line-height:1.65;
  background:rgba(182,242,74,.06);border:1px solid rgba(182,242,74,.2);color:var(--tx2)}
.callout b{display:block;color:var(--lime);font-weight:600;margin-bottom:3px}
.callout.warn{background:rgba(251,191,36,.07);border-color:rgba(251,191,36,.24)}
.callout.warn b{color:var(--am)}
details{margin-top:16px}
summary{cursor:pointer;font-size:11.5px;font-weight:600;color:var(--tx3);text-transform:uppercase;
  letter-spacing:.06em;padding:5px 0}
summary:hover{color:var(--tx)}

/* ── buttons and form controls ── */
.btn{font:inherit;font-size:13.5px;font-weight:500;padding:10px 18px;border-radius:10px;
  border:1px solid var(--line2);background:var(--surf);color:var(--tx2);cursor:pointer;
  transition:border-color .2s,color .2s,transform .2s}
.btn:hover{border-color:var(--lime);color:var(--lime)}
.btn:active{transform:scale(.97)}
.btn.primary{background:var(--grad);border-color:transparent;color:#0d1108;font-weight:600;
  box-shadow:0 8px 24px rgba(182,242,74,.2)}
.btn.primary:hover{color:#0d1108;transform:translateY(-2px)}
.btn[disabled]{opacity:.45;cursor:not-allowed;transform:none}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.inp2{width:100%;font:inherit;font-size:14px;padding:11px 13px;border:1px solid var(--line2);
  border-radius:10px;background:var(--surf2);color:var(--tx);outline:0}
.inp2:focus{border-color:var(--lime);box-shadow:0 0 0 3px rgba(182,242,74,.12)}
.inp2::placeholder{color:var(--tx3)}

.hidden{display:none !important}
:focus-visible{outline:2px solid var(--lime);outline-offset:2px}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
@media (max-width:1100px){ .kpis{grid-template-columns:repeat(2,1fr)} .g2{grid-template-columns:1fr} }
@media (max-width:760px){
  .side{position:static;width:100%;height:auto;flex-direction:row;justify-content:flex-start;
    overflow-x:auto;border-right:0;border-bottom:1px solid var(--line);padding:10px 12px}
  .shell{flex-direction:column}
  .sbrand{width:auto;padding:0 10px 0 0}
  .nb .lbl{display:none}
  .wrap{padding:6px 16px 56px}
  .tbar{padding:12px 16px}
}
@media (max-width:560px){ .kpis{grid-template-columns:1fr} }`;

// ── Shell ───────────────────────────────────────────────────────────────────────────────────

/**
 * One rail button. `href` is an anchor on the dashboard and a step on the wizard, so neither page
 * needs a click handler to navigate.
 */
export const railButton = ({ href, label, icon, current = false, pip = '' }) => `
      <a class="nb${current ? ' on' : ''}" href="${escape(href)}" title="${escape(label)}">
        ${ICONS[icon] ? `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>` : ''}
        ${pip ? `<span class="pip ${escape(pip)}"></span>` : ''}
        <span class="lbl">${escape(label)}</span>
      </a>`;

/**
 * The page frame both surfaces share: rail on the left, title bar across the top, content below.
 * `head`, `style` and `script` let a page add what only it needs without forking the chrome.
 */
export function shell({ title, name, sub, nav = [], right = '', body, head = '', script = '', style = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}<title>${escape(title)}</title>
<style>${THEME}${style}</style>
</head>
<body>
<div class="shell">
  <nav class="side" aria-label="Sections">
    <span class="sbrand">${MARK}</span>
    ${nav.map(railButton).join('')}
  </nav>
  <div class="mainarea">
    <header class="tbar">
      <span class="crumb"><b>${escape(name)}</b><i>${escape(sub)}</i></span>
      <span class="tright">${right}</span>
    </header>
    <main class="wrap">
${body}
    </main>
  </div>
</div>
${script ? `<script>\n${script}\n</script>` : ''}
</body>
</html>
`;
}
