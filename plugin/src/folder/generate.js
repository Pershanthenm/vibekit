import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFrontMatter } from '../frontmatter.js';
import { exists, readText, writeAtomic, writeText } from '../fsutil.js';
import { sha256 } from '../context/unit.js';
import { budgetReport } from './budget.js';
import { decide, hasHeader, preserveLocal, withHeader } from './header.js';
import { DEFAULT_DELIVERY, DEFAULT_FOLDER, Kind, POINTERS, filesFor } from './layout.js';
import { createRequirement, listRequirements } from './requirements.js';
import { STAGE_PROMPTS } from './stages.js';
import * as T from './templates.js';
import { SERVERS_STARTER } from '../servers.js';
import { SHIPPED_SUBDIR, catalogueFiles, shippedFiles, shippedIndexEntries } from '../library.js';
import { renderStatus } from './workflow.js';

/**
 * Writing the folder. Specification §11.
 *
 * Seven rules hold this together: assemble in a temporary directory and move it into place in one
 * step, so a failed run never leaves half a folder; produce byte-identical output on a second
 * run; refuse to overwrite a generated path whose file has lost its header; create an authored
 * file once and never touch it again; touch nothing outside the declared paths; support
 * rules-only mode as a first-class target; and report the budget every time.
 */

const EMPTY_DIRS = ['product/requirements', 'product/sources', 'product/design', 'skills/lib', 'workflow/asks', 'workflow/answers', 'memory/repo', 'memory/sessions'];

/**
 * Skills are indexed from the bodies that exist, not from config, so a body someone drops in is
 * found. Triggers come from config when it declares them, else from the body's own front matter —
 * an adopted or hand-written skill that carries `triggers:` keeps them across a regeneration.
 */
async function skillsFrom(base, config) {
  const names = (await readdir(join(base, 'skills/lib')).catch(() => []))
    .filter((name) => name.endsWith('.md') && !name.endsWith('.test.md'))
    .map((name) => name.replace(/\.md$/, ''));
  const declared = new Map((config.skills ?? []).map((skill) => [skill.name, skill]));
  const skills = [];
  for (const name of names) {
    if (declared.has(name)) { skills.push(declared.get(name)); continue; }
    const meta = readFrontMatter((await readText(join(base, 'skills/lib', `${name}.md`))) ?? '');
    const triggers = String(meta.triggers ?? '').replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
    skills.push({ name, triggers });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function memoriesFrom(base) {
  const names = (await readdir(join(base, 'memory/repo')).catch(() => [])).filter((name) => name.endsWith('.md')).sort();
  const found = [];
  for (const name of names) {
    const meta = readFrontMatter((await readText(join(base, 'memory/repo', name))) ?? '');
    found.push({
      id: meta.id ?? name.replace(/\.md$/, ''),
      kind: meta.kind ?? 'semantic',
      topic: String(meta.topic ?? '').replace(/^\[|\]$/g, '').split(',').map((word) => word.trim()).filter(Boolean),
      learned: meta.learned ?? '',
    });
  }
  return found;
}

async function sourcesFrom(base) {
  const names = (await readdir(join(base, 'product/sources'), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^(?:BRS|DESC)-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return names.map((name) => ({ id: name, title: name.replace(/^(?:BRS|DESC)-\d+-?/, '').replace(/-/g, ' ') || name }));
}

/**
 * The board comes from the REQ files, not from config: they are the same list only if one derives
 * from the other, and the files are what a person edits. Config seeds requirements that do not
 * exist yet by writing them as files first, so the board is never aspirational.
 */
async function requirementsFrom(root, folder, config) {
  const existing = await listRequirements(root, folder);
  const known = new Set(existing.map((entry) => entry.id));
  for (const seed of config.requirements ?? []) {
    if (!seed.id || known.has(seed.id)) continue;
    await createRequirement(root, seed, folder);
  }
  return (config.requirements ?? []).length ? listRequirements(root, folder) : existing;
}

function generatedFiles(config, folder, { skills, memories, sources, requirements, delivery, status }) {
  const counts = { skills: skills.length, memories: memories.length };
  const files = [
    { path: 'README.md', source: 'readme', content: T.readmeBody(config, folder) },
    { path: 'standards/code-style.md', source: 'style', content: T.codeStyleBody(config) },
    { path: 'standards/security.md', source: 'security', content: T.securityBody(config) },
    { path: 'product/map.md', source: 'map', content: T.mapBody(config, folder) },
    { path: 'product/entities.md', source: 'entities', content: T.entitiesBody(config) },
    { path: 'product/requirements/index.md', source: 'requirements', content: T.requirementsIndexBody(requirements) },
    { path: 'product/sources/index.md', source: 'sources', content: T.sourcesIndexBody(sources) },
    { path: 'product/design/tokens.md', source: 'design', content: T.tokensBody(config) },
    { path: 'skills/index.yml', source: 'skills', content: T.skillsIndexBody(skills) },
    { path: 'memory/index.md', source: 'memory', content: T.memoryIndexBody(memories) },
    { path: 'workflow/status.md', source: 'workflow', content: status },
    // Written last: an abstract summarises its area, so it must not be older than what it
    // summarises or the freshness check fires on every fresh folder.
    { path: 'product/.abstract', source: 'abstract', content: T.abstractBody('product', config, counts) },
    { path: 'skills/.abstract', source: 'abstract', content: T.abstractBody('skills', config, counts) },
    { path: 'memory/.abstract', source: 'abstract', content: T.abstractBody('memory', config, counts) },
  ];
  if (delivery !== 'none') files.push({ path: 'delivery/pipeline.spec.md', source: 'pipeline', content: T.pipelineSpecBody({ ...config, deliveryMode: delivery }) });
  if (delivery === 'full') {
    files.push(
      { path: 'delivery/environments.md', source: 'environments', content: T.environmentsBody(config) },
      { path: 'delivery/observability.md', source: 'observability', content: T.observabilityBody(config) },
    );
  }
  return files;
}

const authoredStarters = (config) => [
  { path: 'profile.md', content: T.profileStarter(config) },
  { path: 'standards/rules.md', content: T.rulesStarter() },
  { path: 'standards/guardrails.md', content: T.guardrailsStarter(config) },
  { path: 'product/context.md', content: T.contextStarter(config) },
  { path: 'product/glossary.md', content: T.glossaryStarter() },
  { path: 'product/quality.md', content: T.qualityStarter() },
  { path: 'product/invariants.md', content: T.invariantsStarter() },
  { path: 'product/access.md', content: T.accessStarter() },
  { path: 'product/design/components.md', content: T.componentsStarter() },
  { path: 'product/design/flows.md', content: T.flowsStarter() },
  { path: 'workflow/assumptions.md', content: T.assumptionsStarter() },
  { path: 'workflow/architecture.md', content: T.architectureStarter(config) },
  { path: 'workflow/plan.md', content: T.planStarter() },
  { path: 'agents/humans.md', content: T.humansStarter() },
  { path: 'agents/runners.md', content: T.runnersStarter() },
  { path: 'agents/servers.yml', content: SERVERS_STARTER },
  ...T.ROLE_NAMES.map((role) => ({ path: `agents/${role}.md`, content: T.roleStarter(role) })),
  ...STAGE_PROMPTS.map((stage) => ({ path: stage.path, content: stage.body() })),
];

export async function generateFolder(root, config, options = {}) {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const delivery = options.delivery ?? config.deliveryMode ?? DEFAULT_DELIVERY;
  const base = join(root, folder);
  const written = [];
  const skipped = [];
  const kept = [];
  const manifest = {};

  const staging = await mkdtemp(join(tmpdir(), 'vibekit-folder-'));
  const staged = join(staging, 'folder');

  try {
    // Start from whatever is there. Copying first is what makes the swap safe: everything the
    // generator does not own — requirements, asks, skill bodies, memories, a team's own notes —
    // is already in the staged copy before a single file is written over it.
    if (await exists(base)) await cp(base, staged, { recursive: true });
    else await mkdir(staged, { recursive: true });
    for (const dir of EMPTY_DIRS) await mkdir(join(staged, dir), { recursive: true });

    // Authored files first: a requirement seeded from config has to exist before the board that
    // lists it is generated, or the two disagree on the first run.
    for (const file of authoredStarters(config)) {
      const target = join(staged, file.path);
      if (await exists(target)) {
        kept.push(`${folder}/${file.path}`);
        continue;
      }
      await writeText(target, file.content);
      written.push(`${folder}/${file.path}`);
      manifest[`${folder}/${file.path}`] = { hash: sha256(file.content), kind: Kind.Authored, source: 'starter' };
    }

    // §56 — the shipped library. On by default for a project made through the CLI (`library: false`
    // in the project file, or `vibekit init --no-library`, turns it off); a config that says nothing
    // gets nothing, so a folder generated from a bare config is exactly what the config describes.
    const library = options.library ?? config.library ?? false;
    const chosen = options.catalogue ?? config.catalogue ?? [];
    const catalogue = chosen.length ? await catalogueFiles(chosen) : { files: [], entries: [] };
    const shipped = [...(library ? await shippedFiles() : []), ...catalogue.files];
    // Everything under lib/vibekit comes from the library, so it is rebuilt from nothing each run:
    // a skill disabled since the last run must not linger as a file the index no longer names.
    await rm(join(staged, 'skills', SHIPPED_SUBDIR), { recursive: true, force: true }).catch(() => {});
    const [own, memories, sources] = await Promise.all([skillsFrom(staged, config), memoriesFrom(staged), sourcesFrom(staged)]);
    const skills = [...own, ...(library ? await shippedIndexEntries() : []), ...catalogue.entries];
    // Requirements are read through the staged copy by pointing the reader at the staging root.
    const requirements = await requirementsFrom(staging, 'folder', config);
    const status = await renderStatus(staging, 'folder').catch(() => '# Workflow status\n\nstage: 0 intake\n');

    for (const file of [...generatedFiles(config, folder, { skills, memories, sources, requirements, delivery, status }), ...shipped]) {
      const target = join(staged, file.path);
      const existing = await readText(target);
      if (!options.force && decide({ kindIsGenerated: true, existing }) === 'skip') {
        skipped.push(`${folder}/${file.path}`);
        continue;
      }
      // A generated file the team has added to below `<!-- local -->` keeps that tail — the design
      // gate's `approved:` on tokens.md lives there, and a regeneration that dropped it would shut
      // a gate a human had opened.
      const content = preserveLocal(existing, withHeader(file.path, file.source, file.content));
      await writeText(target, content);
      written.push(`${folder}/${file.path}`);
      manifest[`${folder}/${file.path}`] = { hash: sha256(content), kind: Kind.Generated, source: file.source };
    }

    for (const [path, body] of [['.state/bindings.json', '{\n  "entities": {}\n}\n'], ['.state/tasks.json', '{\n  "held": {}\n}\n'], ['.state/sessions.json', '{\n  "sessions": []\n}\n'], ['.state/workflow.json', '{}\n']]) {
      if (!(await exists(join(staged, path)))) await writeText(join(staged, path), body);
    }

    await swapIntoPlace(staged, base);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }

  // Pointer files sit at the repository root and are replaced one at a time, because each is a
  // single file and writeAtomic already closes the window where a reader sees a truncated one.
  for (const pointer of POINTERS) {
    const target = join(root, pointer.path);
    const existing = await readText(target);
    if (!options.force && decide({ kindIsGenerated: true, existing }) === 'skip') {
      skipped.push(pointer.path);
      continue;
    }
    const body = pointerBodyFor(pointer, config, folder, delivery);
    const content = preserveLocal(existing, withHeader(pointer.path, pointer.source, body));
    await writeAtomic(target, content);
    written.push(pointer.path);
    manifest[pointer.path] = { hash: sha256(content), kind: Kind.Generated, source: pointer.source };
  }

  // Written last, and after the swap, so it records the pointer files too. It is state: losing it
  // costs a rescan, never a decision.
  await writeText(join(base, '.state/manifest.json'), `${JSON.stringify({ folder, delivery, generatedAtUtc: new Date().toISOString(), files: manifest }, null, 2)}\n`);
  await ignoreState(root, folder);

  const budget = await budgetReport(root, folder);
  return { folder, delivery, written, skipped, kept, budget };
}

function pointerBodyFor(pointer, config, folder, delivery) {
  if (pointer.source === 'gitattributes') return T.gitattributesBody(folder, delivery);
  if (pointer.source === 'environments') return T.envExampleBody(config);
  if (pointer.source === 'commands') return T.claudeCommandBody(folder);
  return T.pointerBody(config, folder);
}

/**
 * One move, not a file-by-file copy. A run that dies half way through leaves the folder that was
 * there before, untouched — the difference between a failed run and a broken repository.
 */
async function swapIntoPlace(staged, target) {
  await mkdir(dirname(target), { recursive: true });
  const backup = `${target}.vibekit-backup-${process.pid}`;
  const had = await exists(target);
  if (had) await rename(target, backup);
  try {
    await rename(staged, target);
  } catch (error) {
    if (had) await rename(backup, target).catch(() => {});
    throw error;
  }
  await rm(backup, { recursive: true, force: true }).catch(() => {});
}

/** §51 — state, worktrees, .env and the redaction mapping never go to git. */
async function ignoreState(root, folder) {
  const path = join(root, '.gitignore');
  const entries = [`${folder}/.state/`, '.vibekit-worktrees/', '.env'];
  const current = (await readText(path)) ?? '';
  const lines = current.split('\n').map((line) => line.trim());
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (!missing.length) return;
  const body = current && !current.endsWith('\n') ? `${current}\n` : current;
  await writeAtomic(path, `${body}${missing.join('\n')}\n`);
}

export { hasHeader };
