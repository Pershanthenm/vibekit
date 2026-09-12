import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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

// The written page refreshes itself, but nothing regenerates it in the background — it is only
// rewritten while a long command happens to be running. Serving closes that gap by rendering on
// every request, which is also less machinery than watching the filesystem: no watcher, no
// debounce, no rewrites, and no stale file to go out of date.
export const DEFAULT_PORT = 7332;

/** The page shown when the project cannot be read, so one bad edit does not kill the server. */
const errorPage = (message) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Dashboard — waiting</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0b0a;color:#f4f5f2;
font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
div{max-width:38rem;padding:24px}h1{font-size:17px;margin:0 0 8px}
p{color:#9ea19a;margin:0 0 6px}code{color:#b6f24a}</style></head>
<body><div><h1>Waiting for a readable project</h1>
<p>${message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</p>
<p>This page retries every 5 seconds. Fix it with <code>vibecheck check</code>.</p></div></body></html>`;

/**
 * Serve the dashboard, rendering current state on every request. Returns the server so a caller —
 * or a test — can close it. Binds to loopback unless told otherwise: the page carries feature
 * titles and blocker text that quote file paths and review comments, and that is not something to
 * put on a shared network by accident.
 */
export async function serveDashboard(root, { port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  const server = createServer(async (request, response) => {
    let body;
    let status = 200;
    try {
      const project = await loadProject(root);
      const problems = await collectProblems(root, project).catch(() => []);
      const state = await collectState(root, project, { problems });
      body = renderDashboard(state, { live: true });
    } catch (error) {
      status = 503;
      body = errorPage(error?.message ?? 'the project could not be read');
    }
    // No caching: the whole point is that a refresh shows what is true now.
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
  });

  await new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen(port, host, () => { server.removeListener('error', failed); ready(); });
  });

  const actual = server.address();
  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual.port}`,
    port: actual.port,
    close: () => new Promise((closed) => server.close(closed)),
  };
}

// --static drops the meta-refresh, for a copy that is going somewhere other than a local browser.
export async function dashboard({ root, out, json, open, static: isStatic, serve, port, host }) {
  if (serve) {
    const requested = port ? Number(port) : DEFAULT_PORT;
    if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
      console.error(`✖ --port must be a number between 0 and 65535, not "${port}".`);
      process.exitCode = 1;
      return;
    }
    const lan = host === '0.0.0.0';
    let server;
    try {
      server = await serveDashboard(root, { port: requested, host: lan ? '0.0.0.0' : '127.0.0.1' });
    } catch (error) {
      const busy = error?.code === 'EADDRINUSE';
      console.error(busy
        ? `✖ Port ${requested} is already in use. Choose another with --port, or stop what is on it.`
        : `✖ Could not start the dashboard server: ${error?.message ?? error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Live dashboard on ${server.url}`);
    console.log('  Renders current state on every request. Ctrl-C to stop.');
    if (lan) console.log('  Reachable from other devices on this network — it carries your feature titles and blockers.');
    if (open) openInBrowser(server.url);
    return;
  }

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
