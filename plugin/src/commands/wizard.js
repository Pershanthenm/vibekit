import { isAbsolute, join, resolve } from 'node:path';
import { stateDir } from '../evidence.js';
import { writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { renderWizard } from '../wizard-page.js';
import { openInBrowser, startConsole } from './dashboard.js';

// Same rule as the dashboard: a generated file inside the working tree leaves it dirty, which
// blocks merges and stales evidence. There may also be no git repo yet — the point of the wizard
// is that it can run before a project exists — so fall back to a folder beside it.
function wizardPath(root, out) {
  if (out) return isAbsolute(out) ? out : resolve(root, out);
  try {
    return stateDir(root, 'wizard.html');
  } catch {
    return join(root, '.vibekit', 'wizard.html');
  }
}

/**
 * Serve the wizard instead of writing it, so somewhere other than this machine can fill it in.
 *
 * A written file is the right answer on a laptop and the wrong one over SSH: there is no browser
 * to open it with, and a form is no use as a path. With `--tunnel` the form gets a public address
 * and the console prints a code for it, so the phone in your hand becomes the way in.
 *
 * This is the console's own server, on the console's own secret path, because the wizard already
 * rides it: one link reaches both, and the form hands its answers straight back with no second
 * token and nothing to copy between windows.
 */
async function serveWizard({ root, tunnel, port, host, open }) {
  const started = await startConsole(root, { port, host });
  if (!started) return;
  const { server, lan } = started;
  const url = `${server.url}wizard`;

  console.log(`Spec wizard on ${url}`);
  console.log('  Fill it in and hand it back on the last step. Ctrl-C to stop.');
  console.log('  The path is random and changes every start, so an old link stops working.');
  console.log(`  Live status on ${server.url}`);
  console.log(`\n  Write token: ${server.token}`);
  console.log('  The form asks for this when it hands the answers back, and keeps it in that browser.');
  if (lan) console.log('\n  Bound to every interface on this network — anyone on it can reach the form.');

  if (tunnel) {
    // The announcer prints the addresses and the code, and does it for a tunnel opened from the
    // page as well — so all that is left here is what asking for one on the command line implies.
    const state = await server.tunnel.start();
    if (state.error) {
      console.error(`\n✖ No tunnel: ${state.error}`);
      console.error('  The form is still being served on this machine, at the address above.');
    } else {
      console.log('\n  ! That hostname is public while it is open. The random path is what keeps the form');
      console.log('    private, and the write token is what stops a reader answering for you.');
      console.log('    Done? Ctrl-C, or turn the tunnel off on the Overview page.');
    }
  } else {
    console.log('\n  To fill it in on a phone: vibekit wizard --serve --tunnel');
  }
  if (open) openInBrowser(url);
  // Handed back so a caller — or a test — can close what it started. Nothing on the command line
  // needs it: there, the process lives until Ctrl-C.
  return server;
}

export async function wizard({ root, out, open, serve, tunnel, port, host }) {
  // Asking for a tunnel is asking to be served: there is nothing for a tunnel to point at otherwise.
  if (serve || tunnel) return serveWizard({ root, tunnel, port, host, open });

  // A project is optional: someone can fill this in before anything has been initialised.
  const project = await loadProject(root).catch(() => null);
  const path = wizardPath(root, out);
  await writeText(path, renderWizard({ projectName: project?.project.name ?? '' }));

  console.log(`Wrote ${path}`);
  if (open !== false) openInBrowser(path);
  console.log('  Fill it in, save requirements.json into this project as specs/requirements.json,');
  console.log('  then run: vibekit advise apply');
  console.log('  On a machine with no browser — a server over SSH — serve it to your phone instead:');
  console.log('    vibekit wizard --serve --tunnel');
}
