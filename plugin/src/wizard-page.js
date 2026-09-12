// A browser form for people who would rather not answer twenty questions in a terminal.
//
// The page is generated from the same catalogue the CLI asks from — questions.js, components.js
// and starters.js — so the two can never offer different stacks. Nothing is retyped here; add a
// component to the catalogue and it appears in the form on the next `vibecheck wizard`.
//
// It produces exactly one thing: the requirements.json that `vibecheck advise apply --from` and
// `vibecheck init --from` already accept. The page decides nothing and scaffolds nothing — the
// recommendation, the licence exclusions and the validation all still happen in the CLI, where
// they are tested.

import { componentsFor } from './advisor/components.js';
import { BAAS, STATIC_QUESTIONS } from './advisor/questions.js';
import { STARTERS } from './advisor/starters.js';

const LAYERS = ['backend', 'web', 'mobile', 'desktop', 'database'];
const LAYER_QUESTION = {
  backend: 'Which backend?',
  web: 'Which web front end?',
  mobile: 'Which mobile technology?',
  desktop: 'Which desktop technology?',
  database: 'Which database?',
};
const LAYER_HEADER = { backend: 'Backend', web: 'Web', mobile: 'Mobile', desktop: 'Desktop', database: 'Database' };

// The page's own layout. Question text and options still come from the catalogue; only the
// grouping lives here, because the terminal asks in rounds and a form scrolls in sections.
const SECTIONS = [
  { title: 'What you are building', ids: ['platform', 'appType', 'scale', 'clients'] },
  { title: 'Constraints', ids: ['licensing', 'ecosystem', 'team', 'data'] },
  { title: 'Architecture and security', ids: ['architecture', 'signin', 'security', 'compliance'] },
  { title: 'Stack', layers: true },
  { title: 'Starting point', starter: true },
  { title: 'Delivery', ids: ['hosting', 'integrations'] },
  { title: 'Agent workflow', ids: ['autonomy', 'engine', 'context'] },
];

const question = (id) => STATIC_QUESTIONS.find((entry) => entry.id === id);

const layerQuestion = (layer) => ({
  id: layer,
  header: LAYER_HEADER[layer],
  question: LAYER_QUESTION[layer],
  options: componentsFor(layer).map((item) => ({
    id: item.id,
    label: item.label,
    description: item.summary,
    licence: item.licence.class,
    licenceName: item.licence.name,
  })),
});

const starterQuestion = () => ({
  id: 'starter',
  header: 'Boilerplate',
  question: 'Start from a boilerplate, or generate the structure from scratch?',
  options: [
    ...STARTERS.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.summary,
      licence: item.licence.class,
      licenceName: item.licence.name,
      fits: item.fits,
      needs: item.needs ?? [],
    })),
    { id: 'none', label: 'From scratch', description: 'vibecheck generates the layout and conventions', licence: 'permissive', licenceName: '—' },
  ],
});

/** Everything the page needs, as one JSON blob: questions, stack options, starters. */
export function wizardModel() {
  return {
    sections: SECTIONS.map((section) => ({
      title: section.title,
      layers: Boolean(section.layers),
      starter: Boolean(section.starter),
      questions: (section.ids ?? []).map(question).filter(Boolean),
    })),
    layerQuestions: Object.fromEntries(LAYERS.map((layer) => [layer, layerQuestion(layer)])),
    starter: starterQuestion(),
    baas: BAAS,
  };
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (char) => ENTITIES[char]);
// `</script>` inside embedded JSON would end the block early; escaping < prevents that.
const embed = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const STYLE = `
  :root {
    color-scheme: light dark;
    --bg:#f4f5f7; --surface:#fff; --raised:#fbfcfd; --ink:#1a1d21; --muted:#5c6773; --faint:#8a94a0;
    --line:#dfe3e8; --line-strong:#c9d0d8; --accent:#1f4fd8; --accent-soft:#eaf0ff;
    --good:#0f7a45; --warn:#8a4b09; --shadow:0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0c1016; --surface:#141a22; --raised:#1a212b; --ink:#e6ecf3; --muted:#9aa7b4; --faint:#6f7c8a;
      --line:#252e3a; --line-strong:#33404f; --accent:#6c9bff; --accent-soft:#16223c;
      --good:#4ec27a; --warn:#e0994a; --shadow:none; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width:960px; margin:0 auto; padding:0 20px; }
  .appbar { background:var(--surface); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:60px; flex-wrap:wrap; padding-block:10px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .mark { width:32px; height:32px; border-radius:6px; background:var(--accent); color:#fff;
    display:grid; place-items:center; font-size:12px; font-weight:700; }
  .brand-name { font-size:16px; font-weight:650; }
  .brand-sub { font-size:12px; color:var(--muted); }
  .progress { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  main { padding:24px 0 96px; }
  .lead { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:16px 20px;
    margin-bottom:16px; box-shadow:var(--shadow); }
  .lead p { margin:6px 0 0; color:var(--muted); }
  section.step { background:var(--surface); border:1px solid var(--line); border-radius:8px;
    padding:18px 20px; margin-bottom:14px; box-shadow:var(--shadow); }
  section.step > h2 { font-size:15px; font-weight:650; margin:0 0 4px; }
  .steplabel { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); font-weight:600; }
  fieldset { border:0; padding:0; margin:20px 0 0; }
  legend { padding:0; font-size:14px; font-weight:600; }
  .why { font-size:12px; color:var(--muted); margin:2px 0 10px; }
  .opts { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px; }
  label.opt { display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid var(--line);
    border-radius:6px; cursor:pointer; background:var(--raised); }
  label.opt:hover { border-color:var(--line-strong); }
  label.opt:has(input:checked) { border-color:var(--accent); background:var(--accent-soft); }
  label.opt input { margin:3px 0 0; flex:none; }
  .opt-body { min-width:0; display:flex; flex-direction:column; }
  .opt-label { font-weight:600; font-size:13px; }
  .opt-desc { font-size:12px; color:var(--muted); }
  .lic { font-size:11px; color:var(--faint); }
  .other { margin-top:8px; }
  .other input { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:6px;
    background:var(--raised); color:var(--ink); font:inherit; font-size:13px; }
  .hidden { display:none !important; }
  .done { border:1px solid var(--accent); }
  pre { background:var(--raised); border:1px solid var(--line); border-radius:6px; padding:14px;
    overflow:auto; font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; max-height:320px; }
  code { font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background:var(--raised); border:1px solid var(--line); padding:1px 6px; border-radius:4px; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
  button { font:inherit; font-size:13px; font-weight:600; padding:9px 16px; border-radius:6px;
    border:1px solid var(--line-strong); background:var(--surface); color:var(--ink); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  ol.next { padding-left:20px; } ol.next li { margin:8px 0; }
  .missing { color:var(--warn); font-size:13px; margin-top:10px; }
  @media (max-width:560px) { .opts { grid-template-columns:1fr; } }`;

/**
 * The whole wizard as one self-contained page: no build step, no network, no dependencies.
 * Unlike the dashboard it does need JavaScript — it is a form, and the alternative is posting
 * somewhere, which there is nothing to post to.
 */
export function renderWizard({ projectName = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(projectName || 'New project')} — build your spec</title>
<style>${STYLE}</style>
</head>
<body>
<header class="appbar">
  <div class="wrap bar">
    <div class="brand">
      <span class="mark" aria-hidden="true">VC</span>
      <span>
        <span class="brand-name">${escape(projectName || 'New project')}</span><br>
        <span class="brand-sub">Build your project spec</span>
      </span>
    </div>
    <span class="progress" id="progress">0 of 0 answered</span>
  </div>
</header>

<main class="wrap">
  <div class="lead">
    <b>Answer what you know; skip what you don't.</b>
    <p>Nothing is installed or written from this page. At the end you get a
    <code>requirements.json</code> to hand back to Claude Code, which does the scaffolding and can
    still ask about anything you left blank.</p>
  </div>

  <form id="form"></form>

  <section class="step done" id="result">
    <span class="steplabel">Last step</span>
    <h2>Hand this back</h2>
    <p class="why">Save it into your project as <code>specs/requirements.json</code>, or copy it and
    paste it to Claude Code.</p>
    <div class="actions">
      <button type="button" class="primary" id="download">Download requirements.json</button>
      <button type="button" id="copy">Copy to clipboard</button>
    </div>
    <p class="missing hidden" id="missing"></p>
    <pre id="out">{}</pre>
    <ol class="next">
      <li>Put the file in your project at <code>specs/requirements.json</code>.</li>
      <li>In that folder run <code>vibecheck advise apply</code> — or tell Claude Code
        <em>"apply my requirements"</em> and it runs it for you.</li>
      <li>It writes <code>specs/project.json</code>, a technology-selection ADR recording why each
        choice won, and scaffolds the project.</li>
    </ol>
  </section>
</main>

<script>
const MODEL = ${embed(wizardModel())};
const answers = {};

// Which stack layers this project actually has. Mirrors neededLayers() in questions.js: a
// backend is always present, the rest follow from the platform and any extra clients.
const PLATFORM_TARGETS = { web:['web'], mobile:['ios','android'], desktop:['desktop'], backend:['api'] };
const CLIENT_TARGETS = { web:['web'], mobile:['ios','android'], desktop:['desktop'], api:['api'] };
function targets() {
  const clients = Array.isArray(answers.clients) ? answers.clients : [];
  const from = PLATFORM_TARGETS[answers.platform] || [];
  return new Set([...from, ...clients.flatMap((c) => CLIENT_TARGETS[c] || [])]);
}
function neededLayers() {
  const t = targets();
  const layers = ['backend'];
  if (t.has('web')) layers.push('web');
  if (t.has('ios') || t.has('android')) layers.push('mobile');
  if (t.has('desktop')) layers.push('desktop');
  const backend = answers.backend;
  if (!backend || backend === 'none' || !MODEL.baas.includes(backend)) layers.push('database');
  return layers;
}
// Hosting is only a question when something is actually hosted.
function needsHosting() {
  const backend = answers.backend;
  return Boolean(backend) && backend !== 'none' && !MODEL.baas.includes(backend);
}

// The same licence policy the recommender applies, so the form never offers what the CLI would
// refuse. Anything it cannot classify stays visible rather than being silently dropped.
const ALLOWED = { permissive:['permissive','platform'], 'oss-only':['permissive','weak-copyleft','copyleft','platform'] };
function licenceAllows(cls) {
  const allowed = ALLOWED[answers.licensing];
  return !allowed || !cls || allowed.includes(cls);
}

function starterFits(option) {
  if (!option || option.id === 'none') return true;
  const fits = option.fits || {};
  const entries = Object.entries(fits);
  const matches = entries.some(([layer, ids]) => ids.includes(answers[layer]));
  const noClash = entries.every(([layer, ids]) => !answers[layer] || ids.includes(answers[layer]));
  const needed = (option.needs || []).every((layer) => (fits[layer] || []).includes(answers[layer]));
  return matches && noClash && needed;
}

function optionHtml(q, option) {
  const type = q.multi ? 'checkbox' : 'radio';
  const lic = option.licenceName ? '<span class="lic">' + option.licenceName + '</span>' : '';
  return '<label class="opt" data-option="' + option.id + '">' +
    '<input type="' + type + '" name="' + q.id + '" value="' + option.id + '">' +
    '<span class="opt-body"><span class="opt-label">' + option.label + '</span>' +
    '<span class="opt-desc">' + (option.description || '') + '</span>' + lic + '</span></label>';
}

function questionHtml(q) {
  return '<fieldset data-question="' + q.id + '">' +
    '<legend>' + q.question + '</legend>' +
    (q.multi ? '<p class="why">Choose any that apply, or none.</p>' : '') +
    '<div class="opts">' + q.options.map((o) => optionHtml(q, o)).join('') + '</div>' +
    '<div class="other"><input type="text" data-other="' + q.id + '" placeholder="Something else? Type it here."></div>' +
    '</fieldset>';
}

function build() {
  const form = document.getElementById('form');
  form.innerHTML = MODEL.sections.map((section, index) => {
    let questions = section.questions;
    if (section.layers) questions = Object.values(MODEL.layerQuestions);
    if (section.starter) questions = [MODEL.starter];
    return '<section class="step" data-section="' + index + '">' +
      '<span class="steplabel">Step ' + (index + 1) + '</span>' +
      '<h2>' + section.title + '</h2>' +
      questions.map(questionHtml).join('') + '</section>';
  }).join('');
  form.addEventListener('change', onChange);
  form.addEventListener('input', onChange);
  refresh();
}

function onChange(event) {
  const target = event.target;
  if (target.dataset.other !== undefined) {
    const text = target.value.trim();
    if (text) answers[target.dataset.other] = { other: text };
    else delete answers[target.dataset.other];
  } else if (target.name) {
    const id = target.closest('fieldset').dataset.question;
    if (target.type === 'checkbox') {
      answers[id] = [...document.querySelectorAll('input[name="' + id + '"]:checked')].map((input) => input.value);
    } else {
      answers[id] = target.value;
    }
    const other = document.querySelector('[data-other="' + id + '"]');
    if (other) other.value = '';
  }
  refresh();
}

// Hide what does not apply rather than letting someone answer a question that will be ignored.
function refresh() {
  const layers = neededLayers();
  for (const layer of Object.keys(MODEL.layerQuestions)) {
    const el = document.querySelector('[data-question="' + layer + '"]');
    if (el) el.classList.toggle('hidden', !layers.includes(layer));
  }
  const hosting = document.querySelector('[data-question="hosting"]');
  if (hosting) hosting.classList.toggle('hidden', !needsHosting());

  document.querySelectorAll('fieldset[data-question]').forEach((fieldset) => {
    const id = fieldset.dataset.question;
    const model = MODEL.layerQuestions[id] || (id === 'starter' ? MODEL.starter : null);
    if (!model) return;
    fieldset.querySelectorAll('[data-option]').forEach((label) => {
      const option = model.options.find((entry) => entry.id === label.dataset.option);
      const ok = licenceAllows(option && option.licence) && (id !== 'starter' || starterFits(option));
      label.classList.toggle('hidden', !ok);
      const input = label.querySelector('input');
      if (!ok && input.checked) { input.checked = false; delete answers[id]; }
    });
    if (id === 'starter') {
      const anyFits = [...fieldset.querySelectorAll('[data-option]')].some((label) => !label.classList.contains('hidden') && label.dataset.option !== 'none');
      fieldset.classList.toggle('hidden', !anyFits);
    }
  });

  const visible = [...document.querySelectorAll('fieldset[data-question]')].filter((f) => !f.classList.contains('hidden'));
  const unanswered = visible.filter((f) => answers[f.dataset.question] === undefined).map((f) => f.dataset.question);
  document.getElementById('progress').textContent = (visible.length - unanswered.length) + ' of ' + visible.length + ' answered';

  const missing = document.getElementById('missing');
  missing.classList.toggle('hidden', unanswered.length === 0);
  missing.textContent = unanswered.length
    ? unanswered.length + ' still unanswered (' + unanswered.join(', ') + '). Hand it over anyway — Claude Code will ask about the rest.'
    : '';

  document.getElementById('out').textContent = JSON.stringify(answers, null, 2);
}

document.getElementById('copy').addEventListener('click', async () => {
  const button = document.getElementById('copy');
  try {
    await navigator.clipboard.writeText(JSON.stringify(answers, null, 2));
    button.textContent = 'Copied';
  } catch {
    // Clipboard access is blocked in some embedded viewers; selecting the text still works.
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('out'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = 'Selected — press Ctrl/Cmd+C';
  }
  setTimeout(() => { button.textContent = 'Copy to clipboard'; }, 2500);
});

document.getElementById('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(answers, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'requirements.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Embedded viewers (and the artifact sandbox) render this in an iframe, where a script-driven
// download is silently inert. Offering a button that does nothing is worse than not offering it,
// so in that case the page says plainly that copying is the way out.
if (window.self !== window.top) {
  document.getElementById('download').classList.add('hidden');
  const note = document.createElement('p');
  note.className = 'why';
  note.textContent = 'Downloads are blocked when this page is embedded — use Copy, then paste it to Claude Code or save it yourself as specs/requirements.json.';
  document.getElementById('result').insertBefore(note, document.getElementById('missing'));
}

build();
</script>
</body>
</html>
`;
}
