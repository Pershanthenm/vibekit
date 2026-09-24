import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectState, dashboardPath, needsYou, offersFor, schedule } from '../src/dashboard.js';
import { renderDashboard } from '../src/dashboard-view.js';
import { generateFolder } from '../src/folder/generate.js';
import { openAsk } from '../src/folder/asks.js';
import { claim, setStatus, writeSection } from '../src/folder/requirements.js';
import { BIN, newProject, gitInit, sh } from './helpers.js';

/**
 * The tracker. Specification §57.
 *
 * One screen, four cards, ordered by what needs a human most. The tests that matter are about
 * that ordering and about what a page may and may not do — not about markup, which changes.
 */

const REQUIREMENT = (id, extra = {}) => `---
id: ${id}
title: ${extra.title ?? 'Cancel a booking'}
kind: requirement
size: M
status: ${extra.status ?? 'ready'}
entities: [Booking]
source: BRS-001 §4.2
after: [${(extra.after ?? []).join(', ')}]
assumes: []
---

## Acceptance

- AC-1  When a booking is cancelled, the system shall set its status to \`cancelled\`.

## Security

Touches Booking.

## Approach

## Verification

## Review

## Log
`;

async function tracker(requirements = { 'REQ-001': {} }) {
  const root = await newProject('--yes');
  await generateFolder(root, { name: 'bookings', description: 'Gym bookings.', commands: { test: 't' }, entities: [{ name: 'Booking', class: 'personal' }] });
  for (const [id, extra] of Object.entries(requirements)) {
    await writeFile(join(root, `vibekit/product/requirements/${id}.md`), REQUIREMENT(id, extra));
  }
  return root;
}

test('the state says where every piece of work sits, and who is holding it', async () => {
  const root = await tracker({ 'REQ-001': {}, 'REQ-002': { status: 'draft', title: 'Invite a member' } });
  await setStatus(root, 'REQ-001', 'in-progress', { by: 'agent' });
  await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'claude-code' });

  const state = await collectState(root, null);
  assert.equal(state.stats.requirements, 2);
  const held = state.requirements.find((entry) => entry.id === 'REQ-001');
  assert.equal(held.status, 'in-progress');
  assert.equal(held.holder.role, 'implementer');
  assert.equal(typeof held.heldHours, 'number');
});

test('what needs a human is sorted by how much work it unblocks, not by when it arrived', () => {
  const requirements = [
    { id: 'REQ-001', after: [], status: 'ready', title: 'A', review: '', entities: [] },
    { id: 'REQ-002', after: ['REQ-001'], status: 'draft', title: 'B', review: '', entities: [] },
    { id: 'REQ-003', after: ['REQ-002'], status: 'draft', title: 'C', review: '', entities: [] },
    { id: 'REQ-009', after: [], status: 'ready', title: 'D', review: '', entities: [] },
  ];
  const asks = [
    { id: 'Q-010', kind: 'question', status: 'waiting', blocking: false, for: 'REQ-009', waitingDays: 9, plain: 'small', why: '', options: [], ask: 'x' },
    { id: 'Q-001', kind: 'question', status: 'waiting', blocking: false, for: 'REQ-001', waitingDays: 0, plain: 'big', why: '', options: [], ask: 'y' },
  ];
  const items = needsYou({ asks, requirements, gates: {}, held: {}, holdTimeout: 4 });

  // Q-001 arrived today and Q-010 nine days ago, but three requirements wait on Q-001 and one on
  // Q-010. The Monday-morning job of the page is to surface what unblocks the most.
  assert.equal(items[0].id, 'Q-001');
});

test('a blocking ask outranks everything, because the work is already stopped', () => {
  const requirements = [{ id: 'REQ-001', after: [], status: 'ready', title: 'A', review: '', entities: [] }];
  const items = needsYou({
    asks: [
      { id: 'Q-002', kind: 'question', status: 'waiting', blocking: false, for: 'REQ-001', waitingDays: 30, plain: 'old', why: '', options: [], ask: '' },
      { id: 'Q-003', kind: 'question', status: 'waiting', blocking: true, for: null, waitingDays: 0, plain: 'stopped', why: '', options: [], ask: '' },
    ],
    requirements, gates: {}, held: {}, holdTimeout: 4,
  });
  assert.equal(items[0].id, 'Q-003');
  assert.equal(items[0].blocking, true);
});

test('a stale hold is surfaced as something a person must release', () => {
  const old = new Date(Date.now() - 9 * 3600000).toISOString();
  const items = needsYou({
    asks: [], requirements: [], gates: {},
    held: { 'REQ-001': { role: 'implementer', runner: 'claude-code', startedAtUtc: old } },
    holdTimeout: 4,
  });
  const stale = items.find((item) => item.kind === 'stale-hold');
  assert.ok(stale, 'a hold nine hours past a four-hour timeout was not surfaced');
  assert.match(stale.plain, /9 hours/);
  assert.deepEqual(stale.actions, ['release']);
});

test('the page offers only the moves that are a human\'s to make', () => {
  // An agent picks work up and blocks on a question where the work happens. Those would be
  // meaningless from a board, so the page does not offer them.
  assert.deepEqual(offersFor({ status: 'draft', review: '' }, null), ['ready']);
  assert.deepEqual(offersFor({ status: 'review', review: 'approved' }, null), ['done']);
  assert.ok(!offersFor({ status: 'ready', review: '' }, null).includes('in-progress'));
  assert.ok(offersFor({ status: 'in-progress', review: '' }, { role: 'implementer' }).includes('release'));
});

test('approving a stage from the page writes the same line a person would, with their name on it', async () => {
  // §57: "Approve or reject a gate — the role humans.md names — writes the approved: line". The
  // button is the pen; nothing passes a gate without a name, and the read-only page has no pen.
  const root = await tracker();
  const state = await collectState(root, null);
  const gate = state.needsYou.find((item) => item.kind === 'gate');
  if (gate) {
    assert.deepEqual(gate.actions, ['approve', 'reject-gate']);
    assert.match(gate.why, /writes the line in workflow\//);
  }
  const writable = renderDashboard(state, { control: { url: '/x', token: 't' } });
  const readOnly = renderDashboard(state, {});
  if (gate) assert.match(writable, /data-act="approve"[^>]*data-kind="gate"/);
  assert.doesNotMatch(readOnly, /data-act="approve"/, 'a read-only viewer is offered no pen');
});

test('the schedule is measured from what finished, never from an estimate', () => {
  const none = schedule([{ status: 'ready', log: [] }]);
  assert.equal(none.perWeek, null);
  assert.match(none.basis, /not enough to measure/);

  const measured = schedule([
    { status: 'done', log: ['2026-09-01 10:00 implementer → reviewer'] },
    { status: 'done', log: ['2026-09-08 10:00 implementer → reviewer'] },
    { status: 'done', log: ['2026-09-15 10:00 implementer → reviewer'] },
    { status: 'ready', log: [] },
  ]);
  assert.ok(measured.perWeek > 0, 'three closed requirements over two weeks is a rate');
  assert.match(measured.basis, /measured from 3 closed requirements/);
});

test('the security card names what is sensitive and what is still unclassified', async () => {
  const root = await tracker();
  const state = await collectState(root, null);
  assert.ok(state.security.classified.some((entity) => entity.name === 'Booking' && entity.class === 'personal'));

  const html = renderDashboard(state, {});
  assert.match(html, /Booking \(personal\)/);
});

test('the page carries the budget a task starts from', async () => {
  const root = await tracker();
  const state = await collectState(root, null);
  const html = renderDashboard(state, {});
  assert.match(html, new RegExp(`${state.budget.alwaysLoaded}</b> tokens`));
  assert.ok(state.budget.alwaysLoaded < state.budget.ceiling);
});

test('an unserved page says how to reach it from a phone; a served one shows the address', async () => {
  const root = await tracker();
  const offline = renderDashboard(await collectState(root, null), {});
  assert.match(offline, /vibekit serve --tracker --tunnel cloudflare/);

  const online = renderDashboard(await collectState(root, null, { tunnel: { url: 'https://tracker.example.com' } }), {});
  assert.match(online, /tracker\.example\.com/);
  assert.match(online, /Scanning the code gets a sign-in, not access/);
});

test('--static drops the refresh, for a copy that is not a local browser', async () => {
  const root = await tracker();
  const state = await collectState(root, null);
  assert.match(renderDashboard(state, { live: true }), /http-equiv="refresh"/);
  assert.doesNotMatch(renderDashboard(state, { live: false }), /http-equiv="refresh"/);
});

test('the command writes the page where the project can find it, and leaves the tree clean', async () => {
  const root = await tracker();
  gitInit(root);
  // BIN, not new URL(...).pathname: the repository path contains a space, and pathname keeps it
  // percent-encoded, so node is handed a file that does not exist.
  execFileSync(process.execPath, [BIN, 'tracker', '--static', '--dir', root], { env: { ...process.env, VIBEKIT_NO_OPEN: '1' } });

  const html = await readFile(dashboardPath(root), 'utf8');
  assert.match(html, /Needs you/);
  // Inside .git/, which is ignored by definition. A page in the project root shows up in every
  // git status and eventually in somebody's commit.
  assert.match(dashboardPath(root), /\.git[/\\]vibekit/);
  assert.equal(sh(root, 'git', 'status', '--porcelain').trim(), '');
});

test('an ask with options shows them as outcomes a person can choose between', async () => {
  const root = await tracker();
  await openAsk(root, {
    kind: 'proposal', about: 'entity', forRequirement: 'REQ-001', blocking: true, by: 'implementer',
    plain: 'We need somewhere to record money paid back.',
    ask: 'Add a Refund entity.',
    why: 'Cancelling cannot record what was returned.',
    options: ['A new kind of record for refunds', 'Extra fields on the payment'],
  });
  const state = await collectState(root, null);
  const html = renderDashboard(state, { control: { url: '/x', token: 't' } });
  assert.match(html, /A new kind of record for refunds/);
  assert.match(html, /money paid back/);
  assert.match(html, /data-act="answer"/);
});

test('a requirement waiting for a human to close it reaches the card', async () => {
  const root = await tracker();
  await setStatus(root, 'REQ-001', 'in-progress', { by: 'agent' });
  await writeSection(root, 'REQ-001', 'Evidence', '- test exit 0');
  await setStatus(root, 'REQ-001', 'tested', { by: 'agent' });
  await writeSection(root, 'REQ-001', 'Review', 'approved');
  await setStatus(root, 'REQ-001', 'review', { by: 'agent' });

  const state = await collectState(root, null);
  const close = state.needsYou.find((item) => item.kind === 'close');
  assert.ok(close, 'a reviewed requirement was not offered for closing');
  assert.deepEqual(close.actions, ['done']);
});
