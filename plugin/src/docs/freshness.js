import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readText, writeText } from '../fsutil.js';
import { DIAGRAM_TYPES, DOC_KINDS } from './catalog.js';
import { listProjectFiles, matchFiles } from './files.js';

const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const MERMAID_BLOCK = /```mermaid\n([\s\S]*?)```/g;

function parseValue(raw) {
  try {
    return /^["[]/.test(raw) ? JSON.parse(raw) : raw;
  } catch {
    return raw;
  }
}

export function splitDoc(text) {
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: text };
  const pairs = match[1].split('\n').map((line) => line.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean);
  return { meta: Object.fromEntries(pairs.map(([, key, value]) => [key, parseValue(value)])), body: text.slice(match[0].length) };
}

export function joinDoc(meta, body) {
  const lines = Object.entries(meta).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`;
}

export function lintDiagrams(body, kind) {
  const diagrams = [...body.matchAll(MERMAID_BLOCK)].map(([, code]) => code.trim().split('\n')[0].trim());
  const invalid = diagrams.filter((first) => !DIAGRAM_TYPES.test(first)).map((first) => `unknown Mermaid diagram type "${first || '(empty)'}"`);
  const required = DOC_KINDS[kind]?.diagram;
  const missing = required && !diagrams.some((first) => required.test(first)) ? [`needs a ${DOC_KINDS[kind].diagramName} diagram`] : [];
  return [...invalid, ...missing];
}

export async function sourcesFingerprint(root, files, patterns) {
  const matched = matchFiles(files, patterns);
  const parts = await Promise.all(matched.map(async (file) => `${file}\n${await readFile(join(root, file), 'utf8').catch(() => '')}`));
  return { fingerprint: fingerprint(parts.join('\0')), count: matched.length };
}

export async function docState(root, files, doc) {
  const text = await readText(join(root, doc.path));
  if (text === null) return { ...doc, state: 'missing', stamped: false, problems: [] };
  const { meta, body } = splitDoc(text);
  const sources = Array.isArray(meta.sources) ? meta.sources : doc.sources;
  const problems = lintDiagrams(body, meta.kind ?? doc.kind);
  const stamped = Boolean(meta.stamp);
  if (/\bTODO\b/.test(body)) return { ...doc, sources, state: 'todo', stamped, problems };
  if (!stamped) return { ...doc, sources, state: 'unstamped', stamped, problems };
  const { fingerprint: current } = await sourcesFingerprint(root, files, sources);
  return { ...doc, sources, state: current === meta.stamp ? 'fresh' : 'stale', stamped, problems };
}

export const isReady = (state) => state.state === 'fresh' && !state.problems.length;

export async function stampDoc(root, path, { stillAccurate = false } = {}) {
  const text = await readText(join(root, path));
  if (text === null) throw new Error(`${path} does not exist. Create it with "vibekit docs new".`);
  const { meta, body } = splitDoc(text);
  const problems = lintDiagrams(body, meta.kind);
  if (/\bTODO\b/.test(body)) throw new Error(`${path} still contains TODOs.`);
  if (problems.length) throw new Error(`${path}: ${problems.join('; ')}`);
  if (!Array.isArray(meta.sources) || !meta.sources.length) throw new Error(`${path} has no "sources" in its front matter.`);
  const { fingerprint: sourcesNow, count } = await sourcesFingerprint(root, await listProjectFiles(root), meta.sources);
  if (!count) throw new Error(`${path}: its sources match no files (${meta.sources.join(', ')}).`);
  const bodyNow = fingerprint(body);
  if (meta.stamp && meta.stamp !== sourcesNow && meta.body === bodyNow && !stillAccurate) {
    throw new Error(`${path}: its sources changed but the document didn't. Update it, or re-run with --still-accurate after checking it against the sources.`);
  }
  await writeText(join(root, path), joinDoc({ ...meta, stamp: sourcesNow, body: bodyNow, reviewed: today() }, body));
  return count;
}
