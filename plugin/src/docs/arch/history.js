import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { buildModel } from './model.js';

/**
 * Reproducing and comparing the past. Documentation Feature Spec §7.
 *
 * `--at` exists because a document handed to somebody matches a tag, and being able to reproduce
 * it exactly is the difference between a document and a claim about a document.
 *
 * `--diff` is what a client, an architecture review board or a security reviewer actually asks
 * for, and it is the single hardest thing to produce by hand — which is why it is normally
 * produced badly or not at all.
 */

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * A ref that begins with a dash is an option, not a ref, and git would read it as one. Refused
 * by shape before it reaches a command line: `--output=/tmp/x` is a valid-looking ref to a
 * regular expression and an instruction to git.
 */
export function assertRef(ref) {
  const text = String(ref ?? '').trim();
  if (!text || text.startsWith('-') || /[\s\0]/.test(text) || text.includes('..')) {
    throw new Error(`"${ref}" is not a ref this will pass to git. A tag or a commit looks like v1.2.0 or a6f2c40.`);
  }
  return text;
}

/** The date a commit was made, so a document regenerated from it carries that date. */
export function commitDate(root, ref) {
  try {
    return git(root, ['show', '-s', '--format=%cs', '--end-of-options', assertRef(ref)]);
  } catch {
    return null;
  }
}

export function resolveCommit(root, ref) {
  try {
    return git(root, ['rev-parse', '--verify', '--end-of-options', `${assertRef(ref)}^{commit}`]);
  } catch {
    throw new Error(`"${ref}" is not a commit or a tag in this repository.`);
  }
}

/**
 * The repository as it was, in a throwaway worktree.
 *
 * A worktree rather than `git stash` or a checkout: the working tree is never touched, so
 * generating a document from last quarter cannot disturb what somebody is in the middle of.
 */
export async function atCommit(root, ref, work) {
  const commit = resolveCommit(root, ref);
  const dir = await mkdtemp(join(tmpdir(), 'vibekit-at-'));
  const tree = join(dir, 'tree');
  try {
    git(root, ['worktree', 'add', '--detach', tree, commit]);
    return await work(tree, commit);
  } finally {
    try {
      git(root, ['worktree', 'remove', '--force', tree]);
    } catch { /* a worktree that never got added is not an error worth raising over the result */ }
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The model as it was at a point in history. */
export const modelAt = (root, ref, options = {}) =>
  atCommit(root, ref, (tree) => buildModel(tree, { folder: options.folder ?? DEFAULT_FOLDER }));

const names = (items) => items.map((item) => item.name).sort();
const added = (before, after) => after.filter((name) => !before.includes(name));

function compareEntities(before, after) {
  const changes = [];
  for (const entity of after.entities) {
    const previous = before.entities.find((other) => other.name === entity.name);
    if (!previous) continue;
    const fieldsBefore = previous.fields.map((field) => field.name);
    const fieldsAfter = entity.fields.map((field) => field.name);
    const gained = added(fieldsBefore, fieldsAfter);
    const lost = added(fieldsAfter, fieldsBefore);
    if (gained.length) changes.push(`${entity.name} gained ${gained.join(', ')}`);
    if (lost.length) changes.push(`${entity.name} lost ${lost.join(', ')}`);
    if (previous.class !== entity.class) {
      // A classification that moved is the line a security reviewer is looking for.
      changes.push(`**${entity.name} is now classified ${entity.class}, was ${previous.class}**`);
    }
  }
  return changes;
}

/**
 * What changed architecturally between two points. Prose, because that is what gets read.
 */
export function compareModels(before, after, { from, to }) {
  const sections = [];
  const push = (heading, lines) => {
    if (lines.length) sections.push(`## ${heading}\n\n${lines.map((line) => `- ${line}`).join('\n')}`);
  };

  push('Containers', [
    ...added(names(before.containers), names(after.containers)).map((name) => `**${name}** added`),
    ...added(names(after.containers), names(before.containers)).map((name) => `**${name}** removed`),
  ]);

  push('External dependencies', [
    ...added(names(before.externals), names(after.externals)).map((name) => `now calls **${name}**`),
    ...added(names(after.externals), names(before.externals)).map((name) => `no longer calls **${name}**`),
  ]);

  push('Entities', [
    ...added(names(before.entities), names(after.entities)).map((name) => `**${name}** added`),
    ...added(names(after.entities), names(before.entities)).map((name) => `**${name}** removed`),
    ...compareEntities(before, after),
  ]);

  push('Components', [
    ...added(names(before.components), names(after.components)).map((name) => `**${name}** added`),
    ...added(names(after.components), names(before.components)).map((name) => `**${name}** removed`),
  ]);

  const beforeWork = before.requirements.filter((requirement) => requirement.status === 'done').map((requirement) => requirement.id);
  const doneSince = after.requirements
    .filter((requirement) => requirement.status === 'done' && !beforeWork.includes(requirement.id))
    .map((requirement) => `${requirement.id} ${requirement.title}`);
  push('Work completed', doneSince);

  const unchanged = !sections.length;
  return {
    from,
    to,
    unchanged,
    markdown: [
      `# Architecture changes · ${from} → ${to}`,
      '',
      unchanged ? 'Nothing changed architecturally between these two points.' : sections.join('\n\n'),
      '',
    ].join('\n'),
  };
}

export async function diffDocs(root, from, to, options = {}) {
  const [before, after] = await Promise.all([modelAt(root, from, options), modelAt(root, to, options)]);
  return compareModels(before, after, { from, to });
}
