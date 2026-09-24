import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { isOpen, listAsks } from '../src/folder/asks.js';
import { generateFolder } from '../src/folder/generate.js';
import { ASK_LIMIT, GAPS, gapsFor, unaskedGaps, unfilled } from '../src/docs/arch/gaps.js';
import { generateDocs } from '../src/docs/arch/generate.js';
import { functionalRequirements, glossary, risks, traceability } from '../src/docs/arch/specs.js';
import './helpers.js';

/**
 * The requirements and technical specifications. Specification §59.
 *
 * Both are outputs of the folder, so the tests are about two promises: the shape procurement and
 * QA teams expect, and that a statement `spec` cannot trace is not written. The second is the one
 * worth guarding — a specification that fills its gaps with plausible prose gets agreed to.
 */

const CONFIG = {
  name: 'bookings',
  description: 'A booking system for gyms: members book classes, staff manage schedules.',
  architecture: 'clean',
  stack: { language: '.NET 10', web: 'Vue 3', database: 'PostgreSQL 17' },
  commands: { build: 'dotnet build', test: 'dotnet test' },
  entities: [
    { name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] },
    { name: 'Member', class: 'personal', fields: [{ name: 'email', type: 'string', class: 'personal' }] },
  ],
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-spec-'));
  await generateFolder(root, CONFIG);
  return root;
}

async function withRequirement(root) {
  await run(['req', 'new', 'members can book a class', '--dir', root]);
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8'))
    .replace(/^size:.*$/m, 'size: M')
    .replace(/^source:.*$/m, 'source: product/sources/brs.md#3.2')
    .replace(/^entities:.*$/m, 'entities: [Booking, Member]')
    .replace(/## Acceptance\n[\s\S]*?(?=\n## )/, [
      '## Acceptance', '',
      '- AC-1 When a member submits a booking, the system shall create a booking and return its id.',
      '- AC-2 If the class is full, then the system shall refuse the booking and say the class is full.',
      '- AC-3 The system shall be fast.',
      '',
    ].join('\n'))
    .replace(/## Verification\n[\s\S]*?(?=\n## )/, '## Verification\n\n- AC-1 — tests/contract/bookings.test.ts\n'));
  return path;
}

const capture = async (work) => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await work();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
};

// ---------------------------------------------------------------- the SRS shape (§59)

test('the requirements specification follows the shape procurement and QA teams expect', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc', only: ['srs'] });
  const srs = await readFile(join(root, 'docs/srs.md'), 'utf8');

  for (const heading of [
    '## 1. Introduction', '### 1.1 Purpose and scope', '### 1.2 Definitions', '### 1.3 References',
    '## 2. Overall description', '### 2.2 User classes', '### 2.5 Assumptions',
    '## 3. Functional requirements', '## 4. External interfaces', '## 5. Non-functional requirements',
    '## 6. Data requirements', '## 7. Open questions and deferred scope', '## Appendix A. Traceability matrix',
  ]) {
    assert.ok(srs.includes(heading), `the SRS has no "${heading}"`);
  }
  assert.doesNotMatch(srs, /\{\{[a-z]/, 'an unresolved placeholder in a shipped document is worse than a missing section');
});

test('each requirement appears with its size, its source and the form of every criterion', async () => {
  const root = await project();
  await withRequirement(root);
  await generateDocs(root, { commit: 'abc', only: ['srs'] });
  const srs = await readFile(join(root, 'docs/srs.md'), 'utf8');

  assert.match(srs, /### REQ-001 — members can book a class/);
  assert.match(srs, /size M · drafted · from product\/sources\/brs\.md#3\.2 · touches Booking, Member/);
  assert.match(srs, /\| AC-1 \| event \|/);
  assert.match(srs, /\| AC-2 \| unwanted \|/, 'the pattern is what makes a criterion testable, so it is shown');
});

test('a criterion that cannot become a test is printed as such, not quietly dropped', async () => {
  const root = await project();
  await withRequirement(root);
  const { listRequirements } = await import('../src/folder/requirements.js');
  const body = functionalRequirements(await listRequirements(root));

  assert.match(body, /AC-3 names no observable response/, 'omitting the sentence somebody wrote is how a requirement gets built to the wrong shape');
});

test('traceability shows the criterion with no test as unproved rather than leaving it out', async () => {
  const root = await project();
  await withRequirement(root);
  const { listRequirements } = await import('../src/folder/requirements.js');
  const matrix = traceability(await listRequirements(root));

  assert.match(matrix, /AC-1 \|.*\| tests\/contract\/bookings\.test\.ts/);
  assert.match(matrix, /\*\*not proved yet\*\*/, 'a specification that hides its gaps is the reason nobody trusts one');
});

test('with no requirements the section says so instead of looking finished', async () => {
  assert.match(functionalRequirements([]), /No requirements have been written yet/);
  assert.equal(traceability([]), undefined);
});

// ---------------------------------------------------------------- the technical spec (§59)

test('the technical specification is technical throughout, in the ten sections §59 lists', async () => {
  const root = await project();
  await generateDocs(root, { commit: 'abc', only: ['techspec'] });
  const spec = await readFile(join(root, 'docs/tech-spec.md'), 'utf8');

  for (const heading of [
    '## 1. Architecture overview', '## 2. Component and module map', '## 3. Data model',
    '## 4. API contracts', '## 5. Security design', '## 6. Integrations',
    '## 7. Build, test and deployment', '## 8. Operations', '## 9. Decisions', '## 10. Conventions and standards',
  ]) {
    assert.ok(spec.includes(heading), `the technical specification has no "${heading}"`);
  }

  assert.match(spec, /\| language \| \.NET 10 \|/, 'the stack is a fenced block in map.md, not a table');
  assert.match(spec, /src\/Domain\//, 'where code goes is copied exactly, because it is a path');
  assert.doesNotMatch(spec, /\{\{[a-z]/);
});

test('a placeholder table is empty rather than filled with a heading somebody mistook for content', () => {
  assert.equal(glossary('# Glossary\n\n- **TODO** — what it means in this product.\n'), undefined);
  assert.match(glossary('- **Booking** — a member holding a place in a class\n'), /\| Booking \| a member holding a place in a class \|/);
});

test('classified data is listed as a risk, because it is the work somebody has to own', () => {
  const model = {
    entities: [{ name: 'Member', class: 'personal' }, { name: 'Booking', class: 'internal' }],
    components: [{ name: 'Legacy', path: 'src/Legacy/', unplanned: true }],
  };
  const table = risks(model, [{ id: 'A-001', text: 'members pay by card', confidence: 'low' }]);

  assert.match(table, /A-001 \| members pay by card/);
  assert.match(table, /Legacy \| src\/Legacy\/ is in the code but not in the intended structure/);
  assert.match(table, /Member \| carries personal data/);
  assert.doesNotMatch(table, /Booking/, 'internal data is not a risk to record');
});

// ---------------------------------------------------------------- gaps become asks (§59)

test('a section the folder cannot fill becomes an ask, and the answer lands in the folder', async () => {
  const root = await project();
  const output = await capture(() => run(['spec', '--dir', root]));

  const asks = (await listAsks(root, 'vibekit')).filter(isOpen);
  assert.ok(asks.length > 0);
  assert.ok(asks.length <= ASK_LIMIT, '§12 caps the inbox; an inbox nobody can clear is one nobody opens');

  assert.match(output, /could not be filled from the folder/);
  assert.match(output, /answering it writes to vibekit\/product\/quality\.md, not only to the document/,
    'a gap answered into the document alone is a gap again at the next release');
});

test('running it again does not ask the same question twice', async () => {
  const root = await project();
  await capture(() => run(['spec', '--dir', root]));
  const first = (await listAsks(root, 'vibekit')).filter(isOpen).length;

  await capture(() => run(['spec', '--dir', root]));
  assert.equal((await listAsks(root, 'vibekit')).filter(isOpen).length, first, 'the difference between an inbox and a nag');
});

test('every gap names where its answer lands, and it is never only the document', () => {
  for (const gap of GAPS) {
    assert.ok(gap.plain && gap.ask && gap.lands, `${gap.placeholder} is incomplete`);
    assert.doesNotMatch(gap.lands, /^docs\//, 'an answer that lands in the document is lost at the next generation');
  }
});

test('the unfilled list is read from the document the generator already annotates', () => {
  const document = '# x\n\n<!-- vibekit · nothing to fill: table.quality, table.glossary, diagram.sequence.* -->\n';
  assert.deepEqual(unfilled(document), ['table.quality', 'table.glossary', 'diagram.sequence.*']);
  assert.deepEqual(unfilled('# nothing annotated'), []);

  assert.deepEqual(gapsFor([document]).map((gap) => gap.placeholder), ['table.quality', 'table.glossary']);
  assert.deepEqual(unaskedGaps([document]), ['diagram.sequence.*'], 'what is empty and not worth a question is still shown');
});

test('a question already waiting on somebody is not asked again', () => {
  const document = '<!-- vibekit · nothing to fill: table.quality -->';
  const existing = [{ ask: GAPS.find((gap) => gap.placeholder === 'table.quality').ask }];
  assert.deepEqual(gapsFor([document], { existing }), []);
});

// ---------------------------------------------------------------- reproducing and comparing

test('both documents can be reproduced from a tag, byte for byte', async () => {
  const { gitInit, sh } = await import('./helpers.js');
  const root = await project();
  gitInit(root);
  sh(root, 'git', 'tag', 'v1.0.0');

  await capture(() => run(['spec', 'srs', '--dir', root]));
  const asShipped = await readFile(join(root, 'docs/srs.md'), 'utf8');

  await writeFile(join(root, 'vibekit/workflow/architecture.md'), '# Architecture\n\n## Dependencies\n\n- Stripe · card payments\n');
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'feat: payments');

  await capture(() => run(['spec', 'srs', '--dir', root, '--at', 'v1.0.0']));
  assert.equal(await readFile(join(root, 'docs/srs@v1.0.0.md'), 'utf8'), asShipped);
});

test('the change log between two points is what a client or an auditor asks for', async () => {
  const { gitInit, sh } = await import('./helpers.js');
  const root = await project();
  gitInit(root);
  sh(root, 'git', 'tag', 'v1.0.0');

  const architecture = join(root, 'vibekit/workflow/architecture.md');
  const before = await readFile(architecture, 'utf8');
  await writeFile(architecture, before.replace(/^## Dependencies$/m, '## Dependencies\n\n- Stripe · card payments'));
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'feat: payments');
  sh(root, 'git', 'tag', 'v1.1.0');

  const output = await capture(() => run(['spec', '--diff', 'v1.0.0', 'v1.1.0', '--dir', root]));
  assert.match(output, /now calls \*\*Stripe\*\*/);
});

test('--diff with nothing to compare against says so rather than guessing', async () => {
  const root = await project();
  await assert.rejects(() => run(['spec', '--diff', '--dir', root]), /Usage: vibekit spec --diff/);
});
