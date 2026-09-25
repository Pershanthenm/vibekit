import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readFrontMatter } from './frontmatter.js';
import { parseSkillsIndex } from './folder/checks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { estimateProseTokens } from './tokens.js';
import { exists, readText, writeText } from './fsutil.js';

/**
 * Where skills come from, how they earn their place, and how they travel. Specification §56.
 *
 * "A skill is a prompt fragment, and prompt fragments regress silently." That sentence is why
 * every skill has a sibling test and why `test-skills` exists at all: a rule file that quietly
 * stopped matching looks exactly like a rule file that is working.
 *
 * The other load-bearing rule is the budget. At most three skill bodies load for one task, so a
 * skill that overlaps another is not a redundancy — it is an agent receiving two instructions for
 * one job, and the log has to say which one was dropped.
 */

/** §56 — a body is 100 to 400 tokens; over 400 splits into two skills or a skill plus a pattern. */
export const BODY_MIN = 100;
export const BODY_MAX = 400;

/** §56 — at most three bodies load for one task. */
export const LOAD_LIMIT = 3;

/** §56 — triggers overlapping by more than half are flagged. */
export const OVERLAP_LIMIT = 0.5;

export const SCOPES = Object.freeze(['repo', 'team', 'vibekit']);

const skillsDir = (root, folder) => join(root, folder, 'skills');
export const indexPath = (root, folder = DEFAULT_FOLDER) => join(skillsDir(root, folder), 'index.yml');
export const libDir = (root, folder = DEFAULT_FOLDER) => join(skillsDir(root, folder), 'lib');

/**
 * `path:` in index.yml is relative to `skills/`, not to `skills/lib/` — the generator writes
 * `lib/<name>.md`. Resolving it against lib/ produced `skills/lib/lib/<name>.md` and every skill
 * read as having no body.
 */
const bodyPath = (root, folder, relative) => join(skillsDir(root, folder), relative);
export const teamSkillsDir = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'team-skills');

// Integration spec §5.3 — precedence, most specific first: the project's own, extensions,
// imported skills, then what ships with VibeKit. `team` sits between imported and shipped.
const scopeOf = (path) => {
  if (/\/vibekit\//.test(path) || path.startsWith('vibekit/')) return 'vibekit';
  if (/\/team\//.test(path) || path.startsWith('team/')) return 'team';
  if (/(?:^|\/)imported\//.test(path)) return 'imported';
  return 'repo';
};
export const SCOPE_ORDER = Object.freeze({ repo: 0, extension: 1, imported: 2, team: 3, vibekit: 4 });

/**
 * Every skill, with its body, its test and its scope.
 *
 * The override chain matters: §56 says a repo skill overrides a team one which overrides a
 * shipped one, and that `vibekit check` reports the chain "so nobody is surprised by which
 * version fired".
 */
export async function listSkills(root, { folder = DEFAULT_FOLDER, extensionSkills = [] } = {}) {
  const index = parseSkillsIndex((await readText(indexPath(root, folder))) ?? '');
  const files = await walk(libDir(root, folder));
  // Skills an enabled extension contributes sit in the chain below the project's own (§5.3).
  const skills = extensionSkills.map((skill) => ({
    name: skill.name, triggers: skill.triggers ?? [], path: skill.path, scope: 'extension', body: skill.body ?? null,
    tokens: skill.body ? estimateProseTokens(stripHeader(skill.body)) : 0, test: null, testPath: null, missing: !skill.body, source: skill.source,
  }));

  for (const entry of index) {
    const relative = entry.path ?? (files.includes(`${entry.name}.md`) ? `lib/${entry.name}.md` : null);
    const path = relative ? bodyPath(root, folder, relative) : null;
    const body = path ? await readText(path) : null;
    const testPath = relative ? bodyPath(root, folder, relative.replace(/\.md$/, '.test.md')) : null;

    skills.push({
      name: entry.name,
      triggers: entry.triggers,
      path: relative,
      scope: relative ? scopeOf(relative) : 'repo',
      body,
      tokens: body ? estimateProseTokens(stripHeader(body)) : 0,
      test: testPath ? await readText(testPath) : null,
      testPath: testPath ? testPath.slice(root.length + 1) : null,
      missing: !body,
    });
  }

  // A body in lib/ that the index never mentions can never be fetched, whatever it says.
  const named = new Set(skills.map((skill) => String(skill.path ?? '').replace(/^lib\//, '')));
  const orphans = files.filter((file) => !file.endsWith('.test.md') && !named.has(file));

  return { skills, orphans, index };
}

const stripHeader = (text) => String(text ?? '').replace(/^<!--[\s\S]*?-->\n/, '').replace(/^---\n[\s\S]*?\n---\n/, '');

async function walk(dir, prefix = '') {
  const found = [];
  for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await walk(join(dir, entry.name), relative));
    else if (entry.name.endsWith('.md')) found.push(relative);
  }
  return found;
}

/** The shape of a `<name>.test.md`, which §56 gives exactly. */
export function parseSkillTest(text) {
  // A shipped test is a generated file, so its first line is the header; the front matter is next.
  const meta = readFrontMatter(String(text ?? '').replace(/\r\n/g, '\n').replace(/^<!--[\s\S]*?-->\n/, ''));
  const list = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    try {
      return JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      return raw.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
  };

  // One pass, in order. Collecting the paths and then the `contains:` lines separately attached
  // every one of them to the last expectation, so a `no-file:` inherited the strings that
  // belonged to the `file:` above it — an assertion about the opposite of what was written.
  const expect = [];
  for (const raw of String(text ?? '').split('\n')) {
    const target = raw.match(/^\s*-\s*(file|no-file):\s*(.+)$/);
    if (target) {
      expect.push({ kind: target[1], path: target[2].trim(), contains: [] });
      continue;
    }
    const contains = raw.match(/^\s*contains:\s*\[(.*)\]\s*$/);
    if (contains && expect.length) expect[expect.length - 1].contains = list(`[${contains[1]}]`);
  }

  return {
    skill: meta.skill ?? null,
    triggersOn: list(meta['triggers-on']),
    mustNotTriggerOn: list(meta['must-not-trigger-on']),
    given: meta.given ?? null,
    expect,
  };
}

/**
 * Does this task fire this skill?
 *
 * The same matching the loader uses: a trigger is a phrase, and it fires when the task mentions
 * it. Deliberately plain — a skill whose firing cannot be predicted by reading its triggers is a
 * skill nobody can reason about.
 */
export const fires = (skill, task) => skill.triggers.some((trigger) => {
  const words = String(trigger).toLowerCase().split(/\s+/).filter(Boolean);
  const text = String(task).toLowerCase();
  return words.length > 0 && words.every((word) => text.includes(word));
});

/** Read a fixture: the small repo state a skill test runs against. */
export async function readFixture(root, given) {
  const dir = join(root, given);
  const files = [];
  const walk = async (current, prefix = '') => {
    for (const entry of (await readdir(current, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(current, entry.name), relative);
      else files.push({ path: relative, content: (await readText(join(current, entry.name))) ?? '' });
    }
  };
  await walk(dir);
  return files;
}

/**
 * §56 — run the skill on the fixture and assert the expectations.
 *
 * The model is given the skill body as its instruction and the fixture as the repository state,
 * and asked for the files it would end with. The expectations are checked against that.
 *
 * Asking for whole files rather than a patch is deliberate: a patch that does not apply is
 * ambiguous between "the skill did nothing" and "the model produced a bad diff", and this test
 * exists to tell those apart.
 */
export async function runFixture(root, skill, test, { ask, folder = DEFAULT_FOLDER } = {}) {
  if (!test.given) return { ran: false, why: 'its test names no `given:` fixture' };
  const files = await readFixture(root, test.given);
  if (!files.length) return { ran: false, why: `its fixture ${test.given} has no files` };

  const task = test.triggersOn[0];
  const result = await ask(root, {
    role: 'implementer',
    folder,
    system: [
      'You are applying one skill to one small repository. The skill is the only instruction that matters.',
      'Answer with JSON and nothing else: {"files":[{"path":"<path>","content":"<the whole file after your change>"}]}.',
      'Include only files you created or changed. If the skill means you should change nothing, answer {"files":[]}.',
    ].join('\n'),
    prompt: [
      `## The skill\n\n${stripHeader(skill.body)}`,
      `## The task\n\n${task}`,
      `## The repository\n\n${files.map((file) => `### ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n')}`,
    ].join('\n\n'),
  });

  if (!result.json?.files) {
    return { ran: true, ok: false, why: 'the model did not answer with the file list this asked for, so there is nothing to check', model: result.model };
  }

  const produced = new Map(result.json.files.map((file) => [String(file.path), String(file.content ?? '')]));
  const failures = [];

  for (const expectation of test.expect) {
    if (expectation.kind === 'no-file') {
      if (produced.has(expectation.path)) failures.push(`it created ${expectation.path}, and the test says it must extend rather than create`);
      continue;
    }
    const content = produced.get(expectation.path) ?? files.find((file) => file.path === expectation.path)?.content;
    if (content === undefined) {
      failures.push(`${expectation.path} is neither in the fixture nor in what the skill produced`);
      continue;
    }
    for (const needle of expectation.contains) {
      if (!content.includes(needle)) failures.push(`${expectation.path} does not contain ${JSON.stringify(needle)}`);
    }
  }

  return { ran: true, ok: failures.length === 0, failures, model: result.model, usage: result.usage };
}

/**
 * Run the skill tests. §56: check the triggers fire and only fire when they should, run the skill
 * on the fixture, and assert the expectations.
 *
 * The trigger half needs no model and always runs. The fixture half does, so it runs only when
 * `ask` is supplied — and when it is not, the expectations are reported as unchecked rather than
 * counted. A green run that verified half of what it claimed would be worse than an honest
 * partial one.
 */
export async function testSkills(root, { folder = DEFAULT_FOLDER, only = null, ask = null } = {}) {
  const { skills } = await listSkills(root, { folder });
  const results = [];

  for (const skill of skills) {
    if (only && skill.name !== only) continue;
    const problems = [];
    const unchecked = [];

    if (!skill.test) {
      // §56 — "A skill without a test loads with a warning and cannot be promoted."
      results.push({ name: skill.name, ok: false, untested: true, problems: ['it has no <name>.test.md, so nothing would notice it regressing'], unchecked: [] });
      continue;
    }

    const test = parseSkillTest(skill.test);
    if (test.skill && test.skill !== skill.name) {
      problems.push(`its test names skill "${test.skill}", not "${skill.name}"`);
    }
    if (!test.triggersOn.length) problems.push('its test lists no triggers-on, so it asserts nothing about firing');

    for (const task of test.triggersOn) {
      if (!fires(skill, task)) problems.push(`it should fire on "${task}" and does not`);
    }
    for (const task of test.mustNotTriggerOn) {
      if (fires(skill, task)) problems.push(`it fires on "${task}" and must not`);
    }

    if (skill.tokens > BODY_MAX) problems.push(`its body is about ${skill.tokens} tokens, over the ${BODY_MAX} ceiling — split it`);
    if (skill.tokens && skill.tokens < BODY_MIN) problems.push(`its body is about ${skill.tokens} tokens, under ${BODY_MIN} — it is probably a rule, not a skill`);

    if (test.given && !(await exists(join(root, test.given)))) {
      problems.push(`its fixture ${test.given} is not there`);
    } else if (test.expect.length && ask) {
      const run = await runFixture(root, skill, test, { ask, folder }).catch((error) => ({ ran: true, ok: false, why: error.message }));
      if (!run.ran) unchecked.push(`${test.expect.length} fixture expectation(s) not run: ${run.why}`);
      else if (!run.ok) problems.push(...(run.failures ?? [run.why]));
    } else if (test.expect.length) {
      unchecked.push(`${test.expect.length} fixture expectation(s) not run: pass --run, and set the credential for the tier the policy names`);
    }

    results.push({ name: skill.name, ok: problems.length === 0, untested: false, problems, unchecked });
  }

  return {
    results,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok && !result.untested),
    untested: results.filter((result) => result.untested),
  };
}

/** §56 — triggers overlapping by more than half are two instructions for one task. */
export function overlaps(skills, { limit = OVERLAP_LIMIT } = {}) {
  const found = [];
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      // The same skill at two scopes is the override chain's business, not an overlap.
      if (skills[i].name === skills[j].name) continue;
      const left = new Set(skills[i].triggers.map((trigger) => String(trigger).toLowerCase()));
      const right = new Set(skills[j].triggers.map((trigger) => String(trigger).toLowerCase()));
      if (!left.size || !right.size) continue;
      let shared = 0;
      for (const trigger of left) if (right.has(trigger)) shared += 1;
      const share = shared / Math.min(left.size, right.size);
      if (share > limit) found.push({ a: skills[i].name, b: skills[j].name, shared, share });
    }
  }
  return found;
}

/** Which three would load for a task, and which were left out. §56's budget. */
export function loadFor(skills, task, { limit = LOAD_LIMIT } = {}) {
  // One body per name: when a skill exists at several scopes, only the winner of the override
  // chain loads — the point of the chain is that the others do not.
  const winners = new Map();
  for (const skill of skills) {
    const current = winners.get(skill.name);
    if (!current || (SCOPE_ORDER[skill.scope] ?? 9) < (SCOPE_ORDER[current.scope] ?? 9)) winners.set(skill.name, skill);
  }
  const matching = [...winners.values()]
    .filter((skill) => fires(skill, task))
    // The most specific triggers win: a skill that fired on a longer phrase matched more of the
    // task, which is a better reason to load it than alphabetical order.
    .map((skill) => ({
      skill,
      specificity: Math.max(...skill.triggers.filter((trigger) => fires({ triggers: [trigger] }, task)).map((trigger) => String(trigger).length), 0),
    }))
    .sort((a, b) => b.specificity - a.specificity || a.skill.name.localeCompare(b.skill.name));

  return {
    loaded: matching.slice(0, limit).map((entry) => entry.skill.name),
    leftOut: matching.slice(limit).map((entry) => entry.skill.name),
  };
}

/** §56 — the override chain, so nobody is surprised by which version fired. */
export function overrideChain(skills) {
  const byName = new Map();
  for (const skill of skills) {
    const existing = byName.get(skill.name) ?? [];
    existing.push(skill.scope);
    byName.set(skill.name, existing);
  }
  const order = SCOPE_ORDER;
  return [...byName.entries()]
    .filter(([, scopes]) => scopes.length > 1)
    .map(([name, scopes]) => {
      const sorted = [...scopes].sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return { name, scopes: sorted, wins: sorted[0] };
    });
}

/**
 * §56 — `promote <name> --to team` opens the PR with the skill, its test and its match history.
 *
 * "A skill without a test cannot be promoted from repo to team scope." Enforced here rather than
 * asked for: a team skill is loaded into other people's sessions, and one that regresses there
 * regresses everywhere at once.
 */
export async function promote(root, name, { folder = DEFAULT_FOLDER, to = 'team' } = {}) {
  if (!SCOPES.includes(to)) throw new Error(`"${to}" is not a scope. One of: ${SCOPES.join(', ')}.`);
  if (to === 'vibekit') throw new Error('The `vibekit` scope is what ships with the tool. A team skill is the furthest a project can promote its own.');

  const { skills } = await listSkills(root, { folder });
  const skill = skills.find((entry) => entry.name === name);
  if (!skill) throw new Error(`No skill "${name}" in ${folder}/skills/index.yml.`);
  if (skill.missing) throw new Error(`${name} is in the index with no body at ${folder}/skills/lib/.`);
  if (!skill.test) {
    throw new Error(`${name} has no test. A team skill loads into other people's sessions, so one that regresses there regresses everywhere at once — §56 refuses the promotion.`);
  }

  const dir = join(teamSkillsDir(), name);
  await writeText(join(dir, `${name}.md`), skill.body);
  await writeText(join(dir, `${name}.test.md`), skill.test);
  await writeText(join(dir, 'PROMOTION.md'), [
    `# ${name}`,
    '',
    `Promoted from a repository to ${to} scope on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    '## Triggers',
    '',
    skill.triggers.map((trigger) => `- ${trigger}`).join('\n'),
    '',
    '## Why it earned this',
    '',
    'A skill nobody asked for is not written. Replace this paragraph with the sessions that matched it,',
    'which is what a reviewer needs in order to agree it belongs in everyone\'s context.',
    '',
  ].join('\n'));

  return { name, to, dir, files: [`${name}.md`, `${name}.test.md`, 'PROMOTION.md'] };
}

/**
 * §56 — import a skill written in a runner's own format.
 *
 * "marked `confidence: low` until a human edits the triggers." The triggers are the part that
 * cannot be inferred: a description says what a skill is for, not the words that should fetch it.
 */
export async function importSkill(root, from, { folder = DEFAULT_FOLDER } = {}) {
  // A directory read throws EISDIR rather than returning null, and `from` is usually a folder:
  // the whole point of this command is that a runner keeps its skills in one.
  const candidates = [join(from, 'SKILL.md'), join(from, 'skill.md'), from];
  let text = null;
  let source = null;
  for (const candidate of candidates) {
    text = await readText(candidate).catch(() => null);
    if (text !== null) {
      source = candidate;
      break;
    }
  }
  if (text === null) throw new Error(`Nothing to import at ${from}. Expected a Markdown file, or a folder containing SKILL.md.`);

  const meta = readFrontMatter(text);
  const name = (meta.name ?? basename(from.replace(/\/SKILL\.md$/i, ''))).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const description = meta.description ?? String(text).match(/^#\s+(.+)$/m)?.[1] ?? '';

  // Triggers inferred from the description are a guess, and the guess is labelled as one.
  const triggers = [...new Set(String(description).toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) ?? [])]
    .filter((word) => !['this', 'that', 'with', 'when', 'from', 'skill', 'should', 'always'].includes(word))
    .slice(0, 4);

  const body = [
    `# ${name}`,
    '',
    `<!-- imported from ${source} · triggers inferred from its description · confidence: low -->`,
    '',
    stripHeader(text).trim(),
    '',
  ].join('\n');

  await writeText(bodyPath(root, folder, `lib/${name}.md`), body);

  // The same shape the generator writes: a dash at column zero, and `path:` relative to skills/.
  const index = (await readText(indexPath(root, folder))) ?? '';
  const entry = [
    `- name: ${name}`,
    `  triggers: [${triggers.join(', ')}]`,
    `  path: lib/${name}.md`,
    '  confidence: low',
  ].join('\n');
  await writeText(indexPath(root, folder), `${index.trimEnd()}\n${entry}\n`.replace(/^\n/, ''));

  return { name, source, triggers, path: `${folder}/skills/lib/${name}.md` };
}
