import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readText, writeText } from './fsutil.js';
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

export async function loadManifest(root, featureId) {
  const text = await readText(manifestPath(root, featureId));
  return text ? withLiveness(JSON.parse(text)) : null;
}

export function createManifestWriter(root) {
  let pending = Promise.resolve();
  return (manifest) => {
    pending = pending.then(() => writeText(manifestPath(root, manifest.feature), `${JSON.stringify(manifest, null, 2)}\n`));
    return pending;
  };
}

export const deleteManifest = (root, featureId) => rm(manifestPath(root, featureId), { force: true });
