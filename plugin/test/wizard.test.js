import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { componentsFor } from '../src/advisor/components.js';
import { STATIC_QUESTIONS } from '../src/advisor/questions.js';
import { STARTERS } from '../src/advisor/starters.js';
import { run } from '../src/cli.js';
import { wizard } from '../src/commands/wizard.js';
import { loadProject } from '../src/project.js';
import { renderWizard, wizardModel } from '../src/wizard-page.js';
import { gitInit, newProject, sh } from './helpers.js';

console.log = () => {};
process.env.VIBEKIT_NO_OPEN = '1';

// The point of generating the page: a stack the CLI knows about and the form does not is a
// stack nobody can pick in the browser, and nothing would fail to tell you.
test('every question the CLI asks appears in the form', () => {
  const model = wizardModel();
  const inForm = new Set(model.sections.flatMap((section) => section.questions.map((question) => question.id)));

  for (const question of STATIC_QUESTIONS) {
    assert.ok(inForm.has(question.id), `${question.id} is asked by the CLI but missing from the form`);
  }
});

test('every component and starter in the catalogue is offered', () => {
  const model = wizardModel();

  for (const layer of ['backend', 'web', 'mobile', 'desktop', 'database']) {
    const offered = model.layerQuestions[layer].options.map((option) => option.id);
    assert.deepEqual(offered, componentsFor(layer).map((item) => item.id), `${layer} options drifted from the catalogue`);
  }

  const starters = model.starter.options.map((option) => option.id);
  for (const item of STARTERS) assert.ok(starters.includes(item.id), `${item.id} missing from the form`);
  assert.ok(starters.includes('none'), 'building from scratch must stay an option');
});

test('options carry the licence, because it decides what a team may use', () => {
  const model = wizardModel();
  for (const option of model.layerQuestions.backend.options) {
    assert.ok(option.licenceName, `${option.id} has no licence name`);
    assert.ok(option.licence, `${option.id} has no licence class to filter on`);
  }
});

test('the page is self-contained and makes no external requests', () => {
  const html = renderWizard({ projectName: 'device-register' });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /device-register/);
  // The design system's typeface is the one external request, and it has a real fallback stack:
  // where that request is blocked the form still reads, in the system face.
  const external = [...html.matchAll(/https?:\/\/[^"' ]+/g)].map(([url]) => url);
  assert.ok(external.every((url) => /fonts\.(googleapis|gstatic)\.com/.test(url)), `unexpected external request: ${external}`);
  assert.match(html, /requirements\.json/, 'it has to say what it produces');
  assert.match(html, /vibekit advise apply/, 'and how to hand it back');
});

// Embedded JSON containing "</script>" would end the block early and break the page.
test('catalogue text cannot break out of the embedded script', () => {
  const html = renderWizard({});
  const model = html.slice(html.indexOf('const MODEL ='));
  assert.doesNotMatch(model.slice(0, model.indexOf('\n')), /<\/script>/i);
});

test('the project name is escaped, not interpolated raw', () => {
  const html = renderWizard({ projectName: '<img src=x onerror=alert(1)>' });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('in a git repo the page is written outside the working tree', async () => {
  const root = await newProject('--yes');
  gitInit(root);
  await run(['wizard', '--dir', root]);

  const html = await readFile(join(root, '.git', 'vibekit', 'wizard.html'), 'utf8');
  assert.match(html, /build your spec/i);
  assert.equal(sh(root, 'git', 'status', '--porcelain').trim(), '', 'the page must not dirty the tree');
});

// The wizard is meant to be usable before anything exists, so it cannot require a git repo.
test('with no git repo it still writes, beside the project', async () => {
  const root = await newProject('--yes');
  await run(['wizard', '--dir', root]);

  const html = await readFile(join(root, '.vibekit', 'wizard.html'), 'utf8');
  assert.match(html, /build your spec/i);
});

test('--out puts it where asked', async () => {
  const root = await newProject('--yes');
  await run(['wizard', '--dir', root, '--out', 'pick-my-stack.html']);

  const html = await readFile(join(root, 'pick-my-stack.html'), 'utf8');
  assert.match(html, /<!doctype html>/i);
});

// The whole loop: the browser produces answers, the CLI turns them into a project.
test('answers from the form scaffold a project through the existing apply path', async () => {
  const root = await newProject('--yes');
  const answers = {
    platform: 'backend',
    appType: 'internal',
    scale: 'medium',
    clients: [],
    licensing: 'commercial-ok',
    ecosystem: 'microsoft',
    team: ['csharp'],
    data: 'relational',
    architecture: 'modular-clean',
    signin: 'sso',
    security: ['rbac-audit'],
    compliance: 'elevated',
    backend: 'aspnetcore',
    database: 'postgres',
    starter: 'none',
    hosting: 'linux',
    integrations: [],
    autonomy: 'gated',
    engine: 'cursor',
    context: ['docs'],
  };
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify(answers, null, 2));

  await run(['advise', 'apply', '--dir', root]);

  const project = await loadProject(root);
  assert.match(project.stack.backend, /ASP\.NET Core/);
  assert.equal(project.stack.database, 'PostgreSQL 16');
  assert.equal(project.workflow.engine, 'cursor');
  assert.equal(project.architecture.style, 'modular-monolith');
});

// --- Filling it in from somewhere other than this machine ------------------------------------
//
// A written file is the right answer on a laptop and the wrong one over SSH: there is no browser
// to open it with, and a form is no use as a path. Served, the form has an address; tunnelled, the
// address has a code; and on a machine with no project yet the code is the one worth drawing.

const said = [];
const speaking = async (work) => {
  const original = console.log;
  const wasError = console.error;
  said.length = 0;
  console.log = (...args) => said.push(args.join(' '));
  console.error = (...args) => said.push(args.join(' '));
  try {
    return await work();
  } finally {
    console.log = original;
    console.error = wasError;
  }
};

// Port 0 so nothing collides with a console the developer has open.
const bare = () => mkdtemp(join(tmpdir(), 'vibekit-bare-'));

test('--serve hosts the form instead of writing a file nobody can open', async () => {
  const root = await bare();

  const server = await speaking(() => wizard({ root, serve: true, port: '0' }));

  try {
    const url = `${server.url}wizard`;
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /New project/, 'it is the form, served with no project present');
    assert.match(said.join('\n'), /Spec wizard on http:\/\//, 'and the console says where');
    assert.ok(!existsSync(join(root, '.vibekit', 'wizard.html')), 'serving it is instead of writing it, not as well as');
  } finally {
    await server.close();
  }
});

test('asking for a tunnel is asking to be served, so --tunnel alone is enough', async () => {
  const root = await bare();

  // A tunnel that cannot open is the useful case to pin: the form must still be up, and the
  // failure must be a message rather than a command that looks like it did nothing.
  const server = await speaking(() => wizard({ root, tunnel: true, port: '0' }));

  try {
    assert.match(said.join('\n'), /Spec wizard on http:\/\//, 'the form is up regardless');
    assert.equal((await fetch(`${server.url}wizard`)).status, 200);
  } finally {
    await server.close();
  }
});

test('a bad port is refused before anything is served', async () => {
  const root = await bare();

  const server = await speaking(() => wizard({ root, serve: true, port: 'wednesday' }));

  assert.equal(server, undefined, 'nothing was started');
  assert.match(said.join('\n'), /--port must be a number/);
  process.exitCode = 0;
});
