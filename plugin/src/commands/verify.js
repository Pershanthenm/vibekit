import { join, resolve } from 'node:path';
import { EVIDENCE_SUITES, heldRequirement, recordEvidence } from '../folder/evidence.js';
import { listRequirements } from '../folder/requirements.js';
import { gerund } from '../folder/sprints.js';
import { exists, readText } from '../fsutil.js';
import { DIFFERENCE_KINDS, compareData, migrationGates, parseRows, parseTrafficLog, readDifferences, readMigration, realDifferences, recordDifferences, setSlice, sliceVerified, triageDifference } from '../migration.js';
import { replay, shadow } from '../shadow.js';
import { folderName } from './folder.js';

/**
 * `vibekit verify`. Specification §55 and CLI Spec §2.
 *
 * Two jobs that share a word on purpose. For any requirement it runs the commands in map.md and
 * captures the exit codes into `## Evidence` — the only way work reaches the reviewer. For a
 * migration slice it is also the command that makes the migration honest:
 *
 *   verify                  the current slice, against the characterisation suite
 *   verify --live           shadow mode: real traffic to both, only the old is served
 *   verify --replay <log>   replay recorded traffic through both
 *   verify --data           compare old and new data after a data move
 *   verify --report         what is verified, what is not, what differs
 *   verify triage D-001 expected|tolerable|real
 *
 * Differences are triaged as expected, tolerable or real. A slice with an unresolved real
 * difference cannot be marked done, and traffic cannot be moved to a slice that is not verified.
 */
export async function verify(options) {
  const { root, args, json, folder: chosen } = options;
  const folder = chosen ?? (await folderName(root));
  const [first, ...rest] = args;

  if (first === 'triage') return triage(root, folder, rest, options);
  if (options.report) return report(root, folder, options);
  if (options.replay) return replayCommand(root, folder, options);
  if (options.live) return liveCommand(root, folder, options);
  if (options.data) return dataCommand(root, folder, options);

  if (!(await exists(join(root, folder, 'product/requirements')))) {
    throw new Error(`No ${folder}/product/requirements/ here. \`vibekit new project\` writes the folder; \`vibekit new feature\` writes a requirement.`);
  }

  const named = args.find((argument) => /^(?:REQ|MIG|BUG)-/i.test(argument));
  const id = named?.toUpperCase() ?? options.slice?.toUpperCase() ?? (await heldRequirement(root, folder));
  if (!id) {
    console.log('Nothing to verify: no requirement is named and none is held.');
    console.log('  vibekit verify REQ-001    records evidence for one requirement');
    console.log('  vibekit start REQ-001 --as implementer, then vibekit verify, records for the one you hold');
    return;
  }

  // A slice is held to one more suite than a feature: the characterisation suite, which pins
  // how the old system behaved. Without it, green tests prove the new code, not the migration.
  const slice = id.startsWith('MIG-');
  const result = await recordEvidence(root, id, { folder, suites: slice ? [...EVIDENCE_SUITES, 'characterise'] : EVIDENCE_SUITES });
  const differences = slice ? realDifferences(await readDifferences(root, folder), id) : [];
  const verified = slice && result.green && !result.dirty && !differences.length;
  if (verified) await setSlice(root, id, { verified: result.commit ? result.commit.slice(0, 7) : 'yes' }, folder).catch(() => {});

  if (json) return void console.log(JSON.stringify({ ...result, slice, realDifferences: differences.map((entry) => entry.id), verified }, null, 2));

  if (!result.ran) {
    console.log(`! Nothing ran: ${folder}/product/map.md names no build, test${slice ? ', characterise' : ''} or smoke command.`);
    console.log(`  ## Evidence was written saying so. \`${id}\` cannot reach tested until a command exists to prove it.`);
    process.exitCode = 1;
    return;
  }

  for (const entry of result.results) {
    console.log(`${entry.code === 0 ? '✔' : '✖'} ${entry.suite.padEnd(12)} ${entry.command}  exit ${entry.code}${entry.timedOut ? ' (timed out)' : ''}  ${entry.seconds}s`);
    if (entry.code !== 0) for (const line of String(entry.output).trim().split('\n').slice(-8)) console.log(`    ${line}`);
  }
  console.log('');
  console.log(`${result.green ? '✔' : '✖'} ## Evidence written to ${id}${result.commit ? ` for commit ${result.commit.slice(0, 7)}` : ''}${result.dirty ? ' · working tree dirty' : ''}`);
  if (result.dirty) console.log('  Evidence on a dirty tree describes files that were not committed. Commit, then run this again before tested.');
  if (slice && !result.commands.characterise) console.log('  ! No `characterise` command in map.md: the suite ran, but nothing pinned the old system\'s behaviour.');
  if (differences.length) {
    console.log(`  ✖ ${differences.length} real difference(s) stand against ${id}: ${differences.map((entry) => entry.id).join(', ')}. vibekit verify --report lists them.`);
    process.exitCode = 1;
  } else if (verified) console.log(`  ✔ ${id} is verified: the suite is green and no real difference stands. Traffic may move to it: vibekit migrate shift ${id} <percent>`);
  if (!result.green) process.exitCode = 1;
  else if (!slice) console.log(`  Next: vibekit req tested ${id}`);
}

// ---------------------------------------------------------------- the systems

/** The two systems a comparison needs: flags first, then the migration record. */
async function systemsFor(root, folder, options) {
  const migration = await readMigration(root, folder);
  const oldUrl = options.old ?? migration?.old ?? null;
  const newUrl = options.new ?? migration?.new ?? null;
  if (!oldUrl || !newUrl) throw new Error('Both systems are needed: --old <url> --new <url>, or record them once with vibekit migrate systems --old <url> --new <url>.');
  return { oldUrl, newUrl, slice: options.slice?.toUpperCase() ?? (await currentSlice(root, folder)) };
}

/** The slice a comparison is about: the one held, else the one in progress, else none. */
async function currentSlice(root, folder) {
  const held = await heldRequirement(root, folder);
  if (held?.startsWith('MIG-')) return held;
  const slices = (await listRequirements(root, folder)).filter((entry) => entry.id.startsWith('MIG-'));
  return slices.find((entry) => entry.status === 'in-progress')?.id ?? slices.find((entry) => !['done'].includes(entry.status))?.id ?? null;
}

async function recordAndReport(root, folder, found, options, { label }) {
  const outcome = await recordDifferences(root, found, { folder });
  const real = outcome.rows.filter((row) => row.kind === 'real' && found.some((entry) => entry.where === row.where && (entry.slice ?? null) === row.slice));
  if (!options.json) {
    console.log('');
    if (!found.length) console.log(`✔ ${label}: old and new agreed everywhere.`);
    else {
      console.log(`${real.length ? '✖' : '✔'} ${label}: ${found.length} difference(s) · ${outcome.added.length} new, ${outcome.updated.length} seen before · ${real.length} real`);
      for (const row of outcome.rows.filter((entry) => found.some((hit) => hit.where === entry.where)).slice(0, 12)) console.log(`    ${row.id}  ${row.kind.padEnd(9)} ${row.where}${row.note ? `  ${row.note}` : ''}`);
      console.log(`  Recorded in ${folder}/workflow/differences.md. Triage: vibekit verify triage <id> expected|tolerable|real`);
    }
  }
  if (real.length) process.exitCode = 1;
  return outcome;
}

// ---------------------------------------------------------------- --replay

async function replayCommand(root, folder, options) {
  const path = resolve(root, String(options.replay));
  const text = await readText(path);
  if (text === null) throw new Error(`${options.replay} is not readable. A log is JSON lines ({"method","path","body"}) or one \`METHOD /path\` per line.`);
  const requests = parseTrafficLog(text);
  if (!requests.length) throw new Error(`${options.replay} holds no requests this can replay.`);
  const { oldUrl, newUrl, slice } = await systemsFor(root, folder, options);
  const result = await replay(requests, { oldUrl, newUrl, allowPrivate: Boolean(options['allow-private']), slice });
  if (!options.json) {
    console.log(`Replayed ${result.sent} request(s) through old (${oldUrl}) and new (${newUrl})${slice ? ` for ${slice}` : ''}`);
    for (const row of result.rows.slice(0, 40)) console.log(`  ${row.differences ? '✖' : '✔'} ${row.request.padEnd(40)} old ${row.old} ${String(row.oldMs).padStart(4)}ms · new ${row.new} ${String(row.newMs).padStart(4)}ms${row.errors.length ? ` · ${row.errors.join('; ')}` : ''}`);
    if (result.rows.length > 40) console.log(`  … ${result.rows.length - 40} more`);
  }
  const outcome = await recordAndReport(root, folder, result.found, options, { label: 'replay' });
  if (options.json) console.log(JSON.stringify({ sent: result.sent, rows: result.rows, differences: outcome.rows.filter((row) => result.found.some((hit) => hit.where === row.where)) }, null, 2));
}

// ---------------------------------------------------------------- --live

async function liveCommand(root, folder, options) {
  const { oldUrl, newUrl, slice } = await systemsFor(root, folder, options);
  const port = Number.parseInt(options.port ?? '8787', 10) || 8787;
  if (options['dry-run']) {
    console.log(`shadow · would listen on 127.0.0.1:${port}, send every request to old (${oldUrl}) and new (${newUrl}), and serve the old answer${slice ? ` · differences recorded against ${slice}` : ''}`);
    console.log('  Nothing was started. Without --dry-run this serves until you stop it.');
    return;
  }
  const proxy = await shadow({
    oldUrl, newUrl, port, slice, allowPrivate: Boolean(options['allow-private']),
    onDifference: async (difference) => {
      const outcome = await recordDifferences(root, [difference], { folder });
      const row = outcome.added[0] ?? outcome.updated[0];
      if (row && !options.json) console.log(`  ${outcome.added.length ? 'new' : 'seen'} ${row.id}  ${row.kind.padEnd(9)} ${row.where}${row.note ? `  ${row.note}` : ''}`);
    },
  });
  console.log(`Shadow mode on http://127.0.0.1:${proxy.port} · old ${oldUrl} is served · new ${newUrl} is measured${slice ? ` · for ${slice}` : ''}`);
  console.log('  Point real traffic here. Every disagreement lands in workflow/differences.md as it happens. Ctrl-C stops it.');
  await new Promise((done) => {
    const stop = async () => { await proxy.close(); done(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  console.log(`  ${proxy.seen.requests} request(s) seen · ${proxy.seen.differences} difference(s). vibekit verify --report shows where they stand.`);
}

// ---------------------------------------------------------------- --data

async function dataCommand(root, folder, options) {
  const oldPath = options.old ? resolve(root, options.old) : null;
  const newPath = options.new ? resolve(root, options.new) : null;
  if (!oldPath || !newPath) throw new Error('Point this at the two exports: vibekit verify --data --old <file> --new <file> [--key id]. VibeKit reads exports (JSON, JSON lines or CSV); it does not connect to a database itself.');
  const [oldText, newText] = await Promise.all([readText(oldPath), readText(newPath)]);
  if (oldText === null) throw new Error(`${options.old} is not readable.`);
  if (newText === null) throw new Error(`${options.new} is not readable.`);
  const slice = options.slice?.toUpperCase() ?? (await currentSlice(root, folder));
  const compared = compareData(parseRows(oldText), parseRows(newText), { key: options.key ?? 'id' });
  if (!options.json) console.log(`Compared ${compared.oldCount} old row(s) with ${compared.newCount} new row(s) by ${options.key ?? 'id'}${slice ? ` for ${slice}` : ''}`);
  const outcome = await recordAndReport(root, folder, compared.found.map((entry) => ({ ...entry, slice })), options, { label: 'data' });
  if (options.json) console.log(JSON.stringify({ ...compared, differences: outcome.rows.filter((row) => compared.found.some((hit) => hit.where === row.where)) }, null, 2));
}

// ---------------------------------------------------------------- --report and triage

/** What is verified, what is not, what differs. */
export async function verificationReport(root, folder) {
  const gates = await migrationGates(root, folder);
  const differences = await readDifferences(root, folder);
  const slices = (gates?.slices ?? []).map((entry) => ({
    id: entry.id, title: entry.title, status: entry.status,
    verified: sliceVerified(entry, differences, gates?.migration ?? null),
    differences: differences.filter((difference) => difference.slice === entry.id).map(({ id, where, kind, note }) => ({ id, where, kind, note })),
  }));
  const unassigned = differences.filter((difference) => !difference.slice).map(({ id, where, kind, note }) => ({ id, where, kind, note }));
  return { migration: gates ? { kind: gates.migration.kind, target: gates.migration.target } : null, slices, unassigned, counts: Object.fromEntries(DIFFERENCE_KINDS.map((kind) => [kind, differences.filter((entry) => entry.kind === kind).length])) };
}

async function report(root, folder, options) {
  const view = await verificationReport(root, folder);
  if (options.json) return void console.log(JSON.stringify(view, null, 2));
  if (!view.migration && !view.unassigned.length) return void console.log('No migration here and no differences recorded. vibekit verify --replay <log> or --live compares two systems.');
  if (view.migration) console.log(`Verification · ${view.migration.kind} · ${view.migration.target}`);
  console.log('');
  for (const slice of view.slices) {
    const real = slice.differences.filter((entry) => entry.kind === 'real');
    console.log(`  ${slice.verified ? '✓' : real.length ? '✖' : '○'} ${gerund(slice.title).padEnd(40)} ${slice.verified ? 'verified' : real.length ? `${real.length} real difference${real.length === 1 ? '' : 's'}` : 'not verified'}${slice.status === 'done' ? ' · moved' : ''}`);
    for (const difference of slice.differences) console.log(`      ${difference.id}  ${difference.kind.padEnd(9)} ${difference.where}${difference.note ? `  ${difference.note}` : ''}`);
  }
  if (view.unassigned.length) {
    console.log('  Not tied to a slice');
    for (const difference of view.unassigned) console.log(`      ${difference.id}  ${difference.kind.padEnd(9)} ${difference.where}${difference.note ? `  ${difference.note}` : ''}`);
  }
  console.log('');
  console.log(`  ${view.counts.real} real · ${view.counts.tolerable} tolerable · ${view.counts.expected} expected`);
  if (view.counts.real) console.log('  A real difference blocks its slice: fix it, or vibekit verify triage <id> expected|tolerable with the reason.');
  else if (view.slices.some((slice) => !slice.verified)) console.log('  vibekit verify proves the slice in hand against the characterisation suite.');
}

async function triage(root, folder, rest, options) {
  const [id, kind] = rest;
  if (!id || !kind) throw new Error(`Usage: vibekit verify triage <D-id> <${DIFFERENCE_KINDS.join('|')}> [--why "<reason>"]`);
  const row = await triageDifference(root, id, String(kind).toLowerCase(), { note: options.why ?? null, folder });
  if (options.json) return void console.log(JSON.stringify(row, null, 2));
  console.log(`✔ ${row.id} is ${row.kind}${row.note ? ` · ${row.note}` : ''}`);
  if (row.kind === 'real') console.log(`  ${row.slice ?? 'its slice'} cannot be marked done while it stands.`);
}
