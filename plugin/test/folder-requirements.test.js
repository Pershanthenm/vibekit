import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answerAsk, blastRadius, listAsks, openAsk, rejectAsk, wordCount } from '../src/folder/asks.js';
import { runChecks, findCycle } from '../src/folder/checks.js';
import { parseCriterion } from '../src/folder/ears.js';
import { generateFolder } from '../src/folder/generate.js';
import { appendLog, claim, listRequirements, readTasksState, readyBlockers, refuseStatus, release, setStatus, writeSection } from '../src/folder/requirements.js';
import { approvalOf, nextAction } from '../src/folder/workflow.js';
import { newProject } from './helpers.js';

const CONFIG = {
  name: 'bookings',
  description: 'A booking system for gyms.',
  architecture: 'clean',
  stack: { language: '.NET 10', database: 'PostgreSQL 17' },
  commands: { build: 'dotnet build', test: 'dotnet test' },
  entities: [{ name: 'Booking', class: 'internal' }, { name: 'Payment', class: 'financial' }],
};

const READY = `---
id: REQ-001
title: Cancel a booking
kind: requirement
size: M
status: ready
entities: [Booking, Payment]
source: BRS-001 §4.2
after: []
assumes: []
---

# Cancel a booking

## Acceptance

- AC-1  When a booking with status \`confirmed\` is cancelled more than 24 h before start, the system shall set its status to \`cancelled\`.
- AC-2  If a booking is cancelled within 24 h of start, then the system shall reject the cancellation with reason \`too-late\`.

## Out of scope

- Partial refunds

## Security

Touches Booking (internal) and Payment (financial). Crosses the member auth boundary.

## Approach

## Verification

## Review

## Log
`;

async function repoWith(requirement = READY) {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-req-'));
  await generateFolder(root, CONFIG);
  if (requirement) await writeFile(join(root, 'vibekit/product/requirements/REQ-001.md'), requirement);
  return root;
}

const read = (root, path) => readFile(join(root, path), 'utf8');

// ---------------------------------------------------------------- EARS (§49)

test('the five EARS patterns parse, and nothing else does', () => {
  const ok = [
    ['- AC-1  The system shall record every cancellation with the acting user.', 'ubiquitous'],
    ['- AC-2  When a booking is cancelled, the system shall issue a refund.', 'event'],
    ['- AC-3  While a refund is pending, the system shall not allow rebooking.', 'state'],
    ['- AC-4  Where refunds are enabled, the system shall show the refund total.', 'optional'],
    ['- AC-5  If the payment provider is unreachable, then the system shall queue the refund.', 'unwanted'],
  ];
  for (const [line, pattern] of ok) {
    const parsed = parseCriterion(line);
    assert.ok(parsed.ok, `${line} did not parse: ${parsed.reason}`);
    assert.equal(parsed.pattern, pattern);
  }

  const bad = [
    '- AC-6  The system should be fast.',
    '- AC-7  Cancelling a booking issues a refund.',
    '- The system shall do a thing.',
  ];
  for (const line of bad) assert.ok(!parseCriterion(line).ok, `${line} should not have parsed`);
});

test('a criterion that parses but promises nothing observable is refused with the question a test would ask', () => {
  const parsed = parseCriterion('- AC-1  The system shall be fast.');
  assert.ok(!parsed.ok);
  assert.equal(parsed.observable, false);
  assert.match(parsed.reason, /What would a test assert/);
});

test('a negated response is still a response', () => {
  const parsed = parseCriterion('- AC-3  While a refund is pending, the system shall not allow the booking to be rebooked.');
  assert.ok(parsed.ok);
  assert.equal(parsed.negated, true);
});

// ---------------------------------------------------------------- definition of ready (§6)

test('a requirement is ready only when nothing about it is still undecided', async () => {
  const root = await repoWith();
  const [requirement] = await listRequirements(root);
  assert.deepEqual(readyBlockers(requirement, { entities: ['Booking', 'Payment'] }), []);
});

test('every part of the definition of ready is enforced, and says what to fix', () => {
  const parse = (text) => ({
    acceptance: [], malformed: [], todoCriteria: 0, size: null, source: null,
    entities: ['Ghost'], assumes: ['A-999'], security: '', ...text,
  });
  const blockers = readyBlockers(parse({}), { entities: ['Booking'], assumptions: ['A-001'] });
  const joined = blockers.join(' | ');
  assert.match(joined, /no acceptance criteria/);
  assert.match(joined, /size is not set/);
  assert.match(joined, /source: cites nothing/);
  assert.match(joined, /"Ghost", which is not in product\/entities\.md/);
  assert.match(joined, /assumes A-999/);
});

test('an M requirement with an empty security note is not ready', () => {
  const blockers = readyBlockers({
    acceptance: [{ id: 'AC-1' }], malformed: [], todoCriteria: 0, size: 'M',
    source: 'BRS-001 §1', entities: [], assumes: [], security: '',
  });
  assert.ok(blockers.some((reason) => /## Security is empty/.test(reason)));
});

// ---------------------------------------------------------------- status (§12)

test('an agent may move a requirement forward but never to done', async () => {
  const root = await repoWith();
  const [requirement] = await listRequirements(root);

  assert.equal(refuseStatus(requirement, 'in-progress', { by: 'agent' }), null);
  assert.match(refuseStatus(requirement, 'done', { by: 'agent' }), /A human closes a requirement/);
  await assert.rejects(setStatus(root, 'REQ-001', 'done', { by: 'agent' }), /A human closes a requirement/);
});

test('tested is refused without captured evidence, because "tests pass" is a claim', async () => {
  const root = await repoWith();
  await setStatus(root, 'REQ-001', 'in-progress', { by: 'agent' });
  await assert.rejects(setStatus(root, 'REQ-001', 'tested', { by: 'agent' }), /no ## Evidence block/);

  await writeSection(root, 'REQ-001', 'Evidence', '- build   exit 0\n- test    exit 0   2 passed, 0 failed   AC-1 ✓ AC-2 ✓');
  const moved = await setStatus(root, 'REQ-001', 'tested', { by: 'agent' });
  assert.equal(moved.to, 'tested');
});

test('done is refused until a reviewer has written a verdict and a mapping', async () => {
  const root = await repoWith();
  await setStatus(root, 'REQ-001', 'in-progress', { by: 'agent' });
  await writeSection(root, 'REQ-001', 'Evidence', '- test exit 0');
  await setStatus(root, 'REQ-001', 'tested', { by: 'agent' });

  await assert.rejects(setStatus(root, 'REQ-001', 'done', { by: 'human' }), /no ## Review/);
  await writeSection(root, 'REQ-001', 'Review', 'approved');
  await assert.rejects(setStatus(root, 'REQ-001', 'done', { by: 'human' }), /no ## Verification/);
  await writeSection(root, 'REQ-001', 'Verification', 'AC-1 → Cancel_Confirmed_AC1\nAC-2 → Cancel_TooLate_AC2');
  assert.equal((await setStatus(root, 'REQ-001', 'done', { by: 'human' })).to, 'done');
});

// ---------------------------------------------------------------- ownership (§27)

test('one requirement, one holder, one branch', async () => {
  const root = await repoWith();
  const holder = await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'claude-code' });
  assert.equal(holder.branch, 'req/REQ-001');
  await assert.rejects(claim(root, { id: 'REQ-001', role: 'implementer', runner: 'cursor' }), /already held by implementer/);
});

test('a held requirement cannot be closed, and closing clears the hold once it is released', async () => {
  const root = await repoWith();
  await setStatus(root, 'REQ-001', 'in-progress', { by: 'agent' });
  await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'claude-code' });
  await writeSection(root, 'REQ-001', 'Evidence', '- test exit 0');
  await writeSection(root, 'REQ-001', 'Review', 'approved');
  await writeSection(root, 'REQ-001', 'Verification', 'AC-1 → t1\nAC-2 → t2');
  await setStatus(root, 'REQ-001', 'tested', { by: 'agent' });

  // Somebody is still working on it. Closing over their head would make the log a fiction.
  await assert.rejects(setStatus(root, 'REQ-001', 'done', { by: 'human' }), /still held by implementer/);

  await release(root, 'REQ-001');
  await setStatus(root, 'REQ-001', 'done', { by: 'human' });
  assert.deepEqual((await readTasksState(root)).held, {}, 'nothing stays attributed to a session that ended');
});

test('a handoff is a line in the requirement, and the next agent reads it there', async () => {
  const root = await repoWith();
  await appendLog(root, 'REQ-001', 'implementer (claude-code) → reviewer: 3 files, tests green');
  const [requirement] = await listRequirements(root);
  assert.equal(requirement.log.length, 1);
  assert.match(requirement.log[0], /implementer \(claude-code\) → reviewer/);
});

// ---------------------------------------------------------------- asks (§12)

test('one inbox holds questions and proposals, and a blocking ask stops the work it is for', async () => {
  const root = await repoWith();
  const { id } = await openAsk(root, {
    kind: 'proposal', about: 'entity', forRequirement: 'REQ-001', blocking: true, by: 'implementer (claude-code)',
    plain: 'We need somewhere to record money paid back. Nothing in the folder describes one yet.',
    ask: 'Add a Refund entity with amount, reason, issuedAt.',
    why: 'REQ-001 needs a refund record and entities.md has none.',
    options: ['New Refund entity (recommended)', 'Add refund fields to Payment'],
  });
  assert.equal(id, 'P-001');

  const [ask] = await listAsks(root);
  assert.equal(ask.kind, 'proposal');
  assert.equal(ask.blocking, true);
  assert.deepEqual(ask.options.length, 2);
  assert.match(ask.plain, /record money paid back/);
});

test('an ask is refused without the plain-terms section people actually read', async () => {
  const root = await repoWith();
  await openAsk(root, { kind: 'question', plain: 'Plain words for the person answering.', ask: 'Who may cancel?', why: 'It decides the policy.', by: 'analyst' });
  const path = join(root, 'vibekit/workflow/asks');
  const [file] = await (await import('node:fs/promises')).readdir(path);
  const text = await read(root, `vibekit/workflow/asks/${file}`);
  await writeFile(join(path, file), text.replace(/## In plain terms[\s\S]*?(?=## Question)/, ''));

  const result = await runChecks(root);
  assert.ok(result.findings.some((entry) => entry.code === 'ask.noPlainTerms'), result.findings.map((entry) => entry.code).join(', '));
});

test('a plain-terms section that has started explaining the implementation again is too long', async () => {
  const root = await repoWith();
  const wordy = Array.from({ length: 70 }, (_, index) => `word${index}`).join(' ');
  await openAsk(root, { kind: 'question', ask: 'Who may cancel?', why: 'Policy.', plain: wordy, by: 'analyst' });
  assert.equal(wordCount(wordy), 70);
  const result = await runChecks(root);
  assert.ok(result.findings.some((entry) => entry.code === 'ask.plainTooLong'));
});

test('answering records the decision in the ask and appends it to the stage answers, append-only', async () => {
  const root = await repoWith();
  await openAsk(root, { kind: 'question', stage: 1, ask: 'Who may cancel?', why: 'Policy.', plain: 'Who is allowed to cancel a booking?', by: 'analyst' });
  const result = await answerAsk(root, 'Q-001', { answer: 'The member who made it, and any staff member.', by: 'J. Naidoo' });
  assert.equal(result.status, 'answered');

  const [ask] = await listAsks(root);
  assert.match(ask.answer, /The member who made it/);
  assert.match(await read(root, 'vibekit/workflow/answers/1-answers.md'), /J. Naidoo/);
});

test('a rejected ask stays in the folder as a record of what was refused and why', async () => {
  const root = await repoWith();
  await openAsk(root, { kind: 'proposal', about: 'package', ask: 'Add AutoMapper.', why: 'Mapping is verbose.', plain: 'Add a library that copies data between shapes.', by: 'implementer' });
  await rejectAsk(root, 'P-001', { reason: 'Hand-written mapping stays; it is the thing reviewers read most.', by: 'tech lead' });
  const [ask] = await listAsks(root);
  assert.equal(ask.status, 'rejected');
  assert.match(ask.answer, /Hand-written mapping stays/);
});

test('blast radius counts the requirements that transitively wait on an ask', async () => {
  const requirements = [
    { id: 'REQ-001', after: [], status: 'ready' },
    { id: 'REQ-002', after: ['REQ-001'], status: 'draft' },
    { id: 'REQ-003', after: ['REQ-002'], status: 'draft' },
    { id: 'REQ-004', after: [], status: 'draft' },
  ];
  assert.equal(blastRadius({ for: 'REQ-001' }, requirements), 3);
  assert.equal(blastRadius({ for: 'REQ-004' }, requirements), 1);
  assert.equal(blastRadius({ for: null }, requirements), 0);
});

// ---------------------------------------------------------------- gates (§24)

test('a gate is a line a human writes, and an unwritten one is not a gate', () => {
  assert.equal(approvalOf('---\napproved:\n---\n'), null);
  assert.equal(approvalOf('---\napproved: TODO\n---\n'), null);
  assert.equal(approvalOf(null), null);
  const passed = approvalOf('---\napproved: 2026-09-23 by J. Naidoo\n---\n');
  assert.equal(passed.by, 'J. Naidoo');
  assert.equal(passed.date, '2026-09-23');
});

test('next names the gate that is waiting, and never passes one', async () => {
  const root = await repoWith();
  const action = await nextAction(root);
  assert.equal(action.kind, 'stage');
  assert.equal(action.stage, 0, 'a folder with no source is at intake');

  // Nothing in the code path can write an approval; the file is untouched.
  assert.match(await read(root, 'vibekit/workflow/architecture.md'), /^approved:\s*$/m);
});

// ---------------------------------------------------------------- the plan is a DAG (§21)

test('a cycle in the plan is found and named', () => {
  assert.equal(findCycle([{ id: 'A', after: ['B'] }, { id: 'B', after: [] }]), null);
  const cycle = findCycle([{ id: 'A', after: ['B'] }, { id: 'B', after: ['C'] }, { id: 'C', after: ['A'] }]);
  assert.ok(cycle, 'a three-way cycle was not detected');
  assert.equal(cycle[0], cycle.at(-1), 'the cycle is reported as a closed loop');
});

// ---------------------------------------------------------------- checks (§32)

test('a requirement naming an entity nobody defined is a failure', async () => {
  const root = await repoWith(READY.replace('entities: [Booking, Payment]', 'entities: [Booking, Refund]'));
  const result = await runChecks(root);
  const found = result.findings.find((entry) => entry.code === 'requirement.unknownEntity');
  assert.ok(found, result.findings.map((entry) => entry.code).join(', '));
  assert.match(found.message, /"Refund"/);
});

test('a criterion that is not EARS fails the check', async () => {
  const root = await repoWith(READY.replace('- AC-2  If a booking', '- AC-2  Cancelling a booking should be quick. If a booking'));
  const result = await runChecks(root);
  assert.ok(result.findings.some((entry) => entry.code === 'criterion.notEars'), result.findings.map((entry) => entry.code).join(', '));
});

test('a generated file a human took over is reported, not silently ignored', async () => {
  const root = await repoWith();
  await writeFile(join(root, 'vibekit/product/map.md'), '# Map\n\nOurs now.\n');
  const result = await runChecks(root);
  assert.ok(result.findings.some((entry) => entry.code === 'header.missing'));
});

test('an ask left waiting past the threshold fails the check', async () => {
  const root = await repoWith();
  await openAsk(root, { kind: 'question', ask: 'Who may cancel?', why: 'Policy.', plain: 'Who can cancel a booking?', by: 'analyst' });
  const dir = join(root, 'vibekit/workflow/asks');
  const [file] = await (await import('node:fs/promises')).readdir(dir);
  const old = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  await writeFile(join(dir, file), (await read(root, `vibekit/workflow/asks/${file}`)).replace(/^asked: .*$/m, `asked: ${old}`));

  const result = await runChecks(root);
  const found = result.findings.find((entry) => entry.code === 'ask.stale');
  assert.ok(found, result.findings.map((entry) => entry.code).join(', '));
  assert.match(found.message, /waited 9 days/);
});

test('in-progress with nobody holding it is not attributable', async () => {
  const root = await repoWith(READY.replace('status: ready', 'status: in-progress'));
  const result = await runChecks(root);
  assert.ok(result.findings.some((entry) => entry.code === 'requirement.unheld'));
});

test('a low-confidence assumption carrying more than three requirements blocks the plan', async () => {
  const root = await repoWith();
  await writeFile(join(root, 'vibekit/workflow/assumptions.md'), '# Assumptions\n\n- A-003  single currency (ZAR) · confidence: low\n');
  const dir = join(root, 'vibekit/product/requirements');
  for (const n of [2, 3, 4, 5]) {
    await writeFile(join(dir, `REQ-00${n}.md`), READY.replace('REQ-001', `REQ-00${n}`).replace('assumes: []', 'assumes: [A-003]'));
  }
  const result = await runChecks(root);
  const found = result.findings.find((entry) => entry.code === 'assumption.loadBearing');
  assert.ok(found, result.findings.map((entry) => entry.code).join(', '));
  assert.match(found.message, /4 requirements stand on it/);
});

// ---------------------------------------------------------------- what the simulation caught

test('`req why` and `req ready` answer the same question the same way', async () => {
  // `why` read a narrower set of blockers than `ready` enforced, so it said a requirement met the
  // definition of ready and `ready` then refused it — from the command whose only job is to say.
  const root = await newProject('--yes');
  const { run } = await import('../src/cli.js');
  await run(['add', 'members can cancel a booking', '--dir', root]);

  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8'))
    .replace(/^size:.*$/m, 'size: S')
    .replace(/^source:.*$/m, 'source: product/context.md')
    .replace(/^entities:.*$/m, 'entities: [Nonexistent]')
    .replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  The system shall cancel a booking.\n'));

  const said = [];
  const original = console.log;
  console.log = (...args) => said.push(args.join(' '));
  let refusal = null;
  try {
    await run(['req', 'why', 'REQ-001', '--dir', root]);
    await run(['req', 'ready', 'REQ-001', '--dir', root]).catch((error) => { refusal = error.message; });
  } finally {
    console.log = original;
  }

  assert.match(said.join('\n'), /is not ready/, 'why must see the entity blocker that ready enforces');
  assert.match(said.join('\n'), /Nonexistent/);
  assert.ok(refusal, 'and ready must still refuse it');
});

test('an assumption nobody declared blocks ready, which a comma expression had disabled', async () => {
  // The options passed to setStatus read `assumptions: (result.findings, null)` — a comma
  // expression that always evaluates to null, so the assumption check never ran at all.
  const root = await newProject('--yes');
  const { run } = await import('../src/cli.js');
  await run(['add', 'a thing', '--dir', root]);

  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8'))
    .replace(/^size:.*$/m, 'size: S')
    .replace(/^source:.*$/m, 'source: product/context.md')
    .replace(/^assumes:.*$/m, 'assumes: [A-999]')
    .replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  The system shall record a thing.\n'));

  await assert.rejects(() => run(['req', 'ready', 'REQ-001', '--dir', root]), /A-999/);
});

test('an entity added by editing entities.md survives the next regeneration', async () => {
  // `req new` regenerates the folder from specs/project.json, and entities.md is generated — so
  // an entity somebody added by editing that file was silently discarded, from the one file an
  // agent is refused for not matching.
  const root = await newProject('--yes');
  const { run } = await import('../src/cli.js');
  const entities = join(root, 'vibekit/product/entities.md');

  await writeFile(entities, [
    '<!-- generated by vibekit · do not edit · source: entities -->',
    '# Entities', '',
    '## Booking',
    'class: internal',
    '- `id` uuid',
    '',
  ].join('\n'));

  await run(['add', 'members can cancel a booking', '--dir', root]);
  assert.match(await readFile(entities, 'utf8'), /## Booking/, 'the vocabulary must not be dropped by a regeneration');
});

// ---------------------------------------------------------------- evidence, not assertion (§22, §55)

test('verify runs the commands in map.md and writes the exit codes into ## Evidence', async () => {
  const { recordEvidence, mapCommands, parseEvidence } = await import('../src/folder/evidence.js');
  const root = await newProject('--yes');
  const { run } = await import('../src/cli.js');
  await run(['add', 'a thing', '--dir', root]);
  const map = join(root, 'vibekit/product/map.md');
  await writeFile(map, (await readFile(map, 'utf8'))
    .replace(/^build\s{2,}.*$/m, `build     "${process.execPath}" -e "process.exit(0)"`)
    .replace(/^test\s{2,}.*$/m, `test      "${process.execPath}" -e "process.exit(0)"`));

  assert.equal((await mapCommands(root)).test, `"${process.execPath}" -e "process.exit(0)"`);
  const result = await recordEvidence(root, 'REQ-001');
  assert.equal(result.green, true);

  const text = await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8');
  assert.match(text, /^## Evidence$/m, 'nothing wrote this block before; tested demanded it anyway');
  const parsed = parseEvidence(text.slice(text.indexOf('## Evidence')));
  assert.deepEqual(parsed.exits.map((exit) => exit.suite), ['build', 'test']);
  assert.equal(parsed.exits[0].code, 0);
});

test('a red command is recorded red, and tested refuses it', async () => {
  const { recordEvidence, evidenceRefusal } = await import('../src/folder/evidence.js');
  const { parseRequirement } = await import('../src/folder/requirements.js');
  const root = await newProject('--yes');
  const { run } = await import('../src/cli.js');
  await run(['add', 'a thing', '--dir', root]);
  const map = join(root, 'vibekit/product/map.md');
  await writeFile(map, (await readFile(map, 'utf8'))
    .replace(/^build\s{2,}.*$/m, `build     "${process.execPath}" -e "process.exit(0)"`)
    .replace(/^test\s{2,}.*$/m, `test      "${process.execPath}" -e "process.exit(3)"`));

  const result = await recordEvidence(root, 'REQ-001');
  assert.equal(result.green, false);
  const requirement = parseRequirement('REQ-001', await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8'));
  assert.match(evidenceRefusal(requirement, null), /evidence is red: test exit 3/);
});

test('evidence for another commit, a dirty tree, or a paragraph is refused for what it is', async () => {
  const { evidenceRefusal } = await import('../src/folder/evidence.js');
  const at = (evidence) => ({ id: 'REQ-001', evidence });

  assert.match(evidenceRefusal(at(''), null), /no ## Evidence block/);
  assert.match(evidenceRefusal(at('tests are green, trust me'), null), /a paragraph is not evidence/);
  assert.match(evidenceRefusal(at('commit aaaaaaa · 2026-09-24T10:00Z\n\n- test `x`  exit 0  1s'), { commit: 'bbbbbbb0000' }), /for commit aaaaaaa, and HEAD is bbbbbbb/);
  assert.match(evidenceRefusal(at('commit aaaaaaa · working tree dirty · 2026-09-24T10:00Z\n\n- test `x`  exit 0  1s'), { commit: 'aaaaaaa0000' }), /dirty working tree/);
  assert.equal(evidenceRefusal(at('commit aaaaaaa · 2026-09-24T10:00Z\n\n- test `x`  exit 0  1s'), { commit: 'aaaaaaa0000' }), null);
});

test('an approval written as a body line is found even when the front matter carries an empty key', () => {
  // The templates ship `approved:` empty in the front matter. Reading it with `??` treated that
  // empty string as the answer, so the same line that opens the plan gate was ignored on
  // architecture.md and the gate stayed shut with the approval sitting in the file.
  assert.equal(approvalOf('---\napproved: \nstack: x\n---\n\n# Architecture\n\napproved: 2026-09-24 by Grace Hopper\n').by, 'Grace Hopper');
  assert.equal(approvalOf('---\napproved: 2026-09-24 by Grace Hopper\napproved: \n---\n').by, 'Grace Hopper', 'a duplicate empty key does not hide the real line');
  assert.equal(approvalOf('---\napproved: TODO\n---\n'), null);
});

test('an ask without plain terms is refused at the door, not only flagged later', async () => {
  const root = await newProject('--yes');
  await assert.rejects(() => openAsk(root, { ask: 'Add a Refund entity.', plain: '' }), /needs its plain terms/);
  await assert.rejects(() => openAsk(root, { ask: 'Add a Refund entity.' }), /needs its plain terms/);
});
