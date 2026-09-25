import { runChecks } from '../folder/checks.js';
import { STALE_AFTER_DAYS, pause as pauseProject, resumeReport } from '../folder/pause.js';
import { folderName } from './folder.js';

/** `vibekit project stop` and `vibekit resume`. Specification §60. */

export async function pause({ root, folder: chosen, why, json }) {
  const folder = chosen ?? (await folderName(root));
  const result = await pauseProject(root, { reason: why ?? null, folder });

  if (json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`✔ paused · ${result.paused.length} requirement(s) set paused, holds released`);
  for (const id of result.paused) console.log(`    ${id}`);
  if (result.withoutCheckpoint.length) {
    console.log(`  ! no usable checkpoint: ${result.withoutCheckpoint.join(', ')} — their state will have to come out of the worktree`);
  }
  console.log('');
  console.log(`  The resume note is in ${folder}/workflow/status.md. Commit it: a checkpoint on disk only is not a handoff.`);
  console.log('  Next: vibekit distil, so what the sessions learned is not lost while the project is cold.');
}

export async function resume({ root, folder: chosen, json }) {
  const folder = chosen ?? (await folderName(root));
  const checks = await runChecks(root, { folder }).catch(() => null);
  const report = await resumeReport(root, { folder, checks });

  if (json) return void console.log(JSON.stringify(report, null, 2));

  if (!report.pausedAt && !report.requirements.length) {
    console.log('Nothing is paused. `vibekit run` is what you want.');
    return;
  }

  console.log(`Cold since ${report.pausedAt ?? 'an unrecorded date'}${report.coldDays === null ? '' : ` · ${report.coldDays} day(s)`}`);
  console.log('');
  console.log('Ground truth, re-established rather than trusted');
  for (const row of report.rows) {
    console.log(`  ${row.what.padEnd(42)} ${row.state}`);
    console.log(`  ${''.padEnd(42)} ${row.why}`);
  }

  if (report.requirements.length) {
    console.log('');
    console.log('Paused work');
    for (const requirement of report.requirements) {
      console.log(`  ${requirement.continues ? '→' : '!'} ${requirement.id} ${requirement.title}`);
      console.log(`    ${requirement.why}`);
      for (const path of requirement.reverted ?? []) {
        console.log(`    reverted: ${path} — a denied path changed under the session, which is not a judgement call`);
      }
    }
    console.log('');
    console.log('  A requirement whose checkpoint stands continues from `next:`; anything else re-plans from');
    console.log('  `## Approach`, which is cheap. Nothing still valid is re-planned.');
  }

  if (report.stale) {
    console.log('');
    console.log(`  ! ${report.coldDays} days is past the ${STALE_AFTER_DAYS}-day threshold. Run \`vibekit project import --refresh\` before resuming:`);
    console.log('    the code has probably moved under the plan.');
  }
}
