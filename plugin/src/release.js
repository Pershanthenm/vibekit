import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFrontMatter, setFrontMatterValue } from './frontmatter.js';
import { isOpen, listAsks } from './folder/asks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { appendLog, listRequirements, requirementPath } from './folder/requirements.js';
import { approvalOf } from './folder/workflow.js';
import { readText, writeAtomic, writeText } from './fsutil.js';

/**
 * Releases, rollback and the changelog. Specification §43, §47 and §50.
 *
 * "Nothing deploys from an untagged commit." The tag is the unit: it carries the changelog, the
 * report bundle is recorded beside it, and `--at <tag>` reproduces any of it later.
 *
 * The thing this module refuses to do is the important part. A release verifies every requirement
 * in scope is `done` before it tags, because a version number over unfinished work is a claim
 * somebody will act on — and by the time it is contradicted, it is in production.
 */

const git = (root, args, { quiet = true } = {}) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'],
}).trim();

const tryGit = (root, args) => {
  try {
    return git(root, args);
  } catch {
    return '';
  }
};

export const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/;

/** A ref or tag as this will hand it to git: never something git could read as an option. */
const safeRef = (ref) => {
  const text = String(ref ?? '').trim();
  if (!text || text.startsWith('-') || /[\s\0]/.test(text)) throw new Error(`"${ref}" is not a tag or a commit this will pass to git.`);
  return text;
};

export const tags = (root) => tryGit(root, ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean);
export const lastTag = (root) => tags(root)[0] ?? null;

/**
 * §50 — "`major` when an L requirement changed a public contract, `minor` for new requirements,
 * `patch` for S only."
 *
 * Computed rather than asked for, because a human picking the number is a human deciding whether
 * this is a breaking change while looking at a release note rather than at the diff.
 */
export function bumpFrom(requirements, { contractsChanged = false } = {}) {
  if (!requirements.length) return { level: 'patch', why: 'nothing reached done, so nothing changed for a consumer' };

  const large = requirements.filter((requirement) => requirement.size === 'L');
  if (large.length && contractsChanged) {
    return { level: 'major', why: `${large.map((requirement) => requirement.id).join(', ')} is size L and the API contracts changed` };
  }
  if (requirements.some((requirement) => requirement.size !== 'S')) {
    return { level: 'minor', why: 'new requirements beyond size S' };
  }
  return { level: 'patch', why: 'size S only' };
}

export function nextVersion(previous, level) {
  const matched = String(previous ?? 'v0.0.0').match(SEMVER);
  const [major, minor, patch] = matched ? matched.slice(1).map(Number) : [0, 0, 0];
  if (level === 'major') return `v${major + 1}.0.0`;
  if (level === 'minor') return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

/** Requirements that reached `done` between two points, by their own log and the git history. */
export async function doneBetween(root, from, to = 'HEAD', folder = DEFAULT_FOLDER) {
  const requirements = await listRequirements(root, folder);
  const done = requirements.filter((requirement) => requirement.status === 'done');
  if (!from) return done;

  // The requirement files that changed between the two points: a requirement whose file did not
  // move was already done before `from`, and listing it again would overstate the release.
  const changed = new Set(tryGit(root, ['diff', '--name-only', '--end-of-options', `${safeRef(from)}..${safeRef(to)}`])
    .split('\n')
    .map((path) => path.match(/product\/requirements\/((?:REQ|MIG|BUG)-[\w.-]+)\.md$/)?.[1])
    .filter(Boolean));

  return changed.size ? done.filter((requirement) => changed.has(requirement.id)) : done;
}

/**
 * §47 — "lists every requirement that reached `done` between two tags, grouped by phase, with
 * source citations."
 *
 * The citation is what makes a changelog answerable. "Cancellation now issues a refund" invites
 * "who asked for that"; the same line with `BRS-001 §4.3` beside it does not.
 */
export function renderChangelog(version, requirements, { from, to = 'HEAD', date = new Date() } = {}) {
  const phases = new Map();
  for (const requirement of requirements) {
    const key = requirement.phase ?? 'unphased';
    if (!phases.has(key)) phases.set(key, []);
    phases.get(key).push(requirement);
  }

  const lines = [`## ${version} — ${date.toISOString().slice(0, 10)}`, ''];
  if (!requirements.length) {
    lines.push(`_No requirement reached done between ${from ?? 'the beginning'} and ${to}._`, '');
    return lines.join('\n');
  }

  for (const [phase, inPhase] of [...phases.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    lines.push(`### Phase ${phase}`, '');
    for (const requirement of inPhase.sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`- **${requirement.id}** ${requirement.title}${requirement.source ? ` · ${requirement.source}` : ' · no source cited'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const changelogPath = (root) => join(root, 'CHANGELOG.md');

export async function writeChangelog(root, entry) {
  const path = changelogPath(root);
  const existing = (await readText(path)) ?? '# Changelog\n\nEvery requirement that reached done, with the source that asked for it.\n';
  const [head, ...rest] = existing.split(/^(?=## )/m);
  await writeText(path, `${head.trimEnd()}\n\n${entry.trimEnd()}\n\n${rest.join('').trimEnd()}\n`.replace(/\n{4,}/g, '\n\n\n'));
  return path;
}

/**
 * Why this release may not be cut, or an empty list when it may.
 *
 * Every one of these is something that would be discovered after the tag exists, when undoing it
 * means another tag rather than an edit.
 */
export async function releaseBlockers(root, { folder = DEFAULT_FOLDER, phase = null } = {}) {
  const [requirements, asks] = await Promise.all([listRequirements(root, folder), listAsks(root, folder)]);
  const inScope = phase === null ? requirements : requirements.filter((requirement) => String(requirement.phase) === String(phase));
  const blockers = [];

  const unfinished = inScope.filter((requirement) => !['done', 'draft'].includes(requirement.status));
  if (unfinished.length) {
    blockers.push(`${unfinished.length} requirement(s) in scope are not done: ${unfinished.map((requirement) => `${requirement.id} (${requirement.status})`).join(', ')}`);
  }

  const blocking = asks.filter((ask) => isOpen(ask) && ask.blocking);
  if (blocking.length) blockers.push(`${blocking.length} blocking ask(s) are open: ${blocking.map((ask) => ask.id).join(', ')}`);

  const dirty = tryGit(root, ['status', '--porcelain']);
  if (dirty) blockers.push('the working tree has uncommitted changes, so the tag would not describe what is in it');

  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const profile = readFrontMatter((await readText(join(root, folder, 'profile.md'))) ?? '');
  const base = profile.base ?? 'main';
  if (branch && branch !== base) blockers.push(`this is ${branch}, and a release is cut from ${base}`);

  return blockers;
}

/**
 * Cut a release. §50: verify, report, changelog, tag, record.
 *
 * `tag` is injected so the sequence can be tested without leaving tags in a real repository, and
 * so a caller that only wants the plan does not have to half-run it.
 */
export async function release(root, { folder = DEFAULT_FOLDER, version = null, phase = null, force = false, now = () => new Date() } = {}) {
  const blockers = await releaseBlockers(root, { folder, phase });
  if (blockers.length && !force) return { ok: false, blockers };

  const previous = lastTag(root);
  const shipped = await doneBetween(root, previous, 'HEAD', folder);
  const contractsChanged = Boolean(previous) && /tests\/contract\//.test(tryGit(root, ['diff', '--name-only', '--end-of-options', `${safeRef(previous)}..HEAD`]));
  const bump = bumpFrom(shipped, { contractsChanged });
  // A version somebody typed is checked against the shape a tag has, because `git tag -a` will
  // otherwise read `--force` as its own option rather than as a name.
  if (version && !SEMVER.test(version)) throw new Error(`"${version}" is not a version. One looks like v1.2.0.`);
  const chosen = version ?? nextVersion(previous, bump.level);

  const entry = renderChangelog(chosen, shipped, { from: previous, date: now() });
  await writeChangelog(root, entry);

  const state = {
    version: chosen,
    at: now().toISOString(),
    previous,
    level: bump.level,
    why: bump.why,
    requirements: shipped.map((requirement) => requirement.id),
    phase,
  };
  await writeText(join(root, folder, '.state/releases.json'), `${JSON.stringify(await withRelease(root, folder, state), null, 2)}\n`);

  return { ok: true, blockers: [], version: chosen, previous, bump, requirements: shipped, entry, state };
}

async function withRelease(root, folder, entry) {
  let history = [];
  try {
    const parsed = JSON.parse((await readText(join(root, folder, '.state/releases.json'))) ?? '{}');
    history = Array.isArray(parsed.releases) ? parsed.releases : [];
  } catch { /* disposable state: a corrupt file is rebuilt rather than reported */ }
  return { releases: [...history, entry] };
}

export const tagRelease = (root, version, message) => git(root, ['tag', '-a', '-m', message, '--end-of-options', safeRef(version)]);

/**
 * §50 — "`vibekit release --rollback <tag>` redeploys the previous tag and opens a hotfix
 * requirement pre-filled with the incident note."
 *
 * This does not deploy: deployment is the team's pipeline, and a tool that ran it from a laptop
 * would be a tool that bypasses the pipeline's own checks. What it does is everything around it,
 * so the rollback is recorded rather than remembered.
 */
export async function rollback(root, tag, { folder = DEFAULT_FOLDER, note = null, now = () => new Date() } = {}) {
  const known = tags(root);
  if (!known.includes(String(tag))) throw new Error(`There is no tag ${tag}. Known: ${known.slice(0, 5).join(', ') || 'none'}.`);

  const { createRequirement, nextRequirementId } = await import('./folder/requirements.js');
  const requirements = await listRequirements(root, folder);
  const id = nextRequirementId(requirements, 'bug');
  const title = `hotfix: incident after ${lastTag(root) ?? 'the last release'}`;

  await createRequirement(root, { id, title, kind: 'bug', size: 'S', source: null }, folder);
  const path = requirementPath(root, id, folder);
  const text = (await readText(path)) ?? '';
  await writeAtomic(path, text.replace(/^##\s+Log\s*$/im, [
    '## Log',
    '',
    `- ${now().toISOString().slice(0, 16).replace('T', ' ')} opened by \`vibekit release --rollback ${tag}\``,
    `- Rolled back to ${tag}. ${note ?? 'No incident note was given, which is itself worth recording.'}`,
    '- Redeploy is the pipeline\'s job, not this command\'s: a tool that deployed from a laptop would bypass the checks the pipeline exists to run.',
  ].join('\n')));

  return { tag, requirement: id, title };
}

/**
 * §43 — "revert the merge, set the requirement back to `ready`, log why, and mark every
 * requirement with `after: [REQ-014]` as `review`."
 *
 * The last clause is the one that makes it safe. Anything that was built on this is now standing
 * on something that is not there, and a requirement nobody re-read is a requirement that quietly
 * depends on reverted code.
 */
export async function revert(root, id, { folder = DEFAULT_FOLDER, reason = null, now = () => new Date() } = {}) {
  const requirements = await listRequirements(root, folder);
  const requirement = requirements.find((entry) => entry.id.toLowerCase() === String(id).toLowerCase());
  if (!requirement) throw new Error(`No requirement ${id} in ${folder}/product/requirements/.`);

  const merge = tryGit(root, ['log', '--merges', '--format=%H %s', '--grep', requirement.id, '-1']).split(' ')[0] || null;

  const setStatusRaw = async (target, status) => {
    const path = requirementPath(root, target, folder);
    const text = await readText(path);
    if (text !== null) await writeAtomic(path, setFrontMatterValue(text, 'status', status));
  };

  await setStatusRaw(requirement.id, 'ready');
  await appendLog(root, requirement.id, `reverted${reason ? ` — ${reason}` : ''}${merge ? ` (merge ${merge.slice(0, 7)})` : ''}`, folder);

  const dependents = requirements.filter((entry) => entry.after.includes(requirement.id) && entry.status !== 'draft');
  for (const dependent of dependents) {
    await setStatusRaw(dependent.id, 'review');
    await appendLog(root, dependent.id, `set review: it waits on ${requirement.id}, which was reverted, so what it was built on is no longer there`, folder);
  }

  return { id: requirement.id, merge, dependents: dependents.map((entry) => entry.id), reason };
}

/**
 * §50 — the audit bundle. "The Core tier's audit trail is a command, not a side effect."
 */
export async function evidence(root, { folder = DEFAULT_FOLDER, id = null, phase = null } = {}) {
  const [requirements, asks, status] = await Promise.all([
    listRequirements(root, folder),
    listAsks(root, folder),
    readText(join(root, folder, 'workflow/status.md')),
  ]);

  const inScope = id
    ? requirements.filter((requirement) => requirement.id.toLowerCase() === String(id).toLowerCase())
    : phase === null ? requirements : requirements.filter((requirement) => String(requirement.phase) === String(phase));

  if (!inScope.length) throw new Error(id ? `No requirement ${id}.` : `No requirement is in phase ${phase}.`);

  // `approvalOf` reads the file's text, and the gates live in four known files. Passing it a
  // path returned undefined, which looked like "not approved" — the worst possible default for
  // an audit bundle.
  const gated = [
    ['architecture', 'workflow/architecture.md'],
    ['plan', 'workflow/plan.md'],
    ['design tokens', 'product/design/tokens.md'],
    ['design components', 'product/design/components.md'],
  ];
  const approvals = [];
  for (const [heading, path] of gated) {
    const approved = approvalOf(await readText(join(root, folder, path)));
    if (approved) approvals.push([heading, approved.raw]);
  }

  const parts = [
    `# Evidence · ${id ?? (phase === null ? 'every requirement' : `phase ${phase}`)}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 10)}. Every section below is a file in the repository at this commit; nothing here is a summary of something that was not written down.`,
    '',
    '## Gate approvals',
    '',
    approvals.length ? approvals.map(([heading, who]) => `- **${heading}** — ${who}`).join('\n') : '_No gate has been approved._',
    '',
  ];

  for (const requirement of inScope) {
    const raised = asks.filter((ask) => ask.for === requirement.id);
    parts.push(
      `## ${requirement.id} ${requirement.title}`,
      '',
      `status ${requirement.status}${requirement.size ? ` · size ${requirement.size}` : ''}${requirement.source ? ` · ${requirement.source}` : ''}`,
      '',
      '### Approach', '', requirement.approach || '_not recorded_', '',
      '### Verification', '', requirement.verification || '_not recorded_', '',
      '### Evidence', '', requirement.evidence || '_no captured exit codes_', '',
      '### Review', '', requirement.review || '_no review recorded_', '',
      '### Log', '', requirement.log.length ? requirement.log.map((line) => `- ${line}`).join('\n') : '_empty_', '',
      '### Asks it raised', '',
      raised.length ? raised.map((ask) => `- **${ask.id}** (${ask.status}) ${ask.ask.split('\n')[0]}`).join('\n') : '_none_',
      '',
    );
  }

  parts.push('## Status at generation', '', status ? '```\n' + status.trim() + '\n```' : '_no status.md_', '');
  return { markdown: parts.join('\n'), requirements: inScope.map((requirement) => requirement.id), approvals };
}
