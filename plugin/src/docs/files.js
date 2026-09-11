import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.expo', 'Pods', 'target', '.venv', '__pycache__']);

async function walk(root, prefix, files) {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export const listProjectFiles = async (root) => (await walk(root, '', [])).sort();

const escapeRegExp = (char) => char.replace(/[.+^${}()|[\]\\]/g, '\\$&');

export function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/';
      pattern += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += escapeRegExp(char);
  }
  return new RegExp(`^${pattern}$`);
}

export function matchFiles(files, patterns) {
  const expressions = patterns.map(globToRegExp);
  return files.filter((file) => expressions.some((expression) => expression.test(file)));
}
