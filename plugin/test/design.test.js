import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { designDocPath, featureUiTargets, parseDesign } from '../src/design.js';
import { loadProject } from '../src/project.js';
import { joinDoc, splitDoc } from '../src/docs/freshness.js';
import { fillSpec, newProject, patchProject, read, setDocsEnabled } from './helpers.js';

console.log = () => {};

const FEATURE = '001-assign-laptop';

// With living docs on, the architecture doc gates `planned` before the design gate is
// reached, so these tests give it a real one first.
const ARCHITECTURE = [
  '# Architecture',
  '',
  'Describes the system as built.',
  '',
  '```mermaid',
  'flowchart LR',
  '  users([Users]) --> web[Web app]',
  '  web --> api[API]',
  '```',
].join(String.fromCharCode(10));

async function freshArchitecture(root) {
  const { meta } = splitDoc(await read(root, 'docs/architecture.md'));
  await writeFile(join(root, 'docs/architecture.md'), joinDoc(meta, ARCHITECTURE));
  await run(['docs', '--dir', root, 'stamp', 'docs/architecture.md']);
}

async function plannedFeature(root, targets) {
  await run(['feature', '--dir', root, 'Assign laptop']);
  await fillSpec(root, FEATURE, { tasks: ['- [ ] T-1 [impl] assign (AC-1) — src/assign.ts'] });
  const spec = join(root, 'specs/features', FEATURE, 'spec.md');
  await writeFile(spec, (await readFile(spec, 'utf8')).replace(/^targets:.*$/m, `targets: [${targets.join(', ')}]`));
  for (const next of ['approved', 'planned']) await run(['status', '--dir', root, '001', next]);
}

async function recordDesign(root, { artboard = 'assign-flow-v2' } = {}) {
  const project = await loadProject(root);
  const path = join(root, designDocPath(project, FEATURE));
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `---\ntitle: "Assign laptop — design"\nkind: "design"\nartboard: ${artboard}\ncanvas: https://claude.ai/design/abc\napproved_by: A. User\n---\n\n# Design\n`);
}

const statusOf = async (root) => readFile(join(root, 'specs/features', FEATURE, 'spec.md'), 'utf8');

test('a feature with screens cannot start until a design is approved', async () => {
  const root = await newProject('--yes');
  await freshArchitecture(root);
  await plannedFeature(root, ['web']);

  await assert.rejects(run(['status', '--dir', root, '001', 'in-progress']), /design: 001-assign-laptop targets web but has no design doc/);
});

test('recording the approved artboard unblocks the build', async () => {
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await plannedFeature(root, ['web']);
  await recordDesign(root);

  await run(['status', '--dir', root, '001', 'in-progress']);
  assert.match(await statusOf(root), /^status: in-progress$/m);
});

// The gate must stay quiet about work it has nothing to say about.
test('a feature with no screens is never gated on design', async () => {
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await plannedFeature(root, ['api']);

  await run(['status', '--dir', root, '001', 'in-progress']);
  assert.match(await statusOf(root), /^status: in-progress$/m);
});

test('a design doc with no approved artboard does not count', async () => {
  const root = await newProject('--yes');
  await freshArchitecture(root);
  await plannedFeature(root, ['ios']);
  await recordDesign(root, { artboard: '' });

  await assert.rejects(run(['status', '--dir', root, '001', 'in-progress']), /names no approved artboard/);
});

test('teams that design elsewhere can turn the gate off', async () => {
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await plannedFeature(root, ['web']);
  await patchProject(root, { workflow: { design: false } });

  await run(['status', '--dir', root, '001', 'in-progress']);
  assert.match(await statusOf(root), /^status: in-progress$/m);
});

test('the feature decides which targets count, falling back to the project', () => {
  const project = { targets: ['web', 'api'], docs: { dir: 'docs' }, workflow: { design: true } };

  assert.deepEqual(featureUiTargets(project, { spec: '---\ntargets: [api]\n---\n' }), []);
  assert.deepEqual(featureUiTargets(project, { spec: '---\ntargets: [web, api]\n---\n' }), ['web']);
  assert.deepEqual(featureUiTargets(project, { spec: '# no front matter' }), ['web'], 'falls back to the project targets');
});

test('design front matter is read, and an empty doc is not a design', () => {
  const design = parseDesign('---\nartboard: assign-v3\ncanvas: https://claude.ai/design/xyz\napproved_by: A. User\n---\n');
  assert.equal(design.artboard, 'assign-v3');
  assert.equal(design.canvas, 'https://claude.ai/design/xyz');
  assert.equal(design.approvedBy, 'A. User');
  assert.equal(parseDesign(''), null);
  assert.equal(parseDesign(null), null);
});
