// A browser form for people who would rather not answer twenty questions in a terminal.
//
// The page is generated from the same catalogue the CLI asks from — questions.js, components.js
// and starters.js — so the two can never offer different stacks. Nothing is retyped here; add a
// component to the catalogue and it appears in the form on the next `vibekit wizard`.
//
// The chrome comes from page-chrome.js, the same module the dashboard uses, and the form is built
// from the design system's wizard components: a stepper in the sidebar, choice cards, and a
// sticky footer that carries the one action that matters on each step.
//
// It produces exactly one thing: the requirements.json that `vibekit advise apply --from` and
// `vibekit init --from` already accept. The page decides nothing and scaffolds nothing — the
// recommendation, the licence exclusions and the validation all still happen in the CLI, where
// they are tested. Handing the answers back is a choice at the end, not a thing this page does on
// its own: either you run the command yourself, or, when the form is being served, you send them
// to the running vibekit and it does the same work on the other side.

import { componentsFor } from './advisor/components.js';
import { BAAS, STATIC_QUESTIONS } from './advisor/questions.js';
import { STARTERS } from './advisor/starters.js';
import { CHROME_SCRIPT, escape, icon, shell } from './page-chrome.js';

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
// grouping lives here, because the terminal asks in rounds and a form moves a step at a time.
const SECTIONS = [
  { title: 'What you are building', icon: 'home', ids: ['platform', 'appType', 'scale', 'clients'] },
  { title: 'Constraints', icon: 'issues', ids: ['licensing', 'ecosystem', 'team', 'data'] },
  { title: 'Architecture and security', icon: 'board', ids: ['architecture', 'signin', 'security', 'compliance'] },
  { title: 'Stack', icon: 'features', layers: true },
  { title: 'Starting point', icon: 'star', starter: true },
  { title: 'Delivery', icon: 'cog', ids: ['hosting', 'integrations'] },
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
    { id: 'none', label: 'From scratch', description: 'vibekit generates the layout and conventions', licence: 'permissive', licenceName: '—' },
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

// Only what the form adds on top of the design system. Everything visible is an Atlas component.
const PAGE_STYLE = `
/* The stepper sits inside the sidebar's .nav, which keeps its links on one line. A step title is a
   phrase rather than a menu word, so here it wraps — which is what the design system's own
   line-height on .lbl is for. Without this a long title paints straight over its count. */
.stepper .lbl{white-space:normal;overflow-wrap:break-word}
.stepper a{align-items:flex-start}
.stepper .n,.stepper .cnt{margin-top:1px}
.step{display:none}
.step.on{display:grid;gap:var(--gutter);animation:pageIn var(--dur-slow) var(--ease-decelerate) both}
.hidden{display:none!important}
.question.hidden,.choice.hidden{display:none!important}
#handoff .choices{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.sent{display:grid;gap:var(--sp-3)}`;

/**
 * The whole wizard as one self-contained page: no build step, no dependencies.
 *
 * Unlike the dashboard it does need JavaScript — it is a form that hides the questions your
 * earlier answers made irrelevant, and the alternative is asking all of them and ignoring most.
 * A page without scripting says so rather than showing a form that cannot work.
 *
 * `control` is the URL that accepts the finished answers, present only when this page is being
 * served. Then the last step can offer to build from here as well as from a terminal.
 */
export function renderWizard({ projectName = '', control = null } = {}) {
  const name = projectName || 'New project';
  const model = wizardModel();
  const last = SECTIONS.length;

  // Rendered server-side so the stepper exists before the script runs, and so its shape does not
  // shift when it does.
  const stepper = `
      ${SECTIONS.map((section, index) => `<a href="#step-${index}" class="${index === 0 ? 'current' : ''}" data-step="${index}" data-tip="${escape(section.title)}">
        <span class="n">${index + 1}</span><span class="lbl">${escape(section.title)}</span><span class="cnt"></span>
      </a>`).join('\n      ')}
      <a href="#step-${last}" data-step="${last}" data-tip="Hand it back">
        <span class="n">${last + 1}</span><span class="lbl">Hand it back</span><span class="cnt"></span>
      </a>`;

  const body = `
      <noscript>
        <div class="alert warn">${icon('issues')}<div><b>This form needs JavaScript</b>
        <p>It hides the questions your earlier answers make irrelevant. Run <code>vibekit advise</code>
        in a terminal instead — it asks the same things.</p></div></div>
      </noscript>

      <div class="card" id="intro">
        <div class="card-head"><div class="card-title">Answer what you know; skip what you don't.<small>Nothing is installed or written until the last step</small></div></div>
        <p class="t-muted">At the end you get a <code>requirements.json</code>. You can run the command yourself,
        or${control ? ' send it straight to the vibekit that is serving this page.' : ' — when this form is served rather than opened from a file — send it straight to the running vibekit.'}</p>
      </div>

      <form id="form"></form>

      <section class="card step" id="step-${last}" data-section="${last}">
        <div class="card-head"><div class="card-title">Hand it back<small>Step ${last + 1} of ${last + 1}</small></div></div>
        <div class="alert warn hidden" id="missing"></div>

        <div class="question">
          <div class="qh"><h3>How do you want to build it?</h3></div>
          <div class="choices" id="handoff">
            <label class="choice" data-mode="cli">
              <input type="radio" name="handoff" value="cli" checked>
              <span class="ctl"></span>
              <b>Build from the CLI</b>
              <span>Save the file yourself and run the command. Works anywhere, including from a
              file:// copy of this page.</span>
            </label>
            <label class="choice${control ? '' : ' hidden'}" data-mode="web">
              <input type="radio" name="handoff" value="web">
              <span class="ctl"></span>
              <b>Build from here</b>
              <span>Send the answers to the vibekit serving this page. It writes
              <code>specs/requirements.json</code> and picks the stack, and the console shows it happen.</span>
            </label>
          </div>
        </div>

        <div class="mt-4" id="cliPane">
          <div class="card-actions mb-3">
            <button type="button" class="btn btn-primary" id="download">Download requirements.json</button>
            <button type="button" class="btn btn-ghost" id="copy">Copy to clipboard</button>
          </div>
          <div class="next-steps">
            <div>Put the file in your project at <code>specs/requirements.json</code>.</div>
            <div>In that folder run <code>vibekit advise apply</code> — or tell Claude Code
              <em>"apply my requirements"</em> and it runs it for you.</div>
            <div>It writes <code>specs/project.json</code>, a technology-selection ADR recording why each
              choice won, and scaffolds the project.</div>
          </div>
        </div>

        <div class="mt-4 hidden" id="webPane">
          <div class="card-actions mb-3">
            <button type="button" class="btn btn-primary" id="send">Send to vibekit</button>
            <button type="button" class="btn btn-ghost" id="sendOnly">Save the file only</button>
          </div>
          <p class="t-caption">Sending needs the write token this server printed when it started. It is
          asked for once and kept in this browser — the link on its own can read, but not build.</p>
          <div class="sent mt-3" id="sent"></div>
        </div>

        <h3 class="t-h4 mt-4">What gets handed over</h3>
        <div class="review mt-3" id="review"></div>
        <pre class="json mt-3" id="out">{}</pre>
      </section>

      <div class="wiz-foot">
        <button type="button" class="btn btn-ghost" id="back">Back</button>
        <div class="mid"><span id="stepName"></span><div class="dots" id="dots"></div></div>
        <button type="button" class="btn btn-primary" id="next">Next</button>
      </div>`;

  // The chrome's own behaviour first — theme, drawer, toast — then this page's. `escape` is
  // declared here rather than in the chrome because the dashboard gets it from the render module,
  // and two declarations of the same name in one script block is a syntax error, not a warning.
  const script = `${CHROME_SCRIPT}
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char]);

const MODEL = ${embed(model)};
const CONTROL = ${control ? embed(control) : 'null'};
const answers = {};
const LAST = ${last};
let step = 0;

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
  const multi = q.multi ? ' multi' : '';
  const lic = option.licenceName ? '<span class="lic">' + escape(option.licenceName) + '</span>' : '';
  return '<label class="choice' + multi + '" data-option="' + escape(option.id) + '">' +
    '<input type="' + (q.multi ? 'checkbox' : 'radio') + '" name="' + escape(q.id) + '" value="' + escape(option.id) + '">' +
    '<span class="ctl"></span><b>' + escape(option.label) + '</b>' +
    '<span>' + escape(option.description || '') + '</span>' + lic + '</label>';
}

function questionHtml(q) {
  return '<fieldset class="question" data-question="' + escape(q.id) + '">' +
    '<div class="qh"><h3>' + escape(q.question) + '</h3>' +
    (q.multi ? '<span class="qsub">Choose any that apply, or none.</span>' : '') +
    '<span class="qtag badge neutral no-dot" data-answered="' + escape(q.id) + '">Not answered</span></div>' +
    '<div class="choices">' + q.options.map((o) => optionHtml(q, o)).join('') + '</div>' +
    '<div class="other"><input type="text" data-other="' + escape(q.id) + '" placeholder="Something else? Type it here." aria-label="Something else for: ' + escape(q.question) + '"></div>' +
    '</fieldset>';
}

function build() {
  const form = document.getElementById('form');
  form.innerHTML = MODEL.sections.map((section, index) => {
    let questions = section.questions;
    if (section.layers) questions = Object.values(MODEL.layerQuestions);
    if (section.starter) questions = [MODEL.starter];
    return '<section class="card step" id="step-' + index + '" data-section="' + index + '">' +
      '<div class="card-head"><div class="card-title">' + escape(section.title) +
      '<small>Step ' + (index + 1) + ' of ' + (LAST + 1) + '</small></div></div>' +
      questions.map(questionHtml).join('') + '</section>';
  }).join('');
  form.addEventListener('change', onChange);
  form.addEventListener('input', onChange);
  document.getElementById('dots').innerHTML = Array.from({ length: LAST + 1 }, () => '<i></i>').join('');
  refresh();
  show(0);
}

function onChange(event) {
  const target = event.target;
  if (target.dataset.other !== undefined) {
    const text = target.value.trim();
    if (text) answers[target.dataset.other] = { other: text };
    else delete answers[target.dataset.other];
    target.closest('.other').classList.toggle('has', Boolean(text));
  } else if (target.name) {
    const id = target.closest('fieldset').dataset.question;
    if (target.type === 'checkbox') {
      answers[id] = [...document.querySelectorAll('input[name="' + id + '"]:checked')].map((input) => input.value);
    } else {
      answers[id] = target.value;
    }
    const other = document.querySelector('[data-other="' + id + '"]');
    if (other) { other.value = ''; other.closest('.other').classList.remove('has'); }
  }
  refresh();
}

/** Which questions are showing on a step, and how many of them have an answer. */
function visibleIn(section) {
  return [...section.querySelectorAll('fieldset[data-question]')].filter((f) => !f.classList.contains('hidden'));
}
function answeredIn(section) {
  return visibleIn(section).filter((f) => answers[f.dataset.question] !== undefined).length;
}

function show(index) {
  step = Math.max(0, Math.min(LAST, index));
  for (const section of document.querySelectorAll('.step')) {
    section.classList.toggle('on', Number(section.dataset.section) === step);
  }
  for (const link of document.querySelectorAll('.stepper a')) {
    link.classList.toggle('current', Number(link.dataset.step) === step);
  }
  document.getElementById('intro').hidden = step !== 0;
  document.getElementById('back').disabled = step === 0;
  document.getElementById('next').textContent = step === LAST ? 'Done' : 'Next';
  document.getElementById('next').disabled = step === LAST;
  document.getElementById('stepName').textContent = step === LAST
    ? 'Hand it back'
    : 'Step ' + (step + 1) + ' of ' + (LAST + 1) + ' · ' + MODEL.sections[step].title;
  const dots = document.querySelectorAll('#dots i');
  dots.forEach((dot, index) => {
    const section = document.querySelector('[data-section="' + index + '"]');
    dot.classList.toggle('on', index === step);
    dot.classList.toggle('done', index < LAST && section && visibleIn(section).length > 0 && answeredIn(section) === visibleIn(section).length);
  });
  scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
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

  for (const fieldset of document.querySelectorAll('fieldset[data-question]')) {
    const id = fieldset.dataset.question;
    const model = MODEL.layerQuestions[id] || (id === 'starter' ? MODEL.starter : null);
    if (!model) continue;
    for (const label of fieldset.querySelectorAll('[data-option]')) {
      const option = model.options.find((entry) => entry.id === label.dataset.option);
      const ok = licenceAllows(option && option.licence) && (id !== 'starter' || starterFits(option));
      label.classList.toggle('hidden', !ok);
      const input = label.querySelector('input');
      if (!ok && input.checked) { input.checked = false; delete answers[id]; }
    }
    if (id === 'starter') {
      const anyFits = [...fieldset.querySelectorAll('[data-option]')]
        .some((label) => !label.classList.contains('hidden') && label.dataset.option !== 'none');
      fieldset.classList.toggle('hidden', !anyFits);
    }
  }

  // The chosen card carries the state, so the answer is visible without reading the controls.
  for (const label of document.querySelectorAll('.choice')) {
    const input = label.querySelector('input');
    if (input) label.classList.toggle('on', input.checked);
  }
  for (const tag of document.querySelectorAll('[data-answered]')) {
    const answered = answers[tag.dataset.answered] !== undefined;
    tag.textContent = answered ? 'Answered' : 'Not answered';
    tag.className = 'qtag badge no-dot ' + (answered ? 'ok' : 'neutral');
  }

  const visible = [...document.querySelectorAll('fieldset[data-question]')].filter((f) => !f.classList.contains('hidden'));
  const unanswered = visible.filter((f) => answers[f.dataset.question] === undefined).map((f) => f.dataset.question);
  document.getElementById('progress').textContent = (visible.length - unanswered.length) + ' of ' + visible.length + ' answered';

  for (const link of document.querySelectorAll('.stepper a[data-step]')) {
    const index = Number(link.dataset.step);
    const section = document.querySelector('[data-section="' + index + '"]');
    if (!section || index === LAST) continue;
    const total = visibleIn(section).length;
    const done = answeredIn(section);
    link.querySelector('.cnt').textContent = total ? done + '/' + total : '';
    link.classList.toggle('done', total > 0 && done === total);
  }

  const missing = document.getElementById('missing');
  missing.classList.toggle('hidden', unanswered.length === 0);
  missing.innerHTML = unanswered.length
    ? '<div><b>' + unanswered.length + ' still unanswered</b><p>' + escape(unanswered.join(', ')) +
      '. Hand it over anyway — the CLI asks about the rest.</p></div>'
    : '';

  document.getElementById('out').textContent = JSON.stringify(answers, null, 2);
  renderReview();
}

function labelFor(id, value) {
  const model = MODEL.layerQuestions[id] || (id === 'starter' ? MODEL.starter : MODEL.sections.flatMap((s) => s.questions).find((q) => q.id === id));
  const option = model && model.options.find((entry) => entry.id === value);
  return option ? option.label : value;
}

function renderReview() {
  const rows = [];
  MODEL.sections.forEach((section, index) => {
    const holder = document.querySelector('[data-section="' + index + '"]');
    if (!holder) return;
    for (const fieldset of visibleIn(holder)) {
      const id = fieldset.dataset.question;
      const value = answers[id];
      const text = value === undefined ? 'Not answered'
        : Array.isArray(value) ? (value.map((entry) => labelFor(id, entry)).join(', ') || 'None')
        : value && value.other ? value.other
        : labelFor(id, value);
      rows.push('<div class="row"><span class="k">' + escape(id) + '</span>' +
        '<span class="v' + (value === undefined ? ' empty' : '') + '">' + escape(text) + '</span>' +
        '<span class="sec">' + escape(section.title) + '</span></div>');
    }
  });
  document.getElementById('review').innerHTML = rows.join('');
}

// --- Handing it back ------------------------------------------------------------------------

function mode() {
  const checked = document.querySelector('input[name="handoff"]:checked');
  return checked ? checked.value : 'cli';
}
function syncPanes() {
  const web = mode() === 'web';
  document.getElementById('cliPane').classList.toggle('hidden', web);
  document.getElementById('webPane').classList.toggle('hidden', !web);
  for (const label of document.querySelectorAll('#handoff .choice')) {
    label.classList.toggle('on', label.querySelector('input').checked);
  }
}
document.getElementById('handoff').addEventListener('change', syncPanes);

document.getElementById('copy').addEventListener('click', async () => {
  const button = document.getElementById('copy');
  const text = JSON.stringify(answers, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    // Clipboard access is blocked in some embedded viewers; selecting the text still works.
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('out'));
    const selection = getSelection();
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
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Embedded viewers render this in an iframe, where a script-driven download is silently inert.
// Offering a button that does nothing is worse than not offering it.
if (self !== top) {
  document.getElementById('download').hidden = true;
  const note = document.createElement('p');
  note.className = 't-caption mb-3';
  note.textContent = 'Downloads are blocked when this page is embedded — use Copy instead.';
  document.getElementById('cliPane').prepend(note);
}

async function send(action, button, label) {
  if (!CONTROL) return;
  const key = stored('vibekit-token') || await askToken();
  if (!key) return;
  button.classList.add('loading');
  let response;
  try {
    response = await fetch(CONTROL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ action: action, requirements: answers }),
    });
  } catch {
    button.classList.remove('loading');
    return report('danger', 'The server is not reachable', 'Is the console still running?');
  }
  button.classList.remove('loading');
  if (response.status === 401 || response.status === 403) {
    store('vibekit-token', '');
    return report('danger', 'That token was not accepted', 'Check the token the console printed and try again.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return report('danger', 'Refused', result.error || 'The project would not take those answers.');
  const written = [result.result && result.result.saved, result.result && result.result.adrPath].filter(Boolean);
  report('ok', label, written.length ? 'Written: ' + written.join(', ') : 'Saved.');
  toast(label);
}

function report(tone, title, detail) {
  document.getElementById('sent').innerHTML =
    '<div class="alert ' + tone + '"><div><b>' + escape(title) + '</b><p>' + escape(detail) + '</p></div></div>';
}

function askToken() {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask on';
    mask.innerHTML = '<div class="modal"><h3>Write token</h3>' +
      '<p>Sending needs the token this server printed when it started. It is kept in this browser only.</p>' +
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

if (CONTROL) {
  document.getElementById('send').addEventListener('click', (event) => send('requirements.apply', event.currentTarget, 'Applied — the console will show it'));
  document.getElementById('sendOnly').addEventListener('click', (event) => send('requirements.save', event.currentTarget, 'Saved to specs/requirements.json'));
}

// --- Moving between steps -------------------------------------------------------------------

document.getElementById('back').addEventListener('click', () => show(step - 1));
document.getElementById('next').addEventListener('click', () => show(step + 1));
document.addEventListener('click', (event) => {
  const link = event.target.closest('.stepper a[data-step]');
  if (!link) return;
  event.preventDefault();
  show(Number(link.dataset.step));
});

build();
syncPanes();
`;

  return shell({
    title: `${name} — build your spec`,
    name,
    sub: 'Build your project spec',
    crumb: 'Spec wizard',
    navLabel: 'Steps',
    nav: `<div class="stepper">${stepper}</div>`,
    right: '<span class="badge neutral" id="progress">0 of 0 answered</span>',
    style: PAGE_STYLE,
    body,
    script,
  });
}
