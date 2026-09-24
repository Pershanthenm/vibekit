import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import {
  CHECKPOINT_CAP, checkpointGaps, checkpointProblems, parseCheckpoint, readCheckpoint,
  renderCheckpoint, writeCheckpoint,
} from '../src/folder/checkpoint.js';
import { runChecks } from '../src/folder/checks.js';
import { generateFolder } from '../src/folder/generate.js';
import { listRequirements, parseRequirement } from '../src/folder/requirements.js';
import './helpers.js';

/**
 * Checkpoints. Specification §60, and stage 5 step 5 of the build prompt.
 *
 * The tests that matter are the ones that make the cap and the shape real. A prompt asking for
 * brevity is a suggestion; a refusal is the only thing that still holds on the tenth session.
 */

const CONFIG = {
  name: 'bookings',
  description: 'A booking system for gyms.',
  architecture: 'clean',
  stack: { language: '.NET 10' },
  commands: { test: 'dotnet test' },
  entities: [{ name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] }],
};

const GOOD = {
  done: 'AC-1 has a failing test, for the right reason',
  hand: 'BookingsController, half wired',
  next: 'implement Create so AC-1 passes',
  read: 'src/Api/BookingsController.cs',
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-cp-'));
  await generateFolder(root, CONFIG);
  await run(['req', 'new', 'members can book a class', '--dir', root]);
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8'))
    .replace(/^size:.*$/m, 'size: S')
    .replace(/^status:.*$/m, 'status: in-progress')
    .replace(/^source:.*$/m, 'source: product/context.md')
    .replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1 When a member books, the system shall create a booking.\n'));
  return root;
}

test('a checkpoint is the block §60 writes: metadata in the heading, plain labels beneath', () => {
  const body = renderCheckpoint(GOOD, { at: new Date('2026-09-23T14:32:00Z'), session: 's-0419', step: 2, of: 6 });

  assert.equal(body.split('\n')[0], '## Checkpoint   2026-09-23T14:32Z   session s-0419   step 2 of 6');
  assert.match(body, /^done: +AC-1 has a failing test, for the right reason$/m);
  assert.match(body, /^in hand: +BookingsController, half wired$/m);
  assert.deepEqual(checkpointProblems(body), []);

  const parsed = parseCheckpoint(body);
  assert.equal(parsed.next, GOOD.next);
  assert.equal(parsed.session, 's-0419');
  assert.equal(parsed.step, 2);
  assert.equal(parsed.of, 6, 'a resuming session needs to know where in the loop it stopped');
});

test('a checkpoint with no next step is refused, because that is the cost it exists to remove', () => {
  const problems = checkpointProblems(renderCheckpoint({ done: 'a lot', hand: 'the repository' }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /has no `next:` line/);
});

test('an empty checkpoint is reported as empty rather than as four separate omissions', () => {
  assert.deepEqual(checkpointProblems(''), ['is empty']);
  assert.deepEqual(checkpointProblems('   \n  '), ['is empty']);
});

test('a checkpoint as expensive as re-reading the work is refused, not truncated', async () => {
  const root = await project();
  const sprawling = { ...GOOD, done: 'and then '.repeat(400) };

  await assert.rejects(
    () => writeCheckpoint(root, 'REQ-001', sprawling),
    (error) => {
      assert.match(error.message, new RegExp(`over the ${CHECKPOINT_CAP} cap`));
      return true;
    },
  );
  // Nothing was written: a half-saved checkpoint is worse than none, because it looks current.
  assert.equal(await readCheckpoint(root, 'REQ-001'), '');
});

test('writing a checkpoint replaces the previous one, because a list of them is a transcript again', async () => {
  const root = await project();
  await writeCheckpoint(root, 'REQ-001', GOOD, { session: 's-1', step: 1, of: 6 });
  await writeCheckpoint(root, 'REQ-001', { ...GOOD, next: 'wire the repository' }, { session: 's-2', step: 2, of: 6 });

  const text = await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8');
  assert.equal(text.match(/^## Checkpoint/gm).length, 1);
  assert.match(await readCheckpoint(root, 'REQ-001'), /wire the repository/);
  assert.doesNotMatch(await readCheckpoint(root, 'REQ-001'), /implement Create/);

  // The rest of the requirement is untouched; a checkpoint must not cost you your Acceptance.
  assert.match(text, /AC-1 When a member books/);
});

test('work that was interrupted with no usable checkpoint is reported, and only that work', async () => {
  const root = await project();
  const requirements = await listRequirements(root);
  assert.equal(checkpointGaps(requirements).length, 1, 'REQ-001 is in-progress with no checkpoint');

  await writeCheckpoint(root, 'REQ-001', GOOD);
  assert.deepEqual(checkpointGaps(await listRequirements(root)), []);

  // A requirement nobody has started has nothing to check point.
  const draft = parseRequirement('REQ-002', '---\nid: REQ-002\nstatus: draft\n---\n');
  assert.deepEqual(checkpointGaps([draft]), []);
});

test('check reports a thin checkpoint as a warning, in a sentence that reads correctly', async () => {
  const root = await project();
  const { findings } = await runChecks(root, {});
  const found = findings.find((entry) => entry.code === 'checkpoint.thin');

  assert.ok(found);
  assert.equal(found.severity, 'warning', 'work a few minutes old has nothing to say yet');
  assert.match(found.message, /REQ-001 is in-progress and its ## Checkpoint is empty\./);
  assert.match(found.fix, /vibekit req checkpoint REQ-001/);
});

test('`next` prints the checkpoint of the requirement you hold, which is why it exists', async () => {
  const root = await project();
  // Claimed directly: the fixture is already in-progress, so `req start` would refuse it.
  const { claim } = await import('../src/folder/requirements.js');
  await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'cli' });
  await writeCheckpoint(root, 'REQ-001', GOOD);

  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await run(['next', '--dir', root]);
  } finally {
    console.log = original;
  }
  const output = lines.join('\n');
  assert.match(output, /Resuming REQ-001/);
  assert.match(output, /implement Create so AC-1 passes/);
});

test('a hold that timed out shows its checkpoint on the page, so releasing is a decision not a guess', async () => {
  const { needsYou } = await import('../src/dashboard.js');
  const root = await project();
  await writeCheckpoint(root, 'REQ-001', GOOD);
  const requirements = await listRequirements(root);

  const items = needsYou({
    asks: [],
    requirements,
    gates: {},
    held: { 'REQ-001': { role: 'implementer', runner: 'cli', startedAtUtc: new Date(Date.now() - 9 * 3600000).toISOString() } },
    holdTimeout: 4,
  });

  const stale = items.find((item) => item.kind === 'stale-hold');
  assert.ok(stale, 'a nine-hour hold is past the four-hour timeout');
  assert.match(stale.checkpoint, /implement Create so AC-1 passes/, '"held for nine hours" alone does not say whether releasing costs anything');

  const { cardNeedsYou } = await import('../src/dashboard-render.js');
  const html = cardNeedsYou({ needsYou: items }, { canAct: false });
  assert.match(html, /class="checkpoint"/);
  assert.match(html, /implement Create so AC-1 passes/);
});

// ---------------------------------------------------------------- pausing the project (§60)

test('pausing sets work to paused rather than ready, so nothing starts itself on restart', async () => {
  const { pause } = await import('../src/folder/pause.js');
  const { claim, readTasksState } = await import('../src/folder/requirements.js');
  const root = await project();
  await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'cli' });
  await writeCheckpoint(root, 'REQ-001', GOOD);

  const result = await pause(root, { reason: 'budget freeze' });

  assert.deepEqual(result.paused, ['REQ-001']);
  const [requirement] = await listRequirements(root);
  assert.equal(requirement.status, 'paused', 'ready would auto-start against a plan nobody has re-checked');
  assert.deepEqual((await readTasksState(root)).held, {}, 'a hold on a session that no longer exists is a stuck requirement');
  assert.match(requirement.log.join('\n'), /paused — budget freeze/);
});

test('the resume note records what was in flight, what was open, and what has no checkpoint', async () => {
  const { pause, readResumeNote } = await import('../src/folder/pause.js');
  const root = await project();
  const { openAsk } = await import('../src/folder/asks.js');
  await openAsk(root, { ask: 'Who owns refunds?', plain: 'Who decides about refunds?', blocking: true });

  await pause(root, { reason: 'the weekend' });
  const note = await readResumeNote(root);

  assert.match(note, /Paused \d{4}-\d{2}-\d{2} — the weekend/);
  assert.match(note, /\*\*In flight\.\*\* REQ-001/);
  assert.match(note, /blocking/);
  assert.match(note, /\*\*No usable checkpoint\.\*\* REQ-001/, 'this is the expensive case, so it is named rather than hidden');
});

test('resume re-establishes ground truth instead of trusting the note', async () => {
  const { pause, resumeReport } = await import('../src/folder/pause.js');
  const root = await project();
  await writeCheckpoint(root, 'REQ-001', GOOD);
  await pause(root, {});

  const report = await resumeReport(root, {});
  const checked = report.rows.map((row) => row.what);
  assert.ok(checked.some((what) => /test suite on main/.test(what)));
  assert.ok(checked.some((what) => /worktree reconciliation/.test(what)));
  assert.ok(checked.some((what) => /prompt and spec versions/.test(what)));
  assert.ok(checked.some((what) => /tier mapping/.test(what)), 'strong, mid and cheap may point at different models than they did');

  assert.equal(report.requirements[0].continues, true, 'a checkpoint that stands continues from next:');
});

test('a requirement whose checkpoint is unusable re-plans rather than continuing from it', async () => {
  const { pause, resumeReport } = await import('../src/folder/pause.js');
  const root = await project();
  await pause(root, {});

  const report = await resumeReport(root, {});
  assert.equal(report.requirements[0].continues, false);
  assert.match(report.requirements[0].why, /is empty/);
});

test('a pause longer than the stale threshold says to re-read the code before resuming', async () => {
  const { pause, resumeReport, STALE_AFTER_DAYS } = await import('../src/folder/pause.js');
  const root = await project();
  await pause(root, {}, {});

  const later = new Date(Date.now() + (STALE_AFTER_DAYS + 5) * 86400000);
  const report = await resumeReport(root, { now: () => later });
  assert.equal(report.stale, true, 'the code has probably moved under the plan');
});
