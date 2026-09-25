import { join } from 'node:path';
import { listRequirements, readTasksState } from '../folder/requirements.js';
import { gerund } from '../folder/sprints.js';
import { exists } from '../fsutil.js';
import { KINDS, STAGES, approveStage, migrationGates, readMigration, setSlice, setSystems, sliceVerified, startMigration } from '../migration.js';
import { folderName, req } from './folder.js';

/**
 * `vibekit migrate`. CLI Spec §2.
 *
 *   migrate upgrade "to .NET 10"          same stack, newer versions
 *   migrate replatform "to .NET and Vue"  different stack
 *   migrate decompose "into modules"      split what is there
 *   migrate status                        where the migration is
 *   migrate next                          move the next slice
 *
 * "All three run the same stages — understand, target, characterise, plan, move — each ending
 * at a gate you approve." It is a verb of its own because a migration is a mode a project is in
 * for weeks, not a task you run. Run it inside a project that has been imported.
 */

export function migrateUsage() {
  return [
    '',
    '  migrate upgrade      same stack, newer versions',
    '  migrate replatform   a different stack',
    '  migrate decompose    split a monolith into modules',
    '  migrate status       where the migration is',
    '  migrate next         move the next slice',
    '',
    '  Run this inside a project you have imported: vibekit new project --import .',
    '',
  ].join('\n');
}

export async function migrate(options) {
  const { root, args, json } = options;
  const folder = options.folder ?? (await folderName(root));
  const [noun, ...rest] = args;

  if (!noun) {
    console.log(migrateUsage());
    const current = await migrationGates(root, folder).catch(() => null);
    if (current && !json) console.log(`  Here: ${current.migration.kind} · ${current.migration.target} · ${current.current ? `at ${current.current.title.toLowerCase()}` : 'every slice moved'}`);
    return;
  }
  if (KINDS.includes(noun)) return start(root, folder, noun, rest.join(' ').trim(), options);
  if (noun === 'status') return status(root, folder, options);
  if (noun === 'next') return next(root, folder, options);
  if (noun === 'shift') return shift(root, folder, rest, options);
  if (noun === 'approve') return approve(root, folder, rest, options);
  if (noun === 'systems') return systems(root, folder, options);
  throw new Error(`"${noun}" is not something migrate does.\n${migrateUsage()}`);
}

// ---------------------------------------------------------------- start

async function start(root, folder, kind, target, options) {
  const imported = await exists(join(root, folder, 'understanding.md'));
  if (!imported && !options.force) {
    throw new Error([
      'This project has not been imported, so there is nothing to migrate from.',
      '  vibekit new project --import .    reads the code and explains it back; correct it, then migrate',
      '  --force starts the record anyway, and the understand gate will say what is missing.',
    ].join('\n'));
  }
  const record = await startMigration(root, { kind, target, folder, force: Boolean(options.force) });
  if (options.json) return void console.log(JSON.stringify({ kind: record.kind, target: record.target, started: record.started, created: record.created }, null, 2));
  console.log(record.created ? `✔ ${folder}/workflow/migration.md · ${kind} · ${target}` : `Already running: ${kind} · ${target}`);
  console.log('');
  await status(root, folder, { ...options, json: false });
}

// ---------------------------------------------------------------- status

/** Where the migration is: five stages, then the slices — moved, verified, traffic shifted. */
export async function migrationView(root, folder) {
  const gates = await migrationGates(root, folder);
  if (!gates) return null;
  const { held } = await readTasksState(root, folder);
  const slices = gates.slices.map((entry) => {
    const record = gates.migration.slices.find((row) => row.id === entry.id) ?? { verified: null, traffic: 0 };
    const verified = sliceVerified(entry, gates.differences, gates.migration);
    const real = gates.differences.filter((difference) => difference.kind === 'real' && difference.slice === entry.id).length;
    return { id: entry.id, title: entry.title, status: entry.status, moved: entry.status === 'done', held: Boolean(held[entry.id]), verified, verifiedAt: record.verified, traffic: record.traffic, realDifferences: real };
  });
  return {
    kind: gates.migration.kind, target: gates.migration.target, started: gates.migration.started,
    systems: { old: gates.migration.old, new: gates.migration.new },
    stages: gates.rows.map((row) => ({ key: row.key, title: row.title, passed: row.passed, detail: row.detail })),
    current: gates.current ? gates.current.key : null,
    slices,
    moved: slices.filter((entry) => entry.moved).length, verified: slices.filter((entry) => entry.verified).length,
    traffic: slices.length ? Math.round(slices.reduce((sum, entry) => sum + entry.traffic, 0) / slices.length) : 0,
  };
}

async function status(root, folder, options) {
  const view = await migrationView(root, folder);
  if (!view) {
    if (options.json) return void console.log('null');
    console.log('No migration here.');
    console.log(migrateUsage());
    return;
  }
  if (options.json) return void console.log(JSON.stringify(view, null, 2));
  console.log(`Migration · ${view.kind} · ${view.target} · since ${view.started}`);
  console.log('');
  for (const stage of view.stages) console.log(`  ${stage.passed ? '✓' : stage.key === view.current ? '▶' : '○'} ${stage.title.padEnd(14)} ${stage.detail}`);
  if (view.slices.length) {
    console.log('');
    console.log(`  Slices · ${view.moved} of ${view.slices.length} moved · ${view.verified} verified · ${view.traffic}% of traffic shifted`);
    for (const slice of view.slices) {
      const state = slice.moved ? 'moved' : slice.held ? 'moving' : slice.status === 'blocked' ? 'waiting on your answer' : slice.status;
      const proof = slice.realDifferences ? `${slice.realDifferences} real difference${slice.realDifferences === 1 ? '' : 's'}` : slice.verified ? 'verified' : 'not verified';
      console.log(`    ${slice.moved ? '✓' : slice.held ? '▶' : '○'} ${gerund(slice.title).padEnd(40)} ${state} · ${proof} · ${slice.traffic}% traffic`);
    }
  }
  console.log('');
  const stage = view.stages.find((entry) => entry.key === view.current);
  if (!stage) console.log('  Every slice is moved, verified and carrying the traffic. vibekit ship release is next.');
  else if (stage.key === 'move') {
    const nextSlice = view.slices.find((entry) => !entry.moved && !entry.held);
    console.log(nextSlice ? `  vibekit migrate next            move ${gerund(nextSlice.title).toLowerCase()}` : '  vibekit verify                  prove the slice in hand');
    console.log('  vibekit migrate shift <slice> <percent>    move traffic to a verified slice');
  } else if (stage.detail.includes('waiting for your approval')) console.log(`  vibekit migrate approve ${stage.key} --by "<your name>"    ${stage.title} is ready for you`);
  else console.log(`  ${stageHint(stage.key)}`);
}

const stageHint = (key) => ({
  understand: 'vibekit new project --import .    read the code first',
  target: 'write the ## Target section in workflow/migration.md, then approve it',
  characterise: 'add a `characterise` command to product/map.md and a suite that pins the old behaviour, then approve it',
  plan: 'vibekit new feature "<slice>" with kind MIG, list the slices in workflow/plan.md, then vibekit plan project --approve',
}[key] ?? '');

// ---------------------------------------------------------------- next

/** The next slice whose dependencies are done, handed out exactly as a sprint lane is. */
async function next(root, folder, options) {
  const gates = await migrationGates(root, folder);
  if (!gates) throw new Error(`No migration here.\n${migrateUsage()}`);
  // Every gate before "move" is a person's decision; nothing moves until each is approved.
  const pending = gates.rows.find((row) => row.key !== 'move' && !row.passed);
  if (pending) throw new Error(`Nothing moves before the plan is approved${pending.key === 'plan' ? '' : `, and before it ${pending.title.toLowerCase()} is`}. ${pending.title}: ${pending.detail}.`);
  const requirements = await listRequirements(root, folder);
  const { held } = await readTasksState(root, folder);
  const candidate = gates.slices.find((entry) => entry.status === 'ready' && !held[entry.id] && entry.after.every((id) => requirements.find((other) => other.id === id)?.status === 'done'));
  if (!candidate) {
    const inHand = gates.slices.find((entry) => held[entry.id]);
    if (options.json) return void console.log(JSON.stringify({ started: null, inHand: inHand?.id ?? null }, null, 2));
    console.log(inHand ? `${gerund(inHand.title)} is in hand. vibekit verify proves it; then a reviewer, then a person sets done.` : 'No slice is ready. vibekit migrate status says why.');
    return;
  }
  const original = console.log;
  if (options.json) console.log = () => {};
  try {
    await req({ ...options, args: ['start', candidate.id], as: 'implementer', runner: options.runner ?? 'cli', folder, json: false });
  } finally {
    console.log = original;
  }
  if (options.json) return void console.log(JSON.stringify({ started: candidate.id, title: candidate.title, prompt: `${folder}/workflow/stages/5-build.md` }, null, 2));
  console.log(`  prompt: ${folder}/workflow/stages/5-build.md · when it is built: vibekit verify`);
}

// ---------------------------------------------------------------- shift

/** Traffic cannot be moved to a slice that is not verified. */
async function shift(root, folder, rest, options) {
  const [id, percentText] = rest;
  const percent = Number.parseInt(percentText ?? '', 10);
  if (!id || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Usage: vibekit migrate shift <slice> <percent>   — e.g. vibekit migrate shift MIG-002 25');
  const gates = await migrationGates(root, folder);
  if (!gates) throw new Error(`No migration here.\n${migrateUsage()}`);
  const slice = gates.slices.find((entry) => entry.id.toLowerCase() === id.toLowerCase());
  if (!slice) throw new Error(`No slice ${id}. Slices are MIG-* requirements: ${gates.slices.map((entry) => entry.id).join(', ') || 'none yet'}.`);
  if (percent > 0 && !sliceVerified(slice, gates.differences, gates.migration)) {
    const real = gates.differences.filter((difference) => difference.kind === 'real' && difference.slice === slice.id);
    throw new Error(real.length
      ? `${slice.id} has ${real.length} real difference(s) against the old system; traffic cannot move to it. vibekit verify --report lists them.`
      : `${slice.id} is not verified; traffic cannot move to it. vibekit verify proves it against the characterisation suite first.`);
  }
  const record = await setSlice(root, slice.id, { traffic: percent }, folder);
  if (options.json) return void console.log(JSON.stringify(record, null, 2));
  console.log(`✔ ${gerund(slice.title)} now carries ${percent}% of the traffic`);
  console.log('  Moving the traffic itself is your gateway or router\'s job; this records the decision where the plan can see it.');
}

// ---------------------------------------------------------------- approve, systems

async function approve(root, folder, rest, options) {
  const [stage] = rest;
  if (!stage) throw new Error(`Usage: vibekit migrate approve <${STAGES.slice(0, 4).map((entry) => entry.key).join('|')}> --by "<name>"`);
  const gates = await migrationGates(root, folder);
  if (!gates) throw new Error(`No migration here.\n${migrateUsage()}`);
  const row = gates.rows.find((entry) => entry.key === String(stage).toLowerCase());
  if (row && !row.fact && !options.force) throw new Error(`${row.title} is not ready to approve: ${row.factWhy}. An approval over a missing fact would be a sentence, not a decision (--force records it anyway).`);
  const result = await approveStage(root, stage, { by: options.by, folder });
  if (options.json) return void console.log(JSON.stringify(result, null, 2));
  console.log(`✔ ${result.stage} approved by ${result.by}`);
  const after = await migrationGates(root, folder);
  console.log(after.current ? `  Next: ${after.current.title.toLowerCase()} — ${after.current.detail}` : '  Every gate is open.');
}

async function systems(root, folder, options) {
  if (options.old === undefined && options.new === undefined) {
    const current = await readMigration(root, folder);
    if (!current) throw new Error(`No migration here.\n${migrateUsage()}`);
    if (options.json) return void console.log(JSON.stringify({ old: current.old, new: current.new }, null, 2));
    console.log(`  old  ${current.old ?? 'not set'}`);
    console.log(`  new  ${current.new ?? 'not set'}`);
    console.log('  vibekit migrate systems --old <url> --new <url>');
    return;
  }
  const record = await setSystems(root, { old: options.old, next: options.new }, folder);
  if (options.json) return void console.log(JSON.stringify({ old: record.old, new: record.new }, null, 2));
  console.log(`✔ old ${record.old ?? 'not set'} · new ${record.new ?? 'not set'} — what vibekit verify compares`);
}
