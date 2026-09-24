import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { isOpen, listAsks } from '../src/folder/asks.js';
import { writeCheckpoint } from '../src/folder/checkpoint.js';
import { generateFolder } from '../src/folder/generate.js';
import { checkpointDrift, claimedCriteria, reconcile, verifyCheckpoint } from '../src/folder/reconcile.js';
import { claim, listRequirements } from '../src/folder/requirements.js';
import { CALIBRATION_THRESHOLD, MODES, calibration, checkRunners, decide, parsePreferences, parseRunners } from '../src/runners.js';
import { TOOLS, createServer } from '../src/serve/mcp.js';
import { allowsPath, loadsFor, parseLoads, refuseCommand, refuseLoad, refuseWrite } from '../src/serve/loads.js';
import {
  CADENCE_LIMIT, COMPACTION_ORDER, cadence, compactionBrief, nextSessionId, readSessions,
  record, refuseRead, roomForWork, trimBuildOutput, trimGrep, trimTestOutput, windowState,
} from '../src/session.js';
import { gitInit, sh } from './helpers.js';

/**
 * The agent runner and the rules it enforces. Specification §55, §60, §62 and Appendix A.
 *
 * These tests are about the difference between a manifest and a comment. Every stage prompt
 * already declares what it may read and write; without something refusing the read, that
 * declaration is a suggestion, and the loading budget the format rests on is a number nobody
 * keeps to.
 */

const CONFIG = {
  name: 'bookings', description: 'A booking system for gyms.', architecture: 'clean',
  stack: { language: '.NET 10' }, commands: { build: 'dotnet build', test: 'dotnet test' },
  entities: [
    { name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] },
    { name: 'Member', class: 'personal', fields: [{ name: 'email', type: 'string', class: 'personal' }] },
  ],
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-serve-'));
  await generateFolder(root, CONFIG);
  return root;
}

async function withHeldRequirement(root) {
  await run(['req', 'new', 'members can book a class', '--dir', root]);
  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8'))
    .replace(/^size:.*$/m, 'size: M')
    .replace(/^status:.*$/m, 'status: in-progress')
    .replace(/^source:.*$/m, 'source: product/context.md')
    .replace(/^entities:.*$/m, 'entities: [Booking, Member]')
    .replace(/## Acceptance\n[\s\S]*?(?=\n## )/, '## Acceptance\n\n- AC-1 When a member books, the system shall create a booking.\n- AC-2 If the class is full, then the system shall refuse the booking.\n'));
  await claim(root, { id: 'REQ-001', role: 'implementer', runner: 'cli' });
  return path;
}

const RUNNERS = `## Runners

\`\`\`
- id: claude-code
  kind: seat · mcp: yes · sandbox: partial · unattended: no
  models-available: [strong, mid]
  seats: 4 · rate-limit: per-5h window
  good-at: [implementation, review, long sessions]
- id: cursor
  kind: seat · mcp: yes · sandbox: no · unattended: no
  models-available: [strong, mid, cheap]
  seats: 6
- id: api-sonnet
  kind: api · mcp: n/a · sandbox: full · unattended: yes
  tier: mid · residency: eu-west
- id: api-haiku
  kind: api · sandbox: full · unattended: yes
  tier: cheap
\`\`\`

## Routing preferences

- unattended work → api runners only
- review → never the same runner **and** model as the implementer
`;

const runners = () => parseRunners(RUNNERS);

// ---------------------------------------------------------------- routing across runners (§62)

test('a runner entry is read with its kind, sandbox, tiers and seats', () => {
  const parsed = runners();
  assert.deepEqual(parsed.map((runner) => runner.id), ['claude-code', 'cursor', 'api-sonnet', 'api-haiku']);

  const seat = parsed[0];
  assert.equal(seat.kind, 'seat');
  assert.equal(seat.sandbox, 'partial');
  assert.equal(seat.unattended, false);
  assert.deepEqual(seat.models, ['strong', 'mid']);
  assert.equal(seat.seats, 4);
  assert.equal(seat.rateLimit, 'per-5h window');

  // A key the spec does not name is kept rather than dropped: §52 reads residency.
  assert.equal(parsed[2].residency, 'eu-west');
});

test('attended work goes to a seat, because its marginal cost is zero until the rate limit', () => {
  const decision = decide({ runners: runners(), role: 'implementer', size: 'M', tier: 'mid', attended: true });
  assert.equal(decision.runner.id, 'claude-code');
  assert.equal(decision.runner.kind, 'seat');
  assert.match(decision.reasons.join(' '), /marginal cost is zero/);
});

test('unattended work goes to an api runner, because no seat is available at all', () => {
  const decision = decide({ runners: runners(), role: 'implementer', size: 'S', tier: 'cheap', attended: false });
  assert.equal(decision.runner.kind, 'api');
  assert.equal(decision.runner.unattended, true);
  assert.match(decision.reasons.join(' '), /nobody is at a keyboard/);
});

test('the tier binds on an api runner and is only a minimum on a seat', () => {
  const seat = decide({ runners: runners(), role: 'implementer', size: 'M', tier: 'mid', attended: true });
  assert.equal(seat.binding, false);
  assert.equal(seat.minimum, 'mid', 'VibeKit cannot reach inside a seat to pick the model, so it states a floor');

  const api = decide({ runners: runners(), role: 'implementer', size: 'M', tier: 'mid', attended: false });
  assert.equal(api.binding, true);
  assert.equal(api.minimum, null);
});

test('a seat whose plan cannot reach the required tier is refused rather than quietly used', () => {
  const weak = parseRunners('## Runners\n\n- id: cheap-seat\n  kind: seat · sandbox: no · unattended: no\n  models-available: [cheap]\n');
  const decision = decide({ runners: weak, role: 'planner', tier: 'strong', attended: true });

  assert.equal(decision.runner, null);
  assert.match(decision.refusal, /needs at least strong/);
  assert.match(decision.reasons.join(' '), /cannot select at least strong is refused/);
});

test('classified data and size L need a sandbox, or a seat with a person present', () => {
  const attended = decide({ runners: runners(), role: 'implementer', size: 'L', classes: ['financial'], tier: 'strong', attended: true });
  assert.equal(attended.runner.id, 'claude-code', 'a seat means a named human is at the keyboard');

  // Unattended, the same work may only go somewhere fully sandboxed and strong enough. Here no
  // api runner reaches strong, so that is the reason it is refused.
  const unattended = decide({ runners: runners(), role: 'implementer', size: 'L', classes: ['secret'], tier: 'strong', attended: false });
  assert.equal(unattended.runner, null);
  assert.match(unattended.reasons.join(' '), /cannot select at least strong/);
});

test('an unsandboxed runner cannot take classified work even when it is strong enough', () => {
  const loose = parseRunners([
    '## Runners', '',
    '- id: api-loose',
    '  kind: api · sandbox: no · unattended: yes',
    '  tier: strong',
  ].join('\n'));

  const decision = decide({ runners: loose, role: 'implementer', size: 'M', classes: ['secret'], tier: 'strong', attended: false });
  assert.equal(decision.runner, null);
  assert.match(decision.reasons.join(' '), /needs sandbox: full/);

  // The same runner is fine for work that touches nothing classified.
  assert.equal(decide({ runners: loose, role: 'implementer', size: 'M', tier: 'strong', attended: false }).runner.id, 'api-loose');
});

test('a rate-limited seat is itself a reason to move, and the next one takes the work', () => {
  const decision = decide({ runners: runners(), role: 'implementer', size: 'M', tier: 'mid', attended: true, rateLimited: ['claude-code'] });
  assert.equal(decision.runner.id, 'cursor');
  assert.match(decision.reasons.join(' '), /claude-code is rate-limited, which is itself a reason to move/);
});

test('review never runs on the same runner as the implementation', () => {
  const decision = decide({
    runners: runners(), role: 'reviewer', size: 'M', tier: 'strong', attended: true,
    implementer: { runner: 'claude-code' },
  });
  assert.equal(decision.runner.id, 'cursor');
  assert.match(decision.reasons.join(' '), /shares the implementer's blind spots/);
});

test('when no seat qualifies, the work falls back to an api runner at the required tier', () => {
  const decision = decide({ runners: runners(), role: 'implementer', size: 'S', tier: 'cheap', attended: true, rateLimited: ['claude-code', 'cursor'] });
  assert.equal(decision.runner.kind, 'api');
  assert.match(decision.reasons.join(' '), /no seat qualified/);
});

test('the mode changes concurrency and tier, never the gates', () => {
  assert.deepEqual(Object.keys(MODES), ['thrift', 'balanced', 'sprint']);
  assert.equal(MODES.thrift.lanes, 1);
  assert.equal(MODES.balanced.lanes, 2);
  assert.equal(MODES.sprint.batch, false);

  const sprint = decide({ runners: runners(), role: 'implementer', size: 'M', tier: 'mid', attended: true, mode: 'sprint' });
  assert.equal(sprint.tier, 'strong', 'sprint buys speed with money by cutting rework');
  assert.match(sprint.reasons.join(' '), /one tier above policy/);
});

test('while calibration is on, size S runs a tier up rather than on cheap', () => {
  const calibrating = decide({ runners: runners(), role: 'implementer', size: 'S', tier: 'cheap', attended: true, calibrate: true });
  assert.equal(calibrating.tier, 'mid');
  assert.match(calibrating.reasons.join(' '), /calibrate: true/);

  const settled = decide({ runners: runners(), role: 'implementer', size: 'S', tier: 'cheap', attended: true, calibrate: false });
  assert.equal(settled.tier, 'cheap');
});

test('calibration proposes dropping to cheap only under the escalation threshold, and a human accepts', () => {
  const small = (escalated) => ({ role: 'implementer', size: 'S', escalated });
  const clean = calibration([...Array(19).fill(small(false)), small(true)]);
  assert.ok(clean.rate < CALIBRATION_THRESHOLD);
  assert.match(clean.proposal, /drop size S to cheap/);
  assert.match(clean.why, /A human accepts this; it is not applied automatically/);

  const noisy = calibration([...Array(14).fill(small(false)), ...Array(6).fill(small(true))]);
  assert.equal(noisy.proposal, null);
  assert.match(noisy.why, /the mapping in app settings, not the policy/);

  assert.equal(calibration([]).enough, false);
});

test('routing preferences are kept as written, because a person reads them too', () => {
  const preferences = parsePreferences(RUNNERS);
  assert.equal(preferences[0].when, 'unattended work');
  assert.equal(preferences[0].then, 'api runners only');
});

test('check --runners reports unsandboxed runners, missing tiers and idle seats', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/agents/runners.md'), `${RUNNERS}\n- id: api-broken\n  kind: api · sandbox: full · unattended: yes\n`);

  const report = await checkRunners(root, { sessions: [{ runner: 'claude-code' }] });
  const codes = report.findings.map((finding) => finding.code);
  assert.ok(codes.includes('runners.unsandboxed'));
  assert.ok(codes.includes('runners.idleSeats'), 'a seat you have already bought is the cheapest thing you own');

  const idle = report.utilisation.find((row) => row.id === 'cursor');
  assert.equal(idle.sessions, 0);
  assert.equal(report.utilisation.find((row) => row.id === 'claude-code').sessions, 1);
});

// ---------------------------------------------------------------- the loads manifest (§55)

test('a stage prompt declares what it may read, and it is parsed as a manifest not as prose', async () => {
  const root = await project();
  const manifest = loadsFor(await readFile(join(root, 'vibekit/workflow/stages/5-build.md'), 'utf8'));

  assert.equal(manifest.role, 'implementer');
  assert.ok(manifest.patterns.length > 3);
  assert.ok(manifest.writes.length);
  assert.ok(manifest.never.length);
});

test('a memory topic list is not mistaken for a set of paths', () => {
  const patterns = parseLoads('[standards/*, memory:[domain, glossary], product/map.md]');
  assert.deepEqual(patterns, ['standards/*', 'memory:[domain; glossary]', 'product/map.md']);
  assert.equal(allowsPath(patterns, 'product/map.md'), true);
  assert.equal(allowsPath(patterns, 'domain'), false, 'a topic is not a file');
});

test('a directory pattern covers what is under it, and nothing beside it', () => {
  const patterns = ['standards/*', 'product/map.md'];
  assert.equal(allowsPath(patterns, 'standards/code-style.md'), true);
  assert.equal(allowsPath(patterns, 'standards/rules.md'), true);
  assert.equal(allowsPath(patterns, 'product/map.md'), true);
  assert.equal(allowsPath(patterns, 'product/entities.md'), false, 'a sibling is not covered');
  assert.equal(allowsPath(patterns, 'workflow/plan.md'), false);
});

test('a read outside the manifest is refused with what to do instead', () => {
  const patterns = ['standards/*', 'product/map.md'];
  assert.equal(refuseLoad('vibekit/standards/rules.md', { patterns }), null);

  const why = refuseLoad('vibekit/workflow/plan.md', { patterns });
  assert.match(why, /outside this stage's loads manifest/);
  assert.match(why, /write an ask/, 'an agent that wants to read more asks');

  // Application code is the work, not the rules: the manifest governs the folder only.
  assert.equal(refuseLoad('src/Api/Bookings.cs', { patterns }), null);
});

test('a file the requirement cites is readable even when the manifest does not list it', () => {
  const patterns = ['standards/*'];
  assert.match(refuseLoad('product/sources/brs.md', { patterns }), /refused/);
  assert.equal(refuseLoad('product/sources/brs.md', { patterns, cited: ['product/sources/brs.md'] }), null);
});

test('a write is refused on a denied path, inside never, or outside writes', () => {
  const options = { writes: ['src/**', 'tests/**'], never: ['vibekit/**'], denied: ['infra/'], folder: 'vibekit' };

  assert.equal(refuseWrite('src/Api/Bookings.cs', options), null);
  assert.match(refuseWrite('infra/main.tf', options), /denied path/);
  assert.match(refuseWrite('infra/main.tf', options), /not a judgement call/);
  assert.match(refuseWrite('docs/hld.md', options), /outside this stage's `writes:` list/);

  // A TODO placeholder is not a rule, and must not deny everything by accident.
  assert.equal(refuseWrite('src/x.cs', { ...options, denied: ['TODO: a path'] }), null);
});

test('a command nobody listed is refused, and a denied one is refused first', () => {
  const guardrails = '# Guardrails\n\n## Allowed commands\n\n- dotnet build\n- dotnet test\n\n## Denied commands\n\n- rm -rf\n';

  assert.equal(refuseCommand('dotnet test', guardrails), null);
  assert.match(refuseCommand('curl http://example.com', guardrails), /not on the allowed list/);
  assert.match(refuseCommand('rm -rf /', guardrails), /on the denied list/);

  // With nothing listed there is nothing to enforce, and inventing a list would refuse real work.
  assert.equal(refuseCommand('anything', '# Guardrails\n'), null);
});

// ---------------------------------------------------------------- the context window (§60)

test('the soft limit asks for a checkpoint and the hard limit ends the session cleanly', () => {
  assert.equal(windowState({ used: 100_000, window: 200_000 }).level, 'ok');

  const soft = windowState({ used: 125_000, window: 200_000 });
  assert.equal(soft.level, 'soft');
  assert.match(soft.action, /without starting another file/);

  const hard = windowState({ used: 165_000, window: 200_000 });
  assert.equal(hard.level, 'hard');
  assert.match(hard.action, /keep the requirement in-progress with the holder recorded/);
  assert.equal(hard.log, 'continued after context limit');
});

test('the room left for work accounts for the folder that is always loaded', () => {
  assert.equal(roomForWork(200_000), Math.round(200_000 * 0.8) - 4900 - 1500);
  assert.equal(roomForWork(1000), 0, 'a window too small for the folder leaves nothing, rather than a negative number');
});

test('test output is reduced to the summary and the failures, and nothing is discarded', () => {
  const trimmed = trimTestOutput([
    'ok 1 - lists bookings', 'not ok 2 - cancels a booking', '  AssertionError [ERR_ASSERTION]: expected 1',
    'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1', 'some unrelated chatter', 'more chatter',
  ].join('\n'));

  assert.match(trimmed, /not ok 2/);
  assert.match(trimmed, /AssertionError/);
  assert.match(trimmed, /ℹ fail 1/);
  assert.doesNotMatch(trimmed, /unrelated chatter/, 'test logs are the largest avoidable input on most sessions');
});

test('build output is reduced to errors and warnings, and grep to the first fifty hits', () => {
  assert.match(trimBuildOutput('Restoring...\nBookings.cs(41,9): error CS0246: not found\nDone.'), /error CS0246/);
  assert.doesNotMatch(trimBuildOutput('Restoring...\nBookings.cs(41,9): error CS0246: x\nDone.'), /Restoring/);

  const many = Array.from({ length: 80 }, (_, index) => `src/f${index}.cs:1: match`).join('\n');
  const trimmed = trimGrep(many);
  assert.equal(trimmed.split('\n').length, 51);
  assert.match(trimmed, /30 more hit\(s\)/);
});

test('a read of a long file is refused unless a line range is named', () => {
  const long = 'line\n'.repeat(400);
  assert.match(refuseRead(long), /over the 300-line limit/);
  assert.equal(refuseRead(long, { range: '1-50' }), null);
  assert.equal(refuseRead('line\n'.repeat(10)), null);
});

test('the compaction re-send is a fixed order, so a provider cache can hold', () => {
  assert.deepEqual([...COMPACTION_ORDER], [
    'standards/*',
    'the requirement file, which now includes the checkpoint',
    'the entity sections the requirement names',
    'the evidence block so far',
  ]);
  const brief = compactionBrief('REQ-014');
  assert.match(brief, /1\. standards\/\*/);
  assert.match(brief, /continue from `next:` rather than re-planning/);
});

test('past twelve tool calls with no checkpoint, writes are refused until one is written', () => {
  assert.equal(cadence({ callsSinceCheckpoint: 5 }).due, false);

  const step = cadence({ callsSinceCheckpoint: 3, stepCompleted: true });
  assert.equal(step.due, true);
  assert.equal(step.refuseWrites, false, 'a completed step asks; it does not block');

  const over = cadence({ callsSinceCheckpoint: CADENCE_LIMIT });
  assert.equal(over.refuseWrites, true);
  assert.match(over.instruction, /file writes are refused until you do/);
});

test('sessions are numbered and recorded with the runner, the tier and why', async () => {
  const root = await project();
  assert.equal(nextSessionId([]), 's-0001');
  assert.equal(nextSessionId([{ id: 's-0009' }]), 's-0010');

  await record(root, { id: 's-0001', role: 'implementer', runner: 'claude-code', tier: 'mid', model: 'claude-sonnet-5', why: ['a seat was available'], input: 1000, output: 200, ended: 'handoff' });
  const [session] = await readSessions(root);

  assert.equal(session.runner, 'claude-code');
  assert.equal(session.tier, 'mid');
  assert.deepEqual(session.why, ['a seat was available']);
  assert.equal(session.ended, 'handoff');
});

// ---------------------------------------------------------------- not trusting the last session (§60)

test('a checkpoint may only claim what verify confirms, and is rewritten when it claims more', async () => {
  const root = await project();
  await withHeldRequirement(root);
  await writeCheckpoint(root, 'REQ-001', {
    done: 'AC-1 passing · AC-2 passing',
    hand: 'the controller',
    next: 'tidy up',
  });

  // The claims are read from the checkpoint's own done: line, not from the Acceptance section.
  assert.deepEqual(claimedCriteria(await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8')), ['AC-1', 'AC-2']);

  // verify confirms AC-1 only.
  const result = await verifyCheckpoint(root, 'REQ-001', { prove: async () => ['AC-1'] });

  assert.deepEqual(result.claimed, ['AC-1', 'AC-2']);
  assert.deepEqual(result.overclaimed, ['AC-2']);
  assert.equal(result.finding.code, 'claim');

  const body = await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8');
  assert.match(body, /done: +AC-1 \(corrected on resume\)/, 'the agent never gets to inherit its own optimism');
  assert.match(body, /AC-2 were claimed done and did not pass/);
  assert.match(body, /claim: the checkpoint claimed AC-2 done/, 'logged against the session that wrote it');
});

test('a checkpoint whose claims all hold is left exactly as it was', async () => {
  const root = await project();
  await withHeldRequirement(root);
  await writeCheckpoint(root, 'REQ-001', { done: 'AC-1 passing', hand: 'the controller', next: 'AC-2' });
  const before = await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8');

  const result = await verifyCheckpoint(root, 'REQ-001', { prove: async () => ['AC-1'] });
  assert.deepEqual(result.overclaimed, []);
  assert.equal(await readFile(join(root, 'vibekit/product/requirements/REQ-001.md'), 'utf8'), before);
});

test('a checkpoint naming no criterion is not treated as a claim', async () => {
  const root = await project();
  await withHeldRequirement(root);
  await writeCheckpoint(root, 'REQ-001', { done: 'scaffolding', hand: 'the controller', next: 'write the test' });

  const result = await verifyCheckpoint(root, 'REQ-001', { prove: async () => { throw new Error('verify must not run'); } });
  assert.equal(result.checked, false);
  assert.match(result.why, /names no criterion/);
});

test('files changed since the checkpoint and not described by it must be reconciled first', async () => {
  const root = await project();
  await withHeldRequirement(root);
  gitInit(root);
  await writeCheckpoint(root, 'REQ-001', { done: 'AC-1 test', hand: 'Bookings.cs, half wired', next: 'make AC-1 pass' });
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'wip');

  await writeFile(join(root, 'Bookings.cs'), 'half wired');
  await writeFile(join(root, 'Surprise.cs'), 'nobody mentioned this');

  const result = await reconcile(root, 'REQ-001', {});
  assert.ok(result.undescribed.includes('Surprise.cs'));
  assert.ok(!result.undescribed.includes('Bookings.cs'), 'the checkpoint already names it, so it is not a surprise');
  assert.match(result.instruction, /Keep, revert or describe each one/);
  assert.match(result.instruction, /Nothing in an unreconciled worktree is built upon/);
});

test('a denied path that changed under the session is reverted automatically and logged', async () => {
  const root = await project();
  await withHeldRequirement(root);
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# Guardrails\n\n## Denied paths\n\n- infra/  the platform team owns this\n');
  gitInit(root);
  await writeCheckpoint(root, 'REQ-001', { done: 'AC-1 test', hand: 'the controller', next: 'make it pass' });
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'wip');

  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'infra'), { recursive: true });
  await writeFile(join(root, 'infra/main.tf'), 'resource "x" {}');
  sh(root, 'git', 'add', '-A');
  await writeFile(join(root, 'infra/main.tf'), 'resource "x" { changed = true }');

  const result = await reconcile(root, 'REQ-001', { apply: true });
  assert.ok(result.reverted.includes('infra/main.tf'), 'a denied path is not a judgement call for the resumed agent');

  const [requirement] = await listRequirements(root);
  assert.match(requirement.log.join('\n'), /reverted on resume: infra\/main\.tf/);
});

test('a requirement that changed under the session makes its checkpoint stale', async () => {
  const root = await project();
  const path = await withHeldRequirement(root);
  await writeCheckpoint(root, 'REQ-001', { done: 'AC-1 and AC-2 tests', hand: 'the controller', next: 'implement' });

  const [before] = await listRequirements(root);
  assert.equal(checkpointDrift(before).stale, false);

  // A human edited a criterion from the tracker while the session was running.
  await writeFile(path, (await readFile(path, 'utf8')).replace('- AC-2 If the class is full, then the system shall refuse the booking.', ''));
  const [after] = await listRequirements(root);

  const drift = checkpointDrift(after);
  assert.equal(drift.stale, true);
  assert.match(drift.why, /AC-2 no longer exist/);
  assert.match(drift.instruction, /Re-plan from `## Approach`/);
});

// ---------------------------------------------------------------- the MCP server (Appendix A)

test('the server exposes the tools Appendix A names, each a wrapper over a file operation', () => {
  for (const name of ['vibekit_status', 'vibekit_load', 'vibekit_ask', 'vibekit_log', 'vibekit_remember', 'vibekit_lookup']) {
    assert.ok(TOOLS.some((tool) => tool.name === name), `${name} is not exposed`);
  }
  for (const tool of TOOLS) assert.ok(tool.description && tool.inputSchema, `${tool.name} is not described`);
});

test('it speaks JSON-RPC, so any MCP client can drive it', async () => {
  const root = await project();
  const server = createServer(root, {});

  const initialised = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(initialised.result.serverInfo.name, 'vibekit');
  assert.match(initialised.result.instructions, /The folder is the only interface/);

  assert.equal((await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length, TOOLS.length);
  assert.equal(await server.handle({ jsonrpc: '2.0', id: 3, method: 'notifications/initialized' }), null);
  assert.match((await server.handle({ jsonrpc: '2.0', id: 4, method: 'nonsense' })).error.message, /Method not found/);
});

test('load hands back the checkpoint first, then the requirement and only the entities it names', async () => {
  const root = await project();
  await withHeldRequirement(root);
  await writeCheckpoint(root, 'REQ-001', { done: 'AC-1 test', hand: 'the controller', next: 'make AC-1 pass' });

  const server = createServer(root, {});
  const { content } = await server.call('vibekit_load', { requirement: 'REQ-001' });
  const body = content[0].text;

  assert.ok(body.indexOf('## Checkpoint') < body.indexOf('# REQ-001') || body.startsWith('## Checkpoint'),
    'the checkpoint comes first, or a session re-plans before reading it');
  assert.match(body, /Continue from `next:`/);
  assert.match(body, /## Booking/);
  assert.match(body, /## Member/);
});

test('an entity the requirement names but the folder does not define is an ask, not a name to invent', async () => {
  const root = await project();
  const path = await withHeldRequirement(root);
  await writeFile(path, (await readFile(path, 'utf8')).replace('entities: [Booking, Member]', 'entities: [Booking, Refund]'));

  const server = createServer(root, {});
  const { content } = await server.call('vibekit_load', { requirement: 'REQ-001' });
  assert.match(content[0].text, /## Refund\n_not in product\/entities\.md — that is an ask/);
});

test('a read outside the stage manifest is refused through the server, and the attempt is recorded', async () => {
  const root = await project();
  const server = createServer(root, {});

  const refusal = await server.call('vibekit_load', { path: 'vibekit/workflow/plan.md' });
  assert.equal(refusal.isError, true);
  assert.match(refusal.content[0].text, /outside this stage's loads manifest/);
  assert.deepEqual(server.state.refusedReads, ['vibekit/workflow/plan.md'], 'a pattern of refusals is a manifest that is wrong');
});

test('an ask written through the server lands in the folder as a real ask', async () => {
  const root = await project();
  const server = createServer(root, {});

  const result = await server.call('vibekit_ask', {
    body: 'Do refunds go back to the original card?',
    plain: 'If we refund somebody, does the money go back to the card they paid with?',
  });
  assert.match(result.content[0].text, /written to vibekit\/workflow\/asks\//);
  assert.match(result.content[0].text, /an ask you carry on past is an assumption/);

  const asks = (await listAsks(root, 'vibekit')).filter(isOpen);
  assert.equal(asks.length, 1);
});

test('remember is a proposal, never a write into memory', async () => {
  const root = await project();
  const server = createServer(root, {});

  const result = await server.call('vibekit_remember', { line: 'bookings are never hard-deleted' });
  assert.match(result.content[0].text, /proposed, not recorded/);

  const asks = await listAsks(root, 'vibekit');
  assert.equal(asks[0].kind, 'proposal');
});

test('a command the guardrails do not allow is refused before anything runs', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# Guardrails\n\n## Allowed commands\n\n- dotnet test\n');

  let ran = false;
  const server = createServer(root, { run: async () => { ran = true; return { code: 0, output: '' }; } });

  const refusal = await server.call('vibekit_run', { command: 'curl http://example.com' });
  assert.equal(refusal.isError, true);
  assert.equal(ran, false, 'refused before anything runs, not after');

  const allowed = await server.call('vibekit_run', { command: 'dotnet test', kind: 'test' });
  assert.equal(allowed.isError, undefined);
  assert.equal(ran, true);
});

test('a write is refused past the cadence limit, and a checkpoint is what lifts it', async () => {
  const root = await project();
  const server = createServer(root, {});

  for (let call = 0; call < CADENCE_LIMIT; call += 1) await server.call('vibekit_status');
  assert.match(await server.mayWrite('src/Api/Bookings.cs'), /file writes are refused until you do/);

  // The checkpoint lifts the cadence refusal. What is left is the stage's own writes list, which
  // is a different rule: this project is at stage 0, and stage 0 does not write application code.
  server.checkpointWritten();
  assert.doesNotMatch(await server.mayWrite('src/Api/Bookings.cs') ?? '', /file writes are refused until you do/);
  assert.equal(await server.mayWrite('vibekit/product/sources/index.md'), null, 'stage 0 writes the sources index');
});

test('a compaction is answered with the fixed re-send order, and counted', async () => {
  const root = await project();
  const server = createServer(root, {});

  const brief = server.compacted('REQ-001');
  assert.match(brief, /Your context was compacted/);
  assert.match(brief, /standards\/\*/);
  assert.equal(server.state.compactions, 1);
});

test('an unknown tool is named as unknown rather than failing silently', async () => {
  const server = createServer(await project(), {});
  const result = await server.call('vibekit_delete_everything');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No such tool/);
});

// ---------------------------------------------------------------- what the agent walk caught

test('a manifest entry with prose after the path still yields the path', async () => {
  const { parseLoads, pathToken } = await import('../src/serve/loads.js');
  // These are the real stage 5 entries. Taken whole, `src/** per map.md` matched nothing and an
  // implementer could not write a line of application code through the server.
  const writes = parseLoads("[src/** per map.md, tests/**, the requirement's Approach, Checkpoint, Evidence and Log, workflow/asks/P-*.md, memory/sessions/<today>.md]");
  assert.deepEqual(writes, ['src/**', 'tests/**', 'workflow/asks/P-*.md', 'memory/sessions/*.md']);

  const never = parseLoads('[vibekit/** otherwise, migrations unless map.md allows, any guardrails.md denied path, plan.md, architecture.md, any other requirement]');
  assert.ok(never.includes('vibekit/**'), '"vibekit/** otherwise" protected nothing when taken whole');
  assert.ok(never.includes('plan.md'));

  assert.equal(pathToken("the requirement's Approach"), null, 'an entry with no path is dropped, not mangled');
  assert.equal(pathToken('product/entities.md#<named entities>'), 'product/entities.md');
});

test('a bare file name in a manifest names that file wherever it lives', () => {
  assert.equal(allowsPath(['plan.md'], 'workflow/plan.md'), true);
  assert.equal(allowsPath(['plan.md'], 'workflow/plan.md.bak'), false);
  assert.equal(allowsPath(['plan.md'], 'plan.mdx'), false);
});

test('the implementer writes the requirement it holds and no other', async () => {
  const root = await project();
  await withHeldRequirement(root);
  await run(['req', 'new', 'another thing', '--dir', root]);
  const server = createServer(root, {});

  assert.equal(await server.mayWrite('vibekit/product/requirements/REQ-001.md'), null, 'its own Approach, Checkpoint, Evidence and Log');
  assert.match(await server.mayWrite('vibekit/product/requirements/REQ-002.md'), /another requirement/);
  assert.match(await server.mayWrite('vibekit/product/requirements/../../x.md'), /outside|another requirement/);
});

test('through the real stage 5 manifest, code is writable and the folder is not', async () => {
  const { loadsFor, refuseWrite } = await import('../src/serve/loads.js');
  const root = await project();
  const build = loadsFor(await readFile(join(root, 'vibekit/workflow/stages/5-build.md'), 'utf8'));
  const options = { writes: build.writes, never: build.never, denied: [], folder: 'vibekit', root };

  assert.equal(refuseWrite('src/Bookings/Cancel.cs', options), null);
  assert.equal(refuseWrite('tests/Cancel.Tests.cs', options), null);
  assert.equal(refuseWrite('vibekit/memory/sessions/2026-09-24.md', options), null, 'the one memory write an agent has');
  assert.equal(refuseWrite('vibekit/workflow/asks/P-001.md', options), null, 'a proposal is how it asks for more');
  assert.match(refuseWrite('vibekit/memory/repo/M-001.md', options), /never|writes/, 'an agent that could write memory would teach itself its own guesses');
  assert.match(refuseWrite('vibekit/standards/rules.md', options), /never/);
  assert.match(refuseWrite('vibekit/product/entities.md', options), /never/, 'an invented entity is a proposal, not an edit');
  assert.match(refuseWrite('vibekit/workflow/plan.md', options), /never/);
});

test('a skipped or focused test is found wherever it hides, and tested is refused for it', async () => {
  const { skippedTests } = await import('../src/folder/checks.js');
  const root = await project();
  await withHeldRequirement(root);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'tests'), { recursive: true });

  const cases = {
    'tests/a.test.ts': 'describe("x", () => { it.skip("cancels", () => {}); it("lists", () => {}); });',
    'tests/b.test.js': 'test.only("just this one", () => {});',
    'tests/Cancel.Tests.cs': '[Fact(Skip = "flaky")]\npublic void Cancel_Refunds() { }',
    'tests/test_refund.py': '@pytest.mark.skip\ndef test_refund(): pass',
    'tests/RefundTest.java': '@Disabled\nvoid refunds() {}',
    'tests/ok.test.ts': 'it("passes", () => {});',
  };
  for (const [path, body] of Object.entries(cases)) await writeFile(join(root, path), body);

  const hits = await skippedTests(root);
  assert.deepEqual(hits.map((hit) => hit.path).sort(), ['tests/Cancel.Tests.cs', 'tests/RefundTest.java', 'tests/a.test.ts', 'tests/b.test.js', 'tests/test_refund.py'],
    'every framework\'s way of skipping is one way of claiming coverage that is not there');

  const path = join(root, 'vibekit/product/requirements/REQ-001.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/## Evidence\n[\s\S]*?(?=\n## |$)/, '## Evidence\n\n```\ndotnet test  exit 0\n```\n'));
  await assert.rejects(() => run(['req', 'tested', 'REQ-001', '--dir', root]), /skipped or focused test/);

  const { runChecks } = await import('../src/folder/checks.js');
  const { findings } = await runChecks(root, {});
  assert.ok(findings.filter((finding) => finding.code === 'tests.skipped').length >= 5, 'and check reports each one');
});
