import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

/**
 * The tracker's own branch. Specification §57.
 *
 * "Every action is written to the file, committed on the tracker's own branch `tracker/<user>`
 * with §51 trailers, and pushed to the remote. `serve` then merges `tracker/*` into the current
 * working branch when the change is to workflow files, which is always a clean merge because those
 * files are append-only or single-owner; anything that would conflict is left on the branch as a
 * PR and the page says so."
 *
 * Git is the database (§51), so a decision made on a phone has to end up in a commit with the
 * person's name on it, not only in a file on the machine running `serve`. Everything here works
 * through a temporary index: the real index and working tree are somebody's, and a tracker that
 * staged or unstaged their files to record an answer would be a tracker they turned off.
 */

const run = (root, args, env = {}) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
}).trim();
const attempt = (root, args, env) => { try { return run(root, args, env); } catch { return null; } };

/** `j.naidoo@example.com` → `tracker/j.naidoo`. A branch name has to be one git accepts. */
export const trackerBranch = (user) => {
  const handle = String(user ?? '').toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return `tracker/${handle || 'unknown'}`;
};

/**
 * Every file under the folder with its size and mtime, so what one action wrote can be told from
 * what was already there. `.state/` is left out: it is rebuilt from the folder, never committed.
 */
export async function snapshot(root, folder) {
  const map = new Map();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === '.state') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      const info = await stat(path).catch(() => null);
      if (info) map.set(relative(root, path).split(sep).join('/'), `${info.size}:${info.mtimeMs}`);
    }
  };
  await walk(join(root, folder));
  return map;
}

/** The paths that differ between two snapshots — written, or removed. */
export function changedBetween(before, after) {
  const paths = new Set();
  for (const [path, mark] of after) if (before.get(path) !== mark) paths.add(path);
  for (const path of before.keys()) if (!after.has(path)) paths.add(path);
  return [...paths].sort();
}

/**
 * Commit `paths` as they are in the working tree onto `tracker/<user>`, then merge that into the
 * branch that is checked out when the merge is clean. Never throws for the ordinary reasons a repo
 * has (no commits yet, detached HEAD, a conflict): each comes back as `why`, because the action
 * itself already happened and a page that reported it as failed would be lying.
 */
export async function commitToTracker(root, { user, name = null, paths, message, trailers = [] }) {
  if (!paths?.length) return { committed: false, why: 'nothing changed' };
  if (!attempt(root, ['rev-parse', '--git-dir'])) return { committed: false, why: 'not a git repository' };
  const head = attempt(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!head) return { committed: false, why: 'the repository has no commits yet' };

  const branch = trackerBranch(user);
  const ref = `refs/heads/${branch}`;
  const existing = attempt(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const parent = existing ?? head;
  // §51: the author and the committer are the person whose decision this was.
  const who = String(name ?? user ?? 'tracker');
  const identity = { GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: String(user), GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: String(user) };

  const dir = await mkdtemp(join(tmpdir(), 'vibekit-tracker-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    run(root, ['read-tree', parent], env);
    run(root, ['add', '--all', '--', ...paths], env);
    const tree = run(root, ['write-tree'], env);
    if (tree === attempt(root, ['rev-parse', `${parent}^{tree}`])) return { committed: false, why: 'nothing changed' };

    const commit = run(root, ['commit-tree', tree, '-p', parent, '-m', [message, '', ...trailers].join('\n')], { ...env, ...identity });
    // The old value is passed so a branch somebody else moved a moment ago is not overwritten.
    run(root, ['update-ref', ref, commit, existing ?? '']);
    return { committed: true, branch, commit, ...mergeBack(root, { branch, commit, paths, identity }), ...push(root, branch) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Land the tracker commit on the checked-out branch. A fast-forward when the branch has not moved;
 * a real three-way merge otherwise, and one that would conflict is not attempted — the branch
 * stays where a pull request can pick it up.
 */
function mergeBack(root, { branch, commit, paths, identity }) {
  const current = attempt(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!current) return { merged: false, left: branch, why: 'HEAD is detached, so there is no branch to merge into' };
  if (current === branch) return { merged: true, into: current };
  const head = run(root, ['rev-parse', 'HEAD']);

  let landed = null;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', head, commit], { cwd: root, stdio: 'ignore' });
    landed = commit;
  } catch {
    // Not a fast-forward. `merge-tree --write-tree` merges without touching the working tree and
    // exits non-zero on a conflict; an older git that lacks it also lands here, and the honest
    // answer for both is the same: the change is on its branch, not lost.
    const tree = attempt(root, ['merge-tree', '--write-tree', head, commit])?.split('\n')[0] ?? null;
    if (!tree) return { merged: false, left: branch, why: `merging ${branch} into ${current} would not be clean, so it waits there for a pull request` };
    landed = run(root, ['commit-tree', tree, '-p', head, '-p', commit, '-m', `merge ${branch} into ${current}\n\nVibeKit-Via: tracker`], identity);
  }
  run(root, ['update-ref', `refs/heads/${current}`, landed, head]);
  // The real index is brought level with what just landed for these paths only, so `git status`
  // does not show a file as both changed and reverted.
  attempt(root, ['add', '--all', '--', ...paths]);
  return { merged: true, into: current };
}

/** Push the branch when there is somewhere to push it. A failed push is reported, not fatal. */
function push(root, branch) {
  const remotes = (attempt(root, ['remote']) ?? '').split('\n').filter(Boolean);
  if (!remotes.length) return { pushed: false };
  try {
    execFileSync('git', ['push', '--quiet', remotes[0], `refs/heads/${branch}:refs/heads/${branch}`], { cwd: root, stdio: 'ignore', timeout: 20_000 });
    return { pushed: true, remote: remotes[0] };
  } catch {
    return { pushed: false, why: `the push to ${remotes[0]} failed; the commit is on ${branch} locally` };
  }
}
