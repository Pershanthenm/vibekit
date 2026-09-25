import { join, resolve } from 'node:path';
import { openAsk } from '../folder/asks.js';
import { generateFolder } from '../folder/generate.js';
import { DEFAULT_FOLDER } from '../folder/layout.js';
import { CONVERSION, UNDERSTANDING_FILE, configFrom, refreshUnderstanding, renderUnderstanding, understandRepo } from '../understand.js';
import { exists, writeText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit project import <path or git url>`. Specification §58.
 *
 * The brownfield front door, and the only verb you use on somebody else's code. Read-only until
 * `--convert`: a tool that rewrote a repository while explaining it to you would never be run on
 * a repository that mattered.
 */

export async function understand(options) {
  const { root, args, folder: chosen, convert, refresh, json } = options;
  const folder = chosen ?? (await folderName(root));

  // A git URL is named as unsupported rather than silently treated as a path, which would
  // produce a confident report about an empty directory.
  const target = args.find((argument) => !argument.startsWith('-')) ?? '.';
  if (/^(https?:\/\/|git@)/.test(target)) {
    throw new Error(`Clone it first, then point at the checkout: ${target}\nReading a remote would mean fetching code before you have seen what this reads, and §58 is read-only for a reason.`);
  }
  const repo = resolve(root, target);
  if (!(await exists(repo))) throw new Error(`No such path: ${repo}`);

  if (refresh) return void (await reportRefresh(repo, root, folder, json));

  const understanding = await understandRepo(repo);
  const report = renderUnderstanding(understanding);

  if (json) return void console.log(JSON.stringify(understanding, null, 2));

  if (!convert) {
    // The report is written into the folder if there is one, and printed otherwise: on a repo
    // with no folder yet there is nowhere it belongs, and §58 is read-only until --convert.
    const hasFolder = await exists(join(root, folder));
    if (hasFolder) {
      await writeText(join(root, folder, UNDERSTANDING_FILE), report);
      console.log(`✔ ${folder}/${UNDERSTANDING_FILE}`);
      console.log('');
    }
    console.log(report);

    if (!hasFolder) {
      console.log('');
      console.log('Nothing was written: there is no folder yet, and this reads before it writes.');
      console.log('  Correct anything wrong above, then: vibekit new project --import .');
    } else {
      console.log('');
      console.log(`  Correct ${folder}/${UNDERSTANDING_FILE} — everything the folder is built from comes from it.`);
      console.log('  Then: vibekit new project --import .');
    }
    return;
  }

  await convertToFolder(root, repo, folder, understanding, report);
}

async function convertToFolder(root, repo, folder, understanding, report) {
  const name = understanding.root.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
  const config = configFrom(understanding, name);

  // Rules only: §58 converts into the folder and generates no application code.
  const result = await generateFolder(root, config, { folder, delivery: 'none' });
  await writeText(join(root, folder, UNDERSTANDING_FILE), report);

  console.log(`✔ ${result.folder}/ written from the understanding · ${result.written.length} file(s)`);
  for (const path of result.kept) console.log(`  · kept (yours) ${path}`);
  console.log('  rules-only: no application code was generated, and nothing in the existing repo was modified.');

  console.log('');
  console.log('What came from where');
  for (const [from, to] of CONVERSION) console.log(`  ${from.padEnd(20)} → ${to}`);

  const raised = [];
  for (const ask of understanding.asks) {
    const opened = await openAsk(root, { ask: ask.ask, plain: ask.plain }, folder).catch(() => null);
    if (opened) raised.push(`${opened.id}  ${ask.plain}`);
  }
  if (raised.length) {
    console.log('');
    console.log(`${raised.length} ask(s) — only what the code could not answer:`);
    for (const line of raised) console.log(`  ${line}`);
  }

  console.log('');
  console.log('  Next: vibekit check must be green before any agent starts.');
  console.log('  Then vibekit run continues at the plan stage; the first requirements are usually the gaps above.');
}

async function reportRefresh(repo, root, folder, json) {
  const result = await refreshUnderstanding(repo, folder);
  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (result.first) {
    console.log(`No ${folder}/${UNDERSTANDING_FILE} to compare against yet. Run \`vibekit project import .\` first.`);
    return;
  }
  if (!result.changes.length) {
    console.log('✔ The code still matches the understanding.');
    return;
  }
  console.log(`${result.changes.length} thing(s) changed since the understanding was written:`);
  for (const change of result.changes) console.log(`  ! ${change}`);
  console.log('');
  console.log(`  Update ${folder}/${UNDERSTANDING_FILE}, then re-run \`vibekit check\`.`);
}

export { DEFAULT_FOLDER };
