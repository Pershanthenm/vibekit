import { join } from 'node:path';
import { readFrontMatter } from './frontmatter.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { listRequirements, sectionOf } from './folder/requirements.js';
import { parseEvidence } from './folder/evidence.js';
import { approvalOf } from './folder/workflow.js';
import { exists, readText, writeAtomic } from './fsutil.js';

/**
 * Migrations. CLI Spec §2 (`migrate`, `verify`).
 *
 * "Moving software you already have: to a newer version, to a different stack, or out of a
 * monolith." All three kinds run the same five stages — understand, target, characterise, plan,
 * move — each ending at a gate a person approves. The record is one file, `workflow/migration.md`,
 * written the way every other gate file is: a heading per stage and an `approved:` line a human
 * writes under it. Nothing here passes a gate by itself.
 *
 * Slices are `MIG-*` requirements: the same build loop, the same review, the same definition of
 * done — plus one more rule, from `verify`: a slice with an unresolved **real** difference cannot
 * be marked done, and traffic cannot be moved to a slice that is not verified.
 */

export const KINDS = Object.freeze(['upgrade', 'replatform', 'decompose']);

export const STAGES = Object.freeze([
  { key: 'understand', title: 'Understand', gate: 'the old system is read and explained back; you approve the understanding' },
  { key: 'target', title: 'Target', gate: 'what the new stack or shape is, and why; you approve the target' },
  { key: 'characterise', title: 'Characterise', gate: 'a characterisation suite pins how the old system behaves; you approve it as the yardstick' },
  { key: 'plan', title: 'Plan', gate: 'the slices, as MIG-* requirements in workflow/plan.md, in an order that keeps both systems working; you approve the plan' },
  { key: 'move', title: 'Move', gate: 'every slice moved, verified, and carrying all the traffic' },
]);

export const DIFFERENCE_KINDS = Object.freeze(['expected', 'tolerable', 'real']);

export const migrationPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, 'workflow/migration.md');
export const differencesPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, 'workflow/differences.md');

// ---------------------------------------------------------------- the record

const KIND_WORDS = { upgrade: 'same stack, newer versions', replatform: 'a different stack', decompose: 'split what is there into modules' };

export function renderMigration({ kind, target, started, old = null, next = null, slices = [] }) {
  return [
    '---',
    `kind: ${kind}`,
    `target: ${target}`,
    `started: ${started}`,
    `old: ${old ?? ''}`,
    `new: ${next ?? ''}`,
    '---',
    '',
    `# Migration · ${kind} · ${target}`,
    '',
    `${KIND_WORDS[kind]}. Five stages, each ending at a gate you approve by writing \`approved: <date> by <name>\` under it,`,
    'or with `vibekit migrate approve <stage> --by "<name>"`. Nothing advances itself.',
    '',
    '## Understand',
    '',
    'What the old system is, read before anything moves: `understanding.md` in this folder. Correct it; everything below stands on it.',
    '',
    'approved:',
    '',
    '## Target',
    '',
    `What it becomes: ${target}. Write the target stack, the shape, and what is deliberately not carried across.`,
    '',
    'approved:',
    '',
    '## Characterise',
    '',
    'The characterisation suite pins the observable behaviour of the old system, so the new one can be held to it.',
    'Name it as a `characterise` line in the Commands block of `product/map.md`; `vibekit verify` runs it against the current slice.',
    '',
    'approved:',
    '',
    '## Plan',
    '',
    'The slices, as MIG-* requirements listed in `workflow/plan.md`, in an order that keeps both systems working throughout.',
    '',
    'approved:',
    '',
    '## Move',
    '',
    'One slice at a time: `vibekit migrate next` hands it out, `vibekit verify` proves it, `vibekit migrate shift <slice> <percent>` moves traffic.',
    '',
    '## Systems',
    '',
    'The two systems `verify` compares. Set with `vibekit migrate systems --old <url> --new <url>`; kept in the front matter above.',
    '',
    '## Slices',
    '',
    '| Slice | Verified | Traffic |',
    '| --- | --- | --- |',
    ...slices.map((slice) => `| ${slice.id} | ${slice.verified ?? ''} | ${slice.traffic ?? 0}% |`),
    '',
  ].join('\n');
}

export function parseMigration(text) {
  if (!text) return null;
  const meta = readFrontMatter(text);
  const approvals = {};
  for (const stage of STAGES) approvals[stage.key] = approvalOf(sectionOf(text, stage.title)) ?? null;
  const slices = [...sectionOf(text, 'Slices').matchAll(/^\|\s*((?:MIG|REQ)-[\w.-]+)\s*\|\s*([^|]*?)\s*\|\s*(\d+)%?\s*\|/gm)]
    .map((match) => ({ id: match[1], verified: match[2] || null, traffic: Number.parseInt(match[3], 10) || 0 }));
  return {
    kind: KINDS.includes(meta.kind) ? meta.kind : null,
    target: String(meta.target ?? '').trim() || null,
    started: meta.started ?? null,
    old: String(meta.old ?? '').trim() || null,
    new: String(meta.new ?? '').trim() || null,
    approvals,
    slices,
    text,
  };
}

export async function readMigration(root, folder = DEFAULT_FOLDER) {
  return parseMigration(await readText(migrationPath(root, folder)));
}

export async function startMigration(root, { kind, target, folder = DEFAULT_FOLDER, force = false, now = () => new Date() }) {
  if (!KINDS.includes(kind)) throw new Error(`"${kind}" is not a kind of migration. One of: ${KINDS.join(', ')}.`);
  if (!String(target ?? '').trim()) throw new Error(`Say what it moves to: vibekit migrate ${kind} "to .NET 10"`);
  const existing = await readMigration(root, folder);
  if (existing && !force) {
    if (existing.kind === kind && existing.target === target) return { ...existing, created: false };
    throw new Error(`A migration is already running here: ${existing.kind} · ${existing.target}. Finish it, or --force to replace the record (the slices and their approvals are kept).`);
  }
  const text = renderMigration({ kind, target: String(target).trim(), started: now().toISOString().slice(0, 10), old: existing?.old, next: existing?.new, slices: existing?.slices ?? [] });
  await writeAtomic(migrationPath(root, folder), text);
  return { ...parseMigration(text), created: true };
}

/** The line a human writes, written by the command a human runs. Refuses to approve twice. */
export async function approveStage(root, stageKey, { by, folder = DEFAULT_FOLDER, now = () => new Date() }) {
  const stage = STAGES.find((entry) => entry.key === String(stageKey).toLowerCase());
  if (!stage) throw new Error(`"${stageKey}" is not a migration stage. One of: ${STAGES.map((entry) => entry.key).join(', ')}.`);
  if (stage.key === 'move') throw new Error('The move stage has no approval line: it is done when every slice is verified and carrying the traffic.');
  const who = String(by ?? '').trim();
  if (!who) throw new Error('Approving a gate is a human decision: say who with --by "<name>".');
  const text = await readText(migrationPath(root, folder));
  if (text === null) throw new Error('No migration here. `vibekit migrate upgrade|replatform|decompose "<target>"` starts one.');
  const current = parseMigration(text);
  if (current.approvals[stage.key]) throw new Error(`${stage.title} is already approved by ${current.approvals[stage.key].by}.`);
  const line = `approved: ${now().toISOString().slice(0, 10)} by ${who}`;
  const pattern = new RegExp(`(^##\\s+${stage.title}\\s*$[\\s\\S]*?)^approved:[^\\n]*$`, 'm');
  if (!pattern.test(text)) throw new Error(`${stage.title} has no approval line in workflow/migration.md; add \`approved:\` under its heading.`);
  await writeAtomic(migrationPath(root, folder), text.replace(pattern, `$1${line}`));
  return { stage: stage.key, by: who, line };
}

export async function setSystems(root, { old = undefined, next = undefined }, folder = DEFAULT_FOLDER) {
  const text = await readText(migrationPath(root, folder));
  if (text === null) throw new Error('No migration here. `vibekit migrate upgrade|replatform|decompose "<target>"` starts one.');
  let updated = text;
  if (old !== undefined) updated = updated.replace(/^old:.*$/m, `old: ${old ?? ''}`);
  if (next !== undefined) updated = updated.replace(/^new:.*$/m, `new: ${next ?? ''}`);
  await writeAtomic(migrationPath(root, folder), updated);
  return parseMigration(updated);
}

/** Record a slice's verification or traffic in the table; a slice not yet listed is added. */
export async function setSlice(root, id, { verified = undefined, traffic = undefined }, folder = DEFAULT_FOLDER) {
  const text = await readText(migrationPath(root, folder));
  if (text === null) throw new Error('No migration here. `vibekit migrate upgrade|replatform|decompose "<target>"` starts one.');
  const current = parseMigration(text);
  const slice = current.slices.find((entry) => entry.id === id) ?? { id, verified: null, traffic: 0 };
  if (verified !== undefined) slice.verified = verified;
  if (traffic !== undefined) slice.traffic = traffic;
  const slices = current.slices.some((entry) => entry.id === id) ? current.slices.map((entry) => (entry.id === id ? slice : entry)) : [...current.slices, slice];
  const table = ['| Slice | Verified | Traffic |', '| --- | --- | --- |', ...slices.map((entry) => `| ${entry.id} | ${entry.verified ?? ''} | ${entry.traffic ?? 0}% |`)].join('\n');
  const updated = text.replace(/(^##\s+Slices\s*$\n\n?)[\s\S]*$/m, `$1${table}\n`);
  await writeAtomic(migrationPath(root, folder), updated);
  return slice;
}

// ---------------------------------------------------------------- the gates

/** Where each stage stands: the mechanical fact, then the line a human wrote. */
export async function migrationGates(root, folder = DEFAULT_FOLDER) {
  const migration = await readMigration(root, folder);
  if (!migration) return null;
  const [understood, requirements, plan, map] = await Promise.all([
    exists(join(root, folder, 'understanding.md')),
    listRequirements(root, folder),
    readText(join(root, folder, 'workflow/plan.md')),
    readText(join(root, folder, 'product/map.md')),
  ]);
  const differences = await readDifferences(root, folder);
  const slices = requirements.filter((entry) => entry.id.startsWith('MIG-'));
  const characterise = /^\s*characterise\s{2,}(?!TODO)\S/m.test(sectionOf(map ?? '', 'Commands'));
  const targetWritten = sectionOf(migration.text, 'Target').replace(/^approved:.*$/m, '').replace(/What it becomes:.*$/m, '').trim().length > 0;
  const planApproved = Boolean(approvalOf(plan)) || Boolean(migration.approvals.plan);
  const verifiedSlices = slices.filter((entry) => sliceVerified(entry, differences, migration));
  const traffic = migration.slices.reduce((sum, entry) => sum + entry.traffic, 0);
  const allMoved = slices.length > 0 && slices.every((entry) => entry.status === 'done') && verifiedSlices.length === slices.length && migration.slices.filter((entry) => entry.traffic >= 100).length === slices.length;

  const rows = [
    { key: 'understand', fact: understood, factWhy: understood ? 'understanding.md read' : 'not imported: vibekit new project --import . reads the code first', approved: migration.approvals.understand },
    { key: 'target', fact: targetWritten, factWhy: targetWritten ? 'target written' : 'the ## Target section says nothing beyond the one line', approved: migration.approvals.target },
    { key: 'characterise', fact: characterise, factWhy: characterise ? 'characterise command in map.md' : 'no `characterise` command in product/map.md', approved: migration.approvals.characterise },
    { key: 'plan', fact: slices.length > 0, factWhy: slices.length ? `${slices.length} slice(s) as MIG-* requirements` : 'no MIG-* requirements yet', approved: migration.approvals.plan ?? (slices.length && approvalOf(plan) ? approvalOf(plan) : null) },
    { key: 'move', fact: allMoved, factWhy: slices.length ? `${slices.filter((entry) => entry.status === 'done').length} of ${slices.length} moved · ${verifiedSlices.length} verified · ${Math.min(100, Math.round(traffic / Math.max(slices.length, 1)))}% of traffic` : 'nothing to move yet', approved: allMoved ? { by: 'the slices' } : null },
  ].map((row) => {
    const stage = STAGES.find((entry) => entry.key === row.key);
    const passed = row.key === 'move' ? row.fact : row.fact && Boolean(row.approved);
    return { ...row, title: stage.title, gate: stage.gate, passed, detail: passed ? (row.key === 'move' ? row.factWhy : `${row.factWhy} · approved by ${row.approved.by}`) : row.fact ? `${row.factWhy} · waiting for your approval` : row.factWhy };
  });
  const current = rows.find((row) => !row.passed) ?? null;
  const planGate = rows.find((row) => row.key === 'plan');
  return { migration, rows, current, slices, differences, planApproved: Boolean(planGate?.passed) || planApproved, verified: verifiedSlices.map((entry) => entry.id) };
}

/** A slice is verified when its evidence is green for a commit and no real difference stands against it. */
export function sliceVerified(requirement, differences, migration = null) {
  const parsed = parseEvidence(requirement.evidence ?? '');
  const green = parsed.exits.length > 0 && parsed.exits.every((exit) => exit.code === 0) && !parsed.dirty;
  const real = realDifferences(differences, requirement.id);
  const recorded = migration?.slices.find((entry) => entry.id === requirement.id)?.verified ?? null;
  return (green || Boolean(recorded)) && !real.length;
}

/** Why this slice may not be set done, beyond the ordinary definition of done. Empty for anything that is not a slice. */
export async function migrationBlockers(root, id, folder = DEFAULT_FOLDER) {
  if (!String(id).startsWith('MIG-')) return [];
  const differences = await readDifferences(root, folder);
  const real = realDifferences(differences, id);
  return real.map((difference) => `${difference.id} is a real difference between old and new (${difference.where}${difference.note ? `: ${difference.note}` : ''}). Resolve it, or triage it with \`vibekit verify triage ${difference.id} expected|tolerable\`.`);
}

// ---------------------------------------------------------------- differences

export function renderDifferences(rows) {
  return [
    '# Differences · old against new',
    '',
    'Every place the two systems disagreed, as `vibekit verify` found them. Triage each as **expected** (they differ on purpose),',
    '**tolerable** (nobody will act on it) or **real** (it must match). A new difference is real until a person says otherwise.',
    'A slice with an unresolved real difference cannot be marked done.',
    '',
    '| Id | Slice | Where | Kind | Note | Seen |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.id} | ${row.slice ?? ''} | ${cell(row.where)} | ${row.kind} | ${cell(row.note ?? '')} | ${row.seen ?? ''} |`),
    '',
  ].join('\n');
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function parseDifferences(text) {
  if (!text) return [];
  return [...String(text).matchAll(/^\|\s*(D-\d+)\s*\|\s*([^|]*?)\s*\|\s*((?:\\\||[^|])*?)\s*\|\s*(\w+)\s*\|\s*((?:\\\||[^|])*?)\s*\|\s*([^|]*?)\s*\|/gm)]
    .map((match) => ({ id: match[1], slice: match[2] || null, where: match[3].replace(/\\\|/g, '|'), kind: DIFFERENCE_KINDS.includes(match[4]) ? match[4] : 'real', note: match[5].replace(/\\\|/g, '|') || null, seen: match[6] || null }));
}

export const readDifferences = async (root, folder = DEFAULT_FOLDER) => parseDifferences(await readText(differencesPath(root, folder)));

export const realDifferences = (differences, slice = null) => differences.filter((entry) => entry.kind === 'real' && (!slice || entry.slice === slice));

/**
 * Add what a comparison found. A difference already recorded for the same slice and place keeps
 * its triage — a re-run must not turn an accepted difference back into a real one — and only
 * its note and date move.
 */
export async function recordDifferences(root, found, { folder = DEFAULT_FOLDER, now = () => new Date() } = {}) {
  const rows = await readDifferences(root, folder);
  const today = now().toISOString().slice(0, 10);
  const added = [];
  const updated = [];
  let next = rows.reduce((top, row) => Math.max(top, Number.parseInt(row.id.slice(2), 10) || 0), 0);
  for (const difference of found) {
    const existing = rows.find((row) => row.slice === (difference.slice ?? null) && row.where === difference.where);
    if (existing) { existing.note = difference.note ?? existing.note; existing.seen = today; updated.push(existing); continue; }
    next += 1;
    const row = { id: `D-${String(next).padStart(3, '0')}`, slice: difference.slice ?? null, where: difference.where, kind: 'real', note: difference.note ?? null, seen: today };
    rows.push(row);
    added.push(row);
  }
  if (added.length || updated.length) await writeAtomic(differencesPath(root, folder), renderDifferences(rows));
  return { added, updated, rows };
}

export async function triageDifference(root, id, kind, { note = null, folder = DEFAULT_FOLDER } = {}) {
  if (!DIFFERENCE_KINDS.includes(kind)) throw new Error(`"${kind}" is not a triage. One of: ${DIFFERENCE_KINDS.join(', ')}.`);
  const rows = await readDifferences(root, folder);
  const row = rows.find((entry) => entry.id.toLowerCase() === String(id).toLowerCase());
  if (!row) throw new Error(`No difference ${id}. \`vibekit verify --report\` lists them.`);
  row.kind = kind;
  if (note) row.note = note;
  await writeAtomic(differencesPath(root, folder), renderDifferences(rows));
  return row;
}

// ---------------------------------------------------------------- comparing

/** A body as something comparable: parsed JSON with keys sorted, else trimmed text. */
export function normaliseBody(text, { ignore = [] } = {}) {
  const raw = String(text ?? '');
  try {
    const stripped = (value) => {
      if (Array.isArray(value)) return value.map(stripped);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter((key) => !ignore.includes(key)).sort().map((key) => [key, stripped(value[key])]));
      return value;
    };
    return JSON.stringify(stripped(JSON.parse(raw)));
  } catch {
    return raw.replace(/\r\n/g, '\n').trim();
  }
}

/** Every way two responses to the same request disagree, in words a person can act on. */
export function compareResponses(request, old, next, { ignore = ['date', 'etag', 'x-request-id', 'server', 'set-cookie', 'content-length'], ignoreFields = [] } = {}) {
  const where = `${request.method ?? 'GET'} ${request.path}`;
  const found = [];
  if (old.status !== next.status) found.push({ where: `${where} status`, note: `${old.status} vs ${next.status}` });
  const oldBody = normaliseBody(old.body, { ignore: ignoreFields });
  const newBody = normaliseBody(next.body, { ignore: ignoreFields });
  if (oldBody !== newBody) found.push({ where: `${where} body`, note: firstDifference(oldBody, newBody) });
  const headers = (bag) => Object.fromEntries(Object.entries(bag ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]).filter(([key]) => !ignore.includes(key)));
  const oldHeaders = headers(old.headers);
  const newHeaders = headers(next.headers);
  for (const key of new Set([...Object.keys(oldHeaders), ...Object.keys(newHeaders)])) {
    if (oldHeaders[key] !== newHeaders[key]) found.push({ where: `${where} header ${key}`, note: `${oldHeaders[key] ?? 'absent'} vs ${newHeaders[key] ?? 'absent'}` });
  }
  return found;
}

function firstDifference(a, b) {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  const from = Math.max(0, at - 20);
  return `at ${at}: "${a.slice(from, at + 30)}" vs "${b.slice(from, at + 30)}"`.replace(/\s+/g, ' ');
}

/** Rows keyed by one field, compared field by field. Missing on one side is a difference too. */
export function compareData(oldRows, newRows, { key = 'id' } = {}) {
  const index = (rows) => new Map(rows.map((row) => [String(row?.[key] ?? ''), row]));
  const olds = index(oldRows);
  const news = index(newRows);
  const found = [];
  for (const [id, row] of olds) {
    const other = news.get(id);
    if (!other) { found.push({ where: `row ${key}=${id}`, note: 'in old, missing from new' }); continue; }
    for (const field of new Set([...Object.keys(row), ...Object.keys(other)])) {
      if (!sameValue(row[field], other[field])) found.push({ where: `row ${key}=${id} field ${field}`, note: `${JSON.stringify(row[field] ?? null)} vs ${JSON.stringify(other[field] ?? null)}` });
    }
  }
  for (const id of news.keys()) if (!olds.has(id)) found.push({ where: `row ${key}=${id}`, note: 'in new, missing from old' });
  return { found, oldCount: oldRows.length, newCount: newRows.length };
}

/** One export is JSON and the other CSV more often than not, so 1 and "1" are the same value; objects are compared by shape. */
const sameValue = (a, b) => {
  const scalar = (value) => value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
  if (scalar(a) && scalar(b)) return String(a ?? '') === String(b ?? '');
  return normaliseBody(JSON.stringify(a ?? null)) === normaliseBody(JSON.stringify(b ?? null));
};

/** A data export as rows: a JSON array, JSON lines, or CSV with a header. */
export function parseRows(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) return JSON.parse(raw);
  if (raw.startsWith('{')) return raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const [header, ...lines] = raw.split('\n');
  const keys = header.split(',').map((cell) => cell.trim());
  return lines.filter((line) => line.trim()).map((line) => Object.fromEntries(line.split(',').map((cell, at) => [keys[at], cell.trim()])));
}

/** A recorded traffic log as requests: JSON lines, or `METHOD /path` per line. */
export function parseTrafficLog(text) {
  const requests = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('{')) {
      const parsed = JSON.parse(line);
      if (parsed.path || parsed.url) requests.push({ method: String(parsed.method ?? 'GET').toUpperCase(), path: parsed.path ?? new URL(parsed.url, 'http://x').pathname + new URL(parsed.url, 'http://x').search, headers: parsed.headers ?? {}, body: parsed.body ?? null });
      continue;
    }
    const plain = line.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)(?:\s+(.*))?$/i);
    if (plain) requests.push({ method: plain[1].toUpperCase(), path: plain[2], headers: {}, body: plain[3] ?? null });
  }
  return requests;
}
