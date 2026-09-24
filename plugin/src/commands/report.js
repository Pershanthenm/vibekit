import { KINDS, assumptionReport, costForecast, renderReport, reportFor } from '../reports.js';
import { atCommit } from '../docs/arch/history.js';
import { writeText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit report`, `vibekit assumptions` and `vibekit plan --cost`.
 * Specification §48, §38 and §40.
 *
 * All three read files that had to be right anyway. Nothing here tracks its own state, which is
 * why a report from last month can be regenerated and will match (§48, `--at`).
 */

export async function report(options) {
  const { root, args, folder: chosen, all, at, out, json } = options;
  const folder = chosen ?? (await folderName(root));
  const wanted = all ? KINDS : args.filter((argument) => KINDS.includes(argument));

  if (!wanted.length) {
    throw new Error(`Usage: vibekit report <${KINDS.join(' | ')}> [--all] [--at <sha>] [--out <file>]`);
  }

  const build = async (tree) => {
    const made = [];
    for (const kind of wanted) made.push(await reportFor(kind)(tree, folder));
    return made;
  };
  // §48 — reports run on the folder as of any commit, so one from last month regenerates exactly.
  const reports = at ? await atCommit(root, at, (tree) => build(tree)) : await build(root);

  if (json) return void console.log(JSON.stringify(reports, null, 2));

  const text = reports.map((made) => renderReport(made, { folder })).join('\n---\n\n');
  if (out) {
    await writeText(out, text);
    console.log(`✔ ${out}`);
    return;
  }
  console.log(text);
}

/** §38 — each assumption with the number of requirements standing on it, sorted. */
export async function assumptions({ root, folder: chosen, json }) {
  const folder = chosen ?? (await folderName(root));
  const result = await assumptionReport(root, folder);

  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (!result.rows.length) {
    console.log(`No assumptions recorded in ${folder}/workflow/assumptions.md.`);
    console.log('  An unrecorded assumption is one nobody can measure the blast radius of.');
    return;
  }

  const width = Math.max(...result.rows.map((row) => row.id.length));
  for (const row of result.rows) {
    const bearing = `load-bearing for ${row.count} requirement${row.count === 1 ? '' : 's'}`;
    console.log(`${row.id.padEnd(width)}  ${row.text.slice(0, 44).padEnd(46)} confidence: ${row.confidence.padEnd(7)} ${bearing}${row.blocksPlan ? '   ← confirm before the next phase' : ''}`);
  }

  if (result.blocking.length) {
    console.log('');
    console.log(`${result.blocking.length} low-confidence assumption(s) are load-bearing for more than three requirements.`);
    console.log('  The plan gate refuses a phase in that state until each is confirmed or explicitly accepted as a risk.');
    process.exitCode = 1;
  }
  for (const id of result.undeclared) {
    console.log(`  ! a requirement assumes ${id}, which is not in workflow/assumptions.md`);
  }
}

/** §40 — the agent bill for a phase, before approving it. */
export async function plan(options) {
  const { root, folder: chosen, cost, json } = options;
  const folder = chosen ?? (await folderName(root));
  if (!cost) throw new Error('Usage: vibekit plan --cost   — the token forecast per requirement and per phase.');

  const forecast = await costForecast(root, folder);
  if (json) return void console.log(JSON.stringify(forecast, null, 2));

  if (!forecast.rows.length) {
    console.log('No requirements yet, so there is nothing to forecast.');
    return;
  }

  console.log('Per phase');
  for (const phase of forecast.phases) console.log(`  ${String(phase.phase).padEnd(10)} ${phase.estimate.toLocaleString().padStart(12)} tokens`);
  console.log(`  ${'total'.padEnd(10)} ${forecast.total.toLocaleString().padStart(12)} tokens`);

  console.log('');
  console.log('Most expensive requirements');
  for (const row of forecast.rows.slice(0, 8)) {
    console.log(`  ${row.id.padEnd(9)} ${(row.size ?? '-').padEnd(2)} ${row.estimate.toLocaleString().padStart(10)}  ${row.title.slice(0, 44)}`);
  }

  console.log('');
  console.log(forecast.learned.measured
    ? `  Per-role multiplier learned from ${forecast.learned.sessions} session(s) on this repo.`
    : '  No sessions recorded yet, so the multiplier is 1. This is a floor, not a prediction.');

  const capped = forecast.caps.filter((cap) => cap.tokens !== null);
  if (capped.length) {
    console.log('');
    for (const cap of capped) console.log(`  ${cap.key}: ${cap.tokens.toLocaleString()} tokens`);
  } else {
    console.log('  No cap is set in profile.md, so nothing stops a run that goes past this.');
  }
}
