import { homedir } from 'node:os';
import { join } from 'node:path';
import { exists, readText, writeText } from './fsutil.js';

const registryPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'projects.json');

export async function readRegistry() {
  try {
    return JSON.parse((await readText(registryPath())) ?? '[]');
  } catch {
    return [];
  }
}

export async function rememberProject(root, name) {
  try {
    const entries = (await readRegistry()).filter((entry) => entry.path !== root);
    entries.push({ name, path: root, lastSeen: new Date().toISOString() });
    await writeText(registryPath(), `${JSON.stringify(entries.sort((a, b) => a.name.localeCompare(b.name)), null, 2)}\n`);
  } catch {
    // The registry is a convenience; never block the workflow on it.
  }
}

export async function forgetMissing() {
  const entries = await readRegistry();
  const kept = [];
  for (const entry of entries) if (await exists(join(entry.path, 'specs', 'project.json'))) kept.push(entry);
  await writeText(registryPath(), `${JSON.stringify(kept, null, 2)}\n`);
  return entries.length - kept.length;
}
