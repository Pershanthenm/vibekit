import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { collectState, dashboardPath, renderDashboard } from '../dashboard.js';
import { writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { collectProblems } from './check.js';

/**
 * Hand a file to whatever the operating system uses to open it. Detached and unreferenced, so a
 * short-lived CLI command is never held open by the browser it just launched. Best-effort by
 * design: a machine with no browser, or a locked-down desktop, must not fail the job that
 * opened the page — the file is written either way.
 */
export function openInBrowser(path) {
  // Tests, CI and headless sessions still write the page; they must never launch a window.
  if (process.env.VIBECHECK_NO_OPEN === '1' || process.env.CI) return false;
  const [command, args] = process.platform === 'win32'
    // cmd's `start` takes an empty title first, or it treats a quoted path as the window title.
    ? [process.env.ComSpec || 'cmd', ['/c', 'start', '', path]]
    : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

// --out is the user asking for a copy somewhere specific; everything else stays out of the tree.
const pathFor = (root, out) => (out ? (isAbsolute(out) ? out : resolve(root, out)) : dashboardPath(root));

/**
 * Render the current lifecycle to a file and return where it landed. Long-running commands call
 * this as they start and again as they finish, so an already-open page catches up on its next
 * refresh without anything having to talk to the browser.
 */
export async function writeDashboard(root, project, { out, setup = null, live = true, problems } = {}) {
  const path = pathFor(root, out);
  const found = problems ?? await collectProblems(root, project).catch(() => []);
  const state = await collectState(root, project, { setup, problems: found });
  await writeText(path, renderDashboard(state, { live }));
  return { path, state };
}

// Reopening on every refresh would fight the user for focus, so each path is opened once per run.
const opened = new Set();

/**
 * Write the page and open it the first time only. Never throws: a dashboard that cannot be shown
 * is not a reason for the work it was reporting on to stop.
 */
export async function openDashboard(root, project, options = {}) {
  try {
    const { path } = await writeDashboard(root, project, options);
    if (!opened.has(path)) {
      opened.add(path);
      openInBrowser(path);
      console.log(`  ↗ live status: ${path}`);
    }
    return path;
  } catch {
    return null;
  }
}

// --static drops the meta-refresh, for a copy that is going somewhere other than a local browser.
export async function dashboard({ root, out, json, open, static: isStatic }) {
  const project = await loadProject(root);
  const problems = await collectProblems(root, project).catch(() => []);
  if (json) {
    console.log(JSON.stringify(await collectState(root, project, { problems }), null, 2));
    return;
  }
  const { path, state } = await writeDashboard(root, project, { out, live: !isStatic, problems });
  const blocked = state.features.flatMap((feature) => feature.gates.filter((gate) => gate.state === 'blocked'));
  console.log(`Wrote ${path}`);
  console.log(`  ${state.features.length} feature(s) · ${blocked.length} blocked gate(s)${state.next ? ` · next: ${state.next.step}` : ''}`);
  if (open) openInBrowser(path);
}
