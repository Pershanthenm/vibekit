import { join } from 'node:path';
import { heldRequirement, recordEvidence } from '../folder/evidence.js';
import { exists } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit verify`. Specification §55 (Claims are evidence, not statements).
 *
 * Runs the commands in map.md, captures the exit codes into the requirement's `## Evidence`, and
 * says whether it is green. `status: tested` is refused without an evidence block whose sha
 * matches HEAD, so this is the only way work reaches the reviewer.
 */
export async function verify({ root, args, json, folder: chosen }) {
  const folder = chosen ?? (await folderName(root));
  if (!(await exists(join(root, folder, 'product/requirements')))) {
    throw new Error(`No ${folder}/product/requirements/ here. \`vibekit init\` writes the folder; \`vibekit add\` writes a requirement.`);
  }

  const named = args.find((argument) => /^(?:REQ|MIG|BUG)-/i.test(argument));
  const id = named?.toUpperCase() ?? (await heldRequirement(root, folder));
  if (!id) {
    console.log('Nothing to verify: no requirement is named and none is held.');
    console.log('  vibekit verify REQ-001    records evidence for one requirement');
    console.log('  vibekit start REQ-001 --as implementer, then vibekit verify, records for the one you hold');
    return;
  }

  const result = await recordEvidence(root, id, { folder });
  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (!result.ran) {
    console.log(`! Nothing ran: ${folder}/product/map.md names no build, test or smoke command.`);
    console.log(`  ## Evidence was written saying so. \`${id}\` cannot reach tested until a command exists to prove it.`);
    process.exitCode = 1;
    return;
  }

  for (const entry of result.results) {
    console.log(`${entry.code === 0 ? '✔' : '✖'} ${entry.suite.padEnd(6)} ${entry.command}  exit ${entry.code}${entry.timedOut ? ' (timed out)' : ''}  ${entry.seconds}s`);
    if (entry.code !== 0) for (const line of String(entry.output).trim().split('\n').slice(-8)) console.log(`    ${line}`);
  }
  console.log('');
  console.log(`${result.green ? '✔' : '✖'} ## Evidence written to ${id}${result.commit ? ` for commit ${result.commit.slice(0, 7)}` : ''}${result.dirty ? ' · working tree dirty' : ''}`);
  if (result.dirty) console.log('  Evidence on a dirty tree describes files that were not committed. Commit, then run this again before tested.');
  if (!result.green) process.exitCode = 1;
  else console.log(`  Next: vibekit req tested ${id}`);
}
