import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readText, writeText } from './fsutil.js';
import { normalize, validate } from './schema.js';

export const PROJECT_FILE = 'specs/project.json';

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }
}

export async function loadProject(root) {
  const raw = await readText(join(root, PROJECT_FILE));
  if (raw === null) throw new Error(`No ${PROJECT_FILE} found. Run "vibecheck init" first.`);
  return normalize(parseJson(raw, PROJECT_FILE));
}

export async function readProjectFile(path) {
  return normalize(parseJson(await readFile(path, 'utf8'), path));
}

export async function saveProject(root, project) {
  await writeText(join(root, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`);
}

export function assertValid(project) {
  const errors = validate(project);
  if (errors.length) throw new Error(`Invalid ${PROJECT_FILE}:\n  - ${errors.join('\n  - ')}`);
}
