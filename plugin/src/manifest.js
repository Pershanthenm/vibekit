import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readText, writeText } from './fsutil.js';
import { worktreeBase } from './git.js';

const manifestPath = (root, featureId) => join(worktreeBase(root), `${featureId}.json`);

export async function loadManifest(root, featureId) {
  const text = await readText(manifestPath(root, featureId));
  return text ? JSON.parse(text) : null;
}

export function createManifestWriter(root) {
  let pending = Promise.resolve();
  return (manifest) => {
    pending = pending.then(() => writeText(manifestPath(root, manifest.feature), `${JSON.stringify(manifest, null, 2)}\n`));
    return pending;
  };
}

export const deleteManifest = (root, featureId) => rm(manifestPath(root, featureId), { force: true });
