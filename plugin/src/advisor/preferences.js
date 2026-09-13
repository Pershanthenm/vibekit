import { homedir } from 'node:os';
import { join } from 'node:path';
import { readText, writeText } from '../fsutil.js';
import { PRESETS } from './components.js';

const preferencesPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'preferences.json');

export const expandPreferred = (ids) => [...new Set(ids.flatMap((id) => (PRESETS[id] ? Object.values(PRESETS[id]) : [id])))];

export async function loadPreferred() {
  const text = await readText(preferencesPath());
  const preferences = text ? JSON.parse(text) : {};
  return expandPreferred(preferences.preferred ?? preferences.preferredStacks ?? []);
}

export async function savePreferred(ids) {
  await writeText(preferencesPath(), `${JSON.stringify({ preferred: ids }, null, 2)}\n`);
  return preferencesPath();
}
