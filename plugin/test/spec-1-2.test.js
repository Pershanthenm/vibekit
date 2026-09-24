import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeSprint, gerund, parsePlan, sprintBoard, sprintGate, stepWords } from '../src/folder/sprints.js';
import { verdict } from '../src/folder/converge.js';
import { bugBlockers, createBug, placementFor, refuseSeverity, verdictFrom } from '../src/folder/bugs.js';
import { MARKS, folderIn, readRegistry, register, summarise, timeAgo } from '../src/projects.js';
import { action, decisionsIn, parseAnswers, pick } from '../src/commands/action.js';
import { BUILT_IN, MAY_ADD, add as addExt, list as listExt, refuseManifest, remove as removeExt } from '../src/extensions.js';
import { decide, progress, startAssessment } from '../src/assess.js';
import { applyChange, extractLook, interpretFeedback, renderPreview } from '../src/inspiration.js';
import { CONTROLS, FRAMEWORKS, frameworksFor, score, securityRead } from '../src/security/scan.js';
import { codeowners } from '../src/commands/team.js';
import { parityReport } from '../src/parity.js';
import { ALIASES, run } from '../src/cli.js';
import { ACTIONS, apply } from '../src/control.js';
import { startScreen, unknownCommand } from '../src/guide.js';
import { generateFolder } from '../src/folder/generate.js';
import { createRequirement, listRequirements, setStatus } from '../src/folder/requirements.js';
import { listAsks, openAsk } from '../src/folder/asks.js';
import { isolateHome, restoreEnv, tempDir } from "./helpers.js";

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A folder with a plan of two sprints and three requirements, two of them done. */
async function project({ done = ['REQ-001'] } = {}) {
  const root = tempDir('vibekit-s12-');
  await generateFolder(root, { name: 'stock', description: null, architecture: 'layered', stack: {}, commands: {}, entities: [] }, { folder: 'vibekit' });
  for (const [id, title] of [['REQ-001', 'a counter starts a stock take'], ['REQ-002', 'save a count'], ['REQ-003', 'list variances']]) {
    await createRequirement(root, { id, title, kind: 'requirement', size: 'S', source: 'BRS-001 §2' }, 'vibekit');
    const path = join(root, `vibekit/product/requirements/${id}.md`);
    let text = await readFile(path, 'utf8');
    text = text.replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  When a counter records a quantity, the system shall save it.\n');
    if (done.includes(id)) text = text.replace(/^status: draft$/m, 'status: done').replace('## Review\n', '## Review\n\nApproved.\n').replace('## Verification\n', '## Verification\n\n- AC-1 → tests/x.test.js\n');
    await writeFile(path, text);
  }
  await writeFile(join(root, 'vibekit/workflow/plan.md'), [
    '---', 'approved: 2026-09-24 by You', 'requirements: 3', 'phases: 2', '---', '', '# Plan', '',
    '## Phase 0: Foundation', '', '- Scaffold from map.md', '',
    '## Phase 1: count', '', '- REQ-001 start a stock take', '- REQ-002 save a count · after REQ-001', '',
    '## Phase 2: variances', '', '- REQ-003 list variances', '',
    '## Deferred', '', '- REQ-009 reporting  reason: later', '',
  ].join('\n'));
  return root;
}

// ------------------------------------------------------------------ sprints

test('plan.md is read as sprints: ids under each heading, the deferred list, and the template TODO ignored', () => {
  const { sprints, deferred } = parsePlan('## Phase 0: Foundation\n- Scaffold\n\n## Phase 1\n- TODO: REQ-001 …\n- REQ-002 save a count\n\n## Sprint 2: variances\n- REQ-003\n\n## Deferred\n- REQ-009 reason: later\n');
  assert.deepEqual(sprints.map((sprint) => [sprint.n, sprint.title, sprint.ids]), [[0, 'Foundation', []], [1, 'Sprint 1', ['REQ-002']], [2, 'variances', ['REQ-003']]]);
  assert.deepEqual(deferred, ['REQ-009']);
});

test('the current sprint is the first with work left, read from the requirement files', async () => {
  const root = await project();
  const board = await sprintBoard(root, 'vibekit');
  assert.equal(board.current.n, 1);
  assert.equal(board.current.done, 1);
  assert.equal(board.current.total, 2);
  assert.deepEqual(board.deferred, ['REQ-009']);
  assert.deepEqual(board.unplanned, []);
});

test('the sprint gate names every fact that is not yet true, and a human closes it', async () => {
  const root = await project();
  const open = await sprintGate(root, 1, { folder: 'vibekit' });
  assert.equal(open.ok, false);
  assert.match(open.rows[0].why, /REQ-002/);

  const closed = await sprintGate(root, 0, { folder: 'vibekit', extra: [{ ok: true, what: 'x', why: 'y' }] });
  assert.equal(closed.rows[0].ok, false, 'a sprint with no listed work has nothing done');

  await assert.rejects(closeSprint(root, 1, { folder: 'vibekit' }), /human decision/);
  const result = await closeSprint(root, 1, { by: 'Ada', folder: 'vibekit', tag: false });
  assert.equal(result.by, 'Ada');
  const board = await sprintBoard(root, 'vibekit');
  assert.equal(board.sprints[1].closed.by, 'Ada');
});

test('screens show the work, not the identifier', () => {
  assert.equal(gerund('cancel a booking'), 'Cancelling a booking');
  assert.equal(gerund('save a count'), 'Saving a count');
  assert.equal(gerund('a counter starts a stock take'), 'a counter starts a stock take', 'a title that is not verb-first is left as written');
  assert.equal(stepWords({ status: 'tested' }), 'waiting for a second pair of eyes');
  assert.equal(stepWords({ status: 'in-progress', approach: 'files: x', checkpoint: '' }, {}), 'writing the code');
  assert.equal(stepWords({ status: 'blocked' }), 'waiting on your answer');
});

// ------------------------------------------------------------------ convergence

test('convergence is judged from the sequence of rounds, and oscillation is caught on the spot', () => {
  const set = (...keys) => new Set(keys);
  assert.equal(verdict([set()]).state, 'converged');
  assert.equal(verdict([set('a', 'b')]).state, 'converging');
  assert.equal(verdict([set('a', 'b'), set('a')]).state, 'converging');
  assert.equal(verdict([set('a', 'b'), set('a'), set()]).state, 'converged');
  assert.equal(verdict([set('a', 'b'), set('a'), set('a')]).state, 'converged', 'the same set twice: stopped changing, these remain');
  assert.equal(verdict([set('a'), set('b'), set('a')]).state, 'not-converging', 'a problem came back');
  assert.equal(verdict([set('a'), set('a', 'b')]).state, 'not-converging', 'each round finds more');
});

// ------------------------------------------------------------------ bugs

test('a bug is a requirement with four fields and a failing test; severity places it and an agent cannot set it high', async () => {
  const root = await project();
  const created = await createBug(root, { title: 'due dates show a day early', severity: 'high', foundBy: 'reviewer (claude-code)', foundOn: 'REQ-002', test: 'tests/dates.test.js', criterion: 'When a due date is entered east of UTC, the system shall show the same calendar day' }, 'vibekit');
  assert.equal(created.id, 'BUG-001');
  assert.equal(created.placement.blocksGate, true);
  const bug = (await listRequirements(root, 'vibekit')).find((entry) => entry.id === 'BUG-001');
  assert.equal(bug.kind, 'bug');
  assert.equal(bug.severity, 'high');
  assert.equal(bug.test, 'tests/dates.test.js');
  assert.equal(bug.acceptance.length, 1);
  assert.deepEqual(bugBlockers(bug), []);

  assert.match(refuseSeverity('high', { by: 'agent' }), /human judgement/);
  assert.equal(refuseSeverity('medium', { by: 'agent' }), null);
  assert.match(refuseSeverity('urgent'), /not a severity/);
  assert.equal(placementFor('low').phase, 'backlog');

  const reportOnly = await createBug(root, { title: 'something is off', severity: 'low', foundBy: 'human' }, 'vibekit');
  const blockers = bugBlockers((await listRequirements(root, 'vibekit')).find((entry) => entry.id === reportOnly.id));
  assert.ok(blockers.some((line) => /reproducing test/.test(line)), 'no test, no bug');
});

test('the verdict is one of three words, decided by facts', () => {
  assert.equal(verdictFrom({ ran: false }).verdict, 'failed');
  assert.equal(verdictFrom({ ran: true, suiteGreen: false, testPresent: true }).verdict, 'failed');
  assert.equal(verdictFrom({ ran: true, suiteGreen: true, testPresent: false }).verdict, 'partial');
  assert.equal(verdictFrom({ ran: true, suiteGreen: true, testPresent: true }).verdict, 'verified');
});

// ------------------------------------------------------------------ projects

test('the registry holds paths and names only, and marks are read from each folder on demand', async () => {
  const original = { ...process.env };
  isolateHome();
  try {
    const root = await project();
    await register(root, { name: 'stock' });
    // The registry is per install (VIBEKIT_HOME), which the test harness shares across a run, so
    // the entry is found by its path rather than assumed to be alone.
    const entry = (await readRegistry()).find((row) => row.path === root);
    assert.ok(entry, 'registered');
    assert.deepEqual(Object.keys(entry).sort(), ['lastSeen', 'name', 'path', 'remote']);
    assert.equal(await folderIn(root), 'vibekit');

    const row = await summarise(entry);
    assert.equal(row.mark, MARKS.waiting, `${row.mark} ${row.line}`);
    assert.match(row.line, /sprint 1 of 3|waiting|nothing running/);

    const gone = await summarise({ name: 'x', path: join(root, 'nowhere') });
    assert.equal(gone.mark, MARKS.gone);
    assert.equal(timeAgo(new Date(Date.now() - 5 * 60000).toISOString()), '5 min ago');
  } finally {
    restoreEnv(original);
  }
});

// ------------------------------------------------------------------ action

test('the decision queue is asks by blast radius, then the gate that is ready, then reviewed work to close', async () => {
  const root = await project();
  await openAsk(root, { kind: 'question', by: 'analyst', ask: 'Where does expected stock come from?', plain: 'Where does the expected number come from?', blocking: true, forRequirement: 'REQ-003' }, 'vibekit');
  const items = await decisionsIn(root, 'vibekit');
  assert.equal(items[0].kind, 'ask');
  assert.equal(items[0].blocking, true);
  assert.match(items[0].plain, /expected number/);
  assert.ok(items.every((item) => item.command.startsWith('vibekit ')));
});

test('answering many: a walk with the options as a menu, several on one line, a fill-in file, and an id open in two projects must be qualified', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-action-');
  try {
    const shop = await project();
    const stock = await project();
    await register(shop, { name: 'shop' });
    await register(stock, { name: 'stock' });
    const open = (root, plain, extra = {}) => openAsk(root, { kind: 'question', by: 'analyst', ask: plain, plain, forRequirement: 'REQ-002', ...extra }, 'vibekit');
    await open(shop, 'Where does the expected number come from?', { blocking: true, options: ['a CSV export', 'the ERP API'] });
    await open(stock, 'Where does the expected number come from?');
    await open(shop, 'Which payment provider do we use?');
    await open(stock, 'Do we keep the old portal running?');

    const lines = [];
    const log = console.log;
    console.log = (line = '') => lines.push(String(line));
    try {
      // The list names the id next to the number, and says how to answer many.
      await run(['action', '--dir', shop]);
      assert.match(lines.join('\n'), /Q-001 .*expected number/);
      assert.match(lines.join('\n'), /vibekit action answer {2,}.*walk through/);

      // The same id in two projects: refused until qualified.
      await assert.rejects(run(['action', 'answer', 'Q-001', 'x', '--dir', shop]), /open in shop and stock.*shop\/Q-001 or stock\/Q-001/);

      // Several on one line, by qualified id and by number.
      lines.length = 0;
      await run(['action', 'answer', 'stock/Q-001', 'the ERP export', 'shop/Q-002', 'Stripe', '--dir', shop, '--by', 'Sam']);
      assert.match(lines.join('\n'), /stock · Q-001 answered/);
      assert.match(lines.join('\n'), /shop · Q-002 answered/);
      const answered = (await listAsks(stock, 'vibekit')).find((ask) => ask.id === 'Q-001');
      assert.equal(answered.status, 'answered');
      assert.match(answered.answer, /the ERP export/);
      assert.match(answered.answer, /Sam/);

      // The walk: the agent's options are the menu; a typed answer, a skip, a rejection are each written or not.
      const script = [
        { choose: 'option-0' },                                   // shop/Q-001 → "a CSV export"
        { choose: '__reject', text: 'finance decides this' },     // stock/Q-002 sent back
      ];
      const asker = {
        seen: [],
        choose: async (question) => { asker.seen.push(question); return script.shift().choose; },
        text: async () => 'finance decides this',
        close: () => {},
      };
      lines.length = 0;
      const done = await action({ root: shop, args: ['answer'], asker, by: 'Sam' });
      assert.deepEqual(done.map((item) => `${item.project}/${item.id} ${item.status}`), ['shop/Q-001 answered', 'stock/Q-002 rejected']);
      assert.deepEqual(asker.seen[0].options.slice(0, 2).map((option) => option.label), ['a CSV export', 'the ERP API']);
      assert.ok(asker.seen[0].options.some((option) => option.id === '__skip'));
      assert.match((await listAsks(shop, 'vibekit')).find((ask) => ask.id === 'Q-001').answer, /a CSV export/);
      assert.match(lines.join('\n'), /2 decisions written/);

      // Nothing left: the walk says so instead of asking.
      lines.length = 0;
      await action({ root: shop, args: ['answer'], asker });
      assert.match(lines.join('\n'), /No questions are waiting/);
    } finally {
      console.log = log;
    }

    // The fill-in file: exported with the questions as comments, applied line by line.
    await open(stock, 'Where do refunds go?', { options: ['the original card', 'EFT'] });
    await open(shop, 'Do we need a newsletter?');
    const file = join(tempDir('vibekit-answers-'), 'answers.md');
    console.log = () => {};
    try {
      await run(['action', 'export', '--out', file, '--dir', shop]);
      const exported = await readFile(file, 'utf8');
      assert.match(exported, /# stock · .*Where do refunds go\?\n#   options: the original card \| EFT\nstock\/Q-003: \n/);
      assert.match(exported, /shop\/Q-003: \n/);
      await writeFile(file, exported.replace('stock/Q-003: ', 'stock/Q-003: EFT, always\n  the card provider charges for refunds').replace('shop/Q-003: ', 'shop/Q-003: reject: marketing can raise it as a feature'));
      await run(['action', 'answer', '--from', file, '--dir', shop]);
    } finally {
      console.log = log;
    }
    const refunds = (await listAsks(stock, 'vibekit')).find((ask) => ask.id === 'Q-003');
    assert.equal(refunds.status, 'answered');
    assert.match(refunds.answer, /EFT, always\n {2}the card provider charges/);
    assert.equal((await listAsks(shop, 'vibekit')).find((ask) => ask.id === 'Q-003').status, 'rejected');

    // parseAnswers on its own: comments skipped, blanks skipped, continuation lines kept, reject: recognised.
    assert.deepEqual(parseAnswers('# c\nshop/Q-001: yes\nQ-002: \nQ-003: reject:   too soon\nstock/Q-004: first\nsecond line\n'), [
      { which: 'shop/Q-001', answer: 'yes' }, { which: 'Q-003', reject: 'too soon' }, { which: 'stock/Q-004', answer: 'first\nsecond line' },
    ]);
    assert.throws(() => pick([{ kind: 'gate', id: 'stage 2', command: 'vibekit sprint run' }], '1'), /not a question to answer here/);
  } finally {
    restoreEnv(original);
  }
});

// ------------------------------------------------------------------ extensions

test('extensions are data only and cannot weaken anything', async () => {
  const original = { ...process.env };
  isolateHome();
  try {
    assert.deepEqual(refuseManifest({ name: 'assess', adds: { commands: true } }), []);
    assert.ok(refuseManifest({ name: 'Bad Name' }).length);
    assert.ok(refuseManifest({ name: 'x', adds: { hooks: true } }).some((line) => /may add/.test(line)));
    assert.ok(refuseManifest({ name: 'x', adds: { checks: 'remove-check: budget' } }).some((line) => /cannot weaken/.test(line)));
    assert.ok(refuseManifest({ name: 'x' }, ['index.js']).some((line) => /Code is not installed/.test(line)));
    assert.deepEqual(MAY_ADD, ['commands', 'stages', 'skills', 'checks', 'documents', 'reports', 'templates', 'servers']);

    const added = await addExt('assess');
    assert.equal(added.builtIn, true);
    assert.ok((await listExt()).find((row) => row.name === 'assess').enabled);
    await removeExt('assess');
    assert.equal((await listExt()).find((row) => row.name === 'assess').enabled, false);
    await assert.rejects(addExt('http://example.com/ext.git'), /never plain http/);
    assert.ok(Object.keys(BUILT_IN).includes('security-frameworks'));
  } finally {
    restoreEnv(original);
  }
});

// ------------------------------------------------------------------ assessment

test('an assessment is five files with questions, and a decision with its reasoning', async () => {
  const root = tempDir('vibekit-assess-');
  const started = await startAssessment(root, 'Offline mode with sync');
  assert.equal(started.written.length, 5);
  const rows = await progress(root, 'Offline mode with sync');
  assert.ok(rows.every((row) => row.exists && row.open > 0));
  await assert.rejects(decide(root, 'Offline mode with sync', { decision: 'maybe', why: 'x' }), /one of/);
  await assert.rejects(decide(root, 'Offline mode with sync', { decision: 'build', why: '' }), /reasoning/);
  const result = await decide(root, 'Offline mode with sync', { decision: 'no-build', why: 'nobody asked for it' });
  assert.match(await readFile(join(result.dir, '5-decide.md'), 'utf8'), /\*\*Do not build\*\*/);
  assert.match(await readFile(join(result.dir, 'README.md'), 'utf8'), /Decision: \*\*no-build\*\*/);
});

// ------------------------------------------------------------------ design

test('a reference is turned into extracted values, and vague feedback into a token change', () => {
  const css = ':root{--brand:#0B4F6C}.a{padding:4px;gap:8px;margin:12px;border-radius:6px;border:1px solid #ddd;font-size:13px;font-family:Inter}.b{padding:16px;border:1px solid #eee;border-radius:4px}';
  const look = extractLook(css);
  assert.equal(look.spacing.base, 4);
  assert.equal(look.spacing.rhythm, 'tight');
  assert.equal(look.palette.brand, '#0B4F6C');
  assert.equal(look.corners.max, 6);
  assert.equal(look.surfaces.style, 'borders instead of shadows');
  assert.equal(look.density.level, 'compact');

  assert.equal(interpretFeedback('too cramped').key, 'cramped');
  assert.equal(interpretFeedback('feels a bit dense').key, 'cramped');
  assert.equal(interpretFeedback('meh'), null);
  assert.deepEqual(applyChange({}, { spacing: '+1' }), { spacing: 'regular' });
  assert.deepEqual(applyChange({ spacing: 'regular' }, { spacing: '+1' }), { spacing: 'roomy' });
  assert.deepEqual(applyChange({}, { density: 'comfortable' }), { density: 'comfortable' });

  const html = renderPreview({ name: 'stock', tokens: { brand: '#123456', density: 'compact' }, flows: ['Count a shelf', 'Review variances'], components: ['CountRow'] });
  assert.match(html, /Count a shelf/);
  assert.match(html, /--brand:#123456/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /width:360px/);
});

// ------------------------------------------------------------------ security scan

test('frameworks are chosen by the classifications, and a gap is never counted as a pass', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/product/entities.md'), '<!-- generated by vibekit · do not edit · source: entities -->\n# Entities\n\n## Counter\nclass: personal\n- `email` string\n\n## Count\nclass: internal\n- `quantity` integer\n');
  const frameworks = await frameworksFor(root, { folder: 'vibekit' });
  const applies = Object.fromEntries(frameworks.map((framework) => [framework.id, framework.applies]));
  assert.equal(applies['owasp-asvs'], true);
  assert.equal(applies['popia-gdpr'], true, 'personal data → POPIA/GDPR applies');
  assert.equal(applies['pci-dss'], false);
  assert.equal(applies['cis-docker'], false, 'no Dockerfile');
  assert.equal(frameworks.find((framework) => framework.id === 'owasp-asvs').level, 'L2');

  const read = await securityRead(root, { folder: 'vibekit', offline: true });
  assert.ok(read.findings.some((finding) => finding.check === 'retention'), 'personal data with no retention rule is a finding');
  assert.ok(read.findings.some((finding) => finding.check === 'erasure'));
  assert.equal(read.evidence.secrets.met, true);

  const scored = score(frameworks, read.evidence, { probed: false, context: { classes: new Set(['personal']) } });
  const asvs = scored.find((framework) => framework.id === 'owasp-asvs');
  assert.ok(asvs.human > 0, 'probe controls need a running application and are counted as needing a person');
  assert.equal(asvs.met + asvs.failed + asvs.human + asvs.notApplicable, asvs.controls.length);
  assert.ok(CONTROLS.every((control) => FRAMEWORKS.some((framework) => framework.id === control.framework)));
});

test('a UUID or a path is not a secret', async () => {
  const { highEntropyTokens } = await import('../src/sources.js');
  assert.deepEqual(highEntropyTokens('session 3ecb030d-efc8-450c-918c-5f97286480ef in /tmp/x'), []);
  assert.equal(highEntropyTokens('key=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1O').length, 1);
});

// ------------------------------------------------------------------ team and parity

test('CODEOWNERS comes from humans.md and the layer rules, and the tech lead holds security when nobody is named', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/agents/humans.md'), '# Humans\n\n## Approvers\n\n| Role | Name | May approve |\n| --- | --- | --- |\n| tech lead | Ada <ada@example.com> | all |\n| product owner | Bob <bob@example.com> | plan |\n');
  await codeowners(root, 'vibekit', { json: true });
  const text = await readFile(join(root, 'CODEOWNERS'), 'utf8');
  assert.match(text, /^vibekit\/standards\/ ada@example\.com$/m);
  assert.match(text, /^vibekit\/product\/ bob@example\.com$/m);
  assert.match(text, /^vibekit\/standards\/security\.md ada@example\.com$/m);
});

test('every command has a page action or is the machine\'s own', async () => {
  const report = await parityReport();
  assert.deepEqual(report.missing, [], report.missing.join(', '));
  assert.ok(report.covered.includes('action'));
  for (const action of ['req.add', 'gate.approve', 'plan.reorder', 'note.add', 'memory.accept', 'bug.severity']) assert.ok(ACTIONS[action], action);
});

// ------------------------------------------------------------------ the page's new actions

test('the page approves a gate by writing the line a person would, and refuses to approve twice', async () => {
  const root = await project();
  const result = await apply(root, null, { action: 'gate.approve', stage: 2, by: 'Grace' });
  assert.match(result.message, /architecture approved by Grace/);
  assert.match(await readFile(join(root, 'vibekit/workflow/architecture.md'), 'utf8'), /^approved: \d{4}-\d{2}-\d{2} by Grace$/m);
  await assert.rejects(apply(root, null, { action: 'gate.approve', stage: 2, by: 'Grace' }), /already approved/);
  await assert.rejects(apply(root, null, { action: 'gate.approve', stage: 9, by: 'Grace' }), /no approval line/);

  const reordered = await apply(root, null, { action: 'plan.reorder', order: ['REQ-002', 'REQ-001'], defer: ['REQ-003'], by: 'Grace' });
  assert.match(reordered.message, /reordered; REQ-003 deferred/);
  const plan = await readFile(join(root, 'vibekit/workflow/plan.md'), 'utf8');
  assert.ok(plan.indexOf('REQ-002') < plan.indexOf('REQ-001'), 'the sprint is re-sorted to the given order');
  assert.match(plan, /## Deferred[\s\S]*REQ-003  reason: deferred from the tracker by Grace/);
});

test('a memory proposal accepted from the page becomes a memory file, through the ask', async () => {
  const root = await project();
  const ask = await openAsk(root, { kind: 'proposal', by: 'implementer', ask: 'Integration tests need Postgres running first', plain: 'Start the database before the tests.', topic: ['testing'], about: 'skill' }, 'vibekit');
  const result = await apply(root, null, { action: 'memory.accept', id: ask.id, by: 'Ada' });
  assert.match(result.message, /accepted; M-\d+ written/);
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(join(root, 'vibekit/memory/repo'));
  assert.equal(files.length, 1);
  assert.match(await readFile(join(root, 'vibekit/memory/repo', files[0]), 'utf8'), /Postgres running first/);
});

// ------------------------------------------------------------------ cli

test('the everyday names route to the same functions as the older verbs, and a typo is refused', async () => {
  assert.equal(ALIASES.next, 'sprint start');
  assert.equal(ALIASES.pause, 'project stop');
  assert.equal(ALIASES.understand, 'project import');
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    await run(['nosuchthing']);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.match(errors.join('\n'), /no such command "nosuchthing"/);
    assert.match(unknownCommand('sprnt', ['sprint', 'project']), /Did you mean: vibekit sprint/);
    assert.doesNotMatch(unknownCommand('zzzzzzzz', ['sprint']), /Did you mean/);
  } finally {
    console.error = original;
  }
});

test('project new --yes writes the config, the folder, the source and the registry entry', async () => {
  const original = { ...process.env };
  isolateHome();
  try {
    const root = tempDir('vibekit-pnew-');
    git(root, 'init', '-q', '-b', 'main');
    const lines = [];
    const original = console.log;
    console.log = (line = '') => lines.push(String(line));
    try {
      await run(['project', 'new', '--yes', '--name', 'stock', '--describe', 'Staff count stock on a phone.', '--platform', 'web,api', '--dir', root]);
    } finally {
      console.log = original;
    }
    const config = JSON.parse(await readFile(join(root, 'specs/project.json'), 'utf8'));
    assert.equal(config.project.name, 'stock');
    assert.deepEqual(config.project.platforms, ['web', 'api']);
    assert.match(await readFile(join(root, 'vibekit/product/sources/DESC-001/source.md'), 'utf8'), /Staff count stock/);
    assert.ok((await readRegistry()).some((entry) => entry.path === root));
    assert.match(lines.join('\n'), /Spec started/);
    assert.match(await startScreen(root), /Every day/);
  } finally {
    restoreEnv(original);
  }
});

test('vibekit tracker <project> finds the project by name and defaults to a tunnel with a QR code', async () => {
  const original = { ...process.env };
  isolateHome();
  try {
    const root = await project();
    // A name no other test registers: the registry is shared across the run (VIBEKIT_HOME).
    const name = `stock-${process.pid}-${Date.now()}`;
    await register(root, { name });
    const elsewhere = tempDir('vibekit-elsewhere-');
    const lines = [];
    const log = console.log;
    console.log = (line = '') => lines.push(String(line));
    try {
      await run(['tracker', name, '--dry-run', '--dir', elsewhere]);
    } finally {
      console.log = log;
    }
    const out = lines.join('\n');
    assert.match(out, new RegExp(`would serve vibekit/ of ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the registry, not the current directory, decides');
    assert.match(out, /tunnel {5}yes — a QR code/);

    const quiet = [];
    console.log = (line = '') => quiet.push(String(line));
    try {
      await run(['tracker', name, '--dry-run', '--no-tunnel', '--dir', elsewhere]);
    } finally {
      console.log = log;
    }
    assert.match(quiet.join('\n'), /tunnel {5}no/);
    await assert.rejects(run(['tracker', 'nosuchproject', '--dry-run', '--dir', elsewhere]), /No project called "nosuchproject"/);
  } finally {
    restoreEnv(original);
  }
});

test('a status move leaves a line in the requirement\'s log', async () => {
  const root = await project({ done: [] });
  await setStatus(root, 'REQ-002', 'ready', { by: 'human', folder: 'vibekit', entities: [], assumptions: [] });
  assert.match(await readFile(join(root, 'vibekit/product/requirements/REQ-002.md'), 'utf8'), /## Log\n\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} draft → ready \(human\)/);
});

test('the hook refuses a write to a generated file, a denied path, and another requirement while one is held', async () => {
  const root = await project({ done: [] });
  await mkdir(join(root, 'infra'), { recursive: true });
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# Guardrails\n\n## Denied paths\n\n- infra/  platform team\n\n## Allowed commands\n\n- npm test\n');
  const { claim } = await import('../src/folder/requirements.js');
  await setStatus(root, 'REQ-002', 'ready', { by: 'human', folder: 'vibekit', entities: [], assumptions: [] });
  await claim(root, { id: 'REQ-002', role: 'implementer', runner: 'test' }, 'vibekit');
  const { hook } = await import('../src/commands/hook.js');
  const refusals = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (text) => { refusals.push(String(text)); return true; };
  const stdin = process.stdin;
  const feed = (input) => {
    Object.defineProperty(process, 'stdin', { value: { isTTY: false, [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(input)); } }, configurable: true });
  };
  try {
    for (const path of ['vibekit/product/entities.md', 'infra/main.tf', 'vibekit/product/requirements/REQ-003.md', 'vibekit/standards/rules.md']) {
      feed({ cwd: root, tool_input: { file_path: join(root, path) } });
      process.exitCode = 0;
      await hook({ args: ['pre-edit'] });
      assert.equal(process.exitCode, 2, `${path} should be refused`);
    }
    feed({ cwd: root, tool_input: { file_path: join(root, 'src/count.js') } });
    process.exitCode = 0;
    await hook({ args: ['pre-edit'] });
    assert.equal(process.exitCode, 0, 'application code is the implementer\'s to write');
    assert.match(refusals.join('\n'), /generated by VibeKit/);
    assert.match(refusals.join('\n'), /denied path/);
    assert.match(refusals.join('\n'), /another requirement/);
  } finally {
    process.exitCode = 0;
    process.stderr.write = originalWrite;
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  }
});
