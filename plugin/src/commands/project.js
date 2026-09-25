import { basename, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { exists, readText } from '../fsutil.js';
import { createAsker } from '../menu.js';
import { PROJECT_FILE, loadProject, saveProject } from '../project.js';
import { normalize } from '../schema.js';
import { MARKS, forget, listProjects, readRegistry, register, rescan, timeAgo } from '../projects.js';
import { folderName, init as folderInit } from './folder.js';
import { pause, resume as resumeProject } from './pause.js';
import { understand } from './understand.js';

/**
 * `vibekit project`. Specification §67.
 *
 *   project new        start something: name it, say where it lives, say what you want
 *   project select     your projects with their state; pick one
 *   project status     where this project is, or every project in one screen
 *   project import     read an existing codebase and convert it
 *   project assess     should this be built at all (the `assess` extension)
 *   project stop       stop cleanly · project resume: start again, re-checking the ground first
 */

export const PLATFORMS = Object.freeze([
  { id: 'web', label: 'Web browser' }, { id: 'ios', label: 'iOS' }, { id: 'android', label: 'Android' },
  { id: 'desktop', label: 'Desktop' }, { id: 'api', label: 'API only' }, { id: 'cli', label: 'Command line' }, { id: 'other', label: 'Something else' },
]);

const usage = () => [
  'Usage',
  '  vibekit project new [--name <n>] [--describe "<text>" | --from <file>] [--platform web,api] [--yes]',
  '  vibekit project select [<name>] [--needs-me] [--last] [--rescan <dir>] [--forget <name>]',
  '  vibekit project status [--all]',
  '  vibekit project import <path or git url> [--convert | --refresh | --speckit]',
  '  vibekit project assess "<idea>"',
  '  vibekit project stop [--reason "<why>"]   ·   vibekit project resume',
].join('\n');

export async function project(options) {
  const [verb, ...rest] = options.args;
  if (verb === 'new') return projectNew({ ...options, args: rest });
  if (verb === 'select') return select({ ...options, args: rest });
  if (verb === 'status') return status({ ...options, args: rest });
  if (verb === 'import') return understand({ ...options, args: rest });
  if (verb === 'assess') return assess({ ...options, args: rest });
  if (verb === 'stop') return stop({ ...options, args: rest });
  if (verb === 'resume') return resumeProject({ ...options, args: rest });
  if (verb) throw new Error(`"${verb}" is not something a project does.\n${usage()}`);
  console.log(usage());
}

/** `vibekit stop` — §60's project-level pause, under the name §67 gives it. */
export const stop = (options) => pause({ ...options, why: options.why ?? options.reason ?? null });

// ---------------------------------------------------------------- project new

/**
 * The wizard, in a terminal. Each answer is written before the next question, so a person who
 * stops half-way has a folder and not a lost conversation. `--yes` with `--name`/`--describe`
 * answers everything from flags, which is what a script and a test need.
 */
async function projectNew(options) {
  const { root, yes, json } = options;
  const asker = yes ? null : createAsker();
  try {
    // CLI Spec §2 — `new project "Hello World"`: the name is the first thing after the noun.
    const typed = (options.args ?? []).join(' ').trim() || null;
    const name = options.name ?? typed ?? (asker ? await asker.text('Project name', basename(root)) : basename(root));
    // The name becomes a folder under `--where local`; one that climbs or hides is not a name.
    if (!/^[\w][\w .-]{0,79}$/.test(name) || name.split(/[\\/]/).length > 1) throw new Error(`"${name}" is not a project name: letters, digits, dots, dashes and spaces, no slashes.`);
    // What it is and where it runs come before where the folder goes: a person thinks about the
    // product first and the filing second, and the repository question comes last, once there is
    // something to put in it.
    let describe = options.describe ?? null;
    // Three ways to say what it is: a sentence, a document, or — for the person with neither — a
    // requirements document built from eight questions once the folder exists.
    let buildBrs = Boolean(options.answer?.length);
    if (!describe && !options.from && asker) {
      const how = await asker.choose({ id: 'source', title: 'What are you building?', noOther: true, options: [
        { id: 'describe', label: 'a sentence or two — the analyst asks the rest' },
        { id: 'brs', label: 'build a requirements document with me — eight questions, in your words' },
        { id: 'file', label: 'I have a requirements document' },
      ] });
      if (how === 'brs') buildBrs = true;
      else describe = await asker.text(how === 'file' ? 'Path to the document' : 'What are you building? A sentence or two');
    }
    const fromFile = options.from ?? (describe && (await exists(resolve(root, describe))) ? resolve(root, describe) : null);
    const platforms = options.platform
      ? String(options.platform).split(',').map((item) => item.trim()).filter(Boolean)
      : asker ? [await asker.choose({ id: 'platform', title: 'Where does it run?', multi: true, noOther: true, options: PLATFORMS })].flat() : ['web'];

    const { readConfig } = await import('../prompts.js');
    const machine = await readConfig();
    const where = options.where ?? (asker ? await asker.choose({ id: 'where', title: 'Where does it live?', noOther: true, options: [
      { id: 'here', label: 'this folder' }, { id: 'local', label: machine['projects-root'] ? `a new folder in ${machine['projects-root']}` : 'a new folder beside this one' },
    ] }) : 'here');
    // `--where local`: under the projects folder setup recorded, or beside the current one. `--where remote` (older scripts) means: here, and create the repository.
    const target = where === 'local' ? resolve(machine['projects-root'] ?? root, name) : root;
    if (where === 'local') await mkdir(target, { recursive: true });
    if (!(await exists(join(target, '.git')))) {
      try { execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target, stdio: 'ignore' }); } catch { /* no git: the folder is still written */ }
    }

    // The config the folder is generated from. Platform is asked here because it changes the
    // architecture, the test kinds and whether a design stage exists at all.
    const existing = await loadProject(target).catch(() => null);
    const projectConfig = normalize({
      ...(existing ?? {}),
      project: { ...(existing?.project ?? {}), name, description: fromFile ? existing?.project?.description ?? null : describe ?? null, platforms },
    });
    await saveProject(target, projectConfig);
    if (!json) console.log(`✔ ${PROJECT_FILE} written · ${name} · ${platforms.join(', ')}`);

    await folderInit({ ...options, root: target, yes: true, args: [], 'no-tour': true });
    await register(target, { name });

    // The source of record: the document, or the words a person typed, verbatim.
    const folder = await folderName(target);
    const { ingest } = await import('./ingest.js');
    if (buildBrs) {
      const { newBrs } = await import('./brs.js');
      await newBrs({ ...options, root: target, asker, json: false, from: undefined });
    } else if (fromFile) {
      await ingest({ ...options, root: target, folder, args: [fromFile], yes: true });
    } else if (describe) {
      const path = join(target, folder, 'product/sources/DESC-001/source.md');
      await mkdir(join(target, folder, 'product/sources/DESC-001'), { recursive: true });
      await writeFile(path, `<!-- DESC-001 · typed at project new · never loaded by an agent -->\n# ${name}\n\n${describe.trim()}\n`);
      if (!json) console.log(`✔ ${folder}/product/sources/DESC-001/source.md — what you said, kept verbatim`);
    }

    // Where you are, from now on: this project. Machine settings, never the folder.
    const { setCurrentProject } = await import('../current.js');
    await setCurrentProject(target, { name }).catch(() => {});

    // `--where remote`: the repository at the provider, the pipeline file, the first push. A
    // failure here is reported and leaves the folder intact; `vibekit new repo` retries it.
    await repositoryStep({ ...options, root: target, where, machine, asker, json });

    const { next } = await import('./folder.js');
    if (json) return void console.log(JSON.stringify({ root: target, name, platforms, source: fromFile ? basename(fromFile) : describe ? 'DESC-001' : null }, null, 2));
    console.log('');
    console.log('  Spec started. The analyst\'s questions come next — `vibekit run` prints the prompt for stage 1,');
    console.log('  and `vibekit show status` is where its questions land for you.');
    console.log('');
    console.log('  What now?');
    console.log('    [1] Save and stop here          it is all in the folder; come back any time');
    console.log('    [2] Review the spec first       open the folder and edit anything');
    console.log('    [3] Start                       vibekit run');
    await next({ ...options, root: target, folder, json: false }).catch(() => {});
    if (asker) await offerCompletion(asker).catch(() => {});
  } finally {
    asker?.close();
  }
}

/**
 * The last question: the repository. Create it at the provider setup recorded, link one that
 * already exists, or not now. Flags for scripts: `--where remote` creates, `--remote <url>` links.
 * A failure is reported and leaves the folder intact; `vibekit new repo` retries.
 */
async function repositoryStep({ root, where, machine, asker, json, ...options }) {
  const provider = machine['git-provider'] && machine['git-provider'] !== 'none' ? machine['git-provider'] : null;
  let choice = where === 'remote' ? 'create' : options.remote ? 'link' : null;
  if (!choice && asker) {
    choice = await asker.choose({ id: 'repository', title: 'Link it to a remote repository?', noOther: true, options: [
      ...(provider ? [{ id: 'create', label: `create one at ${provider}${machine['git-org'] ? ` under ${machine['git-org']}` : ''} and push` }] : []),
      { id: 'link', label: 'link a repository I already have' },
      { id: 'later', label: provider ? 'not now' : 'not now — vibekit settings git-provider first, then vibekit new repo' },
    ] });
  }
  if (!choice || choice === 'later') return null;
  if (choice === 'create') {
    const { newRepo } = await import('./repo.js');
    try {
      return await newRepo({ ...options, root, json, args: [] });
    } catch (error) {
      if (!json) console.log(`  ✖ repository not created: ${error.message}\n  Fix the setting and run: vibekit new repo`);
      return null;
    }
  }
  const url = options.remote ?? (asker ? await asker.text('Repository URL (https or ssh)') : null);
  if (!url) return null;
  const { linkRepository } = await import('./repo.js');
  try {
    const linked = await linkRepository(root, url, { force: Boolean(options.force) });
    if (!json) {
      console.log(`✔ origin → ${url}${linked.pipeline ? ` · ${linked.pipeline} written` : ''}`);
      console.log('  Push when ready: git push -u origin main');
    }
    return linked;
  } catch (error) {
    if (!json) console.log(`  ✖ not linked: ${error.message}`);
    return null;
  }
}

/**
 * CLI Spec §6 — "`vibekit new project` offers to install it on first run, and says which file it
 * would write before writing it." Only at a terminal, only when nothing is installed for the
 * shell in use, and only once: a no is recorded in machine settings.
 */
async function offerCompletion(asker) {
  if (!process.stdin.isTTY) return;
  const { completionStatus, installCompletion, installPath, shellOf } = await import('../completion.js');
  const { readConfig, writeConfig } = await import('../prompts.js').catch(() => ({ readConfig: async () => ({}), writeConfig: async () => {} }));
  const shell = shellOf();
  if (!shell) return;
  const status = await completionStatus();
  if (status.installed.some((entry) => entry.shell === shell)) return;
  if ((await readConfig())['completion-offered']) return;
  console.log('');
  const answer = (await asker.text(`Install shell completion for ${shell}? It completes your projects, sprints and files. It would write ${installPath(shell)} (y/N)`, 'n')).trim().toLowerCase();
  await writeConfig('completion-offered', 'true').catch(() => {});
  if (!/^y(es)?$/.test(answer)) return;
  const result = await installCompletion(shell);
  console.log(`  ✔ ${result.path} · ${result.note}`);
}

// ---------------------------------------------------------------- project select

async function select(options) {
  const { args, json } = options;
  const [query] = args;

  if (options.rescan) {
    const found = await rescan(options.rescan);
    if (json) return void console.log(JSON.stringify(found, null, 2));
    console.log(`✔ ${found.length} project(s) registered from ${resolve(options.rescan)}`);
    return;
  }
  if (options.forget) {
    const removed = await forget(options.forget);
    console.log(removed ? `✔ ${options.forget} forgotten. The folder was not touched.` : `${options.forget} was not in the registry.`);
    return;
  }

  const rows = await listProjects({ needsMe: Boolean(options['needs-me']), match: query ?? null });
  if (options.last) {
    const latest = [...await readRegistry()].sort((a, b) => Date.parse(b.lastSeen ?? 0) - Date.parse(a.lastSeen ?? 0))[0];
    if (!latest) return void console.log('No projects yet. `vibekit new project` starts one.');
    return goTo(latest, options);
  }
  if (json) return void console.log(JSON.stringify(rows, null, 2));

  if (query && rows.length === 1) return goTo(rows[0], options);
  if (!rows.length) {
    console.log(query ? `No project matches "${query}".` : options['needs-me'] ? 'Nothing is waiting on you in any project.' : 'No projects yet. `vibekit new project` starts one, or `vibekit project select --rescan ~/code` finds the ones you have.');
    return;
  }
  console.log(`Your projects${options['needs-me'] ? ' that need you' : ''}`);
  console.log('');
  for (const row of rows) {
    console.log(`  ${row.mark}  ${String(row.name).padEnd(22)} ${row.line}`);
    console.log(`     ${row.path}${row.remote ? ` · ${row.remote.replace(/^https?:\/\/|\.git$/g, '')}` : ' · no remote'} · ${timeAgo(row.lastSeen)}`);
  }
  console.log('');
  console.log(`  ${MARKS.active} building  ${MARKS.waiting} waiting on you  ${MARKS.stopped} stopped  ${MARKS.released} released  ${MARKS.attention} needs attention`);
  console.log('  vibekit use project <name>   go there · --needs-me only what is waiting · --last where you were');
}

/** A shell cannot be moved from a child process; the next command is printed instead. */
async function goTo(entry, options) {
  await register(entry.path).catch(() => {});
  const row = entry.mark ? entry : (await listProjects({ match: entry.path }))[0] ?? entry;
  if (options.json) return void console.log(JSON.stringify(row, null, 2));
  console.log(`${row.mark ?? ''} ${row.name} · ${row.line ?? ''}`.trim());
  console.log(`  cd ${quoteForShell(row.path)}`);
  if (row.folder) {
    const { next } = await import('./folder.js');
    await next({ ...options, root: row.path, folder: row.folder, args: [], json: false }).catch((error) => console.log(`  ${error.message}`));
  }
}

const quoteForShell = (path) => (/[^\w./-]/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : path);

// ---------------------------------------------------------------- project status

async function status(options) {
  const { root, json } = options;
  if (options.all) {
    const rows = await listProjects();
    if (json) return void console.log(JSON.stringify(rows, null, 2));
    if (!rows.length) return void console.log('No projects registered. `vibekit project select --rescan <dir>` finds them; `vibekit new project` starts one.');
    const needsYou = rows.reduce((sum, row) => sum + (row.needsYou ?? 0), 0);
    for (const row of rows) console.log(`  ${String(row.name).padEnd(20)} ${row.mark} ${row.line}`);
    console.log('');
    console.log(`  Needs you: ${needsYou} decision${needsYou === 1 ? '' : 's'} across ${rows.filter((row) => row.needsYou).length} project${rows.filter((row) => row.needsYou).length === 1 ? '' : 's'}`);
    return;
  }
  const { sprint } = await import('./sprint.js');
  const { next } = await import('./folder.js');
  await register(root).catch(() => {});
  await sprint({ ...options, args: ['status'] });
  if (!json) {
    console.log('');
    await next({ ...options, args: [] });
  }
}

// ---------------------------------------------------------------- project assess

async function assess(options) {
  const { installed } = await import('../extensions.js');
  if (!(await installed('assess'))) {
    throw new Error('Assessment is an extension: `vibekit ext add assess`, then `vibekit project assess "<idea>"`. It works in a folder with no code in it.');
  }
  const { assessIdea } = await import('../assess.js');
  return assessIdea(options);
}

export { readText };
