import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readText } from '../fsutil.js';
import { estimateProseTokens } from '../tokens.js';
import { BUDGET_CAP, Loading, filesFor } from './layout.js';

/**
 * What a task actually costs. Specification §10.
 *
 * This number is the format's main public claim, so it is measured from the files on disk rather
 * than asserted from the budget column in the layout. Those budgets are targets for a folder that
 * does not exist yet; once it does, the only honest report is a count.
 *
 * One pointer file is charged, not three. An agent reads the one its own tool looks for; charging
 * all of them would inflate the headline by 300 tokens nobody pays.
 */

const tokensOf = async (path) => {
  const text = await readText(path);
  return text === null ? null : estimateProseTokens(text);
};

const listGlob = async (dir, match) => (await readdir(dir).catch(() => [])).filter((name) => match.test(name)).sort();
const countDirs = async (dir, match) => (await readdir(dir, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory() && match.test(entry.name)).length;

/** Sections, so a per-task estimate charges only the entities a requirement names. */
const countSections = (text) => (text ? (text.match(/^##\s+/gm) ?? []).length : 0);

export async function budgetReport(root, folder = 'vibekit', { delivery = 'checks-only', cap = BUDGET_CAP } = {}) {
  const base = join(root, folder);
  const rows = [];
  let alwaysLoaded = 0;

  // Counted first: a per-unit budget cannot be checked until the units are known.
  const requirementFiles = await listGlob(join(base, 'product/requirements'), /^(?:REQ|MIG|BUG)-.*\.md$/);
  const skillFiles = await listGlob(join(base, 'skills/lib'), /^(?!.*\.test\.md$).*\.md$/);
  const memoryFiles = await listGlob(join(base, 'memory/repo'), /\.md$/);
  const entitiesText = await readText(join(base, 'product/entities.md'));
  const entityCount = countSections(entitiesText);
  const sourceCount = await countDirs(join(base, 'product/sources'), /^(?:BRS|DESC)-/);

  const units = { requirement: requirementFiles.length, skill: skillFiles.length, memory: memoryFiles.length, entity: entityCount, source: sourceCount };
  const budgetFor = (file) => (file.perUnit ? (file.base ?? 0) + file.budget * (units[file.perUnit] ?? 0) : file.budget);

  const pointer = await tokensOf(join(root, 'CLAUDE.md'));
  if (pointer !== null) {
    rows.push({ path: 'CLAUDE.md', loading: Loading.Always, tokens: pointer, budget: 150 });
    alwaysLoaded += pointer;
  }

  for (const file of filesFor(delivery)) {
    if (file.glob || file.loading !== Loading.Always) continue;
    const tokens = await tokensOf(join(base, file.path));
    if (tokens === null) continue;
    rows.push({
      path: `${folder}/${file.path}`,
      loading: file.loading,
      tokens,
      budget: budgetFor(file),
      perUnit: file.perUnit,
      units: file.perUnit ? units[file.perUnit] : undefined,
      hardCeiling: file.hardCeiling,
      ceiling: file.ceiling,
    });
    alwaysLoaded += tokens;
  }

  const average = async (dir, names) => {
    if (!names.length) return 0;
    let total = 0;
    for (const name of names) total += (await tokensOf(join(dir, name))) ?? 0;
    return Math.round(total / names.length);
  };

  const perRequirement = await average(join(base, 'product/requirements'), requirementFiles);
  const perSkill = await average(join(base, 'skills/lib'), skillFiles);
  const perMemory = await average(join(base, 'memory/repo'), memoryFiles);
  const entityTokens = entitiesText ? estimateProseTokens(entitiesText) : 0;
  // A task typically names two to four entities; three is the figure the format is budgeted on.
  // A project with fewer than three cannot name three, and the label says so rather than
  // quoting a figure the row's own cost contradicts.
  const named = Math.min(3, entityCount);
  const namedEntities = entityCount ? Math.round((entityTokens / entityCount) * named) : 0;

  const perTask = [
    { label: 'one requirement', tokens: perRequirement },
    { label: `named entities (${named})`, tokens: namedEntities },
    { label: 'one skill + one memory body', tokens: perSkill + perMemory },
  ];

  // The same folder with nothing scoped. This comparison is what justifies the scoping rules, so
  // it is reported next to the total rather than left for somebody to work out.
  let wholeFolder = alwaysLoaded + entityTokens;
  for (const [dir, names] of [['product/requirements', requirementFiles], ['skills/lib', skillFiles], ['memory/repo', memoryFiles]]) {
    for (const name of names) wholeFolder += (await tokensOf(join(base, dir, name))) ?? 0;
  }

  const typicalTask = alwaysLoaded + perTask.reduce((total, item) => total + item.tokens, 0);

  return {
    rows,
    perTask,
    alwaysLoaded,
    typicalTask,
    wholeFolder,
    ceiling: cap,
    passes: alwaysLoaded <= cap,
    counts: { requirements: requirementFiles.length, skills: skillFiles.length, memories: memoryFiles.length, entities: entityCount, sources: sourceCount },
  };
}

const pad = (text, width) => String(text).padEnd(width);
const padStart = (text, width) => String(text).padStart(width);

export function renderBudget(report, folder = 'vibekit') {
  const lines = [];
  const width = Math.max(30, ...report.rows.map((row) => row.path.length));

  lines.push('  Always loaded');
  for (const row of report.rows) {
    const limit = row.ceiling ?? row.budget;
    const over = limit && row.tokens > limit;
    const scale = row.perUnit ? ` for ${row.units} ${row.perUnit}${row.units === 1 ? '' : 's'}` : '';
    const note = over ? `  over budget (${limit}${scale}${row.hardCeiling ? ', hard ceiling' : ''})` : '';
    lines.push(`    ${pad(row.path, width)} ${padStart(row.tokens, 6)}${note}`);
  }
  lines.push(`    ${pad('', width)} ${padStart('──────', 6)}`);
  lines.push(`    ${pad('always-loaded total', width)} ${padStart(report.alwaysLoaded, 6)}  cap ${report.ceiling}`);
  lines.push('');
  lines.push('  Per task');
  for (const item of report.perTask) lines.push(`    ${pad(item.label, width)} ${padStart(item.tokens, 6)}`);
  lines.push(`    ${pad('', width)} ${padStart('──────', 6)}`);
  lines.push(`    ${pad('typical task total', width)} ${padStart(report.typicalTask, 6)}`);
  lines.push('');
  lines.push(`  The same folder loaded whole: ${report.wholeFolder} tokens`);
  const { requirements, entities, skills, memories, sources } = report.counts;
  lines.push(`  (${requirements} requirements · ${entities} entities · ${skills} skills · ${memories} memories · ${sources} sources)`);
  return lines.join('\n');
}
