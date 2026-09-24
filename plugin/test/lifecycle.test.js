import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { PROMOTE_AFTER, group, plan as planDistil, similarity } from '../src/distil.js';
import { isOpen, listAsks } from '../src/folder/asks.js';
import { generateFolder } from '../src/folder/generate.js';
import { listRequirements } from '../src/folder/requirements.js';
import {
  bumpFrom, doneBetween, evidence, nextVersion, release, releaseBlockers,
  renderChangelog, revert, rollback, tags,
} from '../src/release.js';
import { base, casesIn, criterionFrom, humanise, planReverse, reverse, suiteName, typesIn } from '../src/reverse.js';
import { CONFIG_KEYS, diffLines, isBehind, readConfig, upgrade, upgradePlan, writeConfig } from '../src/prompts.js';
import { BODY_MAX, LOAD_LIMIT, fires, listSkills, loadFor, overlaps, overrideChain, parseSkillTest, promote, testSkills } from '../src/skills.js';
import { convertPlan, looksLikeSpecKit, readSpecKit } from '../src/speckit.js';
import { gitInit, sh } from './helpers.js';

/**
 * The lifecycle commands. Specification §5, §16, §30, §35, §41, §42, §43, §47, §50 and §56.
 *
 * What ties them together: each writes something into the repository that somebody will later
 * rely on — a release tag, a drafted requirement, a promoted skill — so each one's refusals
 * matter more than its successes.
 */

const CONFIG = {
  name: 'bookings', description: 'A booking system for gyms.', architecture: 'clean',
  stack: { language: '.NET 10' }, commands: { test: 'dotnet test' },
  entities: [{ name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] }],
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-life-'));
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'vibekit-home-'));
  await generateFolder(root, CONFIG);
  await mkdir(join(root, 'specs'), { recursive: true });
  await writeFile(join(root, 'specs/project.json'), JSON.stringify({
    project: { name: CONFIG.name, description: CONFIG.description },
    architecture: { style: CONFIG.architecture },
    stack: CONFIG.stack,
    commands: CONFIG.commands,
    entities: CONFIG.entities,
  }, null, 2));
  return root;
}

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

async function requirement(root, id, fields = {}) {
  await run(['req', 'new', fields.title ?? `thing ${id}`, '--dir', root]);
  const path = join(root, `vibekit/product/requirements/${id}.md`);
  let text = await readFile(path, 'utf8');
  for (const [key, value] of Object.entries({ size: 'M', status: 'done', ...fields })) {
    if (key === 'title') continue;
    text = new RegExp(`^${key}:`, 'm').test(text)
      ? text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`)
      : text.replace(/^kind:.*$/m, (line) => `${line}\n${key}: ${value}`);
  }
  await writeFile(path, text);
  return path;
}

// ---------------------------------------------------------------- reverse (§41)

test('a test name becomes a criterion in the form the name supports, and no more', () => {
  assert.equal(criterionFrom('Cancel_ConfirmedBooking_IssuesRefund').text,
    'When cancel is called with confirmed booking, the system shall issue refund.');
  assert.equal(criterionFrom('RefusesWhenClassIsFull').pattern, 'unwanted');
  assert.equal(criterionFrom('cancels a confirmed booking').text, 'The system shall cancel a confirmed booking.');

  // A longer snake_case name is a sentence, not Subject_Condition_Response.
  assert.equal(criterionFrom('test_cancel_with_no_card_is_rejected').pattern, 'ubiquitous');
});

test('a third-person verb is corrected, and a word that merely ends in s is not', () => {
  assert.equal(base('issues refund'), 'issue refund');
  assert.equal(base('processes the payment'), 'process the payment');
  assert.equal(base('matches the address'), 'match the address');
  assert.equal(base('refuses'), 'refuse');
  assert.equal(base('fixes'), 'fix');
  assert.equal(base('address the note'), 'address the note', 'a double s is not a third-person verb');
});

test('test cases are found across the frameworks people actually use', () => {
  assert.deepEqual(casesIn('it("cancels a booking", () => {}); test("lists", () => {});'), ['cancels a booking', 'lists']);
  assert.deepEqual(casesIn('[Fact]\npublic void Cancel_Confirmed_Refunds() { }'), ['Cancel_Confirmed_Refunds']);
  assert.deepEqual(casesIn('def test_cancel_is_rejected(self):'), ['test_cancel_is_rejected']);
  assert.deepEqual(casesIn('nothing here'), []);
});

test('the suite name comes from the describe or the class, not from the filename when it can', () => {
  assert.equal(suiteName('describe("Bookings", () => {})', 'x.test.ts'), 'Bookings');
  assert.equal(suiteName('public class BookingTests { }', 'x.cs'), 'Booking');
  assert.equal(suiteName('nothing', 'bookings.test.ts'), 'bookings');
});

test('types are only reported when they are in the vocabulary, so nothing is invented', () => {
  const text = 'var booking = new Booking(); var helper = new Helper();';
  assert.deepEqual(typesIn(text, ['Booking', 'Member']), ['Booking']);
  assert.ok(!typesIn(text, ['Booking']).includes('Helper'));
  assert.ok(!typesIn('Assert.True(x); Mock<IThing> m;').includes('Assert'));
});

test('reverse drafts a requirement per test class, all draft and low confidence', async () => {
  const root = await project();
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'tests/bookings.test.ts'),
    'describe("Bookings", () => { it("cancels a confirmed booking", () => {}); it("refuses when the class is full", () => {}); });');

  const result = await reverse(root, {});
  assert.equal(result.written.length, 1);

  const [drafted] = await listRequirements(root);
  assert.equal(drafted.status, 'draft');
  assert.equal(drafted.source, 'tests/bookings.test.ts');
  assert.equal(drafted.acceptance.length, 2, 'both criteria parse as EARS');

  const text = await readFile(join(root, `vibekit/product/requirements/${drafted.id}.md`), 'utf8');
  assert.match(text, /^confidence: low$/m);
  assert.match(text, /## Verification\n\n- AC-1 — tests\/bookings\.test\.ts · `cancels a confirmed booking`/);
  assert.match(text, /inferred from a test name/);
  assert.match(text, /\n\n## Out of scope/, 'the next heading must not join the last bullet');
});

test('running reverse twice does not double the backlog', async () => {
  const root = await project();
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'tests/a.test.ts'), 'describe("A", () => { it("does a thing", () => {}); });');

  await reverse(root, {});
  const after = await reverse(root, {});
  assert.equal(after.written.length, 0);
  assert.equal((await listRequirements(root)).length, 1);
});

test('a test file this cannot read is named, not silently skipped', async () => {
  const root = await project();
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'tests/odd.test.ts'), '// a test file with no recognisable cases\n');

  const planned = await planReverse(root, {});
  assert.deepEqual(planned.unreadable, ['tests/odd.test.ts']);
  assert.equal(planned.drafts.length, 0);
});

// ---------------------------------------------------------------- distil (§30)

test('two sessions noticing the same thing are one memory with two witnesses', () => {
  const grouped = group([
    { from: 'a', date: '1', text: 'The bookings query needs a TenantId filter or it leaks across customers' },
    { from: 'b', date: '2', text: 'bookings query must filter by TenantId, otherwise data leaks across customers' },
    { from: 'c', date: '3', text: 'Stripe webhooks arrive out of order' },
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].witnesses.length, 2);
  assert.ok(similarity('the booking was cancelled late', 'a booking cancelled late') > 0.6);
  assert.ok(similarity('bookings leak between tenants', 'deployments run at midnight') < 0.3);
});

test('a note that would override a guardrail is reported, never proposed', async () => {
  const root = await project();
  await mkdir(join(root, 'vibekit/memory/sessions'), { recursive: true });
  await writeFile(join(root, 'vibekit/memory/sessions/2026-09-20.md'),
    '- We skip the migration check on Fridays\n- Stripe webhooks arrive out of order\n');

  const planned = await planDistil(root, {});
  assert.equal(planned.proposals.length, 1);
  assert.equal(planned.refused.length, 1);
  assert.match(planned.refused[0].refused, /a memory cannot do that/);
});

test('distil writes proposals, never memories', async () => {
  const root = await project();
  await mkdir(join(root, 'vibekit/memory/sessions'), { recursive: true });
  await writeFile(join(root, 'vibekit/memory/sessions/2026-09-20.md'), '- Webhooks from the payment provider arrive out of order\n');

  await capture(() => run(['distil', '--dir', root]));
  const asks = await listAsks(root, 'vibekit');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].kind, 'proposal', 'an agent that could write memory would teach itself its own guesses');
});

test('a remember: line in a requirement log is picked up too', async () => {
  const root = await project();
  await requirement(root, 'REQ-001', { status: 'in-progress' });
  await run(['req', 'log', 'REQ-001', 'remember: the booking id is a uuid, not an int', '--dir', root]);

  const planned = await planDistil(root, {});
  assert.equal(planned.remembered, 1);
  assert.ok(planned.proposals.some((proposal) => /uuid, not an int/.test(proposal.text)));
});

test('promotion is reported for a memory that keeps matching', async () => {
  const root = await project();
  await mkdir(join(root, 'vibekit/memory/repo'), { recursive: true });
  await writeFile(join(root, 'vibekit/memory/repo/M-001.md'),
    `---\nid: M-001\ntopic: [domain]\nby: a human\nmatched: ${PROMOTE_AFTER + 2}\n---\n\nBookings are never hard-deleted.\n`);

  const planned = await planDistil(root, {});
  assert.deepEqual(planned.promote.map((memory) => memory.id), ['M-001'], 'a memory that keeps matching is a rule, not a hint');
});

// ---------------------------------------------------------------- releases (§47, §50)

test('the version is computed from what shipped, not chosen by whoever is releasing', () => {
  assert.equal(bumpFrom([{ id: 'R', size: 'S' }]).level, 'patch');
  assert.equal(bumpFrom([{ id: 'R', size: 'M' }]).level, 'minor');
  assert.equal(bumpFrom([{ id: 'R', size: 'L' }], { contractsChanged: true }).level, 'major');
  assert.equal(bumpFrom([{ id: 'R', size: 'L' }], { contractsChanged: false }).level, 'minor', 'size L alone is not a breaking change');

  assert.equal(nextVersion('v1.2.3', 'major'), 'v2.0.0');
  assert.equal(nextVersion('v1.2.3', 'minor'), 'v1.3.0');
  assert.equal(nextVersion(null, 'patch'), 'v0.0.1');
});

test('a release is refused over unfinished work, and says why', async () => {
  const root = await project();
  await requirement(root, 'REQ-001', { status: 'in-progress' });
  gitInit(root);

  const blockers = await releaseBlockers(root, {});
  assert.ok(blockers.some((blocker) => /not done/.test(blocker)));

  const result = await release(root, {});
  assert.equal(result.ok, false);
  assert.equal(tags(root).length, 0, 'nothing is tagged when the release is refused');
});

test('a blocking ask stops a release, because it is a decision nobody has made', async () => {
  const root = await project();
  gitInit(root);
  const { openAsk } = await import('../src/folder/asks.js');
  await openAsk(root, { ask: 'Who owns refunds?', plain: 'Who decides about refunds?', blocking: true });

  assert.ok((await releaseBlockers(root, {})).some((blocker) => /blocking ask/.test(blocker)));
});

test('a clean release writes the changelog, records the version and tags it', async () => {
  const root = await project();
  await requirement(root, 'REQ-001', { title: 'members can cancel', source: 'BRS-001 §4.2', phase: '1' });
  gitInit(root);

  const result = await release(root, {});
  assert.equal(result.ok, true);
  assert.equal(result.version, 'v0.1.0');

  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## v0\.1\.0/);
  assert.match(changelog, /### Phase 1/);
  assert.match(changelog, /\*\*REQ-001\*\* members can cancel · BRS-001 §4\.2/, 'a line with no citation invites "who asked for that"');

  const state = JSON.parse(await readFile(join(root, 'vibekit/.state/releases.json'), 'utf8'));
  assert.equal(state.releases[0].version, 'v0.1.0');
});

test('the changelog names a requirement with no source as having none', () => {
  const entry = renderChangelog('v1.0.0', [{ id: 'REQ-001', title: 'a thing', source: null, phase: null }], { from: null });
  assert.match(entry, /no source cited/);
  assert.match(renderChangelog('v1.0.0', [], { from: 'v0.9.0' }), /No requirement reached done/);
});

test('only requirements that moved since the last tag are in the release', async () => {
  const root = await project();
  await requirement(root, 'REQ-001', { title: 'first' });
  gitInit(root);
  sh(root, 'git', 'tag', 'v0.1.0');

  await requirement(root, 'REQ-002', { title: 'second' });
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'feat: second');

  const shipped = await doneBetween(root, 'v0.1.0', 'HEAD');
  assert.deepEqual(shipped.map((entry) => entry.id), ['REQ-002'], 'listing REQ-001 again would overstate the release');
});

// ---------------------------------------------------------------- revert and rollback (§43, §50)

test('reverting sets the requirement back to ready and anything built on it to review', async () => {
  const root = await project();
  await requirement(root, 'REQ-001', { title: 'the thing' });
  await requirement(root, 'REQ-002', { title: 'built on it', after: '[REQ-001]' });
  gitInit(root);

  const result = await revert(root, 'REQ-001', { reason: 'the refund went to the wrong card' });
  assert.deepEqual(result.dependents, ['REQ-002']);

  const requirements = await listRequirements(root);
  assert.equal(requirements.find((entry) => entry.id === 'REQ-001').status, 'ready');
  assert.equal(requirements.find((entry) => entry.id === 'REQ-002').status, 'review',
    'what it was built on is no longer there');
  assert.match(requirements.find((entry) => entry.id === 'REQ-001').log.join('\n'), /reverted — the refund went to the wrong card/);
});

test('a rollback opens a hotfix pre-filled with the incident note', async () => {
  const root = await project();
  gitInit(root);
  sh(root, 'git', 'tag', 'v1.0.0');

  const result = await rollback(root, 'v1.0.0', { note: 'smoke red on refunds' });
  assert.match(result.requirement, /^BUG-/);

  const text = await readFile(join(root, `vibekit/product/requirements/${result.requirement}.md`), 'utf8');
  assert.match(text, /Rolled back to v1\.0\.0\. smoke red on refunds/);
  assert.match(text, /Redeploy is the pipeline's job/);

  await assert.rejects(() => rollback(root, 'v9.9.9', {}), /There is no tag v9\.9\.9/);
});

// ---------------------------------------------------------------- evidence (§50)

test('the evidence bundle is what the folder already says, gathered', async () => {
  const root = await project();
  await requirement(root, 'REQ-001', { title: 'members can cancel' });
  const { openAsk } = await import('../src/folder/asks.js');
  await openAsk(root, { ask: 'Who owns refunds?', plain: 'Who decides about refunds?', forRequirement: 'REQ-001' });

  const bundle = await evidence(root, { id: 'REQ-001' });
  assert.match(bundle.markdown, /# Evidence · REQ-001/);
  assert.match(bundle.markdown, /### Approach/);
  assert.match(bundle.markdown, /### Asks it raised/);
  assert.match(bundle.markdown, /Q-001/);
  assert.match(bundle.markdown, /nothing here is a summary of something that was not written down/);

  await assert.rejects(() => evidence(root, { id: 'REQ-404' }), /No requirement REQ-404/);
});

test('an approved gate appears in the bundle', async () => {
  const root = await project();
  await requirement(root, 'REQ-001');
  const path = join(root, 'vibekit/workflow/architecture.md');
  await writeFile(path, `approved: 2026-09-01 by Grace Hopper\n\n${await readFile(path, 'utf8')}`);

  const bundle = await evidence(root, { id: 'REQ-001' });
  assert.match(bundle.markdown, /\*\*architecture\*\* — 2026-09-01 by Grace Hopper/);
});

// ---------------------------------------------------------------- prompts (§5, §42)

test('a prompt the team edited at the current version is left alone', async () => {
  const root = await project();
  const path = join(root, 'vibekit/workflow/stages/0-intake.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace('# Stage 0', '# Stage 0 (our version)'));

  const planned = await upgradePlan(root, {});
  const change = planned.changes.find((entry) => entry.path === 'workflow/stages/0-intake.md');
  assert.equal(change.kind, 'edited');

  const applied = await upgrade(root, {});
  assert.ok(!applied.written.includes('workflow/stages/0-intake.md'), 'overwriting it would discard a decision somebody made');
  assert.match(await readFile(path, 'utf8'), /our version/);
});

test('a prompt on an older version is offered with its diff, and upgrades on request', async () => {
  const root = await project();
  const path = join(root, 'vibekit/workflow/stages/0-intake.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^prompts: .*$/m, 'prompts: 0.9').replace('# Stage 0', '# Stage zero'));

  const planned = await upgradePlan(root, {});
  const change = planned.changes.find((entry) => entry.path === 'workflow/stages/0-intake.md');
  assert.equal(change.kind, 'behind');
  assert.ok(change.diff.changed > 0);

  const applied = await upgrade(root, {});
  assert.ok(applied.written.includes('workflow/stages/0-intake.md'));
  assert.match(await readFile(path, 'utf8'), /# Stage 0: Intake/);
});

test('an unchanged project has nothing to upgrade', async () => {
  const root = await project();
  assert.deepEqual((await upgradePlan(root, {})).changes, []);
  assert.equal(isBehind('1.0'), false);
  assert.equal(isBehind('0.9'), true);
  assert.deepEqual(diffLines('a\nb', 'a\nB'), { removed: ['b'], added: ['B'], changed: 2 });
});

test('replay compares the prompt against what a project recorded, and says what it did not run', async () => {
  const root = await project();
  const { openAsk } = await import('../src/folder/asks.js');
  await openAsk(root, { ask: 'Who uses this?', plain: 'Who uses this?', stage: 1 }, 'vibekit').catch(() => null);

  const output = await capture(() => run(['replay', '--stage', '1', '--dir', root]));
  assert.match(output, /stage 1 · workflow\/stages\/1-clarify\.md/);
  assert.match(output, /Raising the asks again needs a model/, 'a replay report that claimed a run it never made would be worse than none');

  await assert.rejects(() => run(['replay', '--stage', '9', '--dir', root]), /No stage 9 prompt/);
});

// ---------------------------------------------------------------- config (§30)

test('machine settings live outside the folder, and a bad value is refused', async () => {
  await mkdtemp(join(tmpdir(), 'vibekit-config-')).then((home) => { process.env.VIBEKIT_HOME = home; });

  await writeConfig('team-memory', 'git@github.com:acme/memory.git');
  assert.equal((await readConfig())['team-memory'], 'git@github.com:acme/memory.git');

  await assert.rejects(() => writeConfig('team-memory', 'not a url'), /needs a git URL/);
  await assert.rejects(() => writeConfig('nonsense', 'x'), /is not a setting/);
  assert.ok(Object.keys(CONFIG_KEYS).includes('team-skills'));
});

// ---------------------------------------------------------------- skills (§56)

const SKILL = '# tenant scoping\n\n' + 'Scope every query by tenant. '.repeat(20);
const SKILL_TEST = [
  '---',
  'skill: tenant-scoping',
  'triggers-on: ["add a TenantId filter to the bookings query", "per-customer report"]',
  'must-not-trigger-on: ["rename the tenant column"]',
  'expect:',
  '  - file: src/ListBookings.cs',
  '    contains: [".Where(b => b.TenantId == tenant.Id)"]',
  '  - no-file: src/TenantFilter.cs',
  '---',
  '',
].join('\n');

async function withSkill(root, { test: withTest = true, triggers = 'tenant filter, per-customer' } = {}) {
  await mkdir(join(root, 'vibekit/skills/lib'), { recursive: true });
  await writeFile(join(root, 'vibekit/skills/lib/tenant-scoping.md'), SKILL);
  if (withTest) await writeFile(join(root, 'vibekit/skills/lib/tenant-scoping.test.md'), SKILL_TEST);
  await writeFile(join(root, 'vibekit/skills/index.yml'),
    `- name: tenant-scoping\n  triggers: [${triggers}]\n  path: lib/tenant-scoping.md\n`);
  return root;
}

test('a skill test is read in order, so each expectation keeps its own assertions', () => {
  const parsed = parseSkillTest(SKILL_TEST);
  assert.equal(parsed.skill, 'tenant-scoping');
  assert.equal(parsed.triggersOn.length, 2);
  assert.deepEqual(parsed.expect[0], { kind: 'file', path: 'src/ListBookings.cs', contains: ['.Where(b => b.TenantId == tenant.Id)'] });
  assert.deepEqual(parsed.expect[1].contains, [], 'a no-file must not inherit the strings above it');
});

test('test-skills checks the triggers fire, and only when they should', async () => {
  const root = await withSkill(await project());
  const passing = await testSkills(root, {});
  assert.equal(passing.passed, 1);

  // A trigger that no longer matches its own test is exactly the silent regression §56 describes.
  await writeFile(join(root, 'vibekit/skills/index.yml'),
    '- name: tenant-scoping\n  triggers: [unrelated]\n  path: lib/tenant-scoping.md\n');
  const failing = await testSkills(root, {});
  assert.equal(failing.failed.length, 1);
  assert.match(failing.failed[0].problems.join(' '), /should fire on "add a TenantId filter/);
});

test('a skill that fires when it must not is a failure', async () => {
  const root = await withSkill(await project(), { triggers: 'tenant' });
  const result = await testSkills(root, {});
  assert.match(result.failed[0]?.problems.join(' ') ?? '', /fires on "rename the tenant column" and must not/);
});

test('a skill with no test is reported as untested rather than as passing', async () => {
  const root = await withSkill(await project(), { test: false });
  const result = await testSkills(root, {});
  assert.equal(result.untested.length, 1);
  assert.match(result.untested[0].problems[0], /nothing would notice it regressing/);
});

test('an oversized body is reported, because three of them have to fit in one task', async () => {
  const root = await withSkill(await project());
  await writeFile(join(root, 'vibekit/skills/lib/tenant-scoping.md'), 'word '.repeat(BODY_MAX * 2));
  const result = await testSkills(root, {});
  assert.match(result.failed[0].problems.join(' '), new RegExp(`over the ${BODY_MAX} ceiling`));
});

test('overlapping triggers are flagged: two instructions for one task', () => {
  const clash = overlaps([
    { name: 'a', triggers: ['tenant', 'filter', 'scope'] },
    { name: 'b', triggers: ['tenant', 'filter', 'query'] },
  ]);
  assert.equal(clash.length, 1);
  assert.equal(clash[0].shared, 2);
  assert.deepEqual(overlaps([{ name: 'a', triggers: ['x'] }, { name: 'b', triggers: ['y'] }]), []);
});

test('at most three bodies load, and the ones left out are named', () => {
  const skills = ['alpha', 'beta', 'gamma', 'delta'].map((name) => ({ name, triggers: ['booking'] }));
  const { loaded, leftOut } = loadFor(skills, 'change the booking flow');
  assert.equal(loaded.length, LOAD_LIMIT);
  assert.equal(leftOut.length, 1);
  assert.ok(fires({ triggers: ['booking flow'] }, 'change the booking flow'));
  assert.ok(!fires({ triggers: ['deploy'] }, 'change the booking flow'));
});

test('the override chain says which version fires', () => {
  const chain = overrideChain([
    { name: 'find-existing', scope: 'vibekit' },
    { name: 'find-existing', scope: 'repo' },
    { name: 'other', scope: 'repo' },
  ]);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].wins, 'repo');
});

test('a skill in lib but not in the index can never be fetched, and is reported', async () => {
  const root = await withSkill(await project());
  await writeFile(join(root, 'vibekit/skills/lib/orphan.md'), '# orphan\n');
  const { orphans } = await listSkills(root, {});
  assert.deepEqual(orphans, ['orphan.md']);
});

test('a skill without a test cannot be promoted to team scope', async () => {
  const root = await withSkill(await project(), { test: false });
  await assert.rejects(() => promote(root, 'tenant-scoping', {}), /regresses there regresses everywhere at once/);
});

test('promotion prepares the skill, its test and the note a reviewer needs', async () => {
  const root = await withSkill(await project());
  const result = await promote(root, 'tenant-scoping', {});
  assert.deepEqual(result.files, ['tenant-scoping.md', 'tenant-scoping.test.md', 'PROMOTION.md']);
  assert.match(await readFile(join(result.dir, 'PROMOTION.md'), 'utf8'), /Why it earned this/);

  await assert.rejects(() => promote(root, 'tenant-scoping', { to: 'vibekit' }), /furthest a project can promote/);
});

test('an imported skill arrives with inferred triggers, marked low confidence', async () => {
  const root = await project();
  await mkdir(join(root, '.claude/skills/foo'), { recursive: true });
  await writeFile(join(root, '.claude/skills/foo/SKILL.md'),
    '---\nname: foo\ndescription: Handles tenant scoping for booking queries\n---\n\nDo the thing.\n');

  const output = await capture(() => run(['skills', 'import', '.claude/skills/foo', '--dir', root]));
  assert.match(output, /confidence: low/);

  const { skills: found } = await listSkills(root, {});
  const imported = found.find((skill) => skill.name === 'foo');
  assert.ok(imported, 'it is in the index, or nothing could fetch it');
  assert.ok(imported.triggers.length, 'the triggers are a guess, and the file says so');
});

// ---------------------------------------------------------------- Spec Kit (§35)

async function specKitRepo() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-speckit-'));
  await mkdir(join(root, 'memory'), { recursive: true });
  await mkdir(join(root, 'specs/001-bookings'), { recursive: true });
  await writeFile(join(root, 'memory/constitution.md'), '# Constitution\n\n## Principles\n\n- Tests first\n- Small changes\n');
  await writeFile(join(root, 'specs/001-bookings/spec.md'), [
    '# Bookings', '', 'Members book classes.', '',
    '## Acceptance Criteria', '',
    '- The system shall create a booking when a member submits the form',
    '- It should be fast',
    '- The system shall refuse a booking for a full class',
    '',
  ].join('\n'));
  return root;
}

test('a Spec Kit repository is recognised, and a folder without one is not', async () => {
  assert.equal(await looksLikeSpecKit(await specKitRepo()), true);
  assert.equal(await looksLikeSpecKit(await project()), false);
});

test('each criterion is counted once, whichever heading it sits under', async () => {
  const planned = convertPlan(await readSpecKit(await specKitRepo()));
  assert.equal(planned.criteria, 3, '"Acceptance" also matches "Acceptance Criteria"');
  assert.equal(planned.usable, 2);
  assert.equal(planned.unparsed, 1);
});

test('what the original spec never settled becomes an ask, not a silent fact', async () => {
  const planned = convertPlan(await readSpecKit(await specKitRepo()));
  const plain = planned.asks.map((ask) => ask.plain).join(' ');

  assert.ok(planned.asks.length >= 4 && planned.asks.length <= 15, `§35 expects five to fifteen asks, got ${planned.asks.length}`);
  assert.match(plain, /never change, and which commands/, 'a constitution states principles but rarely names what may not be touched');
  assert.match(plain, /It should be fast/, 'a criterion that cannot become a test is the point of the conversion');
  assert.match(plain, /personal or financial data/);
});

test('init --from-speckit reports before it writes, and writes the asks on request', async () => {
  const root = await specKitRepo();
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'vibekit-home-'));

  const dry = await capture(() => run(['init', '--from-speckit', '--dir', root]));
  assert.match(dry, /question\(s\) the conversion cannot answer/);
  assert.match(dry, /memory\/constitution\.md/);
  assert.equal((await listAsks(root, 'vibekit')).length, 0, 'nothing written without --yes');
});

// ---------------------------------------------------------------- the model-backed halves

test('a skill is applied to its fixture and the expectations are checked', async () => {
  const { runFixture, parseSkillTest } = await import('../src/skills.js');
  const root = await withSkill(await project());
  await mkdir(join(root, 'fixtures/tenant'), { recursive: true });
  await writeFile(join(root, 'fixtures/tenant/ListBookings.cs'), 'var rows = db.Bookings.ToList();');

  const withGiven = SKILL_TEST.replace('expect:', 'given: fixtures/tenant/\nexpect:').replace('src/ListBookings.cs', 'ListBookings.cs');
  await writeFile(join(root, 'vibekit/skills/lib/tenant-scoping.test.md'), withGiven);
  const { skills: found } = await listSkills(root, {});

  // A model that applies the skill correctly.
  const good = await runFixture(root, found[0], parseSkillTest(withGiven), {
    ask: async () => ({ model: 'stub', usage: {}, json: { files: [{ path: 'ListBookings.cs', content: 'var rows = db.Bookings.Where(b => b.TenantId == tenant.Id).ToList();' }] } }),
  });
  assert.equal(good.ok, true);

  // One that ignores it.
  const bad = await runFixture(root, found[0], parseSkillTest(withGiven), {
    ask: async () => ({ model: 'stub', usage: {}, json: { files: [] } }),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.failures.join(' '), /does not contain/);
});

test('a skill that creates where it should extend fails its no-file expectation', async () => {
  const { runFixture, parseSkillTest } = await import('../src/skills.js');
  const root = await withSkill(await project());
  await mkdir(join(root, 'fixtures/tenant'), { recursive: true });
  await writeFile(join(root, 'fixtures/tenant/ListBookings.cs'), 'var rows = db.Bookings.ToList();');

  const withGiven = SKILL_TEST.replace('expect:', 'given: fixtures/tenant/\nexpect:').replace('src/ListBookings.cs', 'ListBookings.cs');
  const { skills: found } = await listSkills(root, {});

  const result = await runFixture(root, found[0], parseSkillTest(withGiven), {
    ask: async () => ({
      model: 'stub',
      usage: {},
      json: { files: [
        { path: 'ListBookings.cs', content: 'var rows = db.Bookings.Where(b => b.TenantId == tenant.Id).ToList();' },
        { path: 'src/TenantFilter.cs', content: 'class TenantFilter {}' },
      ] },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /must extend rather than create/);
});

test('a model that will not answer in the shape asked for is a failed run, not a pass', async () => {
  const { runFixture, parseSkillTest } = await import('../src/skills.js');
  const root = await withSkill(await project());
  await mkdir(join(root, 'fixtures/tenant'), { recursive: true });
  await writeFile(join(root, 'fixtures/tenant/a.cs'), 'x');

  const withGiven = SKILL_TEST.replace('expect:', 'given: fixtures/tenant/\nexpect:');
  const { skills: found } = await listSkills(root, {});
  const result = await runFixture(root, found[0], parseSkillTest(withGiven), {
    ask: async () => ({ model: 'stub', usage: {}, json: null, text: 'I would add a filter.' }),
  });

  assert.equal(result.ok, false);
  assert.match(result.why, /did not answer with the file list/);
});

test('replay re-raises the asks and names the ones the new prompt stopped raising', async () => {
  const { replay: replayStage } = await import('../src/prompts.js');
  const root = await project();
  const { openAsk } = await import('../src/folder/asks.js');
  await openAsk(root, { ask: 'Who uses this system and in what roles?', plain: 'Who uses this?', stage: 1 }, 'vibekit');
  await openAsk(root, { ask: 'How long do we keep personal data?', plain: 'How long do we keep data?', stage: 1 }, 'vibekit');

  const result = await replayStage(root, {
    stage: 1,
    ask: async () => ({
      model: 'stub',
      usage: {},
      json: { asks: [
        { question: 'Who uses this system, and in which roles?', blocking: true },
        { question: 'Which browsers must this support?', blocking: false },
      ] },
    }),
  });

  assert.equal(result.rerun.asksNow.length, 2);
  assert.deepEqual(result.rerun.newlyAsked, ['Which browsers must this support?']);
  assert.ok(result.rerun.noLongerAsked.some((question) => /personal data/.test(question)),
    'a question the old prompt raised and this one does not is the regression worth catching');
  assert.ok(!result.rerun.noLongerAsked.some((question) => /Who uses/.test(question)), 'the same question reworded is not a regression');
});

test('a run is refused with the specific reason, never attempted without a credential', async () => {
  const { unavailable } = await import('../src/agent.js');
  const root = await project();
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const why = await unavailable(root, { role: 'implementer' });
    assert.match(why, /No tier mapping yet|ANTHROPIC_API_KEY is not set/);

    await assert.rejects(() => run(['test-skills', '--run', '--dir', root]), /--run needs a model/);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ---------------------------------------------------------------- smoke against a deploy (§23)

test('the smoke command is read from map.md, where commands are allowed to live', async () => {
  const { smokeCommand, healthChecks, DEFAULT_CHECKS } = await import('../src/smoke.js');
  const root = await project();
  assert.equal(await smokeCommand(root), null);

  const path = join(root, 'vibekit/product/map.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/^test\s+.*$/m, (line) => `${line}\nsmoke     npm run smoke`));
  assert.equal(await smokeCommand(root), 'npm run smoke');

  assert.deepEqual(await healthChecks(root), [...DEFAULT_CHECKS], 'the walking skeleton answers health and ready');
});

test('a red probe names the deploy as the problem, and the rollback as the response', async () => {
  const { smoke, verdict } = await import('../src/smoke.js');
  const root = await project();

  const answers = { '/health': 200, '/ready': 503 };
  // The guard resolves the host before probing; a test address resolves to something public.
  const resolve = async () => [{ address: '93.184.216.34' }];
  const results = await smoke(root, {
    url: 'http://deployed.test',
    resolve,
    fetchImpl: async (url) => ({ ok: answers[new URL(url).pathname] === 200, status: answers[new URL(url).pathname], headers: { get: () => null } }),
  });

  assert.equal(results.ok, false);
  assert.equal(results.probes.length, 2);

  const said = verdict(results, { tag: 'v1.0.0' });
  assert.match(said.line, /this is a deploy problem, not a code problem/);
  assert.match(said.next, /vibekit ship rollback v1\.0\.0/);
});

test('a green smoke says so, and nothing to run says that instead of passing', async () => {
  const { smoke, verdict } = await import('../src/smoke.js');
  const root = await project();

  const green = await smoke(root, { url: 'http://deployed.test', resolve: async () => [{ address: '93.184.216.34' }], fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null } }) });
  assert.equal(verdict(green).ok, true);

  const nothing = await smoke(root, {});
  assert.equal(nothing.ran, false);
  assert.equal(verdict(nothing).ok, null, 'nothing ran is not the same as nothing failed');
  assert.match(verdict(nothing).line, /names no smoke command/);
});

test('a probe that times out is told apart from one that was refused', async () => {
  const { probe } = await import('../src/smoke.js');

  const resolve = async () => [{ address: '93.184.216.34' }];
  const refused = await probe('http://x.test/health', { resolve, fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null } }) });
  assert.match(refused.why, /it answered 503/);

  const silent = await probe('http://x.test/health', {
    timeoutMs: 5,
    resolve,
    fetchImpl: async () => { throw new Error('The operation was aborted due to timeout'); },
  });
  assert.match(silent.why, /nothing answered within 5ms/, 'answered-and-said-no and nothing-answered have different causes');
});

// ---------------------------------------------------------------- serving without blocking

test('the tracker can be checked without starting a server that never returns', async () => {
  const root = await project();
  const output = await capture(() => run(['tracker', '--dry-run', '--dir', root]));

  assert.match(output, /would serve vibekit\//);
  assert.match(output, /approvers/);
  assert.match(output, /Nothing was started/, 'a server that blocks is right for a person and wrong for a script');
});
