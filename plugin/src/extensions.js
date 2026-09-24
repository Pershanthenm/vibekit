import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { readChecks, validateCheck } from './extchecks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { exists, ownerOnly, readText, writeText } from './fsutil.js';
import { SIGNATURE_FILE, verifySignature } from './signing.js';
import { estimateProseTokens } from './tokens.js';
import { parseBlocks, parseYamlish } from './yamlish.js';

/**
 * Extensions. Specification §68 and the Extensions and Integration Spec §4–§5.
 *
 * "VibeKit installs small." An extension is a folder with a manifest and **data only**: stage
 * prompts, skills, declarative checks, document types, report sections, MCP server declarations,
 * stack templates. Never code. A folder cloned from a git URL that could run JavaScript inside
 * every project on the machine is a supply chain, and an extension mechanism that is one is a hole
 * with a name.
 *
 * Trust, budget and conflicts matter more than the features: pinned to a commit, never a branch;
 * every always-loaded cost declared and verified; a check may be added and never removed; a role
 * may be narrowed and never widened; nothing installs without a confirmation.
 */

/** The specification version this VibeKit implements; `requires: vibekit >= 1.0` is judged against it. */
export const VIBEKIT_VERSION = '1.2';
export const EXT_DIR = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'ext');
export const EXT_STATE = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'extensions.json');

/** Shipped with VibeKit: enabled by name, no download. */
export const BUILT_IN = Object.freeze({
  assess: { name: 'assess', version: VIBEKIT_VERSION, description: 'Idea assessment before a project exists: intake, research, define, shape, decide (§68)', adds: { commands: 1 } },
  'security-frameworks': { name: 'security-frameworks', version: VIBEKIT_VERSION, description: 'Framework scoring for `vibekit security scan`: ASVS, OWASP Top 10, API Top 10, CIS Docker, POPIA/GDPR, PCI (§70)', adds: { checks: 1 } },
  docs: { name: 'docs', version: VIBEKIT_VERSION, description: 'Architecture documents and diagrams from the folder (§66)', adds: { documents: 7 } },
});

/** What an extension may add. Anything else in a manifest is refused. */
export const MAY_ADD = Object.freeze(['commands', 'stages', 'skills', 'checks', 'documents', 'reports', 'templates', 'servers']);
/** Where each kind lives inside the extension folder. */
export const LAYOUT = Object.freeze({ skills: 'skills', checks: 'checks', stages: 'stages', documents: 'documents', reports: 'reports', templates: 'templates', servers: 'servers.yml', always: 'always', pipeline: 'pipeline.md' });
/** What no extension may name. §5.1: it may add a check but never remove one, narrow a role but never widen it. */
const FORBIDDEN = /standards\/|guardrails\.md|invariants\.md|may-write|widen|remove-check|disable|override/i;
const EXECUTABLE = /\.(?:m?js|cjs|ts|sh|ps1|py|rb|exe|dll|so|dylib|bat|cmd|jar|wasm)$/i;
/** A declared always-loaded cost this far off what is measured is reported (§5.2). */
export const BUDGET_TOLERANCE = 0.2;
const PER_SKILL_INDEX_TOKENS = 20;

export async function readState() {
  try {
    const parsed = JSON.parse((await readText(EXT_STATE())) ?? '{}');
    return { enabled: Array.isArray(parsed.enabled) ? parsed.enabled : [], external: parsed.external ?? {} };
  } catch {
    return { enabled: [], external: {} };
  }
}

async function writeState(state) {
  await writeText(EXT_STATE(), `${JSON.stringify(state, null, 2)}\n`);
  await ownerOnly(EXT_STATE()).catch(() => {});
}

export const installed = async (name) => (await readState()).enabled.includes(name);

// ---------------------------------------------------------------- manifest

/** `vibekit >= 1.0` against the version this build implements. Only >=, = and a bare version. */
export function satisfiesRequires(requires, version = VIBEKIT_VERSION) {
  if (!requires) return true;
  const match = String(requires).match(/vibekit\s*(>=|=|==)?\s*v?(\d+(?:\.\d+)?)/i);
  if (!match) return false;
  const want = match[2].split('.').map(Number);
  const have = String(version).split('.').map(Number);
  const cmp = (have[0] - want[0]) || ((have[1] ?? 0) - (want[1] ?? 0));
  return match[1] === '=' || match[1] === '==' ? cmp === 0 : cmp >= 0;
}

/** Validate a manifest and the file list. Returns refusals; an empty list is installable. */
export function refuseManifest(manifest, files = []) {
  const refusals = [];
  if (!manifest?.name || !/^[a-z][a-z0-9-]{1,40}$/.test(manifest.name)) refusals.push('name: a lowercase slug is required');
  if (manifest?.version && !/^\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?$/.test(String(manifest.version))) refusals.push('version: semantic version expected (2.1.0)');
  if (manifest?.requires && !satisfiesRequires(manifest.requires)) refusals.push(`requires "${manifest.requires}" is not met by vibekit ${VIBEKIT_VERSION}`);
  const adds = manifest?.adds && typeof manifest.adds === 'object' ? Object.keys(manifest.adds) : [];
  for (const key of adds) if (!MAY_ADD.includes(key)) refusals.push(`adds.${key}: an extension may add ${MAY_ADD.join(', ')} and nothing else`);
  const text = JSON.stringify(manifest ?? {});
  if (FORBIDDEN.test(text)) refusals.push('the manifest names standards/, guardrails, invariants, a write scope or a check to remove; an extension cannot weaken anything');
  for (const file of files) {
    if (EXECUTABLE.test(file)) refusals.push(`${file}: an extension is data — prompts, skills, templates, rules. Code is not installed from an extension.`);
    if (/(?:^|\/)standards\/|guardrails\.md$/.test(file)) refusals.push(`${file}: an extension may not carry standards/ or guardrails.md`);
  }
  return refusals;
}

export async function readManifest(dir) {
  const yml = await readText(join(dir, 'extension.yml'));
  if (yml) {
    const parsed = parseYamlish(yml) ?? {};
    return {
      name: parsed.name, version: parsed.version != null ? String(parsed.version) : null, requires: parsed.requires ?? null, licence: parsed.licence ?? parsed.license ?? null,
      description: parsed.description ?? '', adds: parsed.adds && typeof parsed.adds === 'object' ? parsed.adds : {},
      budget: { alwaysLoaded: Number.parseInt(String(parsed.budget?.['always-loaded'] ?? parsed.budget?.alwaysLoaded ?? ''), 10) || 0 },
    };
  }
  const json = await readText(join(dir, 'extension.json'));
  if (json) {
    const parsed = JSON.parse(json);
    return { ...parsed, version: parsed.version != null ? String(parsed.version) : null, adds: parsed.adds ?? {}, budget: { alwaysLoaded: Number(parsed.budget?.alwaysLoaded ?? parsed.budget?.['always-loaded'] ?? 0) } };
  }
  return null;
}

const walk = async (dir, prefix = '') => {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
};

/**
 * What an extension would cost in always-loaded context: everything under `always/` in full, plus
 * an index line per skill. Measured, so a manifest cannot understate what it adds (§5.2).
 */
export async function measureAlwaysLoaded(dir, files = null) {
  const listed = files ?? (await walk(dir));
  let tokens = 0;
  for (const file of listed.filter((entry) => entry.startsWith(`${LAYOUT.always}/`) && entry.endsWith('.md'))) tokens += estimateProseTokens((await readText(join(dir, file))) ?? '');
  const skills = listed.filter((entry) => entry.startsWith(`${LAYOUT.skills}/`) && entry.endsWith('.md') && !entry.endsWith('.test.md')).length;
  return { tokens: tokens + skills * PER_SKILL_INDEX_TOKENS, skills };
}

/** Everything a person is told before confirming: manifest, counts, budget, checks, refusals. */
export async function inspect(dir) {
  const manifest = await readManifest(dir);
  if (!manifest) throw new Error('no extension.yml or extension.json in the extension');
  const files = await walk(dir);
  const refusals = refuseManifest(manifest, files);
  const checks = await readChecks(dir, manifest.name ?? 'extension');
  for (const check of checks) for (const problem of check.problems ?? []) refusals.push(problem);
  const measured = await measureAlwaysLoaded(dir, files);
  const declared = manifest.budget?.alwaysLoaded ?? 0;
  const off = declared ? Math.abs(measured.tokens - declared) / declared : (measured.tokens > 0 ? 1 : 0);
  const counts = {
    skills: measured.skills,
    checks: checks.length,
    stages: files.filter((entry) => entry.startsWith(`${LAYOUT.stages}/`)).length,
    documents: files.filter((entry) => entry.startsWith(`${LAYOUT.documents}/`)).length,
    reports: files.filter((entry) => entry.startsWith(`${LAYOUT.reports}/`)).length,
    templates: files.filter((entry) => entry.startsWith(`${LAYOUT.templates}/`)).length,
    servers: (await exists(join(dir, LAYOUT.servers))) ? parseBlocks((await readText(join(dir, LAYOUT.servers))) ?? '').length : 0,
    pipeline: await exists(join(dir, LAYOUT.pipeline)),
  };
  const warnings = [];
  if (off > BUDGET_TOLERANCE) warnings.push(`declared always-loaded ${declared} tokens; measured ${measured.tokens} — off by more than ${Math.round(BUDGET_TOLERANCE * 100)}%`);
  for (const [kind, declaredCount] of Object.entries(manifest.adds ?? {})) {
    if (typeof declaredCount === 'number' && counts[kind] !== undefined && counts[kind] !== declaredCount) warnings.push(`adds.${kind}: ${declaredCount} declared, ${counts[kind]} found`);
  }
  if (!manifest.licence) warnings.push('no licence declared');
  // §5.1 — signed releases and a known key. Absent, invalid and untrusted are three different facts.
  const signature = await verifySignature(dir);
  if (!signature.signed) warnings.push('unsigned — fine for a team\'s own kit; required before publishing outside the organisation');
  else if (!signature.valid) warnings.push(`signature invalid: ${signature.why}`);
  else if (!signature.trusted) warnings.push(signature.why);
  const digest = createHash('sha256');
  for (const file of files.filter((entry) => entry !== SIGNATURE_FILE)) digest.update(`${file}\n${(await readText(join(dir, file)).catch(() => '')) ?? ''}\n`);
  return { manifest, files, refusals, warnings, checks, counts, measured: measured.tokens, declared, digest: digest.digest('hex').slice(0, 16), signature };
}

/** Machine policy: `vibekit settings require-signed true` refuses anything unsigned or untrusted. */
async function requireSigned() {
  try {
    const { readConfig } = await import('./prompts.js');
    return String((await readConfig())['require-signed'] ?? 'false') === 'true';
  } catch {
    return false;
  }
}

const signaturePolicyRefusal = (inspection, strict) => {
  const { signature } = inspection;
  if (signature.signed && !signature.valid) return `refused: ${signature.why}. A signature that does not verify is worse than none.`;
  if (!strict) return null;
  if (!signature.signed) return 'refused: this machine requires signed extensions (settings require-signed) and this one is unsigned.';
  if (!signature.trusted) return `refused: this machine requires a trusted signer and ${signature.why}.`;
  return null;
};

// ---------------------------------------------------------------- fetching

async function fetchInto(source, staging) {
  if (/^(?:https?:\/\/|git@|ssh:\/\/)/.test(source)) {
    if (!/^https:\/\/|^git@|^ssh:\/\//.test(source)) throw new Error('an extension is fetched over https or ssh, never plain http');
    execFileSync('git', ['clone', '--quiet', '--', source, staging], { stdio: 'ignore', timeout: 120_000 });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: staging, encoding: 'utf8' }).trim();
    await rm(join(staging, '.git'), { recursive: true, force: true });
    return { commit, remote: true };
  }
  const path = resolve(source);
  if (!(await exists(path))) throw new Error(`${source} is not a built-in extension, a git url or a folder`);
  // Node's own copy, not `cp`: the same code has to work on Windows, and a symlink inside an
  // extension is copied as the file it points at, never followed out of the folder.
  await cp(path, staging, { recursive: true, dereference: true, filter: (from) => !/(?:^|[\\/])\.git(?:[\\/]|$)/.test(from) });
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* a folder, not a repository */ }
  return { commit, remote: false };
}

/**
 * `vibekit ext add <name | url | path>`. Fetched into a staging directory, validated whole, shown
 * (`inspection`) and only then moved into place when `confirm` says yes. `cap` is the project's
 * always-loaded ceiling and current total: an install that would breach it is refused with the numbers.
 */
export async function add(source, { confirm = async () => true, cap = null, force = false } = {}) {
  const state = await readState();
  if (BUILT_IN[source]) {
    if (!state.enabled.includes(source)) state.enabled.push(source);
    await writeState(state);
    return { name: source, builtIn: true, ...BUILT_IN[source], enabled: true };
  }

  await mkdir(EXT_DIR(), { recursive: true });
  const staging = await mkdtemp(join(EXT_DIR(), '.staging-'));
  try {
    const { commit } = await fetchInto(source, staging);
    const inspection = await inspect(staging);
    if (inspection.refusals.length) throw new Error(`refused:\n${inspection.refusals.map((line) => `  - ${line}`).join('\n')}`);
    const policy = signaturePolicyRefusal(inspection, await requireSigned());
    if (policy) throw new Error(policy);

    // Two extensions adding the same check is an error at install time, not a race at runtime.
    const others = await enabledChecks({ except: inspection.manifest.name });
    const clash = inspection.checks.find((check) => others.some((other) => other.id === check.id));
    if (clash) throw new Error(`refused: check "${clash.id}" is already added by ${others.find((other) => other.id === clash.id).source}. Two extensions adding the same check is an error at install time.`);

    if (cap && !force && cap.alwaysLoaded + inspection.measured > cap.ceiling) {
      throw new Error(`refused: this project's always-loaded context is ${cap.alwaysLoaded} tokens against a cap of ${cap.ceiling}; ${inspection.manifest.name} adds ${inspection.measured}, which would breach it. Raise the cap deliberately (profile.md budget-cap) or install less.`);
    }

    const yes = await confirm(inspection);
    if (!yes) return { name: inspection.manifest.name, installed: false, why: 'not confirmed', inspection };

    const target = join(EXT_DIR(), inspection.manifest.name);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    state.external[inspection.manifest.name] = {
      source, version: inspection.manifest.version, commit, licence: inspection.manifest.licence ?? null, added: new Date().toISOString(),
      files: inspection.files.length, declared: inspection.declared, measured: inspection.measured, digest: inspection.digest,
    };
    if (!state.enabled.includes(inspection.manifest.name)) state.enabled.push(inspection.manifest.name);
    await writeState(state);
    return { name: inspection.manifest.name, builtIn: false, installed: true, version: inspection.manifest.version, commit, inspection, adds: inspection.counts };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * `vibekit ext update [name]`: fetch again, diff against what is installed — added, removed and
 * changed files, the version, the commit — and replace on confirmation. The pin moves; nothing else does.
 */
export async function update(name, { confirm = async () => true } = {}) {
  const state = await readState();
  const current = state.external[name];
  if (!current) throw new Error(`${name} is not an installed extension${BUILT_IN[name] ? ' (built-ins update with VibeKit itself)' : ''}.`);
  const installedDir = join(EXT_DIR(), name);
  const staging = await mkdtemp(join(EXT_DIR(), '.staging-'));
  try {
    const { commit } = await fetchInto(current.source, staging);
    const inspection = await inspect(staging);
    if (inspection.refusals.length) throw new Error(`refused:\n${inspection.refusals.map((line) => `  - ${line}`).join('\n')}`);
    const policy = signaturePolicyRefusal(inspection, await requireSigned());
    if (policy) throw new Error(policy);
    const before = new Map();
    for (const file of await walk(installedDir)) before.set(file, createHash('sha256').update((await readText(join(installedDir, file)).catch(() => '')) ?? '').digest('hex'));
    const after = new Map();
    for (const file of inspection.files) after.set(file, createHash('sha256').update((await readText(join(staging, file)).catch(() => '')) ?? '').digest('hex'));
    const diff = {
      added: [...after.keys()].filter((file) => !before.has(file)),
      removed: [...before.keys()].filter((file) => !after.has(file)),
      changed: [...after.keys()].filter((file) => before.has(file) && before.get(file) !== after.get(file)),
      version: { from: current.version, to: inspection.manifest.version },
      commit: { from: current.commit, to: commit },
    };
    const unchanged = !diff.added.length && !diff.removed.length && !diff.changed.length && diff.commit.from === diff.commit.to;
    if (unchanged) return { name, updated: false, why: 'already at that commit', diff };
    const yes = await confirm({ inspection, diff });
    if (!yes) return { name, updated: false, why: 'not confirmed', diff };
    await rm(installedDir, { recursive: true, force: true });
    await rename(staging, installedDir);
    state.external[name] = { ...current, version: inspection.manifest.version, commit, updated: new Date().toISOString(), files: inspection.files.length, declared: inspection.declared, measured: inspection.measured, digest: inspection.digest };
    await writeState(state);
    return { name, updated: true, diff, inspection };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

export async function remove(name) {
  const state = await readState();
  const was = state.enabled.includes(name);
  state.enabled = state.enabled.filter((item) => item !== name);
  if (state.external[name]) {
    await rm(join(EXT_DIR(), basename(name)), { recursive: true, force: true });
    delete state.external[name];
  }
  await writeState(state);
  return { name, removed: was };
}

export async function list() {
  const state = await readState();
  return [
    ...Object.values(BUILT_IN).map((entry) => ({ ...entry, builtIn: true, enabled: state.enabled.includes(entry.name) })),
    ...Object.entries(state.external).map(([name, entry]) => ({ name, ...entry, builtIn: false, enabled: state.enabled.includes(name) })),
  ];
}

// ---------------------------------------------------------------- what enabled extensions contribute

async function enabledExternalDirs() {
  const state = await readState();
  const dirs = [];
  for (const name of state.enabled) {
    if (BUILT_IN[name] || !state.external[name]) continue;
    const dir = join(EXT_DIR(), name);
    if (await exists(dir)) dirs.push({ name, dir, ...state.external[name] });
  }
  return dirs;
}

/** Every declarative check from enabled extensions, tagged with its source. */
export async function enabledChecks({ except = null } = {}) {
  const checks = [];
  for (const { name, dir } of await enabledExternalDirs()) {
    if (name === except) continue;
    checks.push(...(await readChecks(dir, name)));
  }
  return checks;
}

/** MCP server declarations from enabled extensions (§2), each tagged with the extension it came from. */
export async function enabledServerDeclarations() {
  const declarations = [];
  for (const { name, dir } of await enabledExternalDirs()) {
    const text = await readText(join(dir, LAYOUT.servers));
    if (!text) continue;
    for (const entry of parseBlocks(text)) declarations.push({ entry, source: `extension:${name}` });
  }
  return declarations;
}

/** Skills enabled extensions contribute: name, triggers guessed from front matter, path, source. */
export async function enabledSkills() {
  const skills = [];
  for (const { name, dir } of await enabledExternalDirs()) {
    for (const file of (await walk(join(dir, LAYOUT.skills))).filter((entry) => entry.endsWith('.md') && !entry.endsWith('.test.md'))) {
      const text = (await readText(join(dir, LAYOUT.skills, file))) ?? '';
      const meta = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const triggers = meta.match(/^triggers:\s*\[([^\]]*)\]/m)?.[1]?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
      skills.push({ name: file.replace(/\.md$/, '').replace(/\//g, '-'), triggers, path: join(dir, LAYOUT.skills, file), source: name, scope: 'extension', body: text });
    }
  }
  return skills;
}

/** Always-loaded cost by source (§5.2): each extension's declared and measured figures. */
export async function budgetBySource() {
  const rows = [];
  for (const entry of await enabledExternalDirs()) {
    const measured = await measureAlwaysLoaded(entry.dir);
    rows.push({ source: `extension:${entry.name}`, declared: entry.declared ?? 0, measured: measured.tokens, off: entry.declared ? Math.abs(measured.tokens - entry.declared) / entry.declared > BUDGET_TOLERANCE : measured.tokens > 0 });
  }
  return rows;
}

// ---------------------------------------------------------------- the project's record

/** §4 — the extensions a project uses are recorded in profile.md with name, version and pin. */
export async function recordInProfile(root, { name, version, commit }, folder = DEFAULT_FOLDER) {
  const path = join(root, folder, 'profile.md');
  const text = await readText(path);
  if (text === null) return false;
  const line = `- ${name} ${version ?? ''} ${commit ? `@${commit.slice(0, 12)}` : ''}`.replace(/\s+/g, ' ').trim();
  const withoutOld = text.replace(new RegExp(`^- ${name}\\b.*\\n?`, 'm'), '');
  const next = /^## Extensions\s*$/m.test(withoutOld)
    ? withoutOld.replace(/^## Extensions\s*\n/m, `## Extensions\n\n${line}\n`).replace(/\n{3,}/g, '\n\n')
    : `${withoutOld.trimEnd()}\n\n## Extensions\n\nName, version and pinned commit, so a folder is always explainable to somebody who did not set it up.\n\n${line}\n`;
  await writeText(path, next);
  return true;
}

/** An extension that needs to run something declares a pipeline stage; it lands below `<!-- local -->`. */
export async function recordPipelineStage(root, name, folder = DEFAULT_FOLDER) {
  const snippet = await readText(join(EXT_DIR(), name, LAYOUT.pipeline));
  if (!snippet) return false;
  const path = join(root, folder, 'delivery/pipeline.spec.md');
  const text = await readText(path);
  if (text === null) return false;
  if (text.includes(`<!-- extension: ${name} -->`)) return true;
  const block = `<!-- extension: ${name} -->\n${snippet.trim()}\n`;
  const next = text.includes('<!-- local -->') ? `${text.trimEnd()}\n\n${block}` : `${text.trimEnd()}\n\n<!-- local -->\n## Extension stages\n\nDeclared by extensions, visible here, reviewed like any other change, run in CI where everybody can see it — never silently inside \`vibekit check\`.\n\n${block}`;
  await writeText(path, next);
  return true;
}

/**
 * `vibekit ext verify <path>`: every rule in §5 against an extension before it is published — the
 * manifest, data-only, declarative checks that parse, the budget within tolerance, a dry run of its
 * checks against a freshly generated folder so a check that can never evaluate is found here, its
 * signature, and (unless `fixtures: false`) the three fixture briefs diffed against golden outputs.
 */
export async function verify(path, { root = null, fixtures = true } = {}) {
  const dir = resolve(path);
  if (!(await exists(dir))) throw new Error(`${path} is not a folder.`);
  const inspection = await inspect(dir);
  const rows = [
    { ok: !inspection.refusals.length, what: 'manifest and contents', why: inspection.refusals.length ? inspection.refusals.join('; ') : `${inspection.files.length} file(s), data only` },
    { ok: inspection.checks.every((check) => !(check.problems ?? []).length), what: 'checks are declarative and parse', why: `${inspection.checks.length} check(s)` },
    { ok: !inspection.warnings.some((line) => /always-loaded/.test(line)), what: 'declared budget within 20% of measured', why: `declared ${inspection.declared}, measured ${inspection.measured}` },
    { ok: Boolean(inspection.manifest.licence), what: 'licence declared', why: inspection.manifest.licence ?? 'none — knowledge nobody may redistribute should not reach a client repository undecided' },
    { ok: Boolean(inspection.manifest.version), what: 'version declared', why: inspection.manifest.version ?? 'none' },
  ];
  // A dry run of the checks against a folder that exists, so a check that never fires or always
  // fires on an empty project is seen before a customer sees it.
  const { generateFolder } = await import('./folder/generate.js');
  const { evaluateChecks } = await import('./extchecks.js');
  const fixture = root ?? await mkdtemp(join(tmpdir(), 'vibekit-ext-verify-'));
  try {
    if (!root) await generateFolder(fixture, { name: 'fixture', description: null, architecture: 'layered', stack: {}, commands: {}, entities: [] }, { folder: 'vibekit' });
    const findings = await evaluateChecks(fixture, inspection.checks.filter((check) => !(check.problems ?? []).length));
    rows.push({ ok: true, what: 'checks evaluate against a fresh folder', why: `${findings.length} finding(s) on an empty project${findings.length === inspection.checks.length && inspection.checks.length ? ' — every check fires on nothing, which is a check that always fires' : ''}` });
  } finally {
    if (!root) await rm(fixture, { recursive: true, force: true }).catch(() => {});
  }
  rows.push({ ok: inspection.signature.signed ? inspection.signature.valid : true, what: 'signature', why: inspection.signature.signed ? inspection.signature.why : 'unsigned — fine for a team\'s own kit; `vibekit ext sign` before publishing outside the organisation' });

  // §5.4 — "installs it against the three fixture briefs, runs clarify and the build loop, and diffs
  // the asks and the generated folder against golden outputs." The extension is enabled in a home
  // of its own, every brief runs with it, and what moved against the golden file is the verdict.
  const briefs = [];
  if (fixtures) {
    const { compareRuns, readGolden, runBrief, snapshot, unchanged, BRIEFS } = await import('./fixtures.js');
    const golden = await readGolden();
    const home = await mkdtemp(join(tmpdir(), 'vibekit-ext-home-'));
    try {
      const name = inspection.manifest.name ?? 'extension';
      await mkdir(join(home, 'ext'), { recursive: true });
      await cp(dir, join(home, 'ext', name), { recursive: true, dereference: true });
      await writeText(join(home, 'extensions.json'), `${JSON.stringify({ enabled: [name], external: { [name]: { source: dir, version: inspection.manifest.version, files: inspection.files.length, declared: inspection.declared, measured: inspection.measured } } }, null, 2)}\n`);
      for (const brief of Object.keys(BRIEFS)) {
        const run = await runBrief(brief, { home });
        const baseline = golden?.[brief] ?? null;
        const diff = baseline ? compareRuns(baseline, snapshot(run)) : null;
        // The extension's own checks are expected to appear; anything else that moved is the finding.
        const own = diff ? diff.findings.added.filter((code) => code.startsWith(`ext.${name}.`)) : [];
        const foreign = diff ? { ...diff, findings: { added: diff.findings.added.filter((code) => !code.startsWith(`ext.${name}.`)), removed: diff.findings.removed } } : null;
        briefs.push({ brief, golden: Boolean(baseline), ownFindings: own, moved: foreign && !unchanged(foreign) ? foreign : null, asks: run.asks.length, gaps: run.gaps.length });
      }
    } finally {
      await rm(home, { recursive: true, force: true }).catch(() => {});
    }
    const allGolden = briefs.every((row) => row.golden);
    const moved = briefs.filter((row) => row.moved);
    rows.push({
      ok: allGolden && !moved.length,
      what: 'the three fixture briefs against golden outputs',
      why: !allGolden ? 'no fixtures/golden.json to diff against — `npm run golden` writes it' : moved.length ? `${moved.map((row) => row.brief).join(', ')}: the questions, findings or folder moved beyond the extension's own checks` : `unchanged on ${briefs.length} briefs${briefs.some((row) => row.ownFindings.length) ? `; the extension's checks fired where expected (${[...new Set(briefs.flatMap((row) => row.ownFindings))].join(', ')})` : ''}`,
    });
  }
  return { ok: rows.every((row) => row.ok), rows, inspection, briefs };
}
