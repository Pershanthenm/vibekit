import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { BRS_QUESTIONS, brsBody, brsGaps, parseAnswers, splitAnswer } from '../src/brs.js';
import { extractStatements, splitSections } from '../src/sources.js';
import { isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * `vibekit new spec`: eight answers in a person's words become a document the parser reads as
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
  what: 'Store staff count stock on their phones and supervisors approve the differences',
  does: 'count a shelf and save it; supervisor: approve or reject a difference; admin: add a location',
  never: 'a difference gets posted without approval; show another store\'s numbers',
  limits: 'saving a count should feel instant on store wifi; 500 people counting at once on stock-take day; sends the final counts to the ERP every night; staff names (personal), kept 7 years',
  first: 'first: counting and approvals; later: purchasing',
};

test('the document has five numbered sections and every line is a sentence the parser reads as an obligation', () => {
  const body = brsBody('Stock Take', ANSWERS, { date: '2026-09-25' });
  const { sections } = splitSections(body);
  assert.deepEqual(sections.map((section) => section.number), ['1', '2', '3', '4', '5']);
  const statements = extractStatements(sections);
  const inSection = (n) => statements.filter((statement) => statement.section === n).map((statement) => statement.text);
  assert.deepEqual(inSection('2'), [
    'The system shall let people count a shelf and save it.',
    'The system shall let a supervisor approve or reject a difference.',
    'The system shall let an admin add a location.',
  ]);
  assert.deepEqual(inSection('3'), ['The system must not allow this to happen: a difference gets posted without approval.', 'The system must not show another store\'s numbers.']);
  assert.ok(statements.filter((statement) => statement.section === '3').every((statement) => statement.negative), 'prohibitions read as negative obligations');
  assert.deepEqual(inSection('4'), [
    'Saving a count must feel instant on store wifi.',
    'The system must handle 500 people counting at once on stock-take day.',
    'The system will send the final counts to the ERP every night.',
    'The system will hold staff names (personal), kept 7 years.',
  ]);
  assert.deepEqual(inSection('5'), ['The first version will include counting and approvals.', 'The first version will not include purchasing.']);
  assert.equal(brsGaps(body).gaps.length, 0, `nothing thin: ${brsGaps(body).gaps.join(' · ')}`);
});

test('a skipped answer leaves the section marked undecided, and the gaps name it', () => {
  const body = brsBody('Stock Take', { what: 'Staff count stock.' });
  const report = brsGaps(body);
  assert.ok(report.gaps.some((gap) => /§2 What people can do is still empty/.test(gap)));
  assert.ok(report.gaps.some((gap) => /§4 Limits and connections is still empty/.test(gap)));
  assert.ok(report.gaps.some((gap) => /measurable target/.test(gap)), 'the analyst\'s own checklist applies too');
});

test('answers come from flags or a file; unknown keys are refused; lists split on newlines, semicolons or commas', () => {
  assert.deepEqual(parseAnswers(['does=count; approve', 'what=Count stock.']), { does: 'count; approve', what: 'Count stock.' });
  assert.throws(() => parseAnswers(['colour=blue']), /not a BRS question/);
  assert.throws(() => parseAnswers(['nonsense']), /key=value/);
  assert.deepEqual(splitAnswer(BRS_QUESTIONS.find((question) => question.key === 'does'), 'a: b, c\nd: e;f'), ['a: b, c', 'd: e', 'f']);
  assert.deepEqual(splitAnswer(BRS_QUESTIONS.find((question) => question.key === 'what'), 'one; two'), ['one; two']);
});

test('vibekit new spec writes docs/spec.md, ingests it as BRS-001 and becomes the source the analyst reads', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = tempDir('vibekit-brs-');
    await capture(() => run(['new', 'project', 'Stock Take', '--yes', '--describe', 'Staff count stock on a phone.', '--platform', 'web', '--dir', root]));
    const flags = Object.entries(ANSWERS).filter(([key]) => key !== 'what').flatMap(([key, value]) => ['--answer', `${key}=${value}`]);
    const out = await capture(() => run(['new', 'spec', ...flags, '--dir', root]));
    assert.match(out, /docs\/spec\.md · 5 sections · \d+ requirement statement\(s\) · ingested as BRS-001/);
    const doc = await readFile(join(root, 'docs/spec.md'), 'utf8');
    assert.match(doc, /^## 1\. What it is\n\nStaff count stock on a phone\./m, 'the project description answers the first question when none was given');
    assert.match(await readFile(join(root, 'vibekit/product/sources/index.md'), 'utf8'), /BRS-001/);
    assert.ok((await readFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), 'utf8')).includes('The system shall let a supervisor approve or reject a difference.'));

    // A file of answers works the same, and the JSON form reports the gaps.
    const answers = join(root, 'answers.json');
    await writeFile(answers, JSON.stringify({ does: 'count a shelf' }));
    const result = JSON.parse(await capture(() => run(['new', 'spec', '--from', 'answers.json', '--no-ingest', '--json', '--dir', root])));
    assert.equal(result.source, null);
    assert.ok(result.gaps.some((gap) => /§3 What must never happen is still empty/.test(gap)));
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

test('each question comes with suggestions to pick from, half of them from the description', async () => {
  const { suggestionsFor } = await import('../src/brs.js');
  const does = suggestionsFor('does', { description: 'Staff count stock on a phone; supervisors review variances before they are posted' });
  assert.equal(does[0], 'staff count stock on a phone');
  assert.equal(does[1], 'supervisors review variances before they are posted');
  assert.ok(does.includes('approve or reject something before it counts'));
  assert.ok(suggestionsFor('never', {}).length >= 4);
  assert.deepEqual(suggestionsFor('first', { does: ['count a shelf', 'approve a difference'] }), ['first: count a shelf', 'first: approve a difference']);
  assert.deepEqual(suggestionsFor('what', {}), []);

  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = tempDir('vibekit-brs-');
    await capture(() => run(['new', 'project', 'Stock Take', '--yes', '--describe', 'Staff count stock on a phone; supervisors review variances.', '--platform', 'web', '--dir', root]));
    const suggested = JSON.parse(await capture(() => run(['new', 'spec', '--suggest', '--json', '--dir', root])));
    assert.deepEqual(Object.keys(suggested), ['what', 'does', 'never', 'limits', 'first']);
    assert.equal(suggested.does.suggestions[0], 'staff count stock on a phone');
    assert.ok(suggested.limits.suggestions.some((item) => /single sign-on/.test(item)));
    assert.ok(!(await import('node:fs')).existsSync(join(root, 'docs/spec.md')), '--suggest writes nothing');
  } finally {
    restoreEnv(original);
  }
});
