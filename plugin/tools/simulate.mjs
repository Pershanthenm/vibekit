/**
 * An end-to-end simulation of a team using VibeKit.  `npm run simulate`
 *
 * It drives the real binary the way a person would, in the order the workflow prescribes, and
 * asserts what should be true after each step. Nothing here imports a module: every assertion is
 * about what somebody at a terminal would see, so anything it finds is a bug a user would hit.
 *
 * Six walks, and each exists because the others do not cover it:
 *
 *   * **greenfield** — the whole loop on a new project, brief to release.
 *   * **brownfield** — §58's front door on a repo that already exists, including the read-only
 *     guarantee and the drafting of requirements from its tests.
 *   * **release** — tag, smoke, rollback, revert, and what each does to the spec.
 *   * **adversarial** — the rules being broken, every writer run twice, a generated file edited
 *     by hand, and an agent asked to close its own work.
 *   * **misbehavingAgent** — a scripted implementer at stage 5 doing every wrong thing a real one
 *     does, through MCP and the CLI: each must be refused mechanically, not discouraged in a prompt.
 *   * **hostile** — the attack surface attacked through the binary: traversal and chained commands
 *     over MCP stdio, ids and refs that are really paths or options, private and metadata addresses
 *     handed to the two commands that fetch, an unverified dependency, file modes, and dry runs that
 *     must leave no listener behind.
 *
 * The unit suite proves each piece in isolation. This proves they compose, which is where the
 * bugs that survive a green suite actually live: four of the five it has caught so far were two
 * correct modules disagreeing about one file.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import net from 'node:net';

const exec = promisify(execFile);
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/vibekit', import.meta.url));

const failures = [];
const notes = [];
const passed = [];
let step = 0;
let walkName = '';

async function vk(root, args, { expect = 0, home } = {}) {
  const label = `vibekit ${args.join(' ')}`;
  try {
    const { stdout, stderr } = await exec(process.execPath, [BIN, ...args], {
      cwd: root,
      env: { ...process.env, VIBEKIT_HOME: home, VIBEKIT_NO_OPEN: '1', CI: 'true' },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    if (expect !== 0 && expect !== 'any') failures.push({ step, label, why: `expected exit ${expect}, got 0` });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    const code = error.code ?? 1;
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (error.killed) failures.push({ step, label, why: 'timed out — it never returned' });
    else if (expect === 'any') { /* the caller only cares that it did not crash */ }
    else if (code !== expect) failures.push({ step, label, why: `exit ${code}: ${out.trim().split('\n')[0]}` });
    return { code, out };
  }
}

const check = (ok, what, detail = '') => {
  if (!ok) failures.push({ step, label: what, why: detail || 'assertion failed' });
  else passed.push({ walk: walkName, step, what });
};

const has = (text, pattern, what) => check(new RegExp(pattern, 'm').test(text), what, `output did not match /${pattern}/`);

async function patch(path, edits) {
  let text = await readFile(path, 'utf8');
  for (const [from, to] of edits) {
    if (from instanceof RegExp) text = text.replace(from, to);
    else if (!text.includes(from)) failures.push({ step, label: `patch ${path}`, why: `no "${String(from).slice(0, 40)}"` });
    else text = text.split(from).join(to);
  }
  await writeFile(path, text);
}

const git = (root, ...args) => exec('git', args, { cwd: root }).catch(() => ({ stdout: '' }));

// The walks commit by hand on main to set a scene, which is exactly what the §50 commit-msg hook
// that `init` installs refuses. --no-verify is git's own way past it and the one the hook names;
// the hook itself is exercised directly in the hostile walk, where the refusal is the assertion.
const commit = (root, message) => git(root, 'commit', '-q', '--no-verify', '-m', message);

/** Is anything listening on a local port? Portable: lsof is not on every machine, net.connect is. */
const listening = (port) => new Promise((done) => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
  socket.setTimeout(1500, () => { socket.destroy(); done(false); });
});

// ────────────────────────────────────────────────────────────── the greenfield walk

async function greenfield() {
  const root = await mkdtemp(join(tmpdir(), 'sim-green-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');

  step = 1;
  await vk(root, ['init', '--yes'], { home });
  check((await readFile(join(root, 'vibekit/profile.md'), 'utf8')).includes('budget-cap'), 'init writes profile.md');

  step = 2;
  await writeFile(join(root, 'brs.md'), [
    '# Gym bookings, version 2', '',
    '1 Scope',
    'This document covers class bookings for members and staff at all branches.', '',
    '4.2 Cancellation',
    'A member shall be able to cancel a confirmed booking.',
    'The system must issue a refund within 24 hours of cancellation.',
    'Cancellation shall not be permitted within two hours of the class.', '',
    '4.3 Refunds',
    'The system will refund through the original payment provider.',
    'Queries go to ops@gym.example.com or call (011) 555 9999.', '',
  ].join('\n'));

  const dry = await vk(root, ['ingest', 'brs.md'], { home });
  has(dry.out, 'Nothing has been written', 'ingest holds back until the redaction is seen');

  const ingested = await vk(root, ['ingest', 'brs.md', '--yes'], { home });
  has(ingested.out, '3 section\\(s\\)', 'ingest splits on the document numbering');
  const source = await readFile(join(root, 'vibekit/product/sources/BRS-001/source.md'), 'utf8');
  check(!source.includes('ops@gym.example.com'), 'the email is redacted in the folder');
  check(!source.includes('555 9999'), 'the phone number is redacted in the folder');

  step = 3;
  await vk(root, ['clarify', 'brs.md'], { home });

  step = 4;
  await writeFile(join(root, 'vibekit/product/entities.md'), [
    '<!-- generated by vibekit · do not edit · source: entities -->',
    '# Entities', '',
    'These are the only valid entity and field names.', '',
    '## Booking',
    'class: internal',
    '- `id` uuid',
    '- `status` string',
    '',
  ].join('\n'));
  await vk(root, ['add', 'members can cancel a confirmed booking'], { home });
  const requirement = join(root, 'vibekit/product/requirements/REQ-001.md');
  await patch(requirement, [
    [/^size:.*$/m, 'size: M'],
    [/^source:.*$/m, 'source: BRS-001 §4.2'],
    [/^entities:.*$/m, 'entities: [Booking]'],
    [/^assumes:.*$/m, 'assumes: [A-001]'],
    [/## Acceptance\n[\s\S]*?(?=\n## )/, [
      '## Acceptance', '',
      '- AC-1  When a member cancels a confirmed booking, the system shall issue a refund.',
      '- AC-2  If the class starts within two hours, then the system shall refuse the cancellation.',
      '',
    ].join('\n')],
    [/## Security\n[\s\S]*?(?=\n## )/, '## Security\n\nTouches Booking only; no classified data crosses a boundary.\n'],
  ]);
  await writeFile(join(root, 'vibekit/workflow/assumptions.md'),
    '# Assumptions\n\n- A-001 Refunds go back to the original card · confidence: low\n');

  const why = await vk(root, ['req', 'why', 'REQ-001'], { home, expect: 'any' });
  notes.push(`req why: ${why.out.trim().split('\n').slice(0, 2).join(' / ')}`);

  step = 5;
  const ready = await vk(root, ['req', 'ready', 'REQ-001'], { home });
  has(ready.out, 'ready', 'a complete requirement reaches ready');

  step = 6;
  const started = await vk(root, ['start', 'REQ-001', '--as', 'implementer'], { home });
  has(started.out, 'held by implementer', 'start claims it');

  const cp = await vk(root, ['req', 'checkpoint', '--done', 'AC-1 test written and failing',
    '--in-hand', 'CancelBooking.cs, half wired', '--next', 'implement the refund call',
    '--step', '2', '--of', '6'], { home });
  has(cp.out, 'checkpoint replaced', 'a checkpoint is written');

  const next = await vk(root, ['next'], { home });
  has(next.out, 'Resuming REQ-001', 'next hands back the checkpoint');

  step = 7;
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/CancelBooking.cs'), 'class CancelBooking { void Handle() { } }\n');
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'tests/CancelBooking.Tests.cs'), '[Fact] public void Cancel_Confirmed_IssuesRefund() { }\n');

  await patch(requirement, [
    [/## Approach\n[\s\S]*?(?=\n## )/, '## Approach\n\n- src/CancelBooking.cs — the handler\n'],
    [/## Verification\n[\s\S]*?(?=\n## )/, '## Verification\n\n- AC-1 — tests/CancelBooking.Tests.cs\n- AC-2 — tests/CancelBooking.Tests.cs\n'],
    [/## Review\n[\s\S]*?(?=\n## |$)/, '## Review\n\nApproved. Both criteria are covered by named tests.\n'],
  ]);

  // Evidence comes from `verify` running the commands in map.md, never from a hand-written block.
  // The test command is set to something that passes, the way a real project's would.
  await patch(join(root, 'vibekit/product/map.md'), [[/^build\s{2,}.*$/m, `build     "${process.execPath}" -e "process.exit(0)"`], [/^test\s{2,}.*$/m, `test      "${process.execPath}" -e "process.exit(0)"`]]);
  await git(root, 'add', '-A');
  await commit(root, 'feat(REQ-001): handler and tests');
  const verified = await vk(root, ['verify'], { home });
  has(verified.out, 'Evidence written to REQ-001', 'verify records evidence into the requirement');
  const withEvidence = await readFile(requirement, 'utf8');
  has(withEvidence, '^## Evidence', 'the block is in the file');
  has(withEvidence, 'exit 0', 'with a captured exit code');

  const tested = await vk(root, ['req', 'tested', 'REQ-001', '--as', 'implementer'], { home });
  has(tested.out, 'tested', 'tested goes through on green evidence for HEAD');
  await vk(root, ['req', 'release', 'REQ-001'], { home });
  const done = await vk(root, ['req', 'done', 'REQ-001'], { home });
  has(done.out, 'done', 'a human closes reviewed, tested work');

  step = 8;
  await git(root, 'add', '-A');
  await commit(root, 'feat(REQ-001): cancel issues a refund\n\nVibeKit-Requirement: REQ-001');

  const chain = await vk(root, ['why', 'src/CancelBooking.cs'], { home, expect: 'any' });
  has(chain.out, 'REQ-001', 'why finds the requirement');
  has(chain.out, 'BRS-001 §4\\.2', 'why reaches the source section');
  has(chain.out, 'low-confidence assumption', 'why reaches the assumption underneath');

  step = 9;
  for (const args of [['assumptions'], ['plan', '--cost'], ['report', '--all'], ['changelog'], ['spec'], ['arch-docs'], ['drift']]) {
    await vk(root, args, { home, expect: 'any' });
  }
  const trace = await vk(root, ['trace', '--matrix', '--all'], { home, expect: 'any' });
  has(trace.out, 'REQ-001', 'the matrix lists the requirement');

  step = 10;
  const checked = await vk(root, ['check'], { home, expect: 'any' });
  if (checked.code !== 0) notes.push(`check: ${checked.out.trim().split('\n').filter((l) => l.trim()).slice(0, 4).join(' / ')}`);

  step = 11;
  await git(root, 'add', '-A');
  await commit(root, 'docs: generated');
  const released = await vk(root, ['release'], { home, expect: 'any' });
  if (released.code === 0) has(released.out, 'v0\\.\\d+\\.\\d+', 'release picks a version');
  else notes.push(`release: ${released.out.trim().split('\n').slice(0, 3).join(' / ')}`);

  step = 12;
  await vk(root, ['evidence', 'REQ-001'], { home });
  await vk(root, ['pause', '--why', 'the weekend'], { home });
  const resumed = await vk(root, ['resume'], { home });
  has(resumed.out, 'Ground truth', 'resume re-establishes ground truth');

  step = 13;
  for (const args of [['tour'], ['tracker', '--dry-run'], ['serve', '--dry-run'], ['tools', 'policy'], ['tools', 'rates'], ['skills'], ['test-skills'], ['config'], ['upgrade-prompts'], ['distil'], ['dashboard', '--json']]) {
    await vk(root, args, { home, expect: 'any' });
  }

  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── the brownfield walk

async function brownfield() {
  const root = await mkdtemp(join(tmpdir(), 'sim-brown-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home2-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');

  step = 20;
  await writeFile(join(root, 'README.md'), '# Gymly\n\nGymly is a booking system for gyms.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'gymly', scripts: { build: 'tsc', test: 'vitest run' },
    dependencies: { stripe: '^14.0.0', zod: '^3.0.0' },
  }, null, 2));
  await mkdir(join(root, 'src/Domain'), { recursive: true });
  await writeFile(join(root, 'src/Domain/Member.ts'), 'export interface Member {\n  id: string;\n  email: string;\n  isDeleted: boolean;\n}\n');
  await writeFile(join(root, 'src/Domain/Payment.ts'), 'export interface Payment {\n  id: string;\n  amount: number;\n  cardLast4: string;\n}\n');
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'tests/bookings.test.ts'), 'describe("Bookings", () => { it("cancels a confirmed booking", () => {}); it("refuses when the class is full", () => {}); });\n');
  await writeFile(join(root, '.env'), 'STRIPE_KEY=sk_live_abcdefghijklmnop\n');
  await git(root, 'add', '-A');
  await commit(root, 'initial');

  step = 21;
  const understood = await vk(root, ['understand', '.'], { home });
  has(understood.out, 'booking system for gyms', 'understand reads the README');
  has(understood.out, 'Stripe', 'understand finds the integration');
  has(understood.out, 'Member \\(personal\\)', 'understand classifies from field names');
  has(understood.out, 'Stripe secret key is committed', 'understand finds the committed secret');

  const dirty = await git(root, 'status', '--porcelain');
  check(!/^ ?M/m.test(dirty.stdout), 'understand changed nothing it read', dirty.stdout.trim());

  step = 22;
  const converted = await vk(root, ['understand', '.', '--convert'], { home });
  has(converted.out, 'rules-only', 'convert generates no application code');
  const entities = await readFile(join(root, 'vibekit/product/entities.md'), 'utf8');
  has(entities, 'class: personal', 'the guessed classification lands in the folder');

  step = 23;
  const reversed = await vk(root, ['reverse'], { home });
  has(reversed.out, 'requirement\\(s\\) drafted', 'reverse drafts from the tests');
  const drafted = await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8');
  has(drafted, '^confidence: low$', 'a reversed requirement is low confidence');
  has(drafted, '\\n\\n## Out of scope', 'sections are separated');

  step = 24;
  const refresh = await vk(root, ['understand', '.', '--refresh'], { home });
  has(refresh.out, 'matches the understanding', 'nothing changed yet');

  await writeFile(join(root, 'src/Domain/Refund.ts'), 'export interface Refund { id: string; amount: number; }');
  const drifted = await vk(root, ['understand', '.', '--refresh'], { home });
  has(drifted.out, 'Refund is in the code', 'refresh spots a new entity');

  step = 25;
  await vk(root, ['check'], { home, expect: 'any' });
  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── the release and recovery walk

async function releaseWalk() {
  const root = await mkdtemp(join(tmpdir(), 'sim-rel-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home3-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');

  step = 30;
  await vk(root, ['init', '--yes'], { home });
  for (const [id, title] of [['REQ-001', 'first thing'], ['REQ-002', 'second thing']]) {
    await vk(root, ['add', title], { home });
    await patch(join(root, `vibekit/product/requirements/${id}.md`), [
      [/^size:.*$/m, 'size: M'],
      [/^status:.*$/m, 'status: done'],
      [/^phase:.*$/m, 'phase: 1'],
      [/^source:.*$/m, 'source: BRS-001 §1'],
    ]);
  }
  await patch(join(root, 'vibekit/product/requirements/REQ-002.md'), [[/^after:.*$/m, 'after: [REQ-001]']]);
  await git(root, 'add', '-A');
  await commit(root, 'feat: two requirements');

  step = 31;
  const cut = await vk(root, ['release'], { home });
  has(cut.out, 'v0\\.1\\.0', 'a minor release for size M work');
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  has(changelog, 'REQ-001', 'the changelog lists what shipped');
  has(changelog, 'BRS-001 §1', 'each line carries its source');
  const tags = await git(root, 'tag');
  check(tags.stdout.includes('v0.1.0'), 'the release is tagged');

  step = 32;
  const guarded = await vk(root, ['ship', 'smoke', '--url', 'http://127.0.0.1:9'], { home, expect: 1 });
  has(guarded.out, 'loopback.*--allow-private', 'a private smoke target is refused until the flag says it is the point');
  const smoke = await vk(root, ['ship', 'smoke', '--url', 'http://127.0.0.1:9', '--allow-private'], { home, expect: 1 });
  has(smoke.out, 'deploy problem', 'a red smoke names the deploy');
  has(smoke.out, 'ship rollback', 'and names the response');

  step = 33;
  const rolled = await vk(root, ['release', '--rollback', 'v0.1.0', '--why', 'smoke red'], { home });
  has(rolled.out, 'BUG-', 'a rollback opens a hotfix');

  step = 34;
  const reverted = await vk(root, ['revert', 'REQ-001', '--why', 'wrong card'], { home });
  has(reverted.out, 'back to ready', 'the reverted requirement reopens');
  has(reverted.out, 'REQ-002', 'and what stood on it goes to review');

  const list = await vk(root, ['req', 'list'], { home });
  has(list.out, 'REQ-002\\s+\\S*\\s*review', 'REQ-002 is in review');

  step = 35;
  await vk(root, ['report', '--all', '--out', join(root, 'reports.md')], { home });
  const reports = await readFile(join(root, 'reports.md'), 'utf8');
  check((reports.match(/^# \w+ report$/gm) ?? []).length === 3, 'all three reports are written');

  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── the adversarial walk

/**
 * The things a real team does that a happy path never covers: breaking the rules, running the
 * same command twice, editing a generated file, and asking the tool to close its own work.
 */
async function adversarial() {
  const root = await mkdtemp(join(tmpdir(), 'sim-adv-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home4-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');
  await vk(root, ['init', '--yes'], { home });

  step = 40;
  // An agent may never close its own work (§12).
  await vk(root, ['add', 'a thing'], { home });
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await patch(path, [
    [/^size:.*$/m, 'size: S'],
    [/^source:.*$/m, 'source: product/context.md'],
    [/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  The system shall record a thing.\n'],
  ]);
  await vk(root, ['req', 'ready', 'REQ-001'], { home });
  const asAgent = await vk(root, ['req', 'done', 'REQ-001', '--as', 'implementer'], { home, expect: 1 });
  has(asAgent.out, 'cannot set', 'an agent is refused done');

  step = 41;
  // A second start on a held requirement is refused, so work stays attributable (§27).
  await vk(root, ['start', 'REQ-001', '--as', 'implementer'], { home });
  const twice = await vk(root, ['start', 'REQ-001', '--as', 'implementer'], { home, expect: 1 });
  has(twice.out, 'already', 'a second start is refused');

  step = 42;
  // A criterion that cannot become a test is refused rather than accepted (§49).
  await vk(root, ['add', 'something vague'], { home });
  await patch(join(root, 'vibekit/product/requirements/REQ-002.md'), [
    [/^size:.*$/m, 'size: S'],
    [/^source:.*$/m, 'source: product/context.md'],
    [/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  The system shall be fast.\n'],
  ]);
  const vague = await vk(root, ['req', 'ready', 'REQ-002'], { home, expect: 1 });
  has(vague.out, 'observable', 'an unobservable criterion is refused');

  step = 43;
  // A generated file edited by hand is reported as drift, not silently rewritten (§3).
  await writeFile(join(root, 'vibekit/product/map.md'), '# Map\n\nI rewrote this by hand.\n');
  const drifted = await vk(root, ['check'], { home, expect: 'any' });
  has(drifted.out, 'map\\.md', 'a hand-edited generated file is reported');
  await vk(root, ['init'], { home });

  step = 44;
  // Asks: raised, listed, answered, and the answer recorded append-only (§12).
  await vk(root, ['ask', 'Do refunds go to the original card?', '--plain', 'If we refund someone, where does the money go?', '--blocking'], { home });
  const listed = await vk(root, ['ask', 'list'], { home });
  has(listed.out, 'Q-001', 'the ask is listed');
  await vk(root, ['ask', 'answer', 'Q-001', 'Back to the original card, always.'], { home });
  const answers = await readFile(join(root, 'vibekit/workflow/answers/general-answers.md'), 'utf8').catch(() => '');
  has(answers, 'original card', 'the answer is recorded outside the ask too');

  step = 45;
  // Idempotency: every read-only command twice, and every writer twice, with no duplication.
  const before = await vk(root, ['req', 'list'], { home });
  for (const args of [['reverse'], ['distil'], ['spec'], ['arch-docs'], ['report', '--all'], ['assumptions'], ['plan', '--cost']]) {
    await vk(root, args, { home, expect: 'any' });
    await vk(root, args, { home, expect: 'any' });
  }
  const after = await vk(root, ['req', 'list'], { home });
  check(before.out.split('\n').length === after.out.split('\n').length,
    'running the writers twice does not duplicate requirements',
    `${before.out.split('\n').length} → ${after.out.split('\n').length}`);

  const asksAfter = await vk(root, ['ask', 'list'], { home });
  const proposals = (asksAfter.out.match(/P-\d+/g) ?? []).length;
  const unique = new Set(asksAfter.out.match(/P-\d+/g) ?? []).size;
  check(proposals === unique, 'distil twice does not raise the same proposal twice', `${proposals} vs ${unique}`);

  step = 46;
  // Ingest the same document twice: only changed sections ask (§31).
  await writeFile(join(root, 'brs.md'), '1 Scope\nA thing.\n\n2 Detail\nThe system shall do a thing.\n');
  await vk(root, ['ingest', 'brs.md', '--yes'], { home });
  const asksA = (await vk(root, ['ask', 'list'], { home })).out;
  await vk(root, ['ingest', 'brs.md', '--yes', '--id', 'BRS-001'], { home });
  const asksB = (await vk(root, ['ask', 'list'], { home })).out;
  check(asksA.split('\n').length === asksB.split('\n').length, 're-ingesting an unchanged document asks nothing new');

  await writeFile(join(root, 'brs.md'), '1 Scope\nA thing.\n\n2 Detail\nThe system shall do a different thing.\n');
  await vk(root, ['ingest', 'brs.md', '--yes', '--id', 'BRS-001'], { home });
  const asksC = (await vk(root, ['ask', 'list'], { home })).out;
  check(asksC.split('\n').length > asksB.split('\n').length, 'a changed section does ask');

  step = 47;
  // A skill imported, tested and promoted; the untested one is refused promotion (§56).
  await mkdir(join(root, '.claude/skills/tenant'), { recursive: true });
  await writeFile(join(root, '.claude/skills/tenant/SKILL.md'),
    '---\nname: tenant-scoping\ndescription: Scope every booking query by tenant identifier\n---\n\nAlways filter by TenantId.\n');
  await vk(root, ['skills', 'import', '.claude/skills/tenant'], { home });
  const skills = await vk(root, ['skills'], { home });
  has(skills.out, 'tenant-scoping', 'the imported skill is listed');
  has(skills.out, 'NO TEST', 'and reported as untested');

  const refused = await vk(root, ['skills', 'promote', 'tenant-scoping', '--to', 'team'], { home, expect: 1 });
  has(refused.out, 'regresses', 'an untested skill cannot be promoted');

  await writeFile(join(root, 'vibekit/skills/lib/tenant-scoping.test.md'), [
    '---', 'skill: tenant-scoping',
    'triggers-on: ["scope the booking query by tenant"]',
    'must-not-trigger-on: ["rename a column"]', '---', '',
  ].join('\n'));
  await vk(root, ['test-skills'], { home, expect: 'any' });

  step = 48;
  // The guardrail refusal a server enforces (§22), checked through the same module the CLI uses.
  await writeFile(join(root, 'vibekit/standards/guardrails.md'),
    '# Guardrails\n\n## Denied paths\n\n- infra/  the platform team owns this\n\n## Allowed commands\n\n- dotnet build\n- dotnet test\n');
  const served = await vk(root, ['serve', '--json'], { home, expect: 'any' });
  check(served.code === 0, 'serve reports without starting anything');

  step = 49;
  // Recovery: pause with an unusable checkpoint, then resume and be told to reconcile.
  await vk(root, ['pause', '--why', 'a budget freeze'], { home });
  const resumed = await vk(root, ['resume'], { home });
  has(resumed.out, 'Paused work', 'resume lists the paused work');
  has(resumed.out, 'checkpoint', 'and says what it will do about each checkpoint');

  step = 50;
  // A Spec Kit repository, imported.
  const sk = await mkdtemp(join(tmpdir(), 'sim-sk-'));
  await mkdir(join(sk, 'memory'), { recursive: true });
  await mkdir(join(sk, 'specs/001-thing'), { recursive: true });
  await writeFile(join(sk, 'memory/constitution.md'), '# Constitution\n\n## Principles\n\n- Tests first\n');
  await writeFile(join(sk, 'specs/001-thing/spec.md'),
    '# Thing\n\nIt does a thing.\n\n## Acceptance Criteria\n\n- The system shall do a thing\n- It should feel nice\n');
  const imported = await vk(sk, ['init', '--from-speckit'], { home });
  has(imported.out, 'cannot answer', 'the conversion reports what it cannot answer');
  has(imported.out, 'feel nice', 'an unusable criterion becomes a question');

  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── the hostile walk

/**
 * The attack surface, attacked through the binary. The unit tests do this to the modules; this
 * does it the way an adversarial client or a careless script would, over stdio and the CLI.
 */
async function hostile() {
  const root = await mkdtemp(join(tmpdir(), 'sim-hostile-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home5-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');
  await vk(root, ['init', '--yes'], { home });
  await git(root, 'add', '-A');
  await commit(root, 'base');
  const secret = join(tmpdir(), `sim-secret-${Date.now()}.txt`);
  await writeFile(secret, 'TOP SECRET');
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# G\n\n## Allowed commands\n\n- dotnet test\n');

  step = 60;
  // The MCP server, driven over stdio as a client would.
  const rpc = (id, name, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const lines = [
    rpc(1, 'vibekit_load', { path: '../' + secret.split('/').pop() }),
    rpc(2, 'vibekit_load', { path: secret }),
    rpc(3, 'vibekit_load', { path: '.git/config' }),
    rpc(4, 'vibekit_run', { command: 'dotnet test; rm -rf /' }),
    rpc(5, 'vibekit_run', { command: 'dotnet testx' }),
    rpc(6, 'vibekit_run', { command: 'curl http://evil.example' }),
  ].join('\n') + '\n';

  const served = await new Promise((done) => {
    const child = execFile(process.execPath, [BIN, 'serve', '--stdio', '--dir', root], {
      env: { ...process.env, VIBEKIT_HOME: home, VIBEKIT_NO_OPEN: '1' }, timeout: 30_000,
    }, (error, stdout) => done(stdout ?? ''));
    child.stdin.end(lines);
  });
  const replies = served.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  check(replies.length === 6, 'the server answered every message', `${replies.length} replies`);
  for (const reply of replies) {
    check(reply.result?.isError === true, `rpc ${reply.id} was refused`, JSON.stringify(reply.result?.content?.[0]?.text ?? reply).slice(0, 120));
  }
  check(!served.includes('TOP SECRET'), 'no secret crossed the server');

  step = 61;
  // Ids and refs that are really paths or options.
  await writeFile(join(root, 'brs.md'), '1 Scope\nA thing.\n');
  const badId = await vk(root, ['ingest', 'brs.md', '--yes', '--id', '../../escape'], { home, expect: 1 });
  has(badId.out, 'not a source id', 'an id that is a path is refused');
  await vk(root, ['why', 'README.md', '--at', '--output=/tmp/pwned'], { home, expect: 1 });
  await vk(root, ['spec', '--at', '-x'], { home, expect: 1 });
  await vk(root, ['release', '--rollback', '--force'], { home, expect: 'any' });
  const badVersion = await vk(root, ['release', 'v1 --force', '--force'], { home, expect: 1 });
  has(badVersion.out, 'not a version', 'a version that is not a version is refused');

  step = 62;
  // The redaction mapping and the settings file must not be world-readable.
  await vk(root, ['ingest', 'brs.md', '--yes'], { home });
  await vk(root, ['config', 'tunnel-token', 'cf-secret'], { home });
  if (process.platform !== 'win32') {
    const { stat } = await import('node:fs/promises');
    const settings = await stat(join(home, 'config.json')).catch(() => null);
    check(settings && (settings.mode & 0o077) === 0, 'config.json is owner-only', settings ? (settings.mode & 0o777).toString(8) : 'missing');
  }

  step = 62.5;
  // The network's inside is not a target, whichever command is asked to reach it.
  const meta = await vk(root, ['ship', 'smoke', '--url', 'http://169.254.169.254/latest/meta-data/'], { home, expect: 1 });
  has(meta.out, 'metadata', 'the cloud metadata address is refused by name');
  const brand = await vk(root, ['arch-docs', '--brand', 'http://10.0.0.5/', '--docs', 'docs-brand-probe'], { home, expect: 'any' });
  has(brand.out, '10\\.0\\.0\\.0/8', 'a brand fetch of a private address is refused');

  // A dependency nobody looked up is an error the build can fail on.
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { unrecorded: '1.0.0' } }));
  const deps = await vk(root, ['check', '--deps', '--offline'], { home, expect: 1 });
  has(deps.out, 'unrecorded.*Nobody verified it', 'an unverified dependency is reported');
  has(deps.out, 'not checked:', 'and offline says what it did not look up');

  // --sandbox is a decision: without a runtime the session is refused, never quietly unsandboxed.
  // No --stdio here: with docker present that starts a server and never returns.
  const boxed = await vk(root, ['serve', '--sandbox'], { home, expect: 'any' });
  check(boxed.code !== 0 || /sandbox/i.test(boxed.out), 'serve --sandbox does not silently run unsandboxed', boxed.out.slice(0, 120));

  step = 63;
  // The dry-run servers must not bind anything: a scripted sweep that leaves a listener behind is
  // a listener nobody knows about.
  // The default ports are the only ones a dry run could have bound; anything already listening
  // there belongs to somebody else and is not counted against it.
  const PORTS = [7332, 7333, 7340];
  const before = await Promise.all(PORTS.map(listening));
  await vk(root, ['tracker', '--dry-run'], { home });
  await vk(root, ['serve', '--tracker', '--dry-run'], { home });
  const after = await Promise.all(PORTS.map(listening));
  check(PORTS.every((port, index) => before[index] || !after[index]), 'a dry run leaves no listener behind', `ports now listening: ${PORTS.filter((port, index) => !before[index] && after[index]).join(', ')}`);

  step = 64;
  // §50 — the hooks init installed, called the way git calls them. A commit straight onto main is
  // refused; one on a req/ branch without the trailer is refused; a staged key never lands.
  await writeFile(join(root, '.git/COMMIT_EDITMSG'), 'tidy up\n');
  const onMain = await vk(root, ['githook', 'commit-msg', '.git/COMMIT_EDITMSG'], { home, expect: 1 });
  has(onMain.out, 'straight onto main is refused', 'the commit-msg hook refuses a commit on main');
  await git(root, 'checkout', '-q', '-b', 'req/REQ-001');
  const noTrailer = await vk(root, ['githook', 'commit-msg', '.git/COMMIT_EDITMSG'], { home, expect: 1 });
  has(noTrailer.out, 'VibeKit-Requirement', 'and one on req/ without the trailer');
  await writeFile(join(root, '.git/COMMIT_EDITMSG'), 'feat(REQ-001): cancel\n\nVibeKit-Requirement: REQ-001\n');
  await vk(root, ['githook', 'commit-msg', '.git/COMMIT_EDITMSG'], { home });
  await writeFile(join(root, 'settings.json'), '{ "key": "sk_live_4eC39HqLyjWDarjtT1zdp7dc" }\n');
  await git(root, 'add', 'settings.json');
  const key = await vk(root, ['githook', 'pre-commit'], { home, expect: 1 });
  has(key.out, 'live credential', 'the pre-commit hook stops a staged key');
  await git(root, 'reset', '-q', 'settings.json');
  await git(root, 'checkout', '-q', 'main');

  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── the misbehaving agent

/**
 * The claim the whole tool rests on, tested: coding agents are fast and they guess, and the
 * folder catches the guesses. This is a scripted implementer at stage 5 doing every wrong thing a
 * real one does — reading past its manifest, inventing an entity, editing the standards, skipping
 * the test it cannot pass, claiming done — through the MCP server and the CLI, exactly as a
 * runner would. Every one has to be refused mechanically, not discouraged in a prompt.
 */
async function misbehavingAgent() {
  const root = await mkdtemp(join(tmpdir(), 'sim-agent-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home6-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');
  await vk(root, ['init', '--yes'], { home });

  step = 70;
  // Walk the project to stage 5 the way a team does: a source, reviewed assumptions, approved
  // architecture and plan. The design stage is skipped because there is no front end.
  await writeFile(join(root, 'brs.md'), '1 Scope\nGym bookings.\n\n2 Cancellation\nA member shall cancel a booking.\n');
  await vk(root, ['ingest', 'brs.md', '--yes'], { home });
  await writeFile(join(root, 'vibekit/workflow/assumptions.md'), '# Assumptions\n\nreviewed: 2026-09-24 by Grace Hopper\n\n- A-001 Refunds go to the original card · confidence: medium\n');
  const arch = join(root, 'vibekit/workflow/architecture.md');
  await patch(arch, [[/^approved:.*$/m, 'approved: 2026-09-24 by Grace Hopper'], [/^api:.*$/m, 'api: none']]);
  const plan = join(root, 'vibekit/workflow/plan.md');
  await writeFile(plan, `approved: 2026-09-24 by Ada Lovelace\n\n${await readFile(plan, 'utf8')}`);
  await writeFile(join(root, 'vibekit/product/entities.md'), [
    '<!-- generated by vibekit · do not edit · source: entities -->', '# Entities', '',
    '## Booking', 'class: internal', '- `id` uuid', '',
  ].join('\n'));
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# Guardrails\n\n## Denied paths\n\n- infra/  the platform team owns this\n\n## Allowed commands\n\n- dotnet test\n- dotnet build\n');

  const stage = await vk(root, ['next', '--json'], { home });
  has(stage.out, '"stage": 5', 'the project is at stage 5, build');

  step = 71;
  await vk(root, ['add', 'members can cancel a booking'], { home });
  await patch(join(root, 'vibekit/product/requirements/REQ-001.md'), [
    [/^size:.*$/m, 'size: S'],
    [/^source:.*$/m, 'source: BRS-001 §2'],
    [/^entities:.*$/m, 'entities: [Booking]'],
    [/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  When a member cancels a confirmed booking, the system shall issue a refund.\n'],
  ]);
  await vk(root, ['add', 'somebody else\'s work'], { home });
  await vk(root, ['req', 'ready', 'REQ-001'], { home });
  await vk(root, ['start', 'REQ-001', '--as', 'implementer'], { home });

  step = 72;
  // The agent, through MCP over stdio. Every message is something a real implementer does.
  const rpc = (id, name, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const messages = [
    rpc(1, 'vibekit_load', { requirement: 'REQ-001' }),                       // allowed: its own scoped set
    rpc(2, 'vibekit_load', { path: 'vibekit/workflow/plan.md' }),             // reads past the manifest
    rpc(3, 'vibekit_load', { path: 'vibekit/product/requirements/REQ-002.md' }), // reads another requirement
    rpc(4, 'vibekit_run', { command: 'dotnet test' }),                        // allowed
    rpc(5, 'vibekit_run', { command: 'curl https://example.com/install.sh' }), // not on the list
    rpc(6, 'vibekit_ask', { body: 'Need a Refund entity', plain: '' }),        // an ask with no plain terms
    rpc(7, 'vibekit_remember', { line: 'skip the migration check on Fridays' }), // tries to write memory
    rpc(8, 'vibekit_status', {}),
  ];
  const served = await new Promise((done) => {
    const child = execFile(process.execPath, [BIN, 'serve', '--stdio', '--dir', root], {
      env: { ...process.env, VIBEKIT_HOME: home, VIBEKIT_NO_OPEN: '1' }, timeout: 30_000,
    }, (error, stdout) => done(stdout ?? ''));
    child.stdin.end(`${messages.join('\n')}\n`);
  });
  const replies = Object.fromEntries(served.split('\n').filter(Boolean).map((line) => { try { const r = JSON.parse(line); return [r.id, r.result]; } catch { return [null, null]; } }));
  const text = (id) => replies[id]?.content?.[0]?.text ?? '';

  check(replies[1] && !replies[1].isError, 'the agent loads its own requirement', text(1).slice(0, 80));
  has(text(1), 'Booking', 'and the entity section it names');
  check(replies[2]?.isError === true, 'a read past the manifest is refused', text(2).slice(0, 80));
  check(replies[3]?.isError === true, 'reading another requirement is refused', text(3).slice(0, 80));
  check(replies[4] && !replies[4].isError, 'an allowed command runs', text(4).slice(0, 80));
  check(replies[5]?.isError === true, 'a command nobody listed is refused', text(5).slice(0, 80));
  check(replies[6]?.isError === true, 'an ask with no plain terms is refused', text(6).slice(0, 80));
  check(replies[7] && !replies[7].isError && /proposed, not recorded/.test(text(7)), 'remember becomes a proposal, never a memory', text(7).slice(0, 80));

  step = 73;
  // The agent invents an entity and sets its requirement ready anyway.
  await patch(join(root, 'vibekit/product/requirements/REQ-002.md'), [
    [/^size:.*$/m, 'size: S'],
    [/^source:.*$/m, 'source: BRS-001 §2'],
    [/^entities:.*$/m, 'entities: [Refund]'],
    [/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  The system shall record a refund.\n'],
  ]);
  const invented = await vk(root, ['req', 'ready', 'REQ-002', '--as', 'implementer'], { home, expect: 1 });
  has(invented.out, 'Refund.*not in product/entities.md', 'an invented entity is refused, with the file to propose it in');

  step = 74;
  // It skips the test it cannot make pass, writes an evidence block, and claims tested.
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'tests/Cancel.Tests.cs'), '[Fact(Skip = "flaky")]\npublic void Cancel_IssuesRefund_AC1() { }\n');
  await patch(join(root, 'vibekit/product/map.md'), [[/^build\s{2,}.*$/m, `build     "${process.execPath}" -e "process.exit(0)"`], [/^test\s{2,}.*$/m, `test      "${process.execPath}" -e "process.exit(0)"`]]);
  await git(root, 'add', '-A');
  await commit(root, 'wip');
  await vk(root, ['verify'], { home });
  const skipped = await vk(root, ['req', 'tested', 'REQ-001', '--as', 'implementer'], { home, expect: 1 });
  has(skipped.out, 'skipped or focused test', 'a skipped test blocks tested, even with green evidence');
  has(skipped.out, 'Cancel\\.Tests\\.cs:1', 'and names the line');

  // It claims tested without re-running: the evidence is for an older commit.
  await writeFile(join(root, 'tests/Cancel.Tests.cs'), '[Fact]\npublic void Cancel_IssuesRefund_AC1() { }\n');
  await git(root, 'add', '-A');
  await commit(root, 'unskip');
  const stale = await vk(root, ['req', 'tested', 'REQ-001', '--as', 'implementer'], { home, expect: 1 });
  has(stale.out, 'evidence is for commit', 'evidence for another commit is refused');

  await vk(root, ['verify'], { home });
  const tested = await vk(root, ['req', 'tested', 'REQ-001', '--as', 'implementer'], { home });
  has(tested.out, 'tested', 'fresh green evidence for HEAD goes through');

  step = 75;
  // It tries to close its own work.
  const closed = await vk(root, ['req', 'done', 'REQ-001', '--as', 'implementer'], { home, expect: 1 });
  has(closed.out, 'cannot set', 'an agent is refused done');
  // And a human without a review is refused too.
  await vk(root, ['req', 'release', 'REQ-001'], { home });
  const unreviewed = await vk(root, ['req', 'done', 'REQ-001'], { home, expect: 1 });
  has(unreviewed.out, 'Review', 'a human cannot close unreviewed work either');

  step = 76;
  // A checkpoint that claims more than the tests confirm is corrected on resume, not believed.
  await vk(root, ['req', 'checkpoint', 'REQ-001', '--done', 'AC-1 and AC-2 passing', '--in-hand', 'nothing', '--next', 'tidy'], { home });
  const before = await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8');
  has(before, 'done: +AC-1 and AC-2 passing', 'the optimistic checkpoint is written');
  const checks = await vk(root, ['check'], { home, expect: 'any' });
  notes.push(`agent walk check: ${checks.out.trim().split('\n').filter((l) => l.trim()).slice(0, 2).join(' / ')}`);

  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── the sprint walk (§67)

/**
 * The everyday surface, the way §67 names it: a project is started with `project new`, the gates
 * are passed, work is handed out by `sprint run`, a bug goes through assess → fix → test to a
 * verdict, and the sprint is closed by a person at its gate. Every screen must show the work, not
 * the identifier, and every refusal must be the CLI's own.
 */
async function sprintWalk() {
  const root = await mkdtemp(join(tmpdir(), 'sim-sprint-'));
  const home = await mkdtemp(join(tmpdir(), 'sim-home7-'));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'sim@example.com');
  await git(root, 'config', 'user.name', 'Sim');

  step = 80;
  const made = await vk(root, ['project', 'new', '--yes', '--name', 'stock', '--describe', 'Staff count stock on a phone.', '--platform', 'web,api'], { home });
  has(made.out, 'specs/project.json written · stock · web, api', 'project new writes the config from flags');
  has(made.out, 'Spec started', 'and says what happens next');
  check((await readFile(join(root, 'vibekit/product/sources/DESC-001/source.md'), 'utf8')).includes('Staff count stock'), 'the words typed are the source of record, verbatim');

  const before = await vk(root, ['sprint', 'run'], { home, expect: 'any' });
  has(before.out, 'nothing to hand out until the plan is approved', 'sprint run before the plan is the gate reader');
  const queue = await vk(root, ['action'], { home });
  has(queue.out, '1 decision across 1 project', 'the decision queue sees the gate');

  step = 81;
  // Pass the gates the way a person does — lines in files — then plan two sprints.
  await writeFile(join(root, 'vibekit/workflow/assumptions.md'), '---\nreviewed: 2026-09-24 by Sim\n---\n\n# Assumptions\n\n- A-001 one warehouse · confidence: medium\n');
  await patch(join(root, 'vibekit/workflow/architecture.md'), [[/^approved:.*$/m, 'approved: 2026-09-24 by Sim'], [/^api:.*$/m, 'api: none']]);
  await writeFile(join(root, 'vibekit/product/entities.md'), ['<!-- generated by vibekit · do not edit · source: entities -->', '# Entities', '', '## Count', 'class: internal', '- `quantity` integer', ''].join('\n'));
  await vk(root, ['feature', 'add', 'record a count'], { home });
  await vk(root, ['feature', 'add', 'review variances'], { home });
  for (const id of ['REQ-001', 'REQ-002']) {
    await patch(join(root, `vibekit/product/requirements/${id}.md`), [
      [/^size:.*$/m, 'size: S'], [/^source:.*$/m, 'source: DESC-001'], [/^entities:.*$/m, 'entities: [Count]'],
      [/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1  When a counter records a quantity, the system shall save the Count.\n'],
    ]);
    await vk(root, ['req', 'ready', id], { home });
  }
  await writeFile(join(root, 'vibekit/workflow/plan.md'), '---\napproved: 2026-09-24 by Sim\nrequirements: 2\nphases: 2\n---\n\n# Plan\n\n## Phase 1: count\n\n- REQ-001 record a count\n\n## Phase 2: variances\n\n- REQ-002 review variances · after REQ-001\n');
  const plan = await vk(root, ['sprint', 'plan'], { home });
  has(plan.out, 'Sprint 1 — count', 'the plan is read as sprints');
  has(plan.out, 'Approved by Sim', 'with its approval');

  step = 82;
  const ran = await vk(root, ['sprint', 'run', '--lanes', '2'], { home });
  has(ran.out, 'Sprint 1 — count · 0 of 1 done', 'run names the current sprint');
  has(ran.out, '▶ Recording a count', 'the lane shows the work as a gerund, not REQ-001');
  check(!/▶.*REQ-00/.test(ran.out), 'no identifier on the line a person reads first');
  has(ran.out, '1 lane', 'REQ-002 waits on REQ-001, so one lane, not two');
  const status = await vk(root, ['sprint', 'status'], { home });
  has(status.out, 'IN PROGRESS +Recording a count', 'status shows the lane');
  has(status.out, 'sprint 1 of 2', 'and where the sprint sits');

  step = 83;
  // A bug found in review goes through three jobs to one word.
  const bug = await vk(root, ['bug', 'counts save twice on a slow network', '--test', 'tests/count.test.js', '--severity', 'high', '--found-on', 'REQ-001', '--criterion', 'When the same count is sent twice, the system shall save it once'], { home });
  has(bug.out, 'BUG-001 opened · severity high', 'a bug is a requirement with a severity');
  const agentHigh = await vk(root, ['bug', 'another', '--severity', 'high', '--as', 'implementer', '--test', 'tests/x.test.js'], { home, expect: 1 });
  has(agentHigh.out, 'human judgement', 'an agent may not set severity above medium');
  await vk(root, ['bug', 'assess', 'BUG-001', '--cause', 'no idempotency key on the save'], { home });
  const gate = await vk(root, ['sprint', 'close', '--by', 'Sim'], { home, expect: 1 });
  has(gate.out, 'not at its gate', 'a sprint with open work cannot close');
  has(gate.out, 'no open high-severity bug +BUG-001', 'and a high bug blocks it by name');
  has(gate.out, 'vibekit check green', 'the gate runs the checks');

  step = 84;
  const parity = await vk(root, ['check', '--parity'], { home, expect: 'any' });
  has(parity.out, '0 without', 'every command has a page action or is the machine\'s own');
  const scan = await vk(root, ['security', 'scan', '--no-bugs'], { home, expect: 'any' });
  has(scan.out, 'Report: ', 'the scan writes its report');
  check(!/\.state\/security\.json carries/.test(scan.out), 'the scan does not report its own state file as a secret');
  const nothing = await vk(root, ['nosuchthing'], { home, expect: 1 });
  has(nothing.out, 'no such command', 'a typo is refused, not helped');

  await rm(home, { recursive: true, force: true });
  return root;
}

// ────────────────────────────────────────────────────────────── run

const started = Date.now();
const roots = [];
for (const walk of [greenfield, brownfield, releaseWalk, adversarial, hostile, misbehavingAgent, sprintWalk]) {
  walkName = walk.name;
  try {
    roots.push(await walk());
  } catch (error) {
    failures.push({ step, label: walk.name, why: `threw: ${error.message}` });
  }
}

console.log(`\n${'─'.repeat(70)}`);
if (process.argv.includes('--verbose')) {
  for (const walk of ['greenfield', 'brownfield', 'releaseWalk', 'adversarial', 'hostile', 'misbehavingAgent']) {
    const mine = passed.filter((entry) => entry.walk === walk);
    console.log(`\n${walk}  (${mine.length} assertions held)`);
    for (const entry of mine) console.log(`  ✔ ${entry.what}`);
  }
  console.log('');
}
console.log(`simulation finished in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`${passed.length} assertion(s) held · ${failures.length} failure(s)\n`);
for (const failure of failures) console.log(`  [step ${failure.step}] ${failure.label}\n      ${failure.why}`);
if (notes.length) {
  console.log('\nnotes:');
  for (const note of notes) console.log(`  · ${note.slice(0, 200)}`);
}
console.log(`\nworkspaces: ${roots.join(' ')}`);
process.exit(failures.length ? 1 : 0);
