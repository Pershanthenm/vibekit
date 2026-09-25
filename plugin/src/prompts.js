import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFrontMatter, setFrontMatterValue } from './frontmatter.js';
import { isOpen, listAsks } from './folder/asks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { PROMPTS_VERSION, STAGE_PROMPTS } from './folder/stages.js';
import { readText, writeAtomic, writeText } from './fsutil.js';

/**
 * Prompt upgrades, replay, and per-machine settings. Specification §5, §42 and §30.
 *
 * "A project's agents never change behaviour because of an update the team did not see." That is
 * the whole of §5's rule, and it is why an upgrade is a diff a human reads rather than a write
 * that happens on install. An agent whose instructions changed under it produces different work
 * for the same requirement, and nobody would know to look at the prompt.
 */

export const installedVersion = () => PROMPTS_VERSION;

export const projectVersion = async (root, folder = DEFAULT_FOLDER) =>
  readFrontMatter((await readText(join(root, folder, 'profile.md'))) ?? '').prompts ?? null;

const compare = (a, b) => {
  const left = String(a ?? '0').split('.').map(Number);
  const right = String(b ?? '0').split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

export const isBehind = (project, installed = PROMPTS_VERSION) => compare(project, installed) < 0;

/**
 * A line-level diff, enough to read in a terminal.
 *
 * Deliberately not a patch format: the reader is a tech lead deciding whether their agents should
 * behave differently, and what they need is the sentences that changed.
 */
export function diffLines(before, after) {
  const left = String(before ?? '').split('\n');
  const right = String(after ?? '').split('\n');
  const removed = left.filter((line) => line.trim() && !right.includes(line));
  const added = right.filter((line) => line.trim() && !left.includes(line));
  return { removed, added, changed: removed.length + added.length };
}

/**
 * What an upgrade would change, per stage prompt. Nothing is written.
 *
 * Stage prompts are **authored** files: the generator writes them once and the team owns them
 * from then on, which is why a prompt carries its version in its own front matter rather than a
 * generated header. So the three states are told apart by that version, not by the header:
 *
 *   * the file matches the installed body — nothing to do;
 *   * it differs and its `prompts:` is older — an upgrade is available, and this is its diff;
 *   * it differs and its `prompts:` is current — the team edited it, and it is left alone.
 *
 * Getting that last case wrong is how a tool silently discards a rule somebody wrote.
 */
export async function upgradePlan(root, { folder = DEFAULT_FOLDER } = {}) {
  const project = await projectVersion(root, folder);
  const changes = [];

  for (const prompt of STAGE_PROMPTS) {
    const current = await readText(join(root, folder, prompt.path));
    const next = prompt.body();

    if (current === null) {
      changes.push({ path: prompt.path, kind: 'missing', version: null, diff: diffLines('', next) });
      continue;
    }

    const diff = diffLines(current, next);
    if (!diff.changed) continue;

    const version = readFrontMatter(current).prompts ?? null;
    changes.push({
      path: prompt.path,
      version,
      kind: isBehind(version) ? 'behind' : 'edited',
      diff,
    });
  }

  return {
    project,
    installed: PROMPTS_VERSION,
    behind: isBehind(project),
    changes,
    upgradable: changes.filter((change) => change.kind !== 'edited'),
    edited: changes.filter((change) => change.kind === 'edited'),
  };
}

/** Apply the upgrade. A prompt the team edited is left alone and reported, never overwritten. */
export async function upgrade(root, { folder = DEFAULT_FOLDER } = {}) {
  const planned = await upgradePlan(root, { folder });
  const written = [];

  for (const change of planned.upgradable) {
    const prompt = STAGE_PROMPTS.find((entry) => entry.path === change.path);
    await writeText(join(root, folder, prompt.path), prompt.body());
    written.push(change.path);
  }

  const profilePath = join(root, folder, 'profile.md');
  const profile = await readText(profilePath);
  if (profile !== null) await writeAtomic(profilePath, setFrontMatterValue(profile, 'prompts', PROMPTS_VERSION));

  return { ...planned, written };
}

// ---------------------------------------------------------------- replay (§42)

/**
 * §42 — "When a stage prompt changes, `vibekit replay --stage 1 --project <path>` re-runs the new
 * prompt against a past project's sources and diffs the asks it raises against the ones it raised
 * then. Prompt changes ship with a replay report or they do not ship."
 *
 * What this can do without a model is the half that matters for a regression: compare the asks a
 * past project actually recorded against what the current prompt *tells* an agent to ask about,
 * and report the sources the new prompt would read. Actually raising the asks needs the pinned
 * model, so that part is reported as unrun rather than counted — a replay report that claimed a
 * clean run it never made would be worse than no report.
 */
export async function replay(root, { stage, project, folder = DEFAULT_FOLDER, ask = null } = {}) {
  if (stage === undefined || stage === null) throw new Error('Usage: vibekit replay --stage <n> --project <path>');
  const target = project ?? root;

  const prompt = STAGE_PROMPTS.find((entry) => new RegExp(`stages/${stage}-`).test(entry.path));
  if (!prompt) {
    throw new Error(`No stage ${stage} prompt. Stages: ${STAGE_PROMPTS.map((entry) => entry.path.match(/stages\/([\w-]+)\.md/)[1]).join(', ')}.`);
  }

  const body = prompt.body();
  const meta = readFrontMatter(body);
  const asks = (await listAsks(target, folder)).filter((ask) => String(ask.stage ?? '') === String(stage));
  const recorded = await readText(join(target, folder, `workflow/answers/${stage}-answers.md`));

  // What the past project's asks were about, by topic, versus what the prompt now names.
  const topicsThen = [...new Set(asks.flatMap((ask) => ask.topic))].sort();
  const namedNow = [...new Set((String(meta.loads ?? '').match(/\b[a-z][\w-]*(?=\.md|\/)/g) ?? []))].sort();

  const then = asks.map((entry) => ({ id: entry.id, blocking: entry.blocking, status: entry.status, ask: entry.ask.split('\n')[0] }));
  const base = {
    stage,
    project: target,
    prompt: prompt.path,
    version: PROMPTS_VERSION,
    asksThen: then,
    openThen: asks.filter(isOpen).length,
    topicsThen,
    loadsNow: namedNow,
    answered: Boolean(recorded),
  };

  if (!ask) {
    return { ...base, rerun: null, unrun: 'Raising the asks again needs a model. Pass --run, and set the credential for the tier this stage\'s role routes to.' };
  }

  // §42 — re-run the new prompt against the past project's sources and diff the asks it raises
  // against the ones it raised then. The diff is the report a prompt change ships with.
  const sources = await sourceText(target, folder);
  const result = await ask(root, {
    role: meta.role ?? 'analyst',
    folder,
    system: [
      'You are running one stage of a spec-driven workflow against a project that already ran it once.',
      'Raise only the questions the documents genuinely do not settle. Do not invent a question to be thorough.',
      'Answer with JSON and nothing else: {"asks":[{"question":"<one sentence>","blocking":true|false}]}.',
    ].join('\n'),
    prompt: [`## The stage prompt\n\n${body}`, `## What the project gave it\n\n${sources || '_no source documents were recorded_'}`].join('\n\n'),
    maxTokens: 2048,
  });

  const now = (result.json?.asks ?? []).map((entry) => ({ question: String(entry.question ?? '').trim(), blocking: Boolean(entry.blocking) })).filter((entry) => entry.question);

  return {
    ...base,
    rerun: {
      model: result.model,
      asksNow: now,
      // A prompt change that stops asking about something is the regression worth catching: the
      // question was raised once for a reason, and nothing now records that reason.
      noLongerAsked: then.filter((was) => !now.some((asked) => similar(was.ask, asked.question))).map((was) => was.ask),
      newlyAsked: now.filter((asked) => !then.some((was) => similar(was.ask, asked.question))).map((asked) => asked.question),
      usage: result.usage,
    },
    unrun: null,
  };
}

/** The significant words two questions share; near enough is the same question asked twice. */
function similar(a, b) {
  const words = (text) => new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 3));
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size) >= 0.5;
}

/** The sources a stage would have read, so the re-run sees what the original run saw. */
async function sourceText(root, folder) {
  const { allSections, readIndex } = await import('./sources.js');
  const index = await readIndex(root, folder).catch(() => []);
  if (!index.length) return '';
  const sections = await allSections(root, folder);
  return sections.slice(0, 20).map((section) => `### ${section.source} §${section.number} ${section.title}\n\n${section.body}`).join('\n\n');
}

// ---------------------------------------------------------------- settings (§30)

/**
 * §30 — "`team` lives in a designated repo (`vibekit config team-memory <git url>`)".
 *
 * Per machine, never in the folder: a URL in the repository would make the team memory location a
 * thing a fork inherits, and §30 keeps `me` scope out of git for the same reason.
 */
export const settingsPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'config.json');

export const CONFIG_KEYS = Object.freeze({
  'team-memory': 'the git URL of the shared memory repository, pulled read-only at session start',
  'team-skills': 'the git URL of the shared skills repository (§56)',
  'tunnel-token': 'the Cloudflare tunnel token used by `serve --tracker --tunnel`',
  'rates-file': 'a path to rates.yml, which converts tokens to currency in the budget report',
  'require-signed': 'true to refuse an unsigned or untrusted extension (§5.1); false lets a team\'s own kit install with a warning',
  'completion-offered': 'true once `new project` has offered to install shell completion, so it asks only once',
});

export async function readConfig() {
  try {
    return JSON.parse((await readText(settingsPath())) ?? '{}');
  } catch {
    return {};
  }
}

export async function writeConfig(key, value) {
  if (!(key in CONFIG_KEYS)) {
    throw new Error(`"${key}" is not a setting. One of: ${Object.keys(CONFIG_KEYS).join(', ')}.`);
  }
  if (key.endsWith('-memory') || key.endsWith('-skills')) {
    if (!/^(?:https?:\/\/|git@|ssh:\/\/|file:\/\/|\/)/.test(String(value))) {
      throw new Error(`${key} needs a git URL or an absolute path, not "${value}".`);
    }
  }
  const config = { ...(await readConfig()), [key]: value };
  await writeText(settingsPath(), `${JSON.stringify(config, null, 2)}\n`);
  // One of these keys is a tunnel token. A settings file another account can read is a token
  // another account has.
  const { ownerOnly } = await import('./fsutil.js');
  await ownerOnly(settingsPath());
  return config;
}
