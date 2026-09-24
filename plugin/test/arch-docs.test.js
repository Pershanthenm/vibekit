import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_BRAND, darken, parseBrand, withContrastNotes } from '../src/docs/arch/brand.js';
import { HLD_TEMPLATE, fill, readAuthoredSections, renderHld } from '../src/docs/arch/documents.js';
import { contractEndpoints, docsDrift, endpointsFrom, placeholdersIn } from '../src/docs/arch/drift.js';
import { renderDsl, renderErd, renderMermaid } from '../src/docs/arch/dsl.js';
import { generateDocs, generateModel } from '../src/docs/arch/generate.js';
import { buildModel, entitiesFrom } from '../src/docs/arch/model.js';
import { contrast, labelColour } from '../src/docs/arch/svg.js';
import { generateFolder } from '../src/folder/generate.js';
import './helpers.js';

/**
 * Documentation Feature Spec.
 *
 * The tests that matter are §8's acceptance list, and of those the one the spec singles out as
 * most likely to fail: deterministic output. A document that reshuffles itself on every run
 * produces a diff nobody reads, which is the same failure as a document nobody trusts.
 */

const CONFIG = {
  name: 'bookings',
  description: 'A booking system for gyms: members book classes, staff manage schedules.',
  architecture: 'clean',
  stack: { language: '.NET 10', web: 'Vue 3', database: 'PostgreSQL 17' },
  commands: { build: 'dotnet build', test: 'dotnet test' },
  entities: [
    { name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }], relations: ['belongs to one Member'] },
    { name: 'Payment', class: 'financial', fields: [{ name: 'amount', type: 'decimal' }] },
    { name: 'Member', class: 'personal', fields: [{ name: 'email', type: 'string', class: 'personal' }] },
  ],
};

const read = (root, path) => readFile(join(root, path), 'utf8');

async function project(config = CONFIG) {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-docs-'));
  await generateFolder(root, config);
  // The two authored files the model reads people from, filled in as a human would.
  const context = join(root, 'vibekit/product/context.md');
  await writeFile(context, (await readFile(context, 'utf8')).replace('**Who uses it.** TODO: the actual roles, not "users".', '**Who uses it.** members and staff'));
  await writeFile(join(root, 'vibekit/product/access.md'), '# Access\n\n| Role \\ Entity | Booking |\n| --- | --- |\n| member | CRU own |\n| staff | CRUD all |\n');
  return root;
}

// ---------------------------------------------------------------- the model (§3)

test('the model is built from the folder, not from anything drawn by hand', async () => {
  const root = await project();
  const model = await buildModel(root);

  assert.deepEqual(model.people.map((person) => person.name), ['member', 'staff'], 'roles come from the access matrix');
  assert.deepEqual(model.containers.map((container) => container.name), ['API', 'Database', 'Web']);
  assert.equal(model.containers.find((container) => container.name === 'Web').technology, 'Vue 3');
  assert.deepEqual(model.entities.map((entity) => entity.name), ['Booking', 'Member', 'Payment']);
  assert.equal(model.entities.find((entity) => entity.name === 'Payment').class, 'financial');
});

test('a component and a container that share a name do not share an identity', async () => {
  // Clean architecture has a src/Web/ layer and a Vue container, both called Web. Collapsing them
  // made a layer dependency point at the browser application — a diagram that says something false.
  const root = await project();
  const model = await buildModel(root);
  const container = model.containers.find((entry) => entry.name === 'Web');
  const component = model.components.find((entry) => entry.name === 'Web');
  assert.ok(container && component);
  assert.notEqual(container.id, component.id);
  assert.ok(!model.relationships.some((relationship) => relationship.from === container.id && relationship.description === 'depends on'));
});

test('code the intended structure does not mention is marked unplanned, not quietly omitted', async () => {
  // map.md says where code is supposed to go; bindings.json records where it went. Showing only
  // the intention is precisely why nobody trusts architecture diagrams.
  const root = await project();
  await writeFile(join(root, 'vibekit/.state/bindings.json'), JSON.stringify({ entities: { 'src/Reporting/ReportService.cs': 'Booking' } }));
  const model = await buildModel(root);

  const unplanned = model.components.filter((component) => component.unplanned);
  assert.equal(unplanned.length, 1);
  assert.equal(unplanned[0].path, 'src/Reporting/');
});

test('a placeholder in a starter produces nobody, not somebody with a strange name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-docs-'));
  await generateFolder(root, CONFIG);
  const model = await buildModel(root);
  assert.deepEqual(model.people, [], 'the unfilled "TODO: the actual roles, not \\"users\\"" must not become a person');
});

// ---------------------------------------------------------------- the DSL and diagrams

test('the DSL carries every container, component and relationship', async () => {
  const root = await project();
  const model = await buildModel(root);
  const dsl = renderDsl(model, { brand: DEFAULT_BRAND });

  assert.match(dsl, /= container "Web" "Vue 3" "spa"/);
  assert.match(dsl, /= component "Domain"/);
  assert.match(dsl, /web -> api "Calls"/);
  assert.match(dsl, /systemContext .+ "context"/);
  assert.match(dsl, /container .+ "container"/);
});

test('Mermaid is a second view of the same model, never a second source', async () => {
  const root = await project();
  const model = await buildModel(root);
  const container = renderMermaid(model, 'container');
  const context = renderMermaid(model, 'context');

  assert.match(container, /flowchart LR/);
  assert.match(container, /database\[\(/, 'a database is drawn as a store');
  assert.match(context, /member/);
  // The context view collapses the system's insides, or it is not a context diagram.
  assert.doesNotMatch(context, /Vue 3/);
});

test('the ERD comes from the closed vocabulary, with classifications', async () => {
  const model = await buildModel(await project());
  const erd = renderErd(model);
  assert.match(erd, /erDiagram/);
  assert.match(erd, /Booking \{/);
  assert.match(erd, /string email "personal"/);
});

test('a diagram label that would be unreadable is re-coloured rather than shipped', async () => {
  // §3: a label failing WCAG AA against its fill is re-rendered legibly.
  assert.ok(contrast('#FFFFFF', '#000000') > 20);
  assert.equal(labelColour('#F4E4A0', '#FFFFFF'), '#14171C', 'white on a pale fill fails AA, so dark text is used');
  assert.equal(labelColour('#0B4F6C', '#FFFFFF'), '#FFFFFF', 'white on a dark brand passes and is kept');
});

test('a brand colour too pale for body text is darkened, and the reason is recorded', async () => {
  const brand = withContrastNotes({ colour: { brand: '#F4A300' } });
  assert.ok(brand.notes.length, 'a silent substitution is how a team finds out in a printed document');
  assert.match(brand.notes.join(' '), /AA contrast|dark text/i);
  assert.equal(darken('#F4A300', 0.5), '#7A5200');
});

test('brand.yml is read in the shape it is written', () => {
  const brand = parseBrand('company:\n  name: Acme\ncolour:\n  brand: "#0B4F6C"\ntype:\n  heading: Poppins\n');
  assert.equal(brand.company.name, 'Acme');
  assert.equal(brand.colour.brand, '#0B4F6C');
  assert.equal(brand.type.heading, 'Poppins');
});

// ---------------------------------------------------------------- determinism (§8 acceptance 7)

test('regenerating changes nothing — no churn, no reordered tables, no reshuffled diagrams', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc1234' });

  const snapshot = async () => {
    const out = new Map();
    for (const name of await readdir(join(root, 'docs'), { recursive: true })) {
      if (name.includes('.docs-state')) continue;
      const text = await readFile(join(root, 'docs', name), 'utf8').catch(() => null);
      if (text !== null) out.set(name, text);
    }
    return out;
  };

  const before = await snapshot();
  await generateDocs(root, { commit: 'abc1234' });
  const after = await snapshot();

  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [name, text] of before) assert.equal(after.get(name), text, `${name} changed between two runs of the same model`);
  assert.ok(before.size > 4, 'the snapshot actually covered the output');
});

// ---------------------------------------------------------------- documents (§4, §6)

test('the HLD reads from the model, and says which parts stand on a guess', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc1234' });
  const hld = await read(root, 'docs/hld.md');

  assert.match(hld, /# bookings — High Level Design/, 'the pointer names the app, not the starter heading');
  assert.match(hld, /!\[bookings system context\]\(diagrams\/context\.svg\)/);
  assert.match(hld, /\| API \| \.NET 10 \|/);
  assert.match(hld, /Member \(personal\), Payment \(financial\)/);
  assert.match(hld, /## 7\. Assumptions and open questions/);
  // Starter instructions are guidance for whoever fills the file in, not text to hand a client.
  assert.doesNotMatch(hld, /Hard ceiling: 300 tokens/);
});

test('a placeholder VibeKit knows but cannot fill is dropped and reported; one it does not know is left in place', () => {
  const values = { 'table.quality': undefined, 'project.name': 'bookings' };
  const { text, empty, unknown } = fill('# {{project.name}}\n\n{{table.quality}}\n\n{{table.invented}}\n', values);

  assert.match(text, /# bookings/);
  assert.doesNotMatch(text, /\{\{table\.quality\}\}/, 'a known-but-empty section would read as broken in a client document');
  assert.match(text, /\{\{table\.invented\}\}/, 'an unrecognised one stays, so the gap is obvious');
  assert.deepEqual(empty, ['table.quality']);
  assert.deepEqual(unknown, ['table.invented']);
});

test('a section a person wrote inside a generated document survives regeneration', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc1234' });

  const path = join(root, 'docs/hld.md');
  const mine = '<!-- authored:summary -->\nThis release is for the Durban pilot.\n<!-- /authored -->';
  await writeFile(path, `${await readFile(path, 'utf8')}\n${mine}\n`);
  assert.deepEqual(Object.keys(readAuthoredSections(await readFile(path, 'utf8'))), ['authored.summary']);
});

test('a template overrides one document and leaves the others on the built-in structure', async () => {
  const root = await project();
  await writeFile(join(root, 'docs/templates/hld.md'), '# {{project.name}} — ours\n\n{{diagram.c4.container}}\n').catch(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'docs/templates'), { recursive: true });
    await writeFile(join(root, 'docs/templates/hld.md'), '# {{project.name}} — ours\n\n{{diagram.c4.container}}\n');
  });

  const { model, brand } = await generateModel(root);
  const hld = await renderHld(root, model, brand, { docs: 'docs' });
  assert.match(hld, /# bookings — ours/);
  assert.doesNotMatch(hld, /High Level Design/, 'the override wins for this document');
});

test('the built-in HLD only asks for placeholders that exist', async () => {
  // A structure shipped with a placeholder nothing can fill would print its own bug into every
  // document. This is how {{table.trust_boundaries}} was caught.
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  const hld = await read(root, 'docs/hld.md');
  assert.doesNotMatch(hld, /not recognised/, 'the shipped structure must not ask for an unknown placeholder');
  for (const placeholder of placeholdersIn(HLD_TEMPLATE)) assert.ok(placeholder.includes('.'), placeholder);
});

// ---------------------------------------------------------------- drift (§7)

test('a clean project reports no documentation drift', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  const { findings } = await docsDrift(root);
  assert.deepEqual(findings.filter((entry) => entry.severity === 'error'), [], findings.map((entry) => entry.message).join('\n'));
});

test('code with no place in the intended structure fails the check', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  await writeFile(join(root, 'vibekit/.state/bindings.json'), JSON.stringify({ entities: { 'src/Reporting/R.cs': 'Booking' } }));

  const { findings } = await docsDrift(root);
  const found = findings.find((entry) => entry.code === 'docs.unplannedComponent');
  assert.ok(found, findings.map((entry) => entry.code).join(', '));
  assert.match(found.message, /every diagram of it is already wrong|does not mention it/);
});

test('an entity missing from the data model fails the check', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  await writeFile(join(root, 'docs/data-model.md'), '<!-- generated by vibekit · do not edit · source: docs -->\n# Data model\n\n## Booking\n');

  const { findings } = await docsDrift(root);
  assert.ok(findings.some((entry) => entry.code === 'docs.entityMissing' && entry.message.includes('Member')));
});

test('an endpoint a contract test pins but the API reference omits fails the check', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'tests/contract'), { recursive: true });
  await writeFile(join(root, 'tests/contract/bookings.test.js'), "test('cancels', () => request('POST /api/bookings/{id}/cancel'));\n");
  await writeFile(join(root, 'docs/api-reference.md'), '<!-- generated by vibekit · do not edit · source: docs -->\n# API\n');

  assert.deepEqual(await contractEndpoints(root), ['POST /api/bookings/{id}/cancel']);
  const { findings } = await docsDrift(root);
  assert.ok(findings.some((entry) => entry.code === 'docs.endpointMissing'), 'somebody will integrate against a document that does not list it');
});

test('a template placeholder that stopped resolving is reported before the section vanishes', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'docs/templates'), { recursive: true });
  await writeFile(join(root, 'docs/templates/hld.md'), '# x\n\n{{diagram.deployment}}\n');

  const { findings } = await docsDrift(root);
  assert.ok(findings.some((entry) => entry.code === 'docs.deadPlaceholder'), 'this project has no environments, so that section would silently vanish');
});

test('a generated document edited by hand is a decision, reported with its consequence', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc' });
  await writeFile(join(root, 'docs/hld.md'), '# Our own HLD\n\nHand written.\n');

  const { findings } = await docsDrift(root);
  const detached = findings.find((entry) => entry.code === 'docs.detached');
  assert.ok(detached);
  assert.equal(detached.severity, 'warning', 'taking a document over is a choice, not an error');
  assert.match(detached.message, /no longer rewrites it/);
});

test('endpoints are read from the contract tests, since annotations drift and tests do not', () => {
  assert.deepEqual(endpointsFrom(`request('GET /api/bookings'); call("DELETE /api/bookings/{id}")`), ['DELETE /api/bookings/{id}', 'GET /api/bookings']);
  assert.deepEqual(endpointsFrom('nothing here'), []);
});

test('entity parsing keeps field classifications, which everything downstream derives from', () => {
  const entities = entitiesFrom('# Entities\n\n## Member\n\nclass: personal\n\n- `email` string · personal — the login\n- `id` uuid\n');
  assert.equal(entities.length, 1);
  assert.equal(entities[0].class, 'personal');
  assert.equal(entities[0].fields[0].class, 'personal');
  assert.equal(entities[0].fields[0].notes, 'the login');
});
