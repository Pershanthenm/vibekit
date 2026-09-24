import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrontMatter } from './frontmatter.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { exists, readText, writeText } from './fsutil.js';
import { estimateProseTokens } from './tokens.js';

/**
 * The skills that ship with VibeKit. Specification §56: "a repo skill overrides a team one, which
 * overrides a shipped one", and the `vibekit` scope in the override chain is these.
 *
 * Each shipped skill is a short technique (100 to 400 tokens, like any skill) distilled from a
 * larger MIT-licensed source, with a sibling test and a reference file holding the full source
 * text. `vibekit init` writes the bodies and tests into the project as **generated** files under
 * `skills/lib/vibekit/`, so file-driven agents can read them, the pre-edit hook refuses to let an
 * agent rewrite them, and a regeneration keeps them current. The references stay here: they are
 * long, they change nothing about what an agent does by default, and `vibekit skills reference`
 * prints one when it is wanted. A team that wants its own version adopts the skill into
 * `skills/lib/` and the repo copy wins.
 */

export const LIBRARY_DIR = fileURLToPath(new URL('../library', import.meta.url));
export const SHIPPED_SUBDIR = 'lib/vibekit';
const skillsDir = () => join(LIBRARY_DIR, 'skills');
const referencesDir = () => join(LIBRARY_DIR, 'references');

const parseList = (value) => String(value ?? '').replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;

/** Every shipped skill: name, triggers, body (front matter included), test, source line. */
export async function shippedSkills() {
  const names = (await readdir(skillsDir()).catch(() => []))
    .filter((file) => file.endsWith('.md') && !file.endsWith('.test.md'))
    .map((file) => file.replace(/\.md$/, ''))
    .sort();
  const skills = [];
  for (const name of names) {
    const body = (await readText(join(skillsDir(), `${name}.md`))) ?? '';
    const meta = readFrontMatter(body);
    skills.push({
      name: meta.name ?? name,
      triggers: parseList(meta.triggers),
      source: meta.source ?? null,
      body,
      test: await readText(join(skillsDir(), `${name}.test.md`)),
      tokens: estimateProseTokens(body.replace(FRONT_MATTER, '')),
      reference: (await exists(join(referencesDir(), `${name}.md`))) ? join(referencesDir(), `${name}.md`) : null,
    });
  }
  return skills;
}

export const shippedSkill = async (name) => (await shippedSkills()).find((skill) => skill.name === name) ?? null;

/**
 * The files the generator writes for the library, relative to the folder: a body and a test per
 * skill, at `skills/lib/vibekit/<name>[.test].md`. Both are generated (headered) files.
 */
export async function shippedFiles() {
  const files = [];
  for (const skill of await shippedSkills()) {
    files.push({ path: `skills/${SHIPPED_SUBDIR}/${skill.name}.md`, source: 'library', content: skill.body, skill });
    if (skill.test) files.push({ path: `skills/${SHIPPED_SUBDIR}/${skill.name}.test.md`, source: 'library', content: skill.test, skill });
  }
  return files;
}

/** The index entries for the shipped skills, in the shape `skills/index.yml` uses. */
export const shippedIndexEntries = async () => (await shippedSkills()).map((skill) => ({ name: skill.name, triggers: skill.triggers, path: `${SHIPPED_SUBDIR}/${skill.name}.md` }));

/** The full source text a shipped skill was distilled from, for `vibekit skills reference <name>`. */
export async function referenceFor(name) {
  const skill = await shippedSkill(name);
  if (skill) return { skill, text: skill.reference ? await readText(skill.reference) : null };
  const entry = await catalogueSkill(name);
  if (entry) return { skill: entry, text: await readText(entry.path) };
  throw new Error(`No shipped or catalogue skill "${name}". \`vibekit skills\` lists the project's; \`vibekit skills catalogue <word>\` searches the rest.`);
}

/**
 * `vibekit skills adopt <name>`: copy a shipped skill into the project's own `skills/lib/` so the
 * team can edit it. The copy is authored (no generated header), the index points at it, and from
 * then on the repo copy wins the override chain; `vibekit skills` reports the chain.
 */
export async function adopt(root, name, { folder = DEFAULT_FOLDER } = {}) {
  let skill = await shippedSkill(name);
  if (!skill) {
    // A catalogue entry adopts as its short lead; the full text stays reachable as the reference.
    const entry = await catalogueSkill(name);
    if (entry) {
      const text = (await readText(entry.path)) ?? '';
      skill = { ...entry, body: `---\nname: ${entry.name}\ntriggers: [${entry.triggers.join(', ')}]\nsource: ${entry.source ?? ''}\n---\n${shortLead(entry.name, text)}`, test: `---\nskill: ${entry.name}\ntriggers-on: [${entry.triggers.slice(0, 4).map((trigger) => JSON.stringify(trigger)).join(', ')}]\nmust-not-trigger-on: []\n---\n` };
    }
  }
  if (!skill) throw new Error(`No shipped or catalogue skill "${name}" to adopt. \`vibekit skills catalogue <word>\` searches the catalogue.`);
  const target = join(root, folder, 'skills/lib', `${name}.md`);
  if (await exists(target)) throw new Error(`${folder}/skills/lib/${name}.md already exists: the project already has its own ${name}.`);
  const note = `<!-- adopted from VibeKit's shipped skill ${name} on ${new Date().toISOString().slice(0, 10)}; edit freely — this copy wins over the shipped one -->`;
  const body = skill.body.replace(FRONT_MATTER, (front) => `${front}${note}\n\n`);
  await writeText(target, body);
  const written = [`${folder}/skills/lib/${name}.md`];
  if (skill.test) {
    await writeText(join(root, folder, 'skills/lib', `${name}.test.md`), skill.test);
    written.push(`${folder}/skills/lib/${name}.test.md`);
  }
  // The index: the repo copy is listed under its own path; the shipped entry stays, so the chain
  // is visible rather than silently replaced.
  const { indexPath } = await import('./skills.js');
  const index = (await readText(indexPath(root, folder))) ?? '';
  const entry = `- name: ${name}\n  triggers: [${skill.triggers.join(', ')}]\n  path: lib/${name}.md\n`;
  await writeText(indexPath(root, folder), `${index.trimEnd()}\n${entry}`.replace(/^\n/, ''));
  return { name, written, triggers: skill.triggers };
}

// ---------------------------------------------------------------- the catalogue

/**
 * The catalogue: every unique skill from the source repository, converted to data and filed by
 * domain under `library/catalogue/`. Nothing in it is indexed until a project enables it, because
 * an index entry is always-loaded context and the whole catalogue would cost three times a
 * project's cap. Enabled entries are written like the curated skills — generated, under
 * `skills/lib/vibekit/` — with a short lead as the body and the full text as the reference.
 */
const catalogueDir = () => join(LIBRARY_DIR, 'catalogue');
let catalogueCache = null;

export async function catalogueSkills() {
  if (catalogueCache) return catalogueCache;
  const out = [];
  for (const domain of (await readdir(catalogueDir()).catch(() => [])).sort()) {
    // Finder leaves "engineering 3" next to engineering; those copies must not double the catalogue.
    if (/ \d+$/.test(domain)) continue;
    const files = (await readdir(join(catalogueDir(), domain)).catch(() => [])).filter((file) => file.endsWith('.md')).sort();
    for (const file of files) {
      const path = join(catalogueDir(), domain, file);
      const text = (await readText(path)) ?? '';
      const meta = readFrontMatter(text);
      out.push({
        name: meta.name ?? file.replace(/\.md$/, ''), domain: meta.domain ?? domain, triggers: parseList(meta.triggers),
        description: meta.description ?? '', source: meta.source ?? null, path, tokens: estimateProseTokens(text.replace(FRONT_MATTER, '')),
      });
    }
  }
  catalogueCache = out;
  return out;
}

export async function catalogueDomains() {
  const counts = new Map();
  for (const skill of await catalogueSkills()) counts.set(skill.domain, (counts.get(skill.domain) ?? 0) + 1);
  return [...counts.entries()].map(([domain, count]) => ({ domain, count }));
}

export const catalogueSkill = async (name) => (await catalogueSkills()).find((skill) => skill.name === name) ?? null;

/** Plain word search over name, domain, description and triggers. */
export async function searchCatalogue(query = '', { domain = null } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return (await catalogueSkills()).filter((skill) => {
    if (domain && skill.domain !== domain) return false;
    const haystack = `${skill.name} ${skill.domain} ${skill.description} ${skill.triggers.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * What a project's `catalogue:` list selects. A word that is a domain selects the whole domain;
 * anything else must be a skill name. Unknown words are returned, not ignored: a typo that
 * silently enabled nothing is how a team believes it has a skill it does not.
 */
export async function selectCatalogue(list = []) {
  const all = await catalogueSkills();
  const domains = new Set(all.map((skill) => skill.domain));
  const chosen = new Map();
  const unknown = [];
  for (const item of list.map(String)) {
    if (domains.has(item)) { for (const skill of all.filter((skill) => skill.domain === item)) chosen.set(skill.name, skill); continue; }
    const skill = all.find((entry) => entry.name === item);
    if (skill) chosen.set(skill.name, skill); else unknown.push(item);
  }
  return { skills: [...chosen.values()], unknown };
}

/**
 * The indexed body of a catalogue skill: its description and the opening of its text, cut at the
 * body ceiling, ending with where the rest is. Code blocks are left out of the lead — they are
 * in the reference — because a fenced block is the one thing that blows a 400-token budget.
 */
export function shortLead(name, text, { limit = 360 } = {}) {
  const meta = readFrontMatter(text);
  const body = text.replace(FRONT_MATTER, '').replace(/^<!--[\s\S]*?-->\n+/, '');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
  const pointer = `The full text, with its examples: \`vibekit skills reference ${name}\`.`;
  // Line by line first: fenced code, table rows, rules and comments go to the reference, whatever
  // paragraph they sit in — a fence that opens mid-paragraph is the case a block split misses.
  const prose = [];
  let fence = false;
  for (const raw of body.replace(/^#\s+.+$/m, '').split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence || /^\s*\|/.test(line) || /^\s*<!--.*-->\s*$/.test(line) || /^\s*[-*_]{3,}\s*$/.test(line)) continue;
    prose.push(line);
  }
  const blocks = prose.join('\n').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
    .filter((block) => !/^#{1,4}\s+table of contents/i.test(block) && !/^(?:[-*]\s+\[.*\]\(#.*\)\s*\n?)+$/.test(block));
  const kept = [];
  let used = estimateProseTokens(`# ${title}\n\n${meta.description ?? ''}\n\n${pointer}`);
  for (const block of blocks) {
    const cost = estimateProseTokens(block) + 1;
    if (used + cost > limit) break;
    kept.push(block);
    used += cost;
  }
  // A heading with nothing kept under it (its table or code went to the reference) is noise.
  const isHeading = (block) => /^#{1,6}\s/.test(block) && !block.includes('\n');
  const trimmed = kept.filter((block, index) => !(isHeading(block) && (index === kept.length - 1 || isHeading(kept[index + 1]))));
  return `# ${title}\n\n${meta.description ? `${meta.description}\n\n` : ''}${trimmed.join('\n\n')}${trimmed.length ? '\n\n' : ''}${pointer}\n`;
}

/** The generated files and index entries for the catalogue entries a project enables. */
export async function catalogueFiles(list = []) {
  const { skills, unknown } = await selectCatalogue(list);
  const curated = new Set((await shippedSkills()).map((skill) => skill.name));
  const files = [];
  const entries = [];
  for (const skill of skills) {
    if (curated.has(skill.name)) continue; // the hand-distilled version is already there under that name
    const text = (await readText(skill.path)) ?? '';
    const front = `---\nname: ${skill.name}\ndomain: ${skill.domain}\ntriggers: [${skill.triggers.join(', ')}]\nsource: ${skill.source ?? ''}\n---\n`;
    files.push({ path: `skills/${SHIPPED_SUBDIR}/${skill.name}.md`, source: 'catalogue', content: `${front}${shortLead(skill.name, text)}`, skill });
    // A trigger test written from the triggers themselves: each fires by construction, so the test
    // catches an edit that breaks one later, which is what a test that ships with data is for.
    files.push({ path: `skills/${SHIPPED_SUBDIR}/${skill.name}.test.md`, source: 'catalogue', content: `---\nskill: ${skill.name}\ntriggers-on: [${skill.triggers.slice(0, 4).map((trigger) => JSON.stringify(trigger)).join(', ')}]\nmust-not-trigger-on: []\n---\n`, skill });
    entries.push({ name: skill.name, triggers: skill.triggers, path: `${SHIPPED_SUBDIR}/${skill.name}.md` });
  }
  return { files, entries, unknown, skipped: skills.filter((skill) => curated.has(skill.name)).map((skill) => skill.name) };
}

/** About what one more indexed skill costs, always loaded: the index entry. */
export const INDEX_TOKENS_PER_SKILL = 40;

/**
 * `vibekit skills enable <domain|name>…`: record the choice in the project file and say what it
 * will cost. Refused past the budget cap unless forced — past the cap teams delete rules to make
 * room, which is the failure the cap exists to catch.
 */
export async function enableCatalogue(root, items, { folder = DEFAULT_FOLDER, force = false } = {}) {
  const { loadProject, saveProject } = await import('./project.js');
  const { budgetReport } = await import('./folder/budget.js');
  const { BUDGET_CAP } = await import('./folder/layout.js');
  const project = await loadProject(root);
  const current = Array.isArray(project.catalogue) ? project.catalogue.map(String) : [];
  const { skills: before } = await selectCatalogue(current);
  const next = [...new Set([...current, ...items.map(String)])];
  const { skills: after, unknown } = await selectCatalogue(next);
  if (unknown.length) {
    const domains = (await catalogueDomains()).map((entry) => entry.domain);
    throw new Error(`Not in the catalogue: ${unknown.join(', ')}. Domains: ${domains.join(', ')}. \`vibekit skills catalogue <word>\` searches by name.`);
  }
  const added = after.filter((skill) => !before.some((known) => known.name === skill.name));
  const budget = await budgetReport(root, folder).catch(() => null);
  const projected = (budget?.alwaysLoaded ?? 0) + added.length * INDEX_TOKENS_PER_SKILL;
  const cap = budget?.ceiling ?? BUDGET_CAP;
  if (projected > cap && !force) {
    throw new Error(`Enabling ${added.length} more skill(s) would put the always-loaded folder at about ${projected} tokens against a cap of ${cap}. Enable fewer (a domain is many skills; a name is one), or --force if you mean it.`);
  }
  await saveProject(root, { ...project, catalogue: next });
  return { enabled: next, added: added.map((skill) => skill.name), total: after.length, projected, cap };
}

export async function disableCatalogue(root, items) {
  const { loadProject, saveProject } = await import('./project.js');
  const project = await loadProject(root);
  const current = Array.isArray(project.catalogue) ? project.catalogue.map(String) : [];
  const drop = new Set(items.map(String));
  const next = current.filter((item) => !drop.has(item));
  const removed = current.filter((item) => drop.has(item));
  await saveProject(root, { ...project, catalogue: next });
  return { enabled: next, removed, notEnabled: items.filter((item) => !current.includes(String(item))) };
}
