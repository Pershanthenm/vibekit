import { mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { coloursFrom, typefacesFrom } from './docs/arch/extract.js';
import { openAsk } from './folder/asks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { slugify } from './frontmatter.js';
import { exists, readText, writeText } from './fsutil.js';

/**
 * Design references. Specification §69.
 *
 * "A reference stored as a mood is something a person interprets differently every time; a
 * reference turned into six extracted values and three answered questions is a decision the
 * folder can hold and the reviewer can check against."
 *
 * Extraction reads a page's CSS the way §66's brand extraction does and adds the four things a
 * look is made of beyond colour and type: spacing rhythm, corner radius, surfaces (borders or
 * shadows) and density. What a stylesheet cannot say becomes an ask, never a guess.
 */

export const REFERENCES_DIR = 'product/design/references';
export const INSPIRATION = 'product/design/inspiration.md';

const px = (text, property) => [...String(text ?? '').matchAll(new RegExp(`${property}\\s*:\\s*([\\d.]+)px`, 'gi'))].map((match) => Number.parseFloat(match[1])).filter((value) => value > 0);
const mode = (values) => {
  if (!values.length) return null;
  const tally = new Map();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** The six values, each with how sure the extraction is. */
export function extractLook(css, html = '') {
  const text = `${css}\n${html}`;
  const colours = coloursFrom(text);
  const type = typefacesFrom(text);
  const spacing = [...px(text, 'padding'), ...px(text, 'gap'), ...px(text, 'margin')].filter((value) => value <= 64 && Number.isInteger(value));
  const base = spacing.length ? spacing.reduce((acc, value) => gcd(acc, value), spacing[0]) : null;
  const radii = px(text, 'border-radius');
  const bodySize = mode(px(text, 'font-size').filter((value) => value >= 11 && value <= 20));
  const shadows = (text.match(/box-shadow\s*:\s*(?!none)/gi) ?? []).length;
  const borders = (text.match(/border(?:-\w+)?\s*:\s*\d/gi) ?? []).length;
  const weights = [...text.matchAll(/font-weight\s*:\s*(\d{3})/gi)].map((match) => Number(match[1]));

  return {
    spacing: base ? { base: base >= 2 && base <= 12 ? base : mode(spacing), rhythm: base <= 4 ? 'tight' : base <= 8 ? 'regular' : 'roomy', confidence: spacing.length > 5 ? 'medium' : 'low' } : null,
    palette: colours.brand ? { brand: colours.brand, accent: colours.accent, saturation: /^#(?:[0-9a-f])\1(?:[0-9a-f])\2(?:[0-9a-f])\3$/i.test(colours.brand) ? 'low' : 'mixed', confidence: 'medium' } : null,
    type: type.heading ? { body: bodySize ? `${bodySize}px` : null, heading: type.heading, weight: weights.length ? Math.max(...weights) : null, confidence: 'medium' } : null,
    surfaces: shadows || borders ? { style: borders >= shadows * 2 ? 'borders instead of shadows' : shadows > borders ? 'shadows' : 'mixed', confidence: 'medium' } : null,
    corners: radii.length ? { max: Math.max(...radii.filter((value) => value < 100)), confidence: 'medium' } : null,
    density: bodySize ? { level: bodySize <= 13 ? 'compact' : bodySize <= 15 ? 'comfortable' : 'roomy', confidence: 'low' } : null,
  };
}

/** What a picture or a stylesheet cannot tell. Three at most; the same ask shape as everywhere. */
export const QUESTIONS = Object.freeze([
  { key: 'tables', ask: 'How dense should data tables be?', plain: 'When you look at a table of records, do you want to see as many rows as possible, a comfortable amount, or plenty of space around each?', options: ['compact', 'comfortable', 'roomy'] },
  { key: 'sidebar', ask: 'Is the sidebar always visible?', plain: 'Should the side menu always be on screen, fold away when you want more room, or stay hidden until asked for?', options: ['always', 'collapsible', 'hidden'] },
  { key: 'empty', ask: 'Empty states: illustrated, or plain?', plain: 'When a screen has nothing to show yet, should it carry a picture and a sentence, or just a sentence and one thing to do?', options: ['illustrated', 'plain text'] },
]);

const captureName = (source) => {
  const url = /^https?:\/\//i.test(source) ? new URL(source) : null;
  return slugify(url ? `${url.host}${url.pathname}` : basename(source, extname(source))).slice(0, 60);
};

/**
 * Add a reference: fetch or read it, keep a copy (§69: committed, not linked), extract the look,
 * append to inspiration.md, and open the questions it cannot answer.
 */
export async function addReference(root, source, { folder = DEFAULT_FOLDER, allowPrivate = false, fetchPage = null, now = () => new Date() } = {}) {
  const isUrl = /^https?:\/\//i.test(source);
  let html = '';
  let css = '';
  let kind = 'page';
  let saved = null;

  await mkdir(join(root, folder, REFERENCES_DIR), { recursive: true });
  if (isUrl) {
    const page = await (fetchPage ?? defaultFetchPage)(source, { allowPrivate });
    html = page.html; css = page.css;
    saved = join(folder, REFERENCES_DIR, `${captureName(source)}.html`);
    await writeText(join(root, saved), `<!-- captured from ${source} on ${now().toISOString().slice(0, 10)} by vibekit design add -->\n${html}\n<style>\n${css}\n</style>\n`);
  } else {
    const path = join(root, source);
    if (!(await exists(path))) throw new Error(`${source} is not a url or a file here.`);
    const ext = extname(source).toLowerCase();
    kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? 'image' : ext === '.pdf' ? 'pdf' : 'file';
    const buffer = await readFile(path);
    saved = join(folder, REFERENCES_DIR, `${captureName(source)}${ext}`);
    // Committed, not linked (§69): the project still makes sense when the original is gone.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, saved), buffer);
    if (kind === 'file') { html = buffer.toString('utf8'); css = html; }
  }

  const look = kind === 'image' || kind === 'pdf' ? {} : extractLook(css, html);
  const took = Object.entries(look).filter(([, value]) => value).map(([key, value]) => ({ key, ...value }));
  const asks = [];
  for (const question of QUESTIONS) {
    const ask = await openAsk(root, {
      kind: 'question', ask: `${question.ask} (from ${source})`, plain: question.plain, why: 'A look is not a decision until this is answered; two people would render the same screens differently.',
      options: question.options, topic: ['design', question.key], about: 'design', by: 'designer (vibekit design add)', blocking: false,
    }, folder).catch(() => null);
    if (ask) asks.push({ id: ask.id, ...question });
  }
  await appendInspiration(root, { source, saved, took, kind, date: now().toISOString().slice(0, 10) }, folder);
  return { source, saved, kind, took, asks, couldNotTell: kind === 'image' || kind === 'pdf' ? ['everything but the picture itself: an image carries no stylesheet, so the six values are asked rather than read'] : QUESTIONS.map((question) => question.ask) };
}

async function defaultFetchPage(url, { allowPrivate }) {
  const { refuseUrl, safeFetch } = await import('./netguard.js');
  const why = await refuseUrl(url, { allowPrivate });
  if (why) throw new Error(why);
  const get = async (address) => {
    const response = await safeFetch(address, { headers: { 'user-agent': 'vibekit-design/1.0 (+reference, on request)' }, allowPrivate, fetchImpl: fetch });
    if (!response.ok) throw new Error(`${address} returned ${response.status}`);
    return response.text();
  };
  const html = await get(url);
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
  const sheets = [...html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]).slice(0, 3);
  for (const href of sheets) {
    try { css += `\n${await get(new URL(href, url).toString())}`; } catch { /* one unreachable sheet is a partial extraction, reported by the confidences */ }
  }
  return { html, css };
}

const describe = (row) => {
  if (row.key === 'spacing') return `${row.base}px base rhythm, ${row.rhythm}`;
  if (row.key === 'palette') return `${row.saturation === 'low' ? 'muted, low saturation' : 'mixed palette'}, brand ${row.brand}${row.accent ? `, accent ${row.accent}` : ''}`;
  if (row.key === 'type') return `${row.body ?? 'body size unread'}, ${row.weight ? `${row.weight} weight headings, ` : ''}${row.heading}`;
  if (row.key === 'surfaces') return row.style;
  if (row.key === 'corners') return `nothing over ${row.max}px`;
  if (row.key === 'density') return `${row.level}`;
  return '';
};

export const describeLook = describe;

async function appendInspiration(root, { source, saved, took, date }, folder) {
  const path = join(root, folder, INSPIRATION);
  const existing = (await readText(path)) ?? [
    '# Inspiration', '',
    '## Intent', '', 'TODO: the look in words — what it should feel like, and what it must never be.', '',
    '## References', '', '| Reference | Took | Added |', '| --- | --- | --- |', '',
    '## Decisions taken from them', '', '',
  ].join('\n');
  const row = `| ${source} | ${took.map(describe).join(' · ') || 'a picture: nothing readable, asked instead'} · kept at ${saved} | ${date} |`;
  const next = existing.includes('| --- | --- | --- |')
    ? existing.replace(/(\| --- \| --- \| --- \|\n(?:\|.*\n)*)/, `$1${row}\n`)
    : `${existing.trimEnd()}\n\n## References\n\n| Reference | Took | Added |\n| --- | --- | --- |\n${row}\n`;
  await writeText(path, next);
}

export async function listReferences(root, folder = DEFAULT_FOLDER) {
  const text = (await readText(join(root, folder, INSPIRATION))) ?? '';
  const rows = [...text.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|$/gm)].map((match) => ({ source: match[1], took: match[2], added: match[3] }));
  const files = await readdir(join(root, folder, REFERENCES_DIR)).catch(() => []);
  return { rows, files, intent: text.match(/## Intent\n\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() ?? null };
}

// ---------------------------------------------------------------- feedback

/** "Too cramped" cannot drive anything; these are the closest things it usually means (§69). */
export const FEEDBACK = Object.freeze({
  cramped: { about: 'space', options: [
    { id: 1, label: 'Not enough space between things', change: { spacing: '+1' } },
    { id: 2, label: 'Text too small', change: { type: '+1' } },
    { id: 3, label: 'Too much on screen at once', change: { density: 'comfortable' } },
  ] },
  busy: { about: 'noise', options: [
    { id: 1, label: 'Too many colours', change: { palette: 'one accent' } },
    { id: 2, label: 'Too many borders and shadows', change: { surfaces: 'borders only' } },
    { id: 3, label: 'Too much on screen at once', change: { density: 'comfortable' } },
  ] },
  dull: { about: 'energy', options: [
    { id: 1, label: 'Needs a stronger accent colour', change: { accent: 'stronger' } },
    { id: 2, label: 'Headings should carry more weight', change: { type: 'heavier headings' } },
    { id: 3, label: 'Corners too sharp', change: { radius: '+1' } },
  ] },
  small: { about: 'size', options: [{ id: 1, label: 'Text too small', change: { type: '+1' } }, { id: 2, label: 'Touch targets too small', change: { spacing: '+1' } }] },
});

export function interpretFeedback(text) {
  const words = String(text ?? '').toLowerCase();
  const key = Object.keys(FEEDBACK).find((word) => words.includes(word)) ?? (/tight|squash|dense/.test(words) ? 'cramped' : /loud|clutter|noisy/.test(words) ? 'busy' : /boring|flat|plain/.test(words) ? 'dull' : null);
  return key ? { key, ...FEEDBACK[key] } : null;
}

/** Apply one chosen change to the design tokens in project.json (the source tokens.md is generated from). */
export function applyChange(design = {}, change) {
  const next = { ...design };
  const scaleUp = (value, steps) => steps[Math.min(steps.indexOf(value ?? steps[0]) + 1, steps.length - 1)];
  if (change.spacing === '+1') next.spacing = scaleUp(next.spacing, ['tight', 'regular', 'roomy']);
  if (change.type === '+1') next.typeScale = scaleUp(next.typeScale, ['small', 'regular', 'large']);
  if (change.type === 'heavier headings') next.headingWeight = 700;
  if (change.density) next.density = change.density;
  if (change.palette) next.palette = change.palette;
  if (change.surfaces) next.surfaces = change.surfaces;
  if (change.radius === '+1') next.radius = scaleUp(next.radius, ['sharp', 'soft', 'round']);
  if (change.accent === 'stronger') next.accentStrength = 'strong';
  return next;
}

// ---------------------------------------------------------------- preview

/** Your real screens, from flows.md and components.md, with the current tokens: light and dark, phone and desktop. */
export function renderPreview({ name, tokens, flows, components, screen = null }) {
  const brand = tokens.brand ?? '#1F5673';
  const density = tokens.density ?? 'comfortable';
  const rowHeight = density === 'compact' ? 32 : density === 'roomy' ? 48 : 40;
  const radius = tokens.radius === 'sharp' ? 2 : tokens.radius === 'round' ? 12 : 6;
  const space = tokens.spacing === 'tight' ? 4 : tokens.spacing === 'roomy' ? 12 : 8;
  const body = tokens.typeScale === 'small' ? 13 : tokens.typeScale === 'large' ? 16 : 14;
  const screens = (screen ? flows.filter((flow) => flow.toLowerCase().includes(screen.toLowerCase())) : flows).slice(0, 8);
  const esc = (text) => String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  const card = (title, width) => `<section class="screen" style="width:${width}px"><h3>${esc(title)}</h3>
    <nav>${components.slice(0, 3).map((component) => `<span>${esc(component)}</span>`).join('')}</nav>
    <table>${[1, 2, 3, 4].map((n) => `<tr><td>Row ${n}</td><td>${esc(title.split(' ')[0] ?? 'item')} ${n}</td><td><button>Open</button></td></tr>`).join('')}</table>
    <p class="empty">Nothing here yet. <a>Add the first one</a></p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)} — design preview</title>
<style>
:root{--brand:${brand};--radius:${radius}px;--space:${space}px;--row:${rowHeight}px;--body:${body}px;--bg:#fff;--fg:#14171C;--line:#D9DEE4;--surface:#F6F7F9}
@media (prefers-color-scheme: dark){:root{--bg:#111418;--fg:#E7EAEE;--line:#2A2F36;--surface:#1A1F26}}
body{margin:0;padding:calc(var(--space)*3);background:var(--bg);color:var(--fg);font:var(--body)/1.5 ${esc(tokens.body ?? 'system-ui, sans-serif')}}
h1{color:var(--brand);font-family:${esc(tokens.heading ?? 'system-ui, sans-serif')};font-weight:${tokens.headingWeight ?? 600}}
.set{display:flex;gap:calc(var(--space)*3);flex-wrap:wrap;align-items:flex-start}
.screen{border:1px solid var(--line);border-radius:var(--radius);padding:calc(var(--space)*2);background:var(--surface);${tokens.surfaces === 'shadows' ? 'box-shadow:0 4px 16px rgba(0,0,0,.12);' : ''}}
.screen h3{margin:0 0 var(--space);font-family:${esc(tokens.heading ?? 'system-ui, sans-serif')}}
nav span{display:inline-block;padding:calc(var(--space)/2) var(--space);margin-right:var(--space);border:1px solid var(--line);border-radius:var(--radius);font-size:calc(var(--body) - 1px)}
table{width:100%;border-collapse:collapse;margin-top:var(--space)}td{height:var(--row);border-bottom:1px solid var(--line);padding:0 var(--space)}
button{background:var(--brand);color:#fff;border:0;border-radius:var(--radius);padding:calc(var(--space)/2) var(--space);font:inherit}
.empty{color:#778;margin:var(--space) 0 0}a{color:var(--brand)}
</style></head><body>
<h1>${esc(name)} · ${density}, ${space}px rhythm, ${radius}px corners</h1>
<p>Your screens from flows.md with the current tokens. Light or dark follows your system; phone width first, desktop beside it.</p>
${screens.length ? screens.map((title) => `<div class="set">${card(title, 360)}${card(title, 900)}</div>`).join('\n') : '<p>flows.md names no screens yet, so there is nothing of yours to render. One line per flow, screens in order.</p>'}
</body></html>`;
}

export { INSPIRATION as INSPIRATION_PATH };
