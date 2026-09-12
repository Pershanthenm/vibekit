import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { componentsFor } from '../src/advisor/components.js';
import { STATIC_QUESTIONS } from '../src/advisor/questions.js';
import { STARTERS } from '../src/advisor/starters.js';
import { run } from '../src/cli.js';
import { loadProject } from '../src/project.js';
import { renderWizard, wizardModel } from '../src/wizard-page.js';
import { gitInit, newProject, sh } from './helpers.js';

console.log = () => {};
process.env.VIBECHECK_NO_OPEN = '1';

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
  assert.doesNotMatch(html, /https?:\/\/[a-z]/i, 'the form must work with no network');
  assert.match(html, /requirements\.json/, 'it has to say what it produces');
  assert.match(html, /vibecheck advise apply/, 'and how to hand it back');
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

  const html = await readFile(join(root, '.git', 'vibecheck', 'wizard.html'), 'utf8');
  assert.match(html, /build your spec/i);
  assert.equal(sh(root, 'git', 'status', '--porcelain').trim(), '', 'the page must not dirty the tree');
});

// The wizard is meant to be usable before anything exists, so it cannot require a git repo.
test('with no git repo it still writes, beside the project', async () => {
  const root = await newProject('--yes');
  await run(['wizard', '--dir', root]);

  const html = await readFile(join(root, '.vibecheck', 'wizard.html'), 'utf8');
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
