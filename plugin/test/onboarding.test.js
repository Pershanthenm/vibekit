import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { listAsks } from '../src/folder/asks.js';
import {
  ASK_LIMIT, CONVERSION, READ_BUDGET, UNDERSTANDING_FILE, asksFor, commandsFound, conventionsFound,
  decisionsIn, entitiesFound, integrationsFound, refreshUnderstanding, renderUnderstanding,
  risksFound, testsFound, understandRepo,
} from '../src/understand.js';
import { PITCH, STOPS, BROWNFIELD_STOPS, readSettings, renderStop, shouldGreet, writeSettings } from '../src/tour.js';
import { gitInit, sh } from './helpers.js';

/**
 * Reading someone else's repository, and explaining VibeKit. Specification §58 and §65.
 *
 * §58's guarantees are what the tests are for: read-only until `--convert`, every claim cites its
 * file, and every section carries a confidence. A report that presents a guess at the weight of a
 * fact is worse than no report, because a human can only correct what is marked uncertain.
 */

const FILES = {
  'README.md': '# Gymly\n\nGymly is a booking system for gyms. Members book classes and staff manage schedules.\n',
  'package.json': JSON.stringify({
    name: 'gymly',
    scripts: { build: 'tsc', test: 'vitest run' },
    dependencies: { stripe: '^14.0.0', '@sendgrid/mail': '^8.0.0', zod: '^3.22.0' },
  }, null, 2),
  'src/Domain/Member.ts': 'export interface Member {\n  id: string;\n  email: string;\n  phone: string;\n  isDeleted: boolean;\n}\n',
  'src/Domain/Payment.ts': 'export interface Payment {\n  id: string;\n  amount: number;\n  cardLast4: string;\n  isDeleted: boolean;\n}\n',
  'src/Api/bookings.ts': 'import { z } from "zod";\nexport async function list(db, tenantId) {\n  const rows = await db.query("SELECT * FROM bookings WHERE tenant = \'" + tenantId + "\'");\n  return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString(), isDeleted: false }));\n}\n',
  'src/Api/notify.ts': 'import { z } from "zod";\nconst hook = "http://reports.internal.example.com/ingest";\nexport const send = async () => ({ hook, at: new Date().toISOString(), isDeleted: false });\n',
  '.env': 'STRIPE_KEY=sk_live_abcdefghijklmnop\nDB_PASSWORD=supersecret123\n',
  'tests/unit/bookings.test.ts': 'import { describe, it } from "vitest";\ndescribe("bookings", () => { it.skip("cancels", () => {}); it("lists", () => {}); });\n',
  '.github/workflows/ci.yml': 'name: ci\n',
};

async function legacyRepo() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-legacy-'));
  for (const [path, body] of Object.entries(FILES)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), body);
  }
  gitInit(root);
  sh(root, 'git', 'commit', '-q', '--allow-empty', '-m', 'chore: switched to Stripe for payments');
  return root;
}

const capture = async (work) => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await work();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
};

// ---------------------------------------------------------------- reading the repo (§58)

test('the report says what the app is, how it is built, what it talks to and how well tested it is', async () => {
  const understanding = await understandRepo(await legacyRepo());

  assert.match(understanding.plain, /booking system for gyms/);
  const keys = understanding.sections.map((part) => part.key);
  assert.deepEqual(keys, ['what', 'built', 'entities', 'talks', 'quality', 'conventions']);

  assert.deepEqual(understanding.externals.map((external) => external.name), ['Stripe', 'SendGrid']);
  assert.deepEqual(understanding.commands.map((command) => command.name).sort(), ['build', 'install', 'test']);
});

test('every section carries a confidence and cites the files it came from', async () => {
  const understanding = await understandRepo(await legacyRepo());

  for (const part of understanding.sections) {
    assert.ok(['low', 'medium', 'high'].includes(part.confidence), `${part.key} has no confidence`);
  }
  assert.equal(understanding.sections.find((part) => part.key === 'what').confidence, 'high', 'there is a README');
  assert.equal(understanding.sections.find((part) => part.key === 'entities').confidence, 'medium', 'entities are inferred from shapes, not read from a schema');
  assert.equal(understanding.sections.find((part) => part.key === 'conventions').confidence, 'low', 'a repeated pattern is a guess about intent');

  const entities = understanding.sections.find((part) => part.key === 'entities');
  assert.ok(entities.from.some((file) => file.endsWith('Member.ts')), 'a claim nobody can check is a claim nobody can correct');
});

test('classification is guessed from field names and said to be a guess', async () => {
  const understanding = await understandRepo(await legacyRepo());
  const byName = Object.fromEntries(understanding.entities.map((entity) => [entity.name, entity.klass]));

  assert.equal(byName.Member, 'personal', 'email and phone');
  assert.equal(byName.Payment, 'financial', 'amount and cardLast4');
  assert.match(renderUnderstanding(understanding), /classification guessed from field names.*to confirm/);
});

test('entities are found whether the shape is written over five lines or one', () => {
  const multi = entitiesFound([['a.ts', 'export interface Member {\n  id: string;\n  email: string;\n}\n']]);
  assert.deepEqual(multi.map((entity) => entity.name), ['Member']);

  // A one-line TypeScript interface is ordinary, and a stricter pattern saw none of them.
  const single = entitiesFound([['b.ts', 'export interface Refund { id: string; amount: number; }']]);
  assert.deepEqual(single.map((entity) => entity.name), ['Refund']);
});

test('the risks are the ones worth a human on a first pass, each citing its file', async () => {
  const understanding = await understandRepo(await legacyRepo());
  const titles = understanding.risks.map((risk) => risk.title);

  assert.ok(titles.some((title) => /Stripe secret key is committed in \.env/.test(title)));
  assert.ok(titles.some((title) => /\.env is in the repository/.test(title)));
  assert.ok(titles.some((title) => /SQL is built by string concatenation/.test(title)), 'this is the shape of most injection vulnerabilities');
  assert.ok(titles.some((title) => /skipped or disabled test/.test(title)));
  assert.ok(titles.some((title) => /plain-http URL/.test(title)));
  assert.ok(understanding.risks.every((risk) => risk.file), 'a risk with no file is a risk nobody can go and look at');
});

test('the same pattern in many files is one decision to make, not many findings', () => {
  const many = Array.from({ length: 12 }, (_, index) => [`src/f${index}.ts`, 'const u = "http://example.com/x";']);
  const risks = risksFound([], many, []);
  assert.equal(risks.filter((risk) => /plain-http/.test(risk.title)).length, 1);
});

test('a convention is named only once it looks like a habit rather than a coincidence', () => {
  const twice = [['a.ts', 'row.isDeleted'], ['b.ts', 'row.isDeleted']];
  assert.deepEqual(conventionsFound(twice), []);

  const thrice = [...twice, ['c.ts', 'row.isDeleted = true']];
  const found = conventionsFound(thrice);
  assert.equal(found.length, 1);
  assert.match(found[0].text, /soft-deleted/);
  assert.equal(found[0].seen, 3);
});

test('the missing test kinds are reported, because they become the first real requirements', async () => {
  const understanding = await understandRepo(await legacyRepo());
  const quality = understanding.sections.find((part) => part.key === 'quality');
  assert.match(quality.lines.join(' '), /missing test kinds: contract, smoke, invariant/);
});

test('integrations come from manifests and config, not from a name in a comment', () => {
  const found = integrationsFound('{"dependencies":{"stripe":"1"}}', [['config.json', '{"sendgrid":{"key":"x"}}']], ['package.json']);
  assert.deepEqual(found.map((entry) => entry.name), ['Stripe', 'SendGrid']);
  assert.deepEqual(integrationsFound('{}', [], []), []);
});

test('decisions are taken from commit messages that record one', () => {
  const decisions = decisionsIn([
    'feat: add booking form',
    'chore: switched to Stripe for payments',
    'fix: typo',
    'refactor: migrated to Postgres',
  ]);
  assert.deepEqual(decisions.map((decision) => decision.text), ['migrated to Postgres', 'switched to Stripe for payments']);
});

test('the reading budget is reported rather than quietly exceeded', async () => {
  const root = await legacyRepo();
  const generous = await understandRepo(root);
  assert.equal(generous.budget.limit, READ_BUDGET);
  assert.ok(generous.budget.read > 0 && generous.budget.read < READ_BUDGET);

  const mean = await understandRepo(root, { budget: 1 });
  assert.ok(mean.budget.skipped > 0, 'running out of budget is a fact about the report, not a detail to hide');
  assert.match(renderUnderstanding(mean), /file\(s\) were not read: the budget ran out/);
});

test('the asks are only what the code cannot answer, and there are never more than ten', async () => {
  const understanding = await understandRepo(await legacyRepo());
  const plain = understanding.asks.map((ask) => ask.plain);

  assert.ok(understanding.asks.length <= ASK_LIMIT);
  assert.ok(plain.some((question) => /who actually uses this/i.test(question)), 'the code shows endpoints, never who is behind them');
  assert.ok(plain.some((question) => /have I got it right/i.test(question)), 'the classifications were guessed');
  assert.ok(understanding.asks.every((ask) => ask.lands), 'an answer that lands nowhere is a gap again next release');

  // A repo whose manifests declare no command earns that ask; one that does, does not.
  const withCommands = asksFor({ ...understanding, commands: [{ name: 'test', run: 'npm test' }] });
  assert.ok(!withCommands.some((ask) => /what do you actually type/i.test(ask.plain)));
});

// ---------------------------------------------------------------- read-only, and convert (§58)

test('reading changes nothing in the repository it read', async () => {
  const root = await legacyRepo();
  await capture(() => run(['understand', '.', '--dir', root]));

  assert.equal(sh(root, 'git', 'status', '--porcelain').split('\n').filter((line) => /^ ?M/.test(line)).length, 0);
  assert.match(await readFile(join(root, 'src/Api/bookings.ts'), 'utf8'), /SELECT \* FROM bookings/);
});

test('converting writes the folder from the understanding, and no application code', async () => {
  const root = await legacyRepo();
  const output = await capture(() => run(['understand', '.', '--convert', '--dir', root]));

  assert.match(output, /rules-only: no application code was generated/);
  for (const [from] of CONVERSION) assert.ok(output.includes(from), `the conversion table omits "${from}"`);

  const entities = await readFile(join(root, 'vibekit/product/entities.md'), 'utf8');
  assert.match(entities, /## Member/);
  assert.match(entities, /class: personal/, 'the guessed classification is what a human then confirms');

  const report = await readFile(join(root, `vibekit/${UNDERSTANDING_FILE}`), 'utf8');
  assert.match(report, /## In plain terms/);
  assert.match(report, /confidence:/);
});

test('converting raises the asks, so the questions outlive the command that found them', async () => {
  const root = await legacyRepo();
  await capture(() => run(['understand', '.', '--convert', '--dir', root]));

  const asks = await listAsks(root, 'vibekit');
  assert.ok(asks.length >= 4);
  assert.ok(asks.some((ask) => /who uses this system/i.test(ask.ask)));
});

test('a git url is refused by name rather than read as a directory', async () => {
  const root = await legacyRepo();
  await assert.rejects(
    () => run(['understand', 'https://github.com/example/thing.git', '--dir', root]),
    /Clone it first/,
  );
});

test('refresh reports what changed since the understanding was written', async () => {
  const root = await legacyRepo();
  await capture(() => run(['understand', '.', '--convert', '--dir', root]));

  const unchanged = await refreshUnderstanding(root, 'vibekit');
  assert.deepEqual(unchanged.changes, []);

  await writeFile(join(root, 'src/Domain/Refund.ts'), 'export interface Refund { id: string; amount: number; }');
  const changed = await refreshUnderstanding(root, 'vibekit');
  assert.ok(changed.changes.some((change) => /Refund is in the code and not in the understanding/.test(change)));
});

// ---------------------------------------------------------------- first run and the tour (§65)

test('the pitch is the whole case, and it names what comes after a first generation', () => {
  assert.match(PITCH, /next-generation spec-driven development/);
  assert.match(PITCH, /a twenty-minute fix takes twenty minutes/);
  assert.match(PITCH, /captured exit code/);
  assert.match(PITCH, /Delete the folder and nothing breaks/);
});

test('there are seven stops, each explaining the step and then naming the command that does it', () => {
  assert.equal(STOPS.length, 7);
  for (const [index, stop] of STOPS.entries()) {
    assert.ok(stop.happens && stop.why && stop.produces && stop.rule, `stop ${index + 1} is missing a part`);
    assert.match(stop.run, /^vibekit /, 'no screen is purely informational');
    const rendered = renderStop(stop, index, STOPS.length);
    assert.match(rendered, /\[enter\] go  \[\?\] more  \[q\] exit tour/, 'the affordances mean the same thing at every stop');
    assert.match(rendered, new RegExp(`Step ${index + 1} of 7`));
  }
});

test('each stop is short enough that the whole tour is under a minute of reading', () => {
  for (const [index, stop] of STOPS.entries()) {
    const words = [stop.happens, stop.why, stop.produces, stop.rule].join(' ').split(/\s+/).length;
    assert.ok(words < 130, `stop ${index + 1} is ${words} words; §65 budgets roughly eighty`);
  }
});

test('brownfield gets its own four stops, about what converting will and will not change', () => {
  assert.equal(BROWNFIELD_STOPS.length, 4);
  assert.match(BROWNFIELD_STOPS[0].name, /about to read/i);
  assert.match(BROWNFIELD_STOPS[3].rule, /never modified/i);
});

test('where somebody got to is a property of the person, not of the repository', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vibekit-settings-'));
  process.env.VIBEKIT_HOME = home;

  assert.deepEqual(await readSettings(), { pitchShown: false, tourDone: false, tourStop: 0 });
  await writeSettings({ tourStop: 3 });
  assert.equal((await readSettings()).tourStop, 3, 'a colleague cloning the repo gets their own first run');
});

test('the pitch appears once, and never in CI or a pipe', async () => {
  const fresh = { pitchShown: false, tourDone: false, tourStop: 0 };
  assert.equal(shouldGreet({ settings: fresh, isTty: true, env: {} }), true);
  assert.equal(shouldGreet({ settings: fresh, isTty: false, env: {} }), false, 'a prompt nobody can answer is a hang');
  assert.equal(shouldGreet({ settings: fresh, isTty: true, env: { CI: 'true' } }), false);
  assert.equal(shouldGreet({ settings: fresh, isTty: true, env: {}, noTour: true }), false);
  assert.equal(shouldGreet({ settings: { ...fresh, pitchShown: true }, isTty: true, env: {} }), false, 'it is not repeated');
});

test('the tour walks forward, and re-reading a step does not undo the ones already walked', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vibekit-tour-'));
  process.env.VIBEKIT_HOME = home;

  const first = await capture(() => run(['tour']));
  assert.match(first, /Step 1 of 7/);
  assert.match(first, /next-generation spec-driven development/, 'the pitch leads the first stop');
  assert.equal((await readSettings()).tourStop, 1);

  const second = await capture(() => run(['tour']));
  assert.match(second, /Step 2 of 7/);
  assert.doesNotMatch(second, /next-generation spec-driven development/, 'the pitch appears once');

  await writeSettings({ tourStop: 6 });
  await capture(() => run(['tour', '2']));
  assert.equal((await readSettings()).tourStop, 6, 're-reading step 2 must not cost somebody four steps');
});

test('at the end it hands over to the commands and records that it is finished', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vibekit-tour-end-'));
  process.env.VIBEKIT_HOME = home;
  await writeSettings({ tourStop: STOPS.length, pitchShown: true });

  const end = await capture(() => run(['tour']));
  assert.match(end, /That is the loop/);
  assert.match(end, /vibekit sprint run/);
  assert.match(end, /It will not interrupt you again/);
  assert.equal((await readSettings()).tourDone, true);
});
