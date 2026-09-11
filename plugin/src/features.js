import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, readText } from './fsutil.js';
import { FEATURE_STATUSES } from './schema.js';

export const FEATURES_DIR = 'specs/features';

const STATUS_RANK = Object.fromEntries(FEATURE_STATUSES.map((status, index) => [status, index]));

export const slugify = (text) =>
  text
    .toLowerCase()
    .replaceAll('#', 'sharp')
    .replaceAll('+', 'plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const hasTodo = (text) => /\bTODO\b/.test(text);

export function readFrontMatter(text) {
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const pairs = match[1].split('\n').map((line) => line.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean);
  return Object.fromEntries(pairs.map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')]));
}

export const setFrontMatterValue = (text, key, value) => text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`);

export function progress(text, prefix) {
  const items = [...text.matchAll(new RegExp(`^- \\[( |x)\\] ${prefix}-\\d+`, 'gim'))];
  return { done: items.filter((item) => item[1].toLowerCase() === 'x').length, total: items.length };
}

async function loadFeature(root, id) {
  const dir = join(root, FEATURES_DIR, id);
  const [spec, plan, tasks] = await Promise.all(
    ['spec.md', 'plan.md', 'tasks.md'].map(async (name) => (await readText(join(dir, name))) ?? ''),
  );
  const meta = readFrontMatter(spec);
  return { id, dir, spec, plan, tasks, status: meta.status ?? 'unknown', title: meta.title ?? id };
}

export async function listFeatures(root) {
  const dir = join(root, FEATURES_DIR);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return Promise.all(ids.map((id) => loadFeature(root, id)));
}

export function nextFeatureId(features, title) {
  const numbers = features.map((feature) => parseInt(feature.id, 10)).filter(Number.isFinite);
  const next = String(Math.max(0, ...numbers) + 1).padStart(3, '0');
  return `${next}-${slugify(title)}`;
}

export function findFeature(features, query) {
  const exact = features.find((feature) => feature.id === query);
  if (exact) return exact;
  const matches = features.filter((feature) => feature.id.startsWith(query) || feature.id.includes(slugify(query)));
  if (matches.length === 1) return matches[0];
  const reason = matches.length ? `is ambiguous (${matches.map((m) => m.id).join(', ')})` : 'matches no feature';
  throw new Error(`"${query}" ${reason}`);
}

export function checkFeature(feature) {
  if (!(feature.status in STATUS_RANK)) {
    return [`${feature.id}: unknown status "${feature.status}" (use ${FEATURE_STATUSES.join(' | ')})`];
  }
  const reached = (status) => STATUS_RANK[feature.status] >= STATUS_RANK[status];
  const criteria = progress(feature.spec, 'AC');
  const tasks = progress(feature.tasks, 'T');
  const problems = [
    !criteria.total && 'spec.md has no acceptance criteria (`- [ ] AC-1: …`)',
    reached('approved') && hasTodo(feature.spec) && 'spec.md still contains TODOs',
    reached('planned') && hasTodo(feature.plan) && 'plan.md still contains TODOs',
    reached('planned') && (!tasks.total || hasTodo(feature.tasks)) && 'tasks.md is empty or contains TODOs',
    feature.status === 'done' && criteria.done < criteria.total && `only ${criteria.done}/${criteria.total} acceptance criteria are checked`,
    feature.status === 'done' && tasks.done < tasks.total && `only ${tasks.done}/${tasks.total} tasks are checked`,
  ];
  return problems.filter(Boolean).map((problem) => `${feature.id} [${feature.status}]: ${problem}`);
}
