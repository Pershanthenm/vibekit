// The look shared by every page this CLI generates: the dashboard and the wizard.
//
// It lives in one place because the alternative — two stylesheets that are meant to match — drifts
// the first time either one is touched. Both pages call `shell()`, so a change to the sidebar, the
// topbar or the palette lands on both at once.
//
// The look itself is the Atlas design system (src/atlas.css), vendored unchanged. Pages compose
// its components; they do not restyle them. Two notes on where these pages are opened:
//
//   * The stylesheet is inlined, not linked. The dashboard is opened from a file:// path while a
//     build runs, often on a locked-down machine, and a linked stylesheet would not load.
//   * Inter is linked from Google Fonts, as the design system specifies. Where that request is
//     blocked, --font-sans falls back to the system face and nothing else changes.
//
// Atlas is light by default and switches to dark only when the document carries
// `data-theme="dark"`. Both pages carry the toggle; it remembers the choice per browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escape, icon } from './dashboard-render.js';

export { escape, icon, ICONS } from './dashboard-render.js';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/**
 * The design system, read once at module load and inlined into every page. Kept as a .css file
 * rather than a template literal so it stays editable — and diffable — as the stylesheet it is.
 */
export const THEME = read('atlas.css');

/**
 * dashboard-render.js as the browser can run it: the same functions the server just used, with
 * their `export` keywords removed. Stripping rather than bundling keeps one copy of the markup
 * in the repository — the served page and the written file cannot disagree, because there is
 * nothing to keep in step.
 */
export const BROWSER_MODULES = ['dom-morph.js', 'dashboard-render.js', 'scan-plan.js', 'scan-render.js'];

const OWN_IMPORT = new RegExp(`^(import|export) .*from '\\./(${BROWSER_MODULES.join('|').replace(/\./g, '\\.')})';$`, 'gm');

export const browserSource = () => BROWSER_MODULES
  .map((name) => read(name)
    .replace(/^export (?=const|function|class|let)/gm, '')
    // These modules import their shared helpers from each other. Concatenated into one script they
    // are already in scope, so those lines are dropped rather than resolved — and only those. An
    // import of anything outside this list is left in place, where it fails loudly, because the
    // alternative is a page that loads and then throws the first time someone clicks.
    .replace(OWN_IMPORT, ''))
  .join('\n');

export const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
`;

/**
 * One sidebar link. `href` is a route hash, which the served page turns into navigation and the
 * written page resolves as a plain anchor to the matching section. `pip` fills Atlas's `.pill`.
 */
export const navLink = ({ href, label, icon: name, route = '', current = false, pip = '' }) => `
        <a href="${escape(href)}"${current ? ' class="active"' : ''}${route ? ` data-route="${escape(route)}"` : ''} data-tip="${escape(label)}">
          ${icon(name)}<span>${escape(label)}</span>${pip ? `<span class="pill">${escape(pip)}</span>` : ''}
        </a>`;

/**
 * The Atlas app shell both surfaces share: sidebar, topbar, content column.
 *
 * `nav` takes either link descriptions or a ready-made string, because the wizard's sidebar is a
 * stepper rather than a list of sections. `head`, `style` and `script` let a page add what only
 * it needs without forking the chrome.
 *
 * The body sits inside `#page` so a live page can replace everything the server rendered without
 * touching what the browser added beside it — the lane console is appended to `.main`, and a
 * repaint that swallowed it would wipe the output being watched.
 */
export function shell({
  title, name, sub, brand = '', nav = [], navLabel = 'Project', rail = '', foot = '', right = '', body,
  head = '', script = '', style = '', crumb = '',
}) {
  const links = typeof nav === 'string' ? nav : nav.map(navLink).join('');
  // A page with more than one group of links builds the whole rail itself; everything else gets
  // the single labelled list, which is all either page needed until the scan arrived.
  const sidebar = rail || `<div class="nav-label">${escape(navLabel)}</div>
    <nav class="nav" id="nav" aria-label="${escape(navLabel)}">${links}
    </nav>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${FONT_LINK}${head}<title>${escape(title)}</title>
<style>${THEME}${style}</style>
</head>
<body>
<div class="theme-fade" id="themeFade"></div>
<div class="overlay" id="navOverlay"></div>
<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="brand-mark">V</div>
      <div class="brand-name">Vibe-check<small>${escape(brand || sub)}</small></div>
      <button type="button" class="collapse-btn" id="collapseBtn" aria-label="Collapse navigation">${icon('chevron')}</button>
    </div>
    ${sidebar}
${foot}
  </aside>
  <main class="main">
    <header class="topbar">
      <button type="button" class="icon-btn lg menu-btn" id="menuBtn" aria-label="Show navigation">${icon('menu')}</button>
      <div>
        <div class="crumb" id="crumb"><span>Vibe-check</span><span>/</span><b>${escape(crumb || name)}</b></div>
        <h1>${escape(name)}<small>${escape(sub)}</small></h1>
      </div>
      <div class="grow"></div>
      <div class="cluster">${right}
        <button type="button" class="icon-btn lg" id="themeBtn" data-tooltip="Toggle theme" aria-label="Toggle theme">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
      </div>
    </header>
    <div class="stack" id="page">
${body}
    </div>
  </main>
</div>
<div class="toast" id="toast">${icon('check')}<span id="toastMsg"></span><button type="button" class="x" id="toastX" aria-label="Dismiss">×</button></div>
${script ? `<script>\n${script}\n</script>` : ''}
</body>
</html>
`;
}

/**
 * The behaviour every page shares: the theme toggle, the sidebar drawer and collapse, the toast,
 * and the copy buttons on command chips. Kept out of the markup so neither page hand-rolls it.
 *
 * Nothing here is required to read the page. A page with no script is a complete page; this only
 * adds what a pointer and a keyboard can do with it.
 */
export const CHROME_SCRIPT = `
const $ = (selector) => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  const button = $('#themeBtn');
  if (!button) return;
  button.setAttribute('aria-pressed', String(theme === 'dark'));
  button.querySelector('.sun').hidden = theme === 'dark';
  button.querySelector('.moon').hidden = theme !== 'dark';
}

function store(key, value) {
  // Blocked in private windows and some embedded viewers; the page works either way.
  try { localStorage.setItem(key, value); } catch { /* not fatal */ }
}
function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

let toastTimer;
function toast(message) {
  const box = $('#toast');
  $('#toastMsg').textContent = message;
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), 2800);
}

applyTheme(stored('vibecheck-theme') === 'dark' ? 'dark' : 'light');
if (stored('vibecheck-rail') === 'collapsed') document.body.classList.add('collapsed');

$('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store('vibecheck-theme', next);
  if (reduced) return applyTheme(next);
  // The fade hides the repaint: swapping every surface at once reads as a glitch without it.
  const fade = $('#themeFade');
  fade.classList.add('go');
  setTimeout(() => { applyTheme(next); setTimeout(() => fade.classList.remove('go'), 40); }, 200);
});
$('#collapseBtn').addEventListener('click', () => {
  document.body.classList.toggle('collapsed');
  store('vibecheck-rail', document.body.classList.contains('collapsed') ? 'collapsed' : 'open');
});
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#navOverlay').addEventListener('click', () => document.body.classList.remove('nav-open'));
$('#toastX').addEventListener('click', () => $('#toast').classList.remove('on'));

// One listener for every command chip on the page, including chips rendered later.
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const text = button.dataset.copy;
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied: ' + text), () => toast('Could not copy'));
  else toast('Copying is blocked here — select the text instead');
});
`;
