import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { isOpen, listAsks } from '../src/folder/asks.js';
import { generateFolder } from '../src/folder/generate.js';
import { listRequirements } from '../src/folder/requirements.js';
import {
  LOAD_BEARING_LIMIT, SIZE_PASSES, assumptionReport, buildReport, budgetReportFor,
  costForecast, multipliers, renderReport, securityReport,
} from '../src/reports.js';
import {
  abstractOf, allSections, detect, extractStatements, extractTerms, mappingPath,
  nextSourceId, readIndex, redact, splitSections, writeSource,
} from '../src/sources.js';
import { chainFor, renderChain, requirementsNaming, traceMatrix } from '../src/why.js';
import { gitInit, sh } from './helpers.js';

/**
 * Sources, provenance and reporting. Specification §31, §36, §38, §40, §48 and §50.
 *
 * The thread running through all of them: a number or a claim that cannot be traced to a file is
 * not written. These tests are mostly about what happens when the chain is broken, because a
 * traceability tool that hides its own gaps is worse than none.
 */

const CONFIG = {
  name: 'bookings', description: 'A booking system for gyms.', architecture: 'clean',
  stack: { language: '.NET 10' }, commands: { test: 'dotnet test' },
  entities: [
    { name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] },
    { name: 'Member', class: 'personal', fields: [{ name: 'email', type: 'string', class: 'personal' }] },
  ],
};

const BRS = `# Bookings v2

1 Scope
This document covers gym class bookings for members and staff.

4.2 Cancellation
A member shall be able to cancel a confirmed booking. Contact: John Smith on +27 11 555 1234.
The system must issue a refund within 24 hours of cancellation.
Cancellation shall not be permitted within two hours of the class.

4.3 Refunds
The system will refund through the original payment provider. Queries to ops@gym.example.com.
A refund must never exceed the amount paid, which is capped at R 2500.00.
`;

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-sources-'));
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'vibekit-home-'));
  await generateFolder(root, CONFIG);

  // The folder is regenerated from specs/project.json on `req new`, so a fixture that writes the
  // folder without it loses its entity vocabulary the first time a requirement is added. That is
  // how the real tool works; a test that skipped it would be testing a state no project is in.
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'specs'), { recursive: true });
  await writeFile(join(root, 'specs/project.json'), JSON.stringify({
    project: { name: CONFIG.name, description: CONFIG.description },
    architecture: { style: CONFIG.architecture },
    stack: CONFIG.stack,
    commands: CONFIG.commands,
    entities: CONFIG.entities,
  }, null, 2));

  await writeFile(join(root, 'brs.md'), BRS);
  return root;
}

/**
 * Run a command and collect what it printed.
 *
 * `trace`, `assumptions` and `why` set `process.exitCode` when they find a broken link — that is
 * the point of them — and node:test reads that as the whole file failing. The runner's value is
 * put back, the same way `exitCodeOf` in the helpers does it.
 */
const capture = async (work) => {
  const lines = [];
  const original = console.log;
  const runnerState = process.exitCode;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await work();
  } finally {
    console.log = original;
    process.exitCode = runnerState;
  }
  return lines.join('\n');
};

// ---------------------------------------------------------------- sources (§31)

test('a document is split on its own numbering, so a citation means something to the business', () => {
  const { sections } = splitSections(BRS);
  assert.deepEqual(sections.map((section) => section.number), ['1', '4.2', '4.3']);
  assert.equal(sections[1].title, 'Cancellation');
  assert.equal(sections[1].slug, '4.2-cancellation');
  assert.match(sections[2].body, /original payment provider/);
});

test('a sentence that merely starts with a figure is not a heading', () => {
  const { sections } = splitSections('2024 was the year the club opened its second branch and everything changed.\n\n3 Scope\nThis is the scope.\n');
  assert.deepEqual(sections.map((section) => section.number), ['3']);
});

test('only explicit shall, must and will statements are extracted', () => {
  const { sections } = splitSections(BRS);
  const statements = extractStatements(sections);

  assert.equal(statements.length, 5);
  assert.ok(statements.every((statement) => /shall|must|will/i.test(statement.text)));
  assert.ok(statements.some((statement) => statement.negative), 'a prohibition is not an obligation');
  assert.deepEqual([...new Set(statements.map((statement) => statement.cite))], ['§4.2', '§4.3']);

  // Prose is left for the human: inferring requirements fills the folder with things nobody asked for.
  assert.equal(extractStatements(splitSections('1 Scope\nWe would quite like refunds to be fast.\n').sections).length, 0);
});

test('names, emails, phone numbers and amounts are found before anything is written', () => {
  const found = detect(BRS);
  const kinds = found.map((hit) => hit.kind);

  assert.ok(kinds.includes('EMAIL'));
  assert.ok(kinds.includes('PHONE'), 'an international number has no leading zero');
  assert.ok(kinds.includes('AMOUNT'));
  assert.ok(kinds.includes('PERSON'));
  assert.ok(found.every((hit) => /^\[[A-Z]+-\d+\]$/.test(hit.placeholder)));
});

test('a number at the end of a sentence is still a phone number', () => {
  assert.ok(detect('Call the office on (011) 555 9999.').some((hit) => hit.kind === 'PHONE'));
  assert.equal(detect('Released version 1.2.3 last week.').length, 0, 'a version is not a phone number');
  assert.deepEqual(detect('The fee is R 250.00.').map((hit) => hit.kind), ['AMOUNT']);
});

test('the same value gets the same placeholder everywhere in the document', () => {
  const text = 'Email ops@gym.example.com about it. Later, email ops@gym.example.com again.';
  const found = detect(text);
  assert.equal(found.length, 1);
  assert.equal(redact(text, found).match(/\[EMAIL-1\]/g).length, 2, 'two mentions of one address must stay one person');
});

test('ingest writes nothing until the redaction has been seen', async () => {
  const root = await project();
  const output = await capture(() => run(['ingest', 'brs.md', '--dir', root]));

  assert.match(output, /should not be in git forever/);
  assert.match(output, /Nothing has been written/);
  assert.equal(await readFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), 'utf8').catch(() => null), null);
});

test('once confirmed, the folder carries the redacted text and the mapping lives outside it', async () => {
  const root = await project();
  await capture(() => run(['ingest', 'brs.md', '--yes', '--dir', root]));

  const source = await readFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), 'utf8');
  assert.match(source, /\[PERSON-1\]|\[PERSON-2\]/);
  assert.doesNotMatch(source, /John Smith/);
  assert.doesNotMatch(source, /ops@gym\.example\.com/);

  // §31 — the mapping is an app asset, never in the folder. A copy in the repo would undo the
  // redaction entirely while looking like diligence.
  const mapping = JSON.parse(await readFile(mappingPath('BRS-001'), 'utf8'));
  assert.ok(mapping.found.some((hit) => hit.value === 'John Smith'));
  assert.ok(!mappingPath('BRS-001').includes(root));
});

test('the ingested source is a folder of citable sections, an abstract and an extract', async () => {
  const root = await project();
  await capture(() => run(['ingest', 'brs.md', '--yes', '--dir', root]));
  const dir = join(root, 'vibekit/product/sources/BRS-001');

  assert.match(await readFile(join(dir, 'sections/4.2-cancellation.md'), 'utf8'), /# §4\.2 Cancellation/);
  assert.match(await readFile(join(dir, 'extract.md'), 'utf8'), /\| §4\.2 \| A member shall be able to cancel/);
  assert.match(await readFile(join(dir, 'extract.md'), 'utf8'), /prohibition/);
  assert.match(await readFile(join(dir, '.abstract'), 'utf8'), /3 section\(s\)/);

  const [indexed] = await readIndex(root);
  assert.equal(indexed.id, 'BRS-001');
  assert.equal(indexed.sections, 3);
  assert.equal(indexed.redacted, true);
});

test('an unredacted ingest is recorded as such, not quietly accepted', async () => {
  const root = await project();
  await capture(() => run(['ingest', 'brs.md', '--no-redact', '--dir', root]));

  const [indexed] = await readIndex(root);
  assert.equal(indexed.redacted, false);
  assert.match(await readFile(join(root, 'vibekit/product/sources/index.md'), 'utf8'), /went in unredacted/);
  assert.match(await readFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), 'utf8'), /John Smith/);
});

test('re-ingesting the same id raises an ask only for the sections that changed', async () => {
  const root = await project();
  await capture(() => run(['ingest', 'brs.md', '--yes', '--dir', root]));
  const before = (await listAsks(root, 'vibekit')).length;

  await writeFile(join(root, 'brs.md'), BRS.replace('within 24 hours', 'within 48 hours'));
  await capture(() => run(['ingest', 'brs.md', '--yes', '--id', 'BRS-001', '--dir', root]));

  const asks = await listAsks(root, 'vibekit');
  assert.equal(asks.length, before + 1, 'one section moved, so one question');
  assert.match(asks[asks.length - 1].ask, /§4\.2 changed/);
});

test('ids advance, and a description is a different kind of source from a BRS', () => {
  assert.equal(nextSourceId([], 'BRS'), 'BRS-001');
  assert.equal(nextSourceId([{ id: 'BRS-001' }, { id: 'BRS-002' }], 'BRS'), 'BRS-003');
  assert.equal(nextSourceId([{ id: 'BRS-009' }], 'DESC'), 'DESC-001');
});

test('the abstract stays small, because it loads on every task that cites the source', () => {
  const { preamble, sections } = splitSections(BRS);
  const abstract = abstractOf('Bookings v2', preamble, sections, extractStatements(sections));
  assert.ok(abstract.length < 700, `the abstract is ${abstract.length} characters`);
});

test('repeated capitalised phrases are offered as glossary terms, and common words are not', () => {
  const terms = extractTerms('Booking Window matters. The Booking Window is fixed. Every Booking Window closes.');
  assert.ok(terms.some((term) => term.term === 'Booking Window'));
  assert.ok(!terms.some((term) => /^The\b/.test(term.term)));
});

// ---------------------------------------------------------------- provenance (§36)

async function traced(root) {
  await capture(() => run(['ingest', 'brs.md', '--yes', '--dir', root]));
  await run(['req', 'new', 'members can cancel a booking', '--dir', root]);

  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8'))
    .replace(/^size:.*$/m, 'size: M')
    .replace(/^status:.*$/m, 'status: done')
    .replace(/^source:.*$/m, 'source: BRS-001 §4.2')
    .replace(/^assumes:.*$/m, 'assumes: [A-001]')
    .replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1 When a member cancels a confirmed booking, the system shall issue a refund.\n')
    .replace(/## Approach\n[\s\S]*?(?=\n## )/, '## Approach\n\n- src/CancelBooking.cs — the handler\n')
    .replace(/## Verification\n[\s\S]*?(?=\n## )/, '## Verification\n\n- AC-1 — tests/CancelBooking_AC1.cs\n'));

  await writeFile(join(root, 'vibekit/workflow/assumptions.md'), '# Assumptions\n\n- A-001 Refunds go back to the original card · confidence: low\n');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/CancelBooking.cs'), 'class CancelBooking {}\n');
  return root;
}

test('the chain runs from a line of code to the assumption underneath it', async () => {
  const root = await traced(await project());
  gitInit(root);
  sh(root, 'git', 'commit', '-q', '--allow-empty', '-m', 'feat: cancel\n\nVibeKit-Requirement: REQ-001');

  const chain = await chainFor(root, 'src/CancelBooking.cs');
  const kinds = chain.links.map((link) => link.kind);

  assert.deepEqual(kinds, ['file', 'requirement', 'criterion', 'source', 'assumption']);
  assert.match(renderChain(chain), /BRS-001 §4\.2 Cancellation/);
  assert.match(renderChain(chain), /"A member shall be able to cancel a confirmed booking\."/);
  // §36's whole point: the developer sees the unconfirmed assumption before building on it.
  assert.match(renderChain(chain), /rests on a low-confidence assumption/);
});

test('code that traces to nothing says so, which is the most useful answer it has', async () => {
  const root = await project();
  gitInit(root);
  await writeFile(join(root, 'stray.cs'), 'class Stray {}\n');

  const chain = await chainFor(root, 'stray.cs');
  assert.equal(chain.requirement, null);
  assert.match(renderChain(chain), /Nothing traces this to something the business asked for/);
});

test('a requirement is found from its Approach before anything is committed', async () => {
  const root = await traced(await project());
  const requirements = await listRequirements(root);
  assert.deepEqual(requirementsNaming(requirements, 'src/CancelBooking.cs').map((entry) => entry.id), ['REQ-001']);
});

test('a citation that points at no section is reported rather than rendered as a link', async () => {
  const root = await traced(await project());
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace('source: BRS-001 §4.2', 'source: BRS-001 §9.9'));

  const chain = await chainFor(root, 'src/CancelBooking.cs');
  assert.match(renderChain(chain), /BRS-001 §9\.9 is cited but there is no such section/);
});

// ---------------------------------------------------------------- the matrix (§50)

test('the matrix runs source to requirement to criterion to test to commit', async () => {
  const root = await traced(await project());
  gitInit(root);

  const matrix = await traceMatrix(root, {});
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0].source, 'BRS-001 §4.2');
  assert.equal(matrix.rows[0].criterion, 'AC-1');
  assert.match(matrix.rows[0].test, /CancelBooking_AC1/);
  assert.ok(matrix.rows[0].commit, 'a requirement that was never committed cannot be evidence');
  assert.equal(matrix.complete, true);
});

test('a broken link is shown as broken, because a matrix that omits them always looks full', async () => {
  const root = await traced(await project());
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/## Verification\n[\s\S]*?(?=\n## )/, '## Verification\n\n'));
  gitInit(root);

  const matrix = await traceMatrix(root, {});
  assert.equal(matrix.complete, false);
  assert.equal(matrix.broken.length, 1);
  assert.equal(matrix.rows[0].test, null);

  const output = await capture(() => run(['trace', '--matrix', '--dir', root]));
  assert.match(output, /\*\*not proved\*\*/);
  assert.match(output, /AC-1 has no test/);
});

test('only done requirements are in the matrix unless every one is asked for', async () => {
  const root = await traced(await project());
  await run(['req', 'new', 'staff can export bookings', '--dir', root]);

  assert.equal((await traceMatrix(root, {})).rows.length, 1);
  assert.ok((await traceMatrix(root, { all: true })).rows.length > 1);
});

// ---------------------------------------------------------------- assumptions (§38)

test('each assumption carries how many requirements stand on it, sorted', async () => {
  const root = await traced(await project());
  const report = await assumptionReport(root, 'vibekit');

  assert.equal(report.rows[0].id, 'A-001');
  assert.equal(report.rows[0].count, 1);
  assert.equal(report.rows[0].confidence, 'low');
  assert.doesNotMatch(report.rows[0].text, /confidence/, 'the confidence column would otherwise say it twice');
  assert.equal(report.rows[0].blocksPlan, false);
});

test('a low-confidence assumption too many requirements stand on blocks the plan gate', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/workflow/assumptions.md'), '# Assumptions\n\n- A-003 single currency · confidence: low\n');
  for (let index = 0; index < LOAD_BEARING_LIMIT + 1; index += 1) {
    await run(['req', 'new', `thing ${index}`, '--dir', root]);
    const path = join(root, `vibekit/product/requirements/REQ-00${index + 1}.md`);
    await writeFile(path, (await readFile(path, 'utf8')).replace(/^assumes:.*$/m, 'assumes: [A-003]'));
  }

  const report = await assumptionReport(root, 'vibekit');
  assert.equal(report.rows[0].count, LOAD_BEARING_LIMIT + 1);
  assert.equal(report.rows[0].blocksPlan, true, '"we assumed and found out in month three" becomes a line at planning time');
  assert.equal(report.blocking.length, 1);
});

test('a requirement assuming something nobody wrote down is reported too', async () => {
  const root = await project();
  await run(['req', 'new', 'thing', '--dir', root]);
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^assumes:.*$/m, 'assumes: [A-999]'));

  assert.deepEqual((await assumptionReport(root, 'vibekit')).undeclared, ['A-999']);
});

// ---------------------------------------------------------------- cost before build (§40)

test('the forecast is per requirement and per phase, from the size and the loading budget', async () => {
  const root = await traced(await project());
  const forecast = await costForecast(root, 'vibekit');

  assert.ok(forecast.rows.length);
  assert.equal(forecast.rows[0].passes, SIZE_PASSES.M);
  assert.ok(forecast.rows[0].estimate > forecast.always, 'a pass costs at least the always-loaded set');
  assert.equal(forecast.total, forecast.rows.reduce((sum, row) => sum + row.estimate, 0));
});

test('the multiplier is learned from this repo, and says so when there is nothing to learn from', () => {
  assert.equal(multipliers([]).measured, false);

  const learned = multipliers([
    { role: 'implementer', input: 10_000, output: 2000 },
    { role: 'reviewer', input: 2000, output: 500 },
  ]);
  assert.equal(learned.measured, true);
  assert.ok(learned.byRole.implementer > learned.byRole.reviewer, 'implementers read more than reviewers here');
});

test('plan --cost says a forecast with no measurement is a floor, not a prediction', async () => {
  const root = await traced(await project());
  const output = await capture(() => run(['plan', '--cost', '--dir', root]));
  assert.match(output, /Per phase/);
  assert.match(output, /a floor, not a prediction/);
  assert.match(output, /No cap is set in profile\.md/);
});

// ---------------------------------------------------------------- the three reports (§48)

test('every section of every report names the file it came from', async () => {
  const root = await traced(await project());
  for (const build of [buildReport, budgetReportFor, securityReport]) {
    const made = await build(root, 'vibekit');
    assert.ok(made.sections.length);
    for (const part of made.sections) {
      assert.ok(part.from, `${made.kind}/${part.title} cites no file`);
      assert.ok(part.rows.length, `${made.kind}/${part.title} is empty`);
    }
    assert.match(renderReport(made), /Nothing is fixed from a report/);
  }
});

test('the build report counts what is done, blocked and untested', async () => {
  const root = await traced(await project());
  const text = renderReport(await buildReport(root, 'vibekit'));

  assert.match(text, /\*\*done\*\* — 1 of 1/);
  assert.match(text, /criteria with no test\*\* — 0 \(should be zero\)/);
});

test('the security report maps classified data to the requirements that touch it', async () => {
  const root = await traced(await project());
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^entities:.*$/m, 'entities: [Member]'));

  const text = renderReport(await securityReport(root, 'vibekit'));
  assert.match(text, /Member \(personal\)\*\* — touched by REQ-001/);
});

test('an unredacted source shows up in the security report', async () => {
  const root = await project();
  await capture(() => run(['ingest', 'brs.md', '--no-redact', '--dir', root]));
  assert.match(renderReport(await securityReport(root, 'vibekit')), /BRS-001\*\* — ingested without redaction/);
});

test('the budget report is honest that nothing has been spent yet', async () => {
  const root = await traced(await project());
  const text = renderReport(await budgetReportFor(root, 'vibekit'));

  assert.match(text, /\*\*recorded\*\* — nothing yet/);
  assert.match(text, /a guess with a decimal point/);
});

test('report --all writes all three, and an unknown kind is refused', async () => {
  const root = await traced(await project());
  const out = join(root, 'reports.md');
  await capture(() => run(['report', '--all', '--out', out, '--dir', root]));

  const text = await readFile(out, 'utf8');
  assert.equal((text.match(/^# \w+ report$/gm) ?? []).length, 3);
  await assert.rejects(() => run(['report', 'nonsense', '--dir', root]), /Usage: vibekit report/);
});

// ---------------------------------------------------------------- the top-level verbs

test('the spec\'s verbs are the same call as their req subcommand, not a second implementation', async () => {
  const root = await project();
  await capture(() => run(['add', 'staff can export bookings', '--dir', root]));

  const [requirement] = await listRequirements(root);
  assert.equal(requirement.title, 'staff can export bookings');
});

test('quick adds a small change and says the criteria are still required', async () => {
  const root = await project();
  const output = await capture(() => run(['quick', 'fix the timezone on the list', '--dir', root]));

  const [requirement] = await listRequirements(root);
  assert.equal(requirement.size, 'S');
  assert.match(output, /skips the ceremony, not the criteria/);
});
