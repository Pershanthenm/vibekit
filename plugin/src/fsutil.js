import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path) {
  return (await exists(path)) ? readFile(path, 'utf8') : null;
}

export async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function writeMissing(root, files) {
  const created = [];
  for (const file of files) {
    const target = join(root, file.path);
    if (await exists(target)) continue;
    await writeText(target, file.content);
    created.push(file.path);
  }
  return created;
}
