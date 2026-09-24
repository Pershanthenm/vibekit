import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateFolder } from '../src/folder/generate.js';
import { EVIDENCE_MIN, advise, effectiveCost, impactOf, performance, readSessions } from '../src/models/advise.js';
import { CAPS, DEFAULT_POLICY, TIERS, breached, escalation, loadCaps, loadPolicy, parsePolicy, tierFor } from '../src/models/policy.js';
import {
  costOf, diffProviders, isFirstParty, parseProvider, readTiers, refresh, registryState,
  renderProvider, renderTiers, validateProvider, writeTiers,
} from '../src/models/registry.js';
import './helpers.js';

/**
 * Model routing, cost control and the price registry. Specification §61 and §63.
 *
 * The tests that matter are the ones protecting a rule a hurried session would otherwise quietly
 * undo: review is never cheaper than the work it reviews; a wrong price is never written; and a
 * recommendation is never made on evidence that does not exist.
 */

const CONFIG = {
  name: 'bookings', description: 'A booking system for gyms.', architecture: 'clean',
  stack: { language: '.NET 10' }, commands: { test: 'dotnet test' },
  entities: [{ name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] }],
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-models-'));
  await generateFolder(root, CONFIG);
  return root;
}

// A registry of its own per test: it is per install, so tests must not share one.
const isolatedHome = async () => {
  const home = await mkdtemp(join(tmpdir(), 'vibekit-registry-'));
  process.env.VIBEKIT_HOME = home;
  return home;
};

const ANTHROPIC = `fetched: 2026-09-23T06:00Z
source: https://www.anthropic.com/pricing
models:
  - id: claude-haiku-4-5
    input: 1.00
    output: 5.00
    cache_read: 0.10
    context: 200000
    status: current
  - id: claude-sonnet-5
    input: 2.00
    output: 10.00
    status: current
  - id: claude-opus-5
    input: 5.00
    output: 25.00
    status: current
discounts:
  cache_hit: 0.10
  batch: 0.50
`;

// ---------------------------------------------------------------- tiers and policy (§61)

test('the folder names a tier, never a model, in ascending order of what it is trusted with', () => {
  assert.deepEqual([...TIERS], ['local', 'cheap', 'mid', 'strong']);
});

test('the policy is read from agents/humans.md, which is where a tech lead edits it', async () => {
  const root = await project();
  const { rules, declared } = await loadPolicy(root);
  assert.equal(declared, true, 'the folder generator writes a starting policy');
  assert.equal(tierFor(rules, { role: 'planner' }).tier, 'strong');
  assert.equal(tierFor(rules, { role: 'implementer', size: 'S' }).tier, 'cheap');
  assert.equal(tierFor(rules, { role: 'implementer', size: 'M' }).tier, 'mid');
});

test('a conditional tier is kept, so a classified requirement is not quietly built on the cheap one', () => {
  const rules = parsePolicy('## Model policy\n\n- implementer size L: mid, strong when it touches financial or secret data\n');
  assert.equal(tierFor(rules, { role: 'implementer', size: 'L' }).tier, 'mid');

  const sensitive = tierFor(rules, { role: 'implementer', size: 'L', classes: ['financial'] });
  assert.equal(sensitive.tier, 'strong');
  assert.match(sensitive.reasons.join(' '), /touches financial data/);
});

test('review is one tier above the work it reviews, and on a different model', () => {
  const rules = parsePolicy([
    '## Model policy', '',
    '- implementer size S: cheap',
    '- implementer size L: mid, strong when it touches financial or secret data',
    '- reviewer: one tier above the implementer, and a different model',
  ].join('\n'));

  assert.equal(tierFor(rules, { role: 'reviewer', size: 'S' }).tier, 'mid', 'review is where a cheap implementer\'s mistakes are caught');
  assert.equal(tierFor(rules, { role: 'reviewer', size: 'L' }).tier, 'strong');
  assert.equal(tierFor(rules, { role: 'reviewer', size: 'S' }).differentModel, true, 'the same model shares the implementer\'s blind spots');

  // A classified L already routes the implementer to strong; the reviewer cannot go higher, and
  // must not silently drop back down either.
  assert.equal(tierFor(rules, { role: 'reviewer', size: 'L', classes: ['secret'] }).tier, 'strong');
});

test('a policy file that says nothing falls back to the documented default, not to nothing', () => {
  assert.deepEqual(parsePolicy(''), [...DEFAULT_POLICY]);
  assert.equal(tierFor(parsePolicy('# Humans\n'), { role: 'planner' }).tier, 'strong');
});

test('a role the policy never mentions is reported, rather than routed to a guess', () => {
  const decision = tierFor(parsePolicy('## Model policy\n\n- planner: strong\n'), { role: 'migrator' });
  assert.equal(decision.tier, null);
  assert.match(decision.reasons[0], /no model policy line for migrator/);
});

// ---------------------------------------------------------------- escalation (§61)

test('escalation happens on evidence: a spent review budget, or a model that asserted something untrue', () => {
  assert.equal(escalation({ tier: 'cheap', reviewRounds: 1 }).escalate, false, 'one round is the budget being used, not spent');

  const spent = escalation({ tier: 'cheap', reviewRounds: 2 });
  assert.equal(spent.escalate, true);
  assert.equal(spent.to, 'mid');

  const lied = escalation({ tier: 'mid', reviewRounds: 0, findings: ['claim'] });
  assert.equal(lied.escalate, true);
  assert.equal(lied.to, 'strong');
  assert.match(lied.why, /does not get a second try at the same tier/);
});

test('escalation stops at the top tier rather than falling off it', () => {
  assert.equal(escalation({ tier: 'strong', findings: ['claim'] }).to, 'strong');
});

// ---------------------------------------------------------------- caps (§61)

test('a cap nobody set is reported as unset, never assumed', async () => {
  const root = await project();
  const caps = await loadCaps(root);
  assert.deepEqual(caps.map((cap) => cap.key), CAPS.map((cap) => cap.key));
  assert.ok(caps.every((cap) => cap.tokens === null), 'the starter profile sets no cap, and inventing one would stop a run nobody asked to stop');
});

test('a cap that was set is enforced as a ceiling, and its breach says what happens next', async () => {
  const root = await project();
  const path = join(root, 'vibekit/profile.md');
  const { readFile } = await import('node:fs/promises');
  await writeFile(path, (await readFile(path, 'utf8')).replace('budget-cap: 5500', 'budget-cap: 5500\ncap-requirement: 120_000'));

  const caps = await loadCaps(root);
  assert.equal(caps.find((cap) => cap.key === 'cap-requirement').tokens, 120000);
  assert.deepEqual(breached(caps, { 'cap-requirement': 119000 }), []);

  const over = breached(caps, { 'cap-requirement': 130000 });
  assert.equal(over.length, 1);
  assert.match(over[0].onBreach, /blocked with reason "over budget"/);
});

// ---------------------------------------------------------------- the registry (§63)

test('the registry parses prices, discounts and provenance, and round-trips', () => {
  const file = parseProvider(ANTHROPIC);
  assert.equal(file.source, 'https://www.anthropic.com/pricing');
  assert.equal(file.models.length, 3);
  assert.equal(file.models[0].input, 1);
  assert.equal(file.discounts.cache_hit, 0.1);
  assert.deepEqual(parseProvider(renderProvider({ ...file, provider: 'anthropic' })).models, file.models);
});

test('a cost uses the cache rate for cached input and halves for batch, as the registry records', () => {
  const file = parseProvider(ANTHROPIC);
  const haiku = file.models[0];

  assert.equal(costOf(haiku, { input: 1_000_000, output: 0 }, file.discounts), 1);
  assert.equal(costOf(haiku, { input: 1_000_000, output: 0, cached: 1_000_000 }, file.discounts), 0.1);
  assert.equal(costOf(haiku, { input: 1_000_000, output: 0, batch: true }, file.discounts), 0.5);
  assert.equal(costOf(null, { input: 1 }), null, 'an unpriced model is unpriced, not free');
});

test('only first-party pricing pages count as a source', () => {
  assert.equal(isFirstParty('anthropic', 'https://www.anthropic.com/pricing'), true);
  assert.equal(isFirstParty('anthropic', 'https://llm-prices.example.com/anthropic'), false);
  assert.equal(isFirstParty('nobody', 'https://nobody.example.com'), false);
});

test('a price that would corrupt every forecast is refused before it is written', () => {
  const good = parseProvider(ANTHROPIC);
  assert.deepEqual(validateProvider(good), []);

  const zero = parseProvider('models:\n  - id: x\n    input: 0\n    output: 5\n    status: current\n');
  assert.match(validateProvider(zero)[0], /rate of 0 — a zero rate makes every forecast free/);

  const absurd = parseProvider('models:\n  - id: x\n    input: 5000\n    output: 5\n    status: current\n');
  assert.match(validateProvider(absurd)[0], /not a price per million tokens/);

  const missing = parseProvider('models:\n  - id: x\n    output: 5\n    status: current\n');
  assert.match(validateProvider(missing)[0], /has no input rate/);

  const vanished = validateProvider(parseProvider('models:\n  - id: y\n    input: 1\n    output: 2\n    status: current\n'), good);
  assert.match(vanished.find((problem) => /disappeared/.test(problem)), /parse failure, not a price change/);
});

test('a failed fetch keeps the last good file and reports its age, rather than blocking', async () => {
  await isolatedHome();
  await refresh('anthropic', { fetchPricing: async () => ANTHROPIC });

  const { readProvider } = await import('../src/models/registry.js');
  const good = await readProvider('anthropic');

  const failed = await refresh('anthropic', { fetchPricing: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.kept, true);
  assert.equal(failed.age, good.fetched, 'every report footnotes the date it was fetched');
  assert.deepEqual((await readProvider('anthropic')).models, good.models, 'the last good file stands');
});

test('a provider with no first-party source is refused rather than fetched from somewhere else', async () => {
  await isolatedHome();
  await assert.rejects(() => refresh('somevendor', { fetchPricing: async () => '' }), /aggregator sites are never a source of truth/);
});

test('what changed is what a human is shown: new models, price moves, retirements', () => {
  const before = parseProvider(ANTHROPIC);
  const after = parseProvider([
    'models:',
    '  - id: claude-haiku-4-5',
    '    input: 1.00',
    '    output: 5.00',
    '    status: retired',
    '  - id: claude-sonnet-5',
    '    input: 1.50',
    '    output: 10.00',
    '    status: current',
    '  - id: claude-opus-5',
    '    input: 5.00',
    '    output: 25.00',
    '    status: current',
    '  - id: claude-opus-5-5',
    '    input: 4.00',
    '    output: 20.00',
    '    status: current',
    '',
  ].join('\n'));

  const changes = diffProviders(before, after);
  assert.ok(changes.some((change) => change.kind === 'new' && change.id === 'claude-opus-5-5'));
  assert.ok(changes.some((change) => change.kind === 'price' && change.id === 'claude-sonnet-5' && change.to.input === 1.5));
  assert.ok(changes.some((change) => change.kind === 'retired' && change.id === 'claude-haiku-4-5'));
});

test('the tier mapping lives per install, so a repository outlives the model it was built with', async () => {
  await isolatedHome();
  assert.equal((await readTiers()).declared, false);

  await writeTiers({ strong: 'claude-opus-5', mid: 'claude-sonnet-5' });
  const { tiers, declared } = await readTiers();
  assert.equal(declared, true);
  assert.equal(tiers.strong, 'claude-opus-5');
  assert.match(renderTiers(tiers), /never models/);
});

test('an install with no registry says so, rather than reporting prices it does not have', async () => {
  await isolatedHome();
  const state = await registryState();
  assert.equal(state.empty, true);
  assert.deepEqual(state.providers, []);
});

// ---------------------------------------------------------------- rate intelligence (§63)

const session = (over = {}) => ({
  model: 'claude-haiku-4-5', role: 'implementer', size: 'S', ended: 'done',
  input: 100_000, output: 10_000, cached: 0, reviewRounds: 1, at: new Date().toISOString(), ...over,
});

test('performance is measured per model, per role, per size, from this project\'s own sessions', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/.state/sessions.json'), JSON.stringify({
    sessions: [session(), session({ escalated: true, ended: 'blocked' }), session({ role: 'reviewer', size: 'S' })],
  }));

  const rows = performance(await readSessions(root));
  const implementer = rows.find((row) => row.role === 'implementer');
  assert.equal(implementer.sessions, 2);
  assert.equal(implementer.completed, 1);
  assert.equal(implementer.escalationRate, 0.5);
  assert.ok(rows.some((row) => row.role === 'reviewer'));
});

test('sessions older than the window do not price today\'s decision', () => {
  const old = session({ at: new Date(Date.now() - 90 * 86400000).toISOString() });
  assert.equal(performance([old], { days: 30 }).length, 0);
  assert.equal(performance([old], { days: 0 }).length, 1);
});

test('effective cost is spend divided by requirements that actually completed', async () => {
  await isolatedHome();
  await refresh('anthropic', { fetchPricing: async () => ANTHROPIC });

  // Two sessions, one completed: the model is priced on the requirement, not on the session.
  const rows = performance([session(), session({ ended: 'blocked' })]);
  const [priced] = await effectiveCost(rows, 'anthropic');

  assert.equal(priced.completed, 1);
  assert.ok(priced.spend > 0);
  assert.equal(priced.effectiveCost, priced.spend / 1, 'a model needing two sessions to finish one requirement is priced on the requirement');
  assert.equal(priced.pricedFrom, 'registry/anthropic.yml', 'the report says which price was used');
});

test('a recommendation is refused without enough evidence, and a trial is offered instead', () => {
  const thin = advise([{ model: 'claude-haiku-4-5', effectiveCost: 0.1, enough: false, evidence: 3, escalationRate: 0 }]);
  assert.equal(thin.recommend, null);
  assert.match(thin.why, new RegExp(`under the ${EVIDENCE_MIN} this needs`));
  assert.equal(thin.trial.candidate, 'claude-haiku-4-5');
  assert.match(thin.trial.shape, /next 17 size-S requirements/);
  assert.match(thin.trial.note, /the incumbent mapping stands/);

  const backed = advise([
    { model: 'cheap-one', effectiveCost: 0.1, enough: true, evidence: 40, escalationRate: 0.05 },
    { model: 'dear-one', effectiveCost: 0.9, enough: true, evidence: 40, escalationRate: 0 },
  ]);
  assert.equal(backed.recommend.model, 'cheap-one');
  assert.equal(backed.trial, null);
});

test('with nothing completed there is nothing to recommend on, and it says that', () => {
  const result = advise([]);
  assert.equal(result.recommend, null);
  assert.match(result.why, /nothing to price a recommendation on/);
});

test('impact is computed against measured usage, not a vendor workload', () => {
  const rows = [{ model: 'claude-opus-5', input: 1_000_000, output: 100_000, cached: 0, spend: 7.5, completed: 10 }];
  const cheaper = impactOf(rows, { from: 'claude-opus-5', to: 'claude-opus-5-5', rate: { input: 4, output: 20 } });

  assert.equal(cheaper.spend, 7.5);
  assert.equal(cheaper.would, 6);
  assert.equal(cheaper.percent, -20);
});

test('a corrupt sessions file is read as no sessions, not as a failure', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/.state/sessions.json'), '{ not json');
  assert.deepEqual(await readSessions(root), []);
});
