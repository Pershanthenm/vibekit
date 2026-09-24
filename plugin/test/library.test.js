import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INDEX_TOKENS_PER_SKILL, LIBRARY_DIR, SHIPPED_SUBDIR, adopt, catalogueDomains, catalogueFiles, catalogueSkills, disableCatalogue, enableCatalogue, referenceFor, searchCatalogue, selectCatalogue, shippedFiles, shippedSkills, shortLead } from '../src/library.js';
import { BODY_MAX, BODY_MIN, fires, listSkills, loadFor, overlaps, overrideChain, parseSkillTest, testSkills } from '../src/skills.js';
import { generateFolder } from '../src/folder/generate.js';
import { budgetReport } from '../src/folder/budget.js';
import { hasHeader } from '../src/folder/header.js';
import { runChecks } from '../src/folder/checks.js';
import { run } from '../src/cli.js';
import { isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * The shipped skills library. Specification §56: the `vibekit` scope is "what ships with the
 * tool"; a repo skill overrides a team one, which overrides a shipped one.
 *
 * Two kinds of test here. The first holds every shipped skill to the same rules as any skill —
 * body length, triggers that fire on what its test says and not on what it says they must not,
 * a sibling test, provenance — so a skill edited in the library cannot quietly regress. The
 * second checks the mechanism: generated into the folder, refused to agents, adopted into the
 * repo, and gone when a project opts out.
 */

const CONFIG = { name: 'stock', description: null, architecture: 'layered', stack: {}, commands: {}, entities: [] };
const newRepo = () => {
  const root = tempDir('vibekit-library-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
};

test('every shipped skill obeys the loader\'s rules: length, triggers, a test that fires and does not, provenance, a reference', async () => {
  const skills = await shippedSkills();
  assert.ok(skills.length >= 20, `only ${skills.length} shipped skills`);
  const problems = [];
  for (const skill of skills) {
    if (skill.tokens < BODY_MIN || skill.tokens > BODY_MAX) problems.push(`${skill.name}: ${skill.tokens} tokens`);
    if (skill.triggers.length < 3) problems.push(`${skill.name}: ${skill.triggers.length} triggers`);
    if (!/^alirezarezvani\/claude-skills · \S+ @[0-9a-f]{7} · MIT$/.test(skill.source ?? '')) problems.push(`${skill.name}: source line "${skill.source}"`);
    if (/\byou are\b|\bact as\b/i.test(skill.body)) problems.push(`${skill.name}: identity phrasing`);
    if (!skill.body.includes(`vibekit skills reference ${skill.name}`)) problems.push(`${skill.name}: no pointer to its reference`);
    if (!skill.reference) problems.push(`${skill.name}: no reference file (node tools/library.mjs <clone>)`);
    if (!skill.test) { problems.push(`${skill.name}: no test`); continue; }
    const parsed = parseSkillTest(skill.test);
    if (parsed.skill !== skill.name) problems.push(`${skill.name}: test names ${parsed.skill}`);
    if (parsed.triggersOn.length < 3 || parsed.mustNotTriggerOn.length < 2) problems.push(`${skill.name}: thin test`);
    for (const task of parsed.triggersOn) if (!fires(skill, task)) problems.push(`${skill.name}: does not fire on "${task}"`);
    for (const task of parsed.mustNotTriggerOn) if (fires(skill, task)) problems.push(`${skill.name}: fires on "${task}"`);
  }
  assert.deepEqual(problems, []);
});

test('shipped skills do not overlap one another by more than half their triggers, and no two share a name', async () => {
  const skills = await shippedSkills();
  const names = skills.map((skill) => skill.name);
  assert.equal(new Set(names).size, names.length);
  const clashes = overlaps(skills.map((skill) => ({ name: skill.name, triggers: skill.triggers })));
  assert.deepEqual(clashes.map((clash) => `${clash.a} ~ ${clash.b}`), []);
  // At most three bodies load for a task: a broad task must not fire half the library.
  const loaded = loadFor(skills.map((skill) => ({ ...skill, scope: 'vibekit' })), 'add an index for the slow query on the orders api endpoint');
  assert.ok(loaded.loaded.length <= 3);
});

test('a config that says library writes the skills into skills/lib/vibekit as generated files, indexed and within budget; one that does not gets none', async () => {
  const root = newRepo();
  const bare = await generateFolder(root, CONFIG);
  const bareIndex = await readFile(join(root, 'vibekit/skills/index.yml'), 'utf8');
  assert.equal((bareIndex.match(/^- name:/gm) ?? []).length, 0, 'a bare config gets exactly what it describes');
  assert.ok(!bare.written.some((path) => path.includes(SHIPPED_SUBDIR)));

  const withLibrary = await generateFolder(root, { ...CONFIG, library: true });
  const files = await shippedFiles();
  for (const file of files) {
    assert.ok(withLibrary.written.includes(`vibekit/${file.path}`), `${file.path} written`);
    const text = await readFile(join(root, 'vibekit', file.path), 'utf8');
    assert.ok(hasHeader(text), `${file.path} carries the generated header`);
  }
  const index = await readFile(join(root, 'vibekit/skills/index.yml'), 'utf8');
  const skills = await shippedSkills();
  for (const skill of skills) assert.ok(index.includes(`  path: ${SHIPPED_SUBDIR}/${skill.name}.md`), `${skill.name} indexed`);

  // The loader sees them at the vibekit scope, tested, and the checks are clean.
  const listed = await listSkills(root, { folder: 'vibekit' });
  assert.equal(listed.skills.filter((skill) => skill.scope === 'vibekit').length, skills.length);
  assert.ok(listed.skills.every((skill) => skill.test && !skill.missing));
  assert.deepEqual(listed.orphans, []);
  const tests = await testSkills(root, { folder: 'vibekit' });
  assert.deepEqual(tests.failed.map((entry) => `${entry.name}: ${entry.problems.join('; ')}`), []);
  assert.equal(tests.untested.length, 0);
  const checks = await runChecks(root, { folder: 'vibekit' });
  assert.deepEqual(checks.findings.filter((finding) => /^skill\./.test(finding.code)), []);
  const budget = await budgetReport(root, 'vibekit');
  assert.ok(budget.passes, `always-loaded ${budget.alwaysLoaded} over the cap`);
  assert.ok(budget.alwaysLoaded < 3600, `the library costs too much always-loaded context: ${budget.alwaysLoaded}`);

  // Turning the library off removes what it wrote; nothing else moves.
  await generateFolder(root, { ...CONFIG, library: false });
  const after = await readFile(join(root, 'vibekit/skills/index.yml'), 'utf8');
  assert.equal((after.match(/^- name:/gm) ?? []).length, 0);
  await assert.rejects(readFile(join(root, 'vibekit/skills', SHIPPED_SUBDIR, 'tdd.md')));
});

test('adopt makes a repo copy that wins the chain, keeps its triggers across a regeneration, and is not reported as an overlap', async () => {
  const root = newRepo();
  await generateFolder(root, { ...CONFIG, library: true });
  const result = await adopt(root, 'tdd', { folder: 'vibekit' });
  assert.deepEqual(result.written, ['vibekit/skills/lib/tdd.md', 'vibekit/skills/lib/tdd.test.md']);
  const copy = await readFile(join(root, 'vibekit/skills/lib/tdd.md'), 'utf8');
  assert.ok(!hasHeader(copy), 'the adopted copy is the team\'s own, not generated');
  assert.match(copy, /adopted from VibeKit's shipped skill tdd/);

  await generateFolder(root, { ...CONFIG, library: true });
  const { skills } = await listSkills(root, { folder: 'vibekit' });
  const tdds = skills.filter((skill) => skill.name === 'tdd');
  assert.deepEqual(tdds.map((skill) => skill.scope).sort(), ['repo', 'vibekit']);
  assert.ok(tdds.every((skill) => skill.triggers.includes('failing test')), 'the regeneration read the triggers from the copy\'s front matter');
  assert.deepEqual(overrideChain(skills).find((entry) => entry.name === 'tdd'), { name: 'tdd', scopes: ['repo', 'vibekit'], wins: 'repo' });
  assert.equal(overlaps(skills).some((clash) => clash.a === 'tdd' && clash.b === 'tdd'), false);
  const load = loadFor(skills, 'write a failing test for AC-2');
  assert.deepEqual(load.loaded.filter((name) => name === 'tdd').length, 1, 'one body per name loads');

  await assert.rejects(adopt(root, 'tdd', { folder: 'vibekit' }), /already exists/);
  await assert.rejects(adopt(root, 'no-such-skill', { folder: 'vibekit' }), /No shipped or catalogue skill/);

  const reference = await referenceFor('tdd');
  assert.ok(reference.text && /Reference: tdd/.test(reference.text));
  assert.ok(!/\byou are\b/i.test(reference.text), 'identity phrasing is dropped from the reference');
});

test('vibekit init writes the library by default and --no-library records the choice in the project file', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-library-');
  const log = console.log;
  console.log = () => {};
  try {
    const withLibrary = newRepo();
    await run(['init', '--yes', '--no-tour', '--dir', withLibrary]);
    const index = await readFile(join(withLibrary, 'vibekit/skills/index.yml'), 'utf8');
    assert.ok(index.includes(`path: ${SHIPPED_SUBDIR}/tdd.md`));
    // A shipped body is a generated file: the pre-edit hook refuses an agent's write to it.
    const body = await readFile(join(withLibrary, 'vibekit/skills', SHIPPED_SUBDIR, 'adversarial-review.md'), 'utf8');
    assert.ok(hasHeader(body));

    const without = newRepo();
    await run(['init', '--yes', '--no-tour', '--no-library', '--dir', without]);
    assert.equal(((await readFile(join(without, 'vibekit/skills/index.yml'), 'utf8')).match(/^- name:/gm) ?? []).length, 0);
    assert.equal(JSON.parse(await readFile(join(without, 'specs/project.json'), 'utf8')).library, false);
    // A later rescan keeps the choice.
    await run(['rescan', '--dir', without]);
    await assert.rejects(readFile(join(without, 'vibekit/skills', SHIPPED_SUBDIR, 'tdd.md')));
  } finally {
    console.log = log;
    restoreEnv(original);
  }
});

test('SOURCES.md lists every shipped skill with its source, commit and licence', async () => {
  const sources = await readFile(join(LIBRARY_DIR, 'SOURCES.md'), 'utf8');
  for (const skill of await shippedSkills()) {
    const path = skill.source.split(' · ')[1].split(' @')[0];
    assert.ok(sources.includes(`| ${skill.name} | \`${path}\` |`), `${skill.name} in SOURCES.md`);
  }
  assert.match(sources, /MIT/);
  // Nothing executable ships in the library: skills are data.
  const { readdir } = await import('node:fs/promises');
  const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])))).flat();
  const files = await walk(LIBRARY_DIR);
  assert.deepEqual(files.filter((file) => !/\.md$/.test(file)), []);
  await mkdir(join(LIBRARY_DIR, 'references'), { recursive: true });
  assert.ok(files.length > 40);
  void writeFile;
});

// ---------------------------------------------------------------- the catalogue

test('the catalogue holds every unique upstream skill as data: named, filed by domain, with triggers and provenance, nothing executable', async () => {
  const skills = await catalogueSkills();
  assert.ok(skills.length >= 350, `only ${skills.length} catalogue skills`);
  const domains = await catalogueDomains();
  assert.ok(domains.length >= 12);
  assert.ok(domains.find((entry) => entry.domain === 'engineering').count > 100);
  const names = skills.map((skill) => skill.name);
  assert.equal(new Set(names).size, names.length, 'names are unique across domains');
  const problems = [];
  for (const skill of skills) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skill.name)) problems.push(`${skill.name}: not a slug`);
    if (skill.triggers.length < 3) problems.push(`${skill.name}: ${skill.triggers.length} triggers`);
    if (!/^alirezarezvani\/claude-skills · \S+ @[0-9a-f]{7} · MIT$/.test(skill.source ?? '')) problems.push(`${skill.name}: source`);
    if (!skill.description) problems.push(`${skill.name}: no description`);
    if (!skill.triggers.every((trigger) => fires({ triggers: [trigger] }, trigger))) problems.push(`${skill.name}: a trigger that cannot fire on itself`);
  }
  assert.deepEqual(problems.slice(0, 10), []);
  const catalogue = await readFile(join(LIBRARY_DIR, 'CATALOGUE.md'), 'utf8');
  for (const skill of skills.slice(0, 40)) assert.ok(catalogue.includes(`| ${skill.name} |`), `${skill.name} listed in CATALOGUE.md`);
});

test('a short lead fits the body ceiling, keeps prose, and leaves tables, code and empty headings to the reference', async () => {
  const skills = await catalogueSkills();
  const over = [];
  for (const skill of skills) {
    const text = await readFile(skill.path, 'utf8');
    const lead = shortLead(skill.name, text);
    const tokens = Math.ceil(lead.length / 4);
    if (tokens > BODY_MAX) over.push(`${skill.name}: ${tokens}`);
    if (/^\s*```|^\|/m.test(lead)) over.push(`${skill.name}: code or table in the lead`);
    if (!lead.includes(`vibekit skills reference ${skill.name}`)) over.push(`${skill.name}: no pointer`);
    if (/^you are\b/im.test(lead)) over.push(`${skill.name}: identity`);
  }
  assert.deepEqual(over.slice(0, 10), []);
});

test('selection: a domain word is the domain, a name is one skill, a typo is reported, and a curated name is not doubled', async () => {
  const finance = await selectCatalogue(['finance']);
  assert.ok(finance.skills.length >= 3 && finance.skills.every((skill) => skill.domain === 'finance'));
  const one = await selectCatalogue(['threat-detection', 'no-such-skill']);
  assert.deepEqual(one.skills.map((skill) => skill.name), ['threat-detection']);
  assert.deepEqual(one.unknown, ['no-such-skill']);
  const found = await searchCatalogue('threat', { domain: 'engineering' });
  assert.ok(found.some((skill) => skill.name === 'threat-detection'));
  assert.equal((await searchCatalogue('threat', { domain: 'marketing' })).length, 0);
  const files = await catalogueFiles(['threat-detection']);
  assert.deepEqual(files.files.map((file) => file.path), [`skills/${SHIPPED_SUBDIR}/threat-detection.md`, `skills/${SHIPPED_SUBDIR}/threat-detection.test.md`]);
  assert.deepEqual(files.entries[0].path, `${SHIPPED_SUBDIR}/threat-detection.md`);
});

test('enable writes the chosen entries into the folder within budget, refuses a domain that would breach the cap, and disable removes them', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-catalogue-');
  const log = console.log;
  console.log = () => {};
  try {
    const root = newRepo();
    await run(['init', '--yes', '--no-tour', '--dir', root]);
    const before = await budgetReport(root, 'vibekit');

    const result = await enableCatalogue(root, ['threat-detection', 'finance'], { folder: 'vibekit' });
    assert.ok(result.added.includes('threat-detection'));
    assert.ok(result.total >= 4);
    assert.equal(result.projected, before.alwaysLoaded + result.added.length * INDEX_TOKENS_PER_SKILL);
    await run(['rescan', '--dir', root]);
    const index = await readFile(join(root, 'vibekit/skills/index.yml'), 'utf8');
    assert.ok(index.includes(`path: ${SHIPPED_SUBDIR}/threat-detection.md`));
    const body = await readFile(join(root, 'vibekit/skills', SHIPPED_SUBDIR, 'threat-detection.md'), 'utf8');
    assert.ok(hasHeader(body), 'an enabled catalogue skill is generated, like the curated ones');
    assert.match(body, /source: catalogue/);
    const { skills } = await listSkills(root, { folder: 'vibekit' });
    const enabled = skills.find((skill) => skill.name === 'threat-detection');
    assert.equal(enabled.scope, 'vibekit');
    assert.ok(enabled.tokens <= BODY_MAX && enabled.test, 'within the ceiling and tested');
    const tests = await testSkills(root, { folder: 'vibekit', only: 'threat-detection' });
    assert.deepEqual(tests.failed, []);
    assert.ok((await budgetReport(root, 'vibekit')).passes);

    // The whole engineering domain does not fit; the refusal says by how much, and --force overrides.
    await assert.rejects(enableCatalogue(root, ['engineering'], { folder: 'vibekit' }), /against a cap of/);
    assert.equal(JSON.parse(await readFile(join(root, 'specs/project.json'), 'utf8')).catalogue.includes('engineering'), false, 'a refused enable changes nothing');
    await assert.rejects(enableCatalogue(root, ['nope'], { folder: 'vibekit' }), /Not in the catalogue: nope/);

    const disabled = await disableCatalogue(root, ['finance', 'never-enabled']);
    assert.deepEqual(disabled.removed, ['finance']);
    assert.deepEqual(disabled.notEnabled, ['never-enabled']);
    await run(['rescan', '--dir', root]);
    const after = await readFile(join(root, 'vibekit/skills/index.yml'), 'utf8');
    assert.ok(after.includes('threat-detection'));
    assert.ok(!after.includes('financial-analyst'), 'a disabled domain leaves the index');
    await assert.rejects(readFile(join(root, 'vibekit/skills', SHIPPED_SUBDIR, 'financial-analyst.md')), 'and its files are gone');

    // Reference and adopt reach the catalogue too.
    const reference = await referenceFor('local-seo-manager');
    assert.match(reference.text, /^---\nname: local-seo-manager/);
    const adopted = await adopt(root, 'local-seo-manager', { folder: 'vibekit' });
    assert.deepEqual(adopted.written, ['vibekit/skills/lib/local-seo-manager.md', 'vibekit/skills/lib/local-seo-manager.test.md']);
  } finally {
    console.log = log;
    restoreEnv(original);
  }
});
