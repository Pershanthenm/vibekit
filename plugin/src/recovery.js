import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The recovery fixture. Specification §60.
 *
 * "Recovery is a tested path. VibeKit's own CI runs the recovery fixture on every release: start
 * a requirement on a fixture repo, kill the session at a random step between 2 and 5, resume, and
 * require the requirement to reach `tested` with the same evidence a straight run produces. Three
 * variants: kill after checkpoint, kill mid-edit before checkpoint, and resume on a different
 * runner. A release that fails the fixture does not ship."
 *
 * The session here is a scripted implementer in a child process, driving the real binary the way
 * a runner does: it reads, writes files, checkpoints, commits, verifies and claims `tested`. The
 * parent kills it with SIGKILL — not a signal it can catch and tidy up after — and the resumed
 * child is allowed to know nothing except what `vibekit req checkpoint` prints. If the checkpoint
 * format, the resume report or the evidence rules stop composing, this is where it shows.
 */

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/vibekit', import.meta.url));
const SELF = fileURLToPath(new URL('../tools/recovery.mjs', import.meta.url));

export const VARIANTS = Object.freeze(['after-checkpoint', 'mid-edit', 'other-runner']);
export const STEPS = 5;
export const REQ = 'REQ-001';

const CANCEL = `// Cancel a confirmed booking and issue the refund. REQ-001 AC-1.
function cancel(booking) {
  if (booking.status !== 'confirmed') throw new Error('only a confirmed booking can be cancelled');
  return { ...booking, status: 'cancelled', refund: { amount: booking.price, to: booking.paidWith } };
}
module.exports = { cancel };
`;

const TEST = `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cancel } = require('../src/cancel.js');

test('Cancel_ConfirmedBooking_IssuesRefund_AC1', () => {
  const result = cancel({ status: 'confirmed', price: 120, paidWith: 'card-1' });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.refund.amount, 120);
});
`;

async function vk(root, args, { home, expect = 0 }) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [BIN, ...args], {
      cwd: root,
      env: { ...process.env, VIBEKIT_HOME: home, VIBEKIT_NO_OPEN: '1', CI: 'true' },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    if (expect !== 0 && expect !== 'any') throw new Error(`vibekit ${args.join(' ')} exited 0, expected ${expect}`);
    return `${stdout}${stderr}`;
  } catch (error) {
    if (expect === 'any' && typeof error.code === 'number') return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (error.code === expect) return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    throw new Error(`vibekit ${args.join(' ')} exited ${error.code ?? '?'}: ${String(`${error.stdout ?? ''}${error.stderr ?? ''}`).trim().split('\n').slice(0, 3).join(' / ') || error.message}`);
  }
}

const git = (root, ...args) => exec('git', args, { cwd: root });
// The scene is set by hand on main, which is exactly what §50's commit-msg hook refuses;
// --no-verify is the escape the hook itself names. The implementer's own commits go through it.
const commitAll = (root, message) => git(root, 'add', '-A').then(() => git(root, 'commit', '-q', '--no-verify', '-m', message));

async function patch(path, edits) {
  let text = await readFile(path, 'utf8');
  for (const [from, to] of edits) text = from instanceof RegExp ? text.replace(from, to) : text.split(from).join(to);
  await writeFile(path, text);
}

/**
 * A repository at stage 5 with one ready requirement, held by an implementer. The same scene the
 * simulation's misbehaving-agent walk uses, because the fixture is about what happens after the
 * work starts, not about getting there.
 */
export async function fixture({ runner = 'claude-code' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-recovery-'));
  const home = await mkdtemp(join(tmpdir(), 'vibekit-recovery-home-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'fixture@example.com');
  await git(root, 'config', 'user.name', 'Fixture');
  await vk(root, ['init', '--yes'], { home });

  await writeFile(join(root, 'brs.md'), '1 Scope\nGym bookings.\n\n2 Cancellation\nA member shall cancel a booking.\n');
  await vk(root, ['ingest', 'brs.md', '--yes'], { home });
  await writeFile(join(root, 'vibekit/workflow/assumptions.md'), '# Assumptions\n\nreviewed: 2026-09-24 by Grace Hopper\n\n- A-001 Refunds go to the original card · confidence: medium\n');
  await patch(join(root, 'vibekit/workflow/architecture.md'), [[/^approved:.*$/m, 'approved: 2026-09-24 by Grace Hopper'], [/^api:.*$/m, 'api: none']]);
  const plan = join(root, 'vibekit/workflow/plan.md');
  await writeFile(plan, `approved: 2026-09-24 by Ada Lovelace\n\n${await readFile(plan, 'utf8')}`);
  await writeFile(join(root, 'vibekit/product/entities.md'), [
    '<!-- generated by vibekit · do not edit · source: entities -->', '# Entities', '',
    '## Booking', 'class: internal', '- `id` uuid', '',
  ].join('\n'));
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# Guardrails\n\n## Denied paths\n\n- vibekit/standards/  change control\n\n## Allowed commands\n\n- node\n- npm test\n');

  await vk(root, ['add', 'members can cancel a booking'], { home });
  await patch(join(root, `vibekit/product/requirements/${REQ}.md`), [
    [/^size:.*$/m, 'size: S'],
    [/^source:.*$/m, 'source: BRS-001 §2'],
    [/^entities:.*$/m, 'entities: [Booking]'],
    [/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  When a member cancels a confirmed booking, the system shall issue a refund.\n'],
  ]);
  await vk(root, ['req', 'ready', REQ], { home });
  // map.md is generated from specs/project.json, and every req command regenerates it, so the
  // commands go where a team puts them. They are the fixture's own, so verify has something real to run.
  const projectPath = join(root, 'specs/project.json');
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  project.commands = { ...(project.commands ?? {}), build: `"${process.execPath}" -e "process.exit(0)"`, test: `"${process.execPath}" --test tests/cancel.test.js` };
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  await vk(root, ['req', 'show', REQ], { home }); // regenerates map.md from the new commands
  await commitAll(root, 'scene: stage 5, one ready requirement');
  await vk(root, ['start', REQ, '--as', 'implementer', '--runner', runner], { home });
  return { root, home };
}

/**
 * The implementer, one step at a time. Each step ends with a checkpoint in §60's format, so a
 * session killed after any of them can be resumed from `next:` alone. `breakAt` makes step 2 stop
 * half-way through writing a file and wait to be killed — the mid-edit case, where the worktree is
 * ahead of the checkpoint and the resumed session has to notice.
 */
export async function implement(root, { home, from = 1, runner = 'claude-code', report = () => {}, breakAt = null }) {
  const checkpoint = (step, values) => vk(root, [
    'req', 'checkpoint', REQ,
    '--done', values.done, '--in-hand', values.inHand, '--next', values.next,
    '--read', `standards/*, ${REQ}, entities#Booking`,
    '--step', String(step), '--of', String(STEPS), '--runner', runner,
  ], { home });

  for (let step = from; step <= STEPS; step += 1) {
    if (step === 1) {
      await vk(root, ['req', 'show', REQ], { home });
      await checkpoint(1, { done: 'read the requirement, the standards and the Booking entity', inHand: 'nothing written yet', next: 'write src/cancel.js for AC-1' });
    }
    if (step === 2) {
      await mkdir(join(root, 'src'), { recursive: true });
      if (breakAt === 2) {
        await writeFile(join(root, 'src/cancel.js'), CANCEL.slice(0, Math.floor(CANCEL.length / 2)));
        report('mid-edit', 2);
        await new Promise(() => {}); // waits to be killed; a real crash does not tidy up either
      }
      await writeFile(join(root, 'src/cancel.js'), CANCEL);
      await checkpoint(2, { done: 'src/cancel.js written, the AC-1 handler', inHand: 'src/cancel.js, uncommitted', next: 'write tests/cancel.test.js naming AC-1' });
    }
    if (step === 3) {
      await mkdir(join(root, 'tests'), { recursive: true });
      await writeFile(join(root, 'tests/cancel.test.js'), TEST);
      await checkpoint(3, { done: 'src/cancel.js and tests/cancel.test.js written', inHand: 'both files, uncommitted', next: 'commit on req/REQ-001 and run vibekit verify' });
    }
    if (step === 4) {
      await checkpoint(4, { done: 'handler and test written and committed', inHand: 'nothing uncommitted', next: 'set REQ-001 tested' });
      await git(root, 'checkout', '-q', '-B', `req/${REQ}`);
      await commitAll(root, `feat(${REQ}): cancel a confirmed booking and refund (AC-1)\n\nVibeKit-Requirement: ${REQ}`);
      await vk(root, ['verify'], { home });
    }
    if (step === 5) {
      await vk(root, ['req', 'tested', REQ, '--as', 'implementer', '--runner', runner], { home });
    }
    report('step', step);
  }
}

/** The step a resumed session starts from, read from nothing but the checkpoint's `next:` line. */
export function stepFromCheckpoint(text) {
  const next = String(text ?? '').match(/^next:\s*(.+)$/m)?.[1] ?? '';
  if (/write src\/cancel/.test(next)) return 2;
  if (/write tests/.test(next)) return 3;
  if (/commit .*verify/.test(next)) return 4;
  if (/set REQ-001 tested/.test(next)) return 5;
  return null;
}

/** The evidence with the parts that legitimately differ between runs removed: sha, date, seconds. */
export function normaliseEvidence(requirementText) {
  const block = String(requirementText ?? '').match(/^## Evidence\n([\s\S]*?)(?=\n## |(?![\s\S]))/m)?.[1] ?? '';
  return block.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+\w+\s+`/.test(line))
    .map((line) => line.replace(/\s+\d+s$/, ''))
    .join('\n');
}

const statusOf = (text) => String(text ?? '').match(/^status:\s*(\S+)/m)?.[1] ?? null;

/**
 * Run the implementer in a child and kill it. `killAt` is the step it must not reach: the child is
 * killed the moment the previous step reports done (or, for the mid-edit variant, half-way through
 * step 2). Resolves with what was seen, never rejects — being killed is the expected outcome.
 */
function runAndKill(root, { home, killAt, breakAt = null, runner }) {
  return new Promise((done) => {
    const args = [SELF, '--implement', root, '--home', home, '--runner', runner, ...(breakAt ? ['--break-at', String(breakAt)] : [])];
    const child = spawn(process.execPath, args, { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let seen = '';
    let killed = false;
    const kill = () => { if (!killed) { killed = true; child.kill('SIGKILL'); } };
    child.stdout.on('data', (chunk) => {
      seen += chunk;
      if (breakAt && /^mid-edit/m.test(seen)) kill();
      if (!breakAt && new RegExp(`^step ${killAt - 1}$`, 'm').test(seen)) kill();
    });
    child.stderr.on('data', (chunk) => { seen += chunk; });
    child.on('close', () => done({ killed, seen }));
    setTimeout(kill, 120_000).unref();
  });
}

const pick = (random, low, high) => low + Math.floor(random() * (high - low + 1));

/** A small deterministic generator, so a failing run can be repeated with `--seed`. */
export function seeded(seed) {
  let state = (Number(seed) >>> 0) || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  // The first draws of a linear generator barely depend on a small seed — seeds 1, 2 and 3 would
  // all kill at the same step. A few discarded draws spread them out.
  for (let warm = 0; warm < 4; warm += 1) next();
  return next;
}

/**
 * One variant, end to end. Returns what a CI line needs: did it reach tested, does the evidence
 * match the straight run, where did it stop, what did the resume say.
 */
export async function runVariant(variant, { straight, seed, log = () => {} }) {
  const random = seeded(seed);
  const runnerA = 'claude-code';
  const runnerB = variant === 'other-runner' ? 'cursor' : runnerA;
  const { root, home } = await fixture({ runner: runnerA });
  const started = Date.now();
  try {
    const killAt = variant === 'mid-edit' ? 2 : pick(random, 2, STEPS);
    const first = await runAndKill(root, { home, killAt, runner: runnerA, breakAt: variant === 'mid-edit' ? 2 : null });
    if (!first.killed) throw new Error(`the session was never killed; it printed: ${first.seen.slice(0, 200)}`);

    // What the next session does: `vibekit sprint run` on an in-progress requirement loads the checkpoint
    // first (§60), and `req checkpoint` with no arguments prints it. `resume` is the other case —
    // a project somebody paused — and is not what a crash needs.
    const next = await vk(root, ['next'], { home, expect: 'any' });
    if (!next.includes(REQ)) throw new Error(`vibekit sprint run does not mention ${REQ}: ${next.slice(0, 200)}`);
    const checkpoint = await vk(root, ['req', 'checkpoint', REQ], { home });
    const from = stepFromCheckpoint(checkpoint);
    if (!from) throw new Error(`the checkpoint names no next step this fixture knows: ${checkpoint.slice(0, 200)}`);

    if (variant === 'other-runner') {
      // §60: "Hold times out → unhold; the next holder starts from the checkpoint and the worktree,
      // and the log says who held it before."
      await vk(root, ['unhold', REQ], { home });
      await vk(root, ['start', REQ, '--as', 'implementer', '--runner', runnerB], { home });
    }
    await implement(root, { home, from, runner: runnerB });

    const requirement = await readFile(join(root, `vibekit/product/requirements/${REQ}.md`), 'utf8');
    const evidence = normaliseEvidence(requirement);
    const result = {
      variant,
      killAt,
      resumedFrom: from,
      tested: statusOf(requirement) === 'tested',
      evidenceMatches: evidence === straight,
      evidence,
      runnerRecorded: variant !== 'other-runner' || /cursor/.test(requirement),
      seconds: Math.round((Date.now() - started) / 1000),
    };
    result.ok = result.tested && result.evidenceMatches && result.runnerRecorded;
    log(`${result.ok ? '✔' : '✖'} ${variant}: killed before step ${killAt}, resumed at ${from}, ${result.tested ? 'tested' : `not tested (${statusOf(requirement)})`}${result.evidenceMatches ? '' : ', evidence differs'}${result.runnerRecorded ? '' : ', runner change not in the log'} · ${result.seconds}s`);
    return result;
  } catch (error) {
    log(`✖ ${variant}: ${error.message}`);
    return { variant, ok: false, error: error.message, seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

/** The straight run: no kill, the evidence every variant is held to. */
export async function straightRun({ log = () => {} } = {}) {
  const { root, home } = await fixture();
  try {
    await implement(root, { home });
    const requirement = await readFile(join(root, `vibekit/product/requirements/${REQ}.md`), 'utf8');
    if (statusOf(requirement) !== 'tested') throw new Error(`the straight run did not reach tested (${statusOf(requirement)}); nothing to hold the variants to`);
    const evidence = normaliseEvidence(requirement);
    if (!evidence) throw new Error('the straight run recorded no evidence');
    log(`✔ straight run: tested, ${evidence.split('\n').length} suite line(s)`);
    return evidence;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runRecovery({ seed = Date.now() % 100_000, variants = VARIANTS, log = () => {} } = {}) {
  log(`recovery fixture · seed ${seed}`);
  const straight = await straightRun({ log });
  const results = [];
  for (const [index, variant] of variants.entries()) results.push(await runVariant(variant, { straight, seed: seed + index, log }));
  const ok = results.every((result) => result.ok);
  log(ok ? `✔ ${results.length} variant(s) recovered to tested with matching evidence` : `✖ ${results.filter((result) => !result.ok).length} variant(s) failed · repeat with --seed ${seed}`);
  return { ok, seed, results };
}
