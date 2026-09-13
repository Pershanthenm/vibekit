import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readText, writeAtomic } from './fsutil.js';
import { worktreeBase } from './git.js';

const manifestPath = (root, featureId) => join(worktreeBase(root), `${featureId}.json`);

/**
 * Is the process that was started for this lane still there?
 *
 * Signal 0 asks the operating system about a process without touching it: no signal is delivered,
 * and it throws ESRCH when there is nothing to deliver to. EPERM means a process exists that this
 * user may not signal, which still answers the question being asked.
 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * What is actually true of each lane, rather than what was last written down.
 *
 * A manifest records "running" when an agent starts and "finished" when it ends — but if the
 * dispatching process is killed, nothing ever writes the second one, and the board shows a lane
 * running forever. Nobody is working on that feature, and the page says somebody is.
 *
 * So a lane claiming to be running is checked against the process that claim is about. One whose
 * agent is gone becomes `stopped`: not finished, not failed by its own account, just no longer
 * there. Lanes from a manifest written before pids were recorded have nothing to check against and
 * are left exactly as they are rather than guessed at.
 */
export function withLiveness(manifest) {
  if (!manifest) return manifest;
  return {
    ...manifest,
    lanes: manifest.lanes.map((lane) => (lane.state === 'running' && lane.pid && !isAlive(lane.pid)
      ? { ...lane, state: 'stopped' }
      : lane)),
  };
}

/**
 * The manifest for a feature, or null when there genuinely is not one.
 *
 * "Genuinely" is the careful word. A file of zero bytes is almost always a read that landed while
 * the file was being replaced, not a manifest that is missing — and the difference matters, because
 * `dispatch` treats a missing manifest as permission to start another set of lanes over worktrees
 * that already exist. So an empty read is looked at twice before it is believed.
 */
// Long enough to outlast a write on a machine that is busy, short enough that nobody waiting on a
// manifest that genuinely is not there notices. A file of zero bytes is never a valid manifest, so
// there is nothing to lose by looking again.
const EMPTY_RETRIES = 6;
const EMPTY_PAUSE_MS = 50;

export async function loadManifest(root, featureId) {
  const path = manifestPath(root, featureId);
  let text = await readText(path);
  for (let attempt = 0; text === '' && attempt < EMPTY_RETRIES; attempt += 1) {
    await new Promise((settled) => setTimeout(settled, EMPTY_PAUSE_MS));
    text = await readText(path);
  }
  return text ? withLiveness(JSON.parse(text)) : null;
}

export function createManifestWriter(root) {
  let pending = Promise.resolve();
  return (manifest) => {
    pending = pending.then(() => writeAtomic(manifestPath(root, manifest.feature), `${JSON.stringify(manifest, null, 2)}\n`));
    return pending;
  };
}

export const deleteManifest = (root, featureId) => rm(manifestPath(root, featureId), { force: true });
