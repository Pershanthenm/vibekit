import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { BRS_QUESTIONS, brsBody, brsGaps, parseAnswers, splitAnswer } from '../src/brs.js';
import { extractStatements, splitSections } from '../src/sources.js';
import { isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * `vibekit new brs`: eight answers in a person's words become a document the parser reads as
 * numbered sections and obligations, ingested as BRS-001, with what is still thin named.
 */

async function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
}

const ANSWERS = {
  purpose: 'Staff count stock on a phone; supervisors review the variances',
  users: 'staff, supervisor, admin',
  capabilities: 'staff: count a bin and save the quantity; supervisor: review and approve a variance; admin: add a location',
  rules: 'post a variance nobody approved; never show another store\'s counts',
  targets: 'a count saves within 2 seconds on store wifi; 500 counters at once on stock-take day',
  data: 'staff names and ids (personal); stock values in ZAR (financial), kept 7 years',
  integrations: 'the ERP stock ledger (nightly file)',
  scope: 'in: counting, variance review; out: purchasing',
};

test('the document has eight numbered sections and every requirement is an obligation the parser extracts', () => {
  const body = brsBody('Stock Take', ANSWERS, { date: '2026-09-25' });
  const { sections } = splitSections(body);
  assert.deepEqual(sections.map((section) => section.number), ['1', '2', '3', '4', '5', '6', '7', '8']);
  const statements = extractStatements(sections);
  const inSection = (n) => statements.filter((statement) => statement.section === n).map((statement) => statement.text);
  assert.deepEqual(inSection('3'), [
    'The system shall let a staff count a bin and save the quantity.',
    'The system shall let a supervisor review and approve a variance.',
    'The system shall let an admin add a location.',
  ]);
  assert.deepEqual(inSection('4'), ['The system must not post a variance nobody approved.', 'The system must not show another store\'s counts.']);
  assert.ok(statements.filter((statement) => statement.section === '4').every((statement) => statement.negative), 'prohibitions read as negative obligations');
  assert.match(inSection('8').join(' '), /will include counting, variance review\. The first release will not include purchasing\./);
  assert.equal(brsGaps(body).gaps.length, 0, `nothing thin: ${brsGaps(body).gaps.join(' · ')}`);
});

test('a skipped answer leaves the section marked undecided, and the gaps name it', () => {
  const body = brsBody('Stock Take', { purpose: 'Count stock.', users: 'staff' });
  const report = brsGaps(body);
  assert.ok(report.gaps.some((gap) => /§3 Functional requirements is still empty/.test(gap)));
  assert.ok(report.gaps.some((gap) => /§5 Measurable targets is still empty/.test(gap)));
  assert.ok(report.gaps.some((gap) => /measurable target/.test(gap)), 'the analyst\'s own checklist applies too');
});

test('answers come from flags or a file; unknown keys are refused; lists split on newlines, semicolons or commas', () => {
  assert.deepEqual(parseAnswers(['users=staff, admin', 'purpose=Count stock.']), { users: 'staff, admin', purpose: 'Count stock.' });
  assert.throws(() => parseAnswers(['colour=blue']), /not a BRS question/);
  assert.throws(() => parseAnswers(['nonsense']), /key=value/);
  assert.deepEqual(splitAnswer(BRS_QUESTIONS.find((question) => question.key === 'users'), 'staff, supervisor;admin'), ['staff', 'supervisor', 'admin']);
  assert.deepEqual(splitAnswer(BRS_QUESTIONS.find((question) => question.key === 'capabilities'), 'a: b, c\nd: e'), ['a: b, c', 'd: e']);
});

test('vibekit new brs writes docs/brs.md, ingests it as BRS-001 and becomes the source the analyst reads', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = tempDir('vibekit-brs-');
    await capture(() => run(['new', 'project', 'Stock Take', '--yes', '--describe', 'Staff count stock on a phone.', '--platform', 'web', '--dir', root]));
    const flags = Object.entries(ANSWERS).filter(([key]) => key !== 'purpose').flatMap(([key, value]) => ['--answer', `${key}=${value}`]);
    const out = await capture(() => run(['new', 'brs', ...flags, '--dir', root]));
    assert.match(out, /docs\/brs\.md · 8 sections · \d+ requirement statement\(s\) · ingested as BRS-001/);
    const doc = await readFile(join(root, 'docs/brs.md'), 'utf8');
    assert.match(doc, /^## 1\. Purpose\n\nStaff count stock on a phone\./m, 'the project description is the purpose when none was answered');
    assert.match(await readFile(join(root, 'vibekit/product/sources/index.md'), 'utf8'), /BRS-001/);
    assert.ok((await readFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), 'utf8')).includes('The system shall let a supervisor review and approve a variance.'));

    // A file of answers works the same, and the JSON form reports the gaps.
    const answers = join(root, 'answers.json');
    await writeFile(answers, JSON.stringify({ users: 'staff', capabilities: 'staff: count' }));
    const result = JSON.parse(await capture(() => run(['new', 'brs', '--from', 'answers.json', '--no-ingest', '--json', '--dir', root])));
    assert.equal(result.source, null);
    assert.ok(result.gaps.some((gap) => /§4 Rules and prohibitions is still empty/.test(gap)));
  } finally {
    restoreEnv(original);
  }
});

test('new project --answer builds the document instead of a one-line description', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = tempDir('vibekit-brs-');
    const flags = Object.entries(ANSWERS).flatMap(([key, value]) => ['--answer', `${key}=${value}`]);
    const out = await capture(() => run(['new', 'project', 'Stock Take', '--yes', '--platform', 'web', ...flags, '--dir', root]));
    assert.match(out, /ingested as BRS-001/);
    assert.match(await readFile(join(root, 'vibekit/product/sources/index.md'), 'utf8'), /BRS-001/);
    assert.doesNotMatch(await readFile(join(root, 'vibekit/product/sources/index.md'), 'utf8'), /DESC-001/);
  } finally {
    restoreEnv(original);
  }
});
