// A browser form for people who would rather not answer twenty questions in a terminal.
//
// The page is generated from the same catalogue the CLI asks from — questions.js, components.js
// and starters.js — so the two can never offer different stacks. Nothing is retyped here; add a
// component to the catalogue and it appears in the form on the next `vibecheck wizard`.
//
// The chrome comes from page-chrome.js, the same module the dashboard uses, so setting a project
// up and then tracking it look like one product rather than two.
//
// It produces exactly one thing: the requirements.json that `vibecheck advise apply --from` and
// `vibecheck init --from` already accept. The page decides nothing and scaffolds nothing — the
// recommendation, the licence exclusions and the validation all still happen in the CLI, where
// they are tested.

import { componentsFor } from './advisor/components.js';
import { BAAS, STATIC_QUESTIONS } from './advisor/questions.js';
import { STARTERS } from './advisor/starters.js';
import { escape, shell } from './page-chrome.js';

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
  { title: 'What you are building', icon: 'home', ids: ['platform', 'appType', 'scale', 'clients'] },
  { title: 'Constraints', icon: 'issues', ids: ['licensing', 'ecosystem', 'team', 'data'] },
  { title: 'Architecture and security', icon: 'board', ids: ['architecture', 'signin', 'security', 'compliance'] },
  { title: 'Stack', icon: 'stack', layers: true },
  { title: 'Starting point', icon: 'spark', starter: true },
  { title: 'Delivery', icon: 'tools', ids: ['hosting', 'integrations'] },
  { title: 'Agent workflow', icon: 'tests', ids: ['autonomy', 'engine', 'context'] },
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

// `</script>` inside embedded JSON would end the block early; escaping < prevents that.
const embed = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// Only what the form adds on top of the shared chrome.
const PAGE_STYLE = `
/* the step rail across the top: where you are, and how much is left */
.steps{background:var(--surf);border:1px solid var(--line);border-radius:var(--r);
  padding:22px 26px 16px;margin-bottom:16px;position:relative}
.strack{position:absolute;left:60px;right:60px;top:38px;height:2px;background:var(--line2);border-radius:2px}
.sfill{height:100%;width:0;background:var(--grad);border-radius:2px;transition:width .45s cubic-bezier(.16,1,.3,1)}
.snodes{display:grid;position:relative;z-index:1}
.sn{display:flex;flex-direction:column;align-items:center;gap:9px;text-decoration:none;color:inherit}
.sn:hover{text-decoration:none}
.sc{width:30px;height:30px;border-radius:50%;background:var(--surf);border:2px solid var(--line2);
  color:var(--tx3);display:grid;place-items:center;font-size:12.5px;font-weight:600;
  transition:background .3s,border-color .3s,color .3s}
.sn:hover .sc{border-color:var(--tx3);color:var(--tx2)}
.sn.done .sc{background:var(--grad);border-color:transparent;color:#0d1108}
.sn.on .sc{background:var(--grad);border-color:transparent;color:#0d1108;
  box-shadow:0 0 0 5px rgba(182,242,74,.16)}
.sn i{font-style:normal;font-size:12px;font-weight:500;color:var(--tx3);text-align:center;line-height:1.3}
.sn.on i{color:var(--tx)}
.sn.done i{color:var(--tx2)}

.steplabel{font-size:10.5px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--tx3)}
fieldset{border:0;padding:0;margin:22px 0 0}
fieldset:first-of-type{margin-top:16px}
legend{padding:0;font-size:14.5px;font-weight:600;color:var(--tx)}
.why{font-size:12.5px;color:var(--tx3);margin:3px 0 12px}
.opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}
label.opt{display:flex;gap:11px;align-items:flex-start;padding:13px 15px;border:1px solid var(--line);
  border-radius:14px;cursor:pointer;background:var(--surf2);transition:border-color .22s,background .22s,transform .22s}
label.opt:hover{border-color:var(--line2);transform:translateY(-2px)}
label.opt:has(input:checked){border-color:rgba(182,242,74,.42);background:rgba(182,242,74,.06)}
label.opt input{margin:3px 0 0;flex:none;accent-color:var(--lime)}
.opt-body{min-width:0;display:flex;flex-direction:column;gap:2px}
.opt-label{font-weight:500;font-size:13.5px;color:var(--tx)}
.opt-desc{font-size:12.5px;color:var(--tx3);line-height:1.5}
.lic{font-size:11px;color:var(--tx3);opacity:.8;margin-top:3px}
.other{margin-top:10px}
.other .inp2{font-size:13px;padding:9px 12px}
#out{max-height:320px}
.missing{color:var(--am);font-size:13px;margin-top:12px}
ol.next{padding-left:20px;color:var(--tx2);font-size:13.5px}
ol.next li{margin:9px 0}
@media (max-width:760px){
  .steps{padding:16px 14px 12px}
  .strack{left:24px;right:24px;top:34px}
  .sn i{display:none}
}
@media (max-width:560px){ .opts{grid-template-columns:1fr} }`;

/**
 * The whole wizard as one self-contained page: no build step, no network, no dependencies.
 * Unlike the dashboard it does need JavaScript — it is a form, and the alternative is posting
 * somewhere, which there is nothing to post to.
 */
export function renderWizard({ projectName = '' } = {}) {
  const name = projectName || 'New project';
  const model = wizardModel();

  // Rendered server-side so the rail and the stepper exist before the script runs, and so the
  // anchors work even if it never does.
  const nav = [
    ...SECTIONS.map((section, index) => ({
      href: `#step-${index}`, label: section.title, icon: section.icon, current: index === 0,
    })),
    { href: '#result', label: 'Hand it back', icon: 'doc' },
  ];

  const stepper = `
      <div class="steps">
        <div class="strack"><div class="sfill" id="sfill"></div></div>
        <div class="snodes" style="grid-template-columns:repeat(${SECTIONS.length}, 1fr)">
${SECTIONS.map((section, index) => `          <a class="sn${index === 0 ? ' on' : ''}" href="#step-${index}" data-step="${index}"><span class="sc">${index + 1}</span><i>${escape(section.title)}</i></a>`).join('\n')}
        </div>
      </div>`;

  const body = `${stepper}

      <section class="cd">
        <h2>Answer what you know; skip what you don't.</h2>
        <p class="cs" style="margin-bottom:0">Nothing is installed or written from this page. At the end you get a
        <code>requirements.json</code> to hand back to Claude Code, which does the scaffolding and can
        still ask about anything you left blank.</p>
      </section>

      <form id="form"></form>

      <section class="cd" id="result">
        <span class="steplabel">Last step</span>
        <h2 style="margin-top:6px">Hand this back</h2>
        <p class="cs">Save it into your project as <code>specs/requirements.json</code>, or copy it and
        paste it to Claude Code.</p>
        <div class="actions">
          <button type="button" class="btn primary" id="download">Download requirements.json</button>
          <button type="button" class="btn" id="copy">Copy to clipboard</button>
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
      </section>`;

  const script = `
const MODEL = ${embed(model)};
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
    '<div class="other"><input class="inp2" type="text" data-other="' + q.id + '" placeholder="Something else? Type it here."></div>' +
    '</fieldset>';
}

function build() {
  const form = document.getElementById('form');
  form.innerHTML = MODEL.sections.map((section, index) => {
    let questions = section.questions;
    if (section.layers) questions = Object.values(MODEL.layerQuestions);
    if (section.starter) questions = [MODEL.starter];
    return '<section class="cd" id="step-' + index + '" data-section="' + index + '">' +
      '<span class="steplabel">Step ' + (index + 1) + ' of ' + MODEL.sections.length + '</span>' +
      '<h2 style="margin-top:6px">' + section.title + '</h2>' +
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

// The stepper is the only progress signal on a long form: a step is done when every question
// still showing inside it has an answer, and the first one that isn't is where you are.
function markSteps() {
  const sections = [...document.querySelectorAll('section[data-section]')];
  const states = sections.map((section) => {
    const visible = [...section.querySelectorAll('fieldset[data-question]')]
      .filter((f) => !f.classList.contains('hidden'));
    return visible.length > 0 && visible.every((f) => answers[f.dataset.question] !== undefined);
  });
  const current = states.indexOf(false);
  document.querySelectorAll('.sn').forEach((node, index) => {
    node.classList.toggle('done', states[index] === true);
    node.classList.toggle('on', index === current);
  });
  const done = states.filter(Boolean).length;
  const fill = document.getElementById('sfill');
  if (fill) fill.style.width = Math.round((done / states.length) * 100) + '%';
  document.querySelectorAll('.nb[href^="#step-"]').forEach((link, index) => {
    link.classList.toggle('on', index === (current === -1 ? states.length - 1 : current));
  });
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
  markSteps();
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

build();`;

  return shell({
    title: `${name} — build your spec`,
    name,
    sub: 'Build your project spec',
    nav,
    right: '<span class="stamp" id="progress">0 of 0 answered</span>',
    style: PAGE_STYLE,
    body,
    script,
  });
}
