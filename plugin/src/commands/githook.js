import { readFile } from 'node:fs/promises';
import { HOOK_NAMES, commitMsg, installHooks, postMerge, preCommit, prePush } from '../githooks.js';
import { folderName } from './folder.js';

/**
 * `vibekit githook <name>` — the entry point the four scripts in .githooks/ call. §50.
 *
 * Prints every refusal and exits 1 so git stops. The scripts never change; the rules live in one
 * module and a fix there reaches every clone on its next pull.
 */
export async function githook({ root, args, folder: chosen }) {
  const folder = chosen ?? (await folderName(root));
  const [name, ...rest] = args;

  if (name === 'install') {
    const result = await installHooks(root);
    if (result.skipped) return void console.log(`Not installed: ${result.skipped}.`);
    console.log(`✔ ${result.installed.length} hook(s) in ${result.hooksPath}/ · core.hooksPath set`);
    for (const kept of result.kept ?? []) console.log(`  · kept (yours) ${result.hooksPath}/${kept}`);
    return;
  }
  if (!HOOK_NAMES.includes(name)) throw new Error(`Usage: vibekit githook <${HOOK_NAMES.join(' | ')} | install>`);

  let refusals = [];
  if (name === 'pre-commit') refusals = await preCommit(root, { folder });
  if (name === 'commit-msg') refusals = await commitMsg(root, await readFile(rest[0], 'utf8').catch(() => ''), { folder });
  if (name === 'pre-push') {
    const stdin = process.stdin.isTTY ? '' : await new Promise((done) => { let text = ''; process.stdin.on('data', (chunk) => (text += chunk)); process.stdin.on('end', () => done(text)); });
    refusals = await prePush(root, stdin, { folder });
  }
  if (name === 'post-merge') {
    const { regenerated } = await postMerge(root, { folder });
    for (const path of regenerated) console.log(`✔ regenerated ${path}`);
    return;
  }

  if (!refusals.length) return;
  console.error(`✖ ${name}: ${refusals.length} thing(s) stop this commit`);
  for (const why of refusals) console.error(`  - ${why}`);
  process.exitCode = 1;
}
