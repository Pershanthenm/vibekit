import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { folderIn, listProjects, readRegistry, register } from './projects.js';
import { ownerOnly, readText, writeText } from './fsutil.js';

/**
 * Where I am. CLI Spec §2 (`use`).
 *
 * "After `use project "Hello World 2"`, everything applies there until you switch again. A name
 * is only needed to act on something you are not currently in." And: "Recorded in machine
 * settings, never in the folder, so two people on the same repo can be in different places."
 *
 * So this is one small file under `~/.vibekit/`: the project a person chose and, per project,
 * the sprint they chose to work. Nothing here is state about the project — the current sprint
 * is still read from the plan every time — it is only a record of a choice.
 */

export const currentPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'current.json');

export async function readCurrent() {
  try {
    const parsed = JSON.parse((await readText(currentPath())) ?? '{}');
    return parsed && typeof parsed === 'object' ? { project: parsed.project ?? null, sprints: parsed.sprints ?? {} } : { project: null, sprints: {} };
  } catch {
    return { project: null, sprints: {} };
  }
}

async function writeCurrent(state) {
  await writeText(currentPath(), `${JSON.stringify(state, null, 2)}\n`);
  await ownerOnly(currentPath()).catch(() => {});
}

/** `use project <name>`: the registry row is the truth about where it is; the name is what a person typed. */
export async function setCurrentProject(path, { name = null } = {}) {
  const state = await readCurrent();
  state.project = { path: resolve(path), name: name ?? state.project?.name ?? null, chosenAt: new Date().toISOString() };
  await writeCurrent(state);
  return state.project;
}

/** `use sprint N`: a choice per project, so switching projects switches sprints with it. */
export async function setWorkingSprint(root, n) {
  const state = await readCurrent();
  const key = resolve(root);
  if (n === null || n === undefined) delete state.sprints[key];
  else state.sprints[key] = Number(n);
  await writeCurrent(state);
  return state.sprints[key] ?? null;
}

/** The sprint a person chose for this project, or null when they let the plan decide. */
export async function workingSprint(root) {
  const state = await readCurrent();
  const value = state.sprints[resolve(root)];
  return Number.isFinite(value) ? value : null;
}

/** The project `use project` chose, if it still exists and still has a folder. */
export async function currentProject() {
  const state = await readCurrent();
  if (!state.project?.path) return null;
  const folder = await folderIn(state.project.path).catch(() => null);
  if (!folder) return null;
  const registered = (await readRegistry()).find((entry) => entry.path === state.project.path);
  return { ...state.project, name: registered?.name ?? state.project.name ?? state.project.path.split(/[\\/]/).pop(), folder };
}

/**
 * Which directory a command should act on. `--dir` wins; then the folder we are standing in;
 * then the project `use project` chose; then here, so a command in an empty directory says
 * "no project here" rather than silently working somewhere else.
 *
 * Returns the root and, when it is not the directory the person is in, the project it belongs
 * to — so the command can say where it acted.
 */
export async function resolveRoot({ dir = null, cwd = process.cwd() } = {}) {
  if (dir) return { root: resolve(dir), redirected: null };
  const here = resolve(cwd);
  if (await folderIn(here)) return { root: here, redirected: null };
  const chosen = await currentProject();
  if (chosen && chosen.path !== here) return { root: chosen.path, redirected: chosen };
  return { root: here, redirected: null };
}

/**
 * Find one project by name: exact (case-insensitive) first, then a substring, then a path. None
 * or several is a question back to the person, never a guess.
 */
export async function findProject(name) {
  const wanted = String(name ?? '').trim();
  if (!wanted) return null;
  const rows = await listProjects();
  const exact = rows.filter((row) => String(row.name).toLowerCase() === wanted.toLowerCase());
  if (exact.length === 1) return exact[0];
  const byPath = rows.find((row) => row.path === resolve(wanted));
  if (byPath) return byPath;
  const partial = rows.filter((row) => String(row.name).toLowerCase().includes(wanted.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${wanted}" matches ${partial.length} projects: ${partial.map((row) => row.name).join(', ')}. Say which.`);
  return null;
}

export { register };
