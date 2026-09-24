import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isOpen, listAsks } from './folder/asks.js';
import { DEFAULT_FOLDER, FOLDER_NAMES } from './folder/layout.js';
import { isPaused, readResumeNote } from './folder/pause.js';
import { holdAgeHours, listRequirements, readTasksState } from './folder/requirements.js';
import { sprintBoard } from './folder/sprints.js';
import { currentStage, gateState } from './folder/workflow.js';
import { exists, ownerOnly, readText, writeText } from './fsutil.js';

/**
 * Every project on this machine. Specification §67 (`vibekit project select`).
 *
 * "A registry at `~/.vibekit/projects.json` records every project `project new` or `project import
 * --convert` created: name, path, remote, and when VibeKit last ran there. It holds no project
 * content, so it is safe to delete."
 *
 * The status marks are read from each project's folder on demand, never stored: a stored mark is
 * a second source of truth and it is always the one that is wrong.
 */

export const registryPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'projects.json');

export async function readRegistry() {
  try {
    const parsed = JSON.parse((await readText(registryPath())) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.path === 'string') : [];
  } catch {
    return [];
  }
}

async function writeRegistry(entries) {
  const sorted = [...entries].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  await writeText(registryPath(), `${JSON.stringify(sorted, null, 2)}\n`);
  // Paths to every repository a person works in are a map of their machine; kept to themselves.
  await ownerOnly(registryPath()).catch(() => {});
}

const remoteOf = (root) => {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
};

/** Which folder a project keeps its vibekit/ in, or null when it has none. */
export async function folderIn(root) {
  for (const name of FOLDER_NAMES) if (await exists(join(root, name, 'profile.md'))) return name;
  return null;
}

/** Record a project. Called by anything that creates or converts one, and by any command run inside one. */
export async function register(root, { name = null } = {}) {
  const path = resolve(root);
  const entries = (await readRegistry()).filter((entry) => entry.path !== path);
  const previous = (await readRegistry()).find((entry) => entry.path === path) ?? {};
  entries.push({ name: name ?? previous.name ?? basename(path), path, remote: remoteOf(path) ?? previous.remote ?? null, lastSeen: new Date().toISOString() });
  await writeRegistry(entries);
  return entries.find((entry) => entry.path === path);
}

export async function forget(name) {
  const entries = await readRegistry();
  const kept = entries.filter((entry) => entry.name !== name && entry.path !== resolve(name));
  await writeRegistry(kept);
  return entries.length - kept.length;
}

/** Walk a directory two levels deep for folders and register what is found. Rebuilds a deleted registry. */
export async function rescan(dir, { depth = 2 } = {}) {
  const found = [];
  const walk = async (path, left) => {
    if (await folderIn(path)) { found.push(path); return; }
    if (left === 0) return;
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      await walk(join(path, entry.name), left - 1);
    }
  };
  await walk(resolve(dir), depth);
  for (const path of found) await register(path);
  return found;
}

export const MARKS = Object.freeze({
  active: '●', waiting: '○', stopped: '⏸', released: '✓', attention: '⚠', gone: '✖',
});

/**
 * One project's state at a glance, from its own files. Never throws: a project that cannot be read
 * is reported as such, because the list is for finding out, not for failing.
 */
export async function summarise(entry, { holdTimeout = 4 } = {}) {
  const root = entry.path;
  const folder = (await folderIn(root).catch(() => null)) ?? (await exists(root).catch(() => false) ? null : undefined);
  if (folder === undefined) return { ...entry, mark: MARKS.gone, line: 'folder is gone', needsYou: 0 };
  if (folder === null) return { ...entry, mark: MARKS.waiting, line: 'no vibekit/ folder yet', needsYou: 0, folder: null };

  try {
    const [requirements, asks, tasks, paused, board, stage] = await Promise.all([
      listRequirements(root, folder), listAsks(root, folder), readTasksState(root, folder), isPaused(root, folder), sprintBoard(root, folder), currentStage(root, folder),
    ]);
    const open = asks.filter(isOpen);
    const held = Object.entries(tasks.held);
    const stale = held.filter(([, holder]) => holdAgeHours(holder) > holdTimeout);
    const highBugs = requirements.filter((entry2) => entry2.kind === 'bug' && entry2.severity === 'high' && entry2.status !== 'done');
    const done = requirements.filter((entry2) => entry2.status === 'done').length;
    const gates = await gateState(root, folder);
    const gateWaiting = stage.n < 5 && !gates[stage.n]?.passed;
    const needsYou = open.length + (gateWaiting ? 1 : 0);
    const releases = JSON.parse((await readText(join(root, folder, '.state/releases.json'))) ?? 'null');
    const lastRelease = Array.isArray(releases) ? releases[releases.length - 1] : releases?.releases?.slice(-1)[0] ?? null;
    const where = board.current ? `sprint ${board.current.n} of ${board.sprints.length}` : stage.n < 5 ? `stage ${stage.n} · ${stage.name}` : 'planned';

    if (paused) {
      const note = await readResumeNote(root, folder);
      const reason = note?.match(/reason:\s*(.+)/i)?.[1] ?? null;
      return { ...entry, folder, mark: MARKS.stopped, line: `stopped${reason ? ` · "${reason.trim()}"` : ''}`, needsYou: open.length, where };
    }
    if (stale.length || highBugs.length) {
      return { ...entry, folder, mark: MARKS.attention, line: stale.length ? `stale hold on ${stale[0][0]}` : `high-severity ${highBugs[0].id} open`, needsYou, where };
    }
    if (held.length) return { ...entry, folder, mark: MARKS.active, line: `${where} · building${needsYou ? ` · ${needsYou} decision${needsYou === 1 ? '' : 's'} waiting` : ' · on track'}`, needsYou, where };
    if (requirements.length && done === requirements.length && lastRelease) {
      return { ...entry, folder, mark: MARKS.released, line: `released ${lastRelease.version ?? lastRelease.tag ?? ''} · no open work`.trim(), needsYou: 0, where };
    }
    if (needsYou) return { ...entry, folder, mark: MARKS.waiting, line: `${where} · waiting on you (${needsYou})`, needsYou, where };
    if (stage.n >= 4 && !gates[4]?.passed) return { ...entry, folder, mark: MARKS.waiting, line: 'spec ready · never planned', needsYou: 1, where };
    return { ...entry, folder, mark: MARKS.waiting, line: `${where} · nothing running`, needsYou: 0, where };
  } catch (error) {
    return { ...entry, folder, mark: MARKS.attention, line: `could not be read: ${error.message}`, needsYou: 0 };
  }
}

/** Every registered project, summarised, most in need of a person first. */
export async function listProjects({ needsMe = false, match = null } = {}) {
  const entries = await readRegistry();
  const summaries = [];
  for (const entry of entries) {
    if (match && !String(entry.name).toLowerCase().includes(String(match).toLowerCase()) && entry.path !== resolve(match)) continue;
    summaries.push(await summarise(entry));
  }
  const filtered = needsMe ? summaries.filter((row) => row.needsYou > 0) : summaries;
  return filtered.sort((a, b) => b.needsYou - a.needsYou || Date.parse(b.lastSeen ?? 0) - Date.parse(a.lastSeen ?? 0));
}

export const timeAgo = (iso, now = Date.now()) => {
  const ms = now - Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return 'never';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `${Math.round(days / 30)} months ago`;
};

export { DEFAULT_FOLDER, stat };
