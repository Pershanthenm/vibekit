import { chainFor, renderChain, renderMatrix, traceMatrix } from '../why.js';
import { atCommit } from '../docs/arch/history.js';
import { folderName } from './folder.js';

/**
 * `vibekit why` and `vibekit trace`. Specification §36 and §50.
 *
 * Both walk the same links, because §50 says the matrix "is not a document anyone maintains; it
 * is `vibekit why` run across the folder". Two implementations would eventually disagree about
 * whether a chain was complete, which is the one thing a matrix is for.
 */

export async function why(options) {
  const { root, args, folder: chosen, at, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [target] = args.filter((argument) => !argument.startsWith('-'));
  if (!target) throw new Error('Usage: vibekit why <path>[:<line>]   — what asked for this line.');

  const [path, line] = target.split(':');
  const lineNumber = Number.parseInt(line ?? '', 10) || null;

  // §37 — reports and `why` accept `--at`, so any past state can be reproduced.
  const chain = at
    ? await atCommit(root, at, (tree) => chainFor(tree, path, { folder, line: lineNumber }))
    : await chainFor(root, path, { folder, line: lineNumber });

  if (json) return void console.log(JSON.stringify(chain, null, 2));
  console.log(renderChain(chain));

  if (!chain.requirement) process.exitCode = 1;
}

export async function trace(options) {
  const { root, folder: chosen, matrix, all, at, json } = options;
  const folder = chosen ?? (await folderName(root));

  const built = at
    ? await atCommit(root, at, (tree) => traceMatrix(tree, { folder, all }))
    : await traceMatrix(root, { folder, all });

  if (json) return void console.log(JSON.stringify(built, null, 2));

  if (!built.rows.length) {
    console.log(all
      ? 'No requirements yet, so there is nothing to trace.'
      : 'No requirement is done yet. `vibekit trace --matrix --all` shows the ones in flight too.');
    return;
  }

  if (matrix) console.log(renderMatrix(built));
  else {
    for (const row of built.rows) {
      console.log(`${row.requirement} ${row.criterion ?? '—'}  ${row.source ?? 'no source'}  →  ${row.test ?? 'not proved'}`);
    }
  }

  console.log('');
  if (built.complete) {
    console.log(`✔ ${built.rows.length} link(s), every one complete.`);
    return;
  }

  console.log(`! ${built.broken.length} of ${built.rows.length} link(s) are broken:`);
  for (const row of built.broken.slice(0, 12)) {
    const missing = [
      !row.source ? 'no source cited' : null,
      row.source && !row.sourceOk ? `${row.source} is not a section in product/sources/` : null,
      !row.criterion ? 'no acceptance criterion' : null,
      row.criterion && !row.test ? `${row.criterion} has no test` : null,
      !row.commit ? 'never committed' : null,
    ].filter(Boolean);
    console.log(`  ${row.requirement}  ${missing.join(' · ')}`);
  }
  console.log('');
  console.log('  A broken link is shown rather than dropped: a matrix that omits what it cannot complete always looks full.');
  process.exitCode = 1;
}
