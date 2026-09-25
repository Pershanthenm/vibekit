import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText, writeText } from './fsutil.js';

/**
 * Shell completion. CLI Spec §6.
 *
 * "It completes your data, not just the grammar." The grammar is the table below. The data comes
 * from a cached index in `~/.vibekit/completion.json`, refreshed whenever a command changes
 * state — so completing never shells out to git or scans a repository. "A completion that takes
 * 400ms is one people disable."
 *
 * The shell scripts are thin: each calls `vibekit __complete <shell> <words…>` and prints what
 * comes back. `bin/vibekit` routes `__complete` here before loading the rest of the CLI, which
 * is what keeps it fast.
 */

// ---------------------------------------------------------------- the grammar

const D = (value, description) => ({ value, description });

/** Verb → the nouns it takes, each with the one line a shell shows beside it. */
export const GRAMMAR = Object.freeze({
  new: [D('project', 'start something: name it, describe it, answer the questions'), D('sprint', 'begin the next sprint in the plan'), D('feature', 'add one thing to a project already running'), D('bug', 'log a defect — assess, fix, verify'), D('hotfix', 'production is broken; skip the ceremony')],
  use: [D('project', 'switch; everything after applies here'), D('sprint', 'switch the working sprint')],
  show: [D('project', 'where this project is'), D('plan', 'the sprints, in order, with dependencies'), D('sprint', 'this sprint: lanes, progress, blockers'), D('status', 'what needs you, across every project'), D('cost', 'spend, forecast, waste'), D('security', 'framework scores and open findings'), D('backlog', 'what is not in a sprint, and why'), D('docs', 'the generated architecture documents'), D('why', 'why this line of code exists'), D('team', 'who approves what'), D('migration', 'slices moved, verified, traffic shifted'), D('differences', 'where old and new disagree')],
  plan: [D('project', 'turn the spec into sprints, in dependency order'), D('sprint', 're-order or re-scope the current sprint')],
  run: [D('sprint', 'work the current sprint with several agents'), D('check', 'every mechanical check'), D('scan', 'security, against every applicable framework'), D('review', 'the reviewer over anything waiting'), D('docs', 'regenerate documents and diagrams')],
  analyze: [],
  migrate: [D('upgrade', 'same stack, newer versions'), D('replatform', 'a different stack'), D('decompose', 'split a monolith into modules'), D('status', 'where the migration is'), D('next', 'move the next slice'), D('shift', 'move traffic to a verified slice'), D('approve', 'approve a migration gate')],
  verify: [D('triage', 'mark a difference expected, tolerable or real')],
  stop: [],
  resume: [],
  ship: [D('release', 'tag, changelog, documents, evidence bundle'), D('rollback', 'put the previous release back'), D('undo', 'remove a shipped feature; dependants go to review')],
  settings: [D('tiers', 'which model each tier is'), D('frameworks', 'which security frameworks a scan measures against'), D('server', 'a credential for an MCP server'), D('trust', 'trust an extension publisher\'s key')],
  design: [D('add', 'add a design reference'), D('preview', 'render your screens with the current design'), D('apply', 'turn references into tokens'), D('feedback', 'say what is wrong')],
  tracker: [],
  ext: [D('add', 'install an extension'), D('list', 'what is installed'), D('update', 'fetch, show the diff, apply'), D('remove', 'remove one'), D('verify', 'the rules, before you publish')],
  completion: [D('bash', 'a script for bash'), D('zsh', 'a script for zsh'), D('fish', 'a script for fish'), D('install', 'write the script where your shell loads it')],
});

/** The verbs, with the line `vibekit` alone prints beside each. */
export const VERBS = Object.freeze([
  D('new', 'start something that did not exist'), D('use', 'switch what I am working on'), D('show', 'tell me something, change nothing'),
  D('plan', 'decide the order of work'), D('run', 'do work now'), D('analyze', 'tell me about a codebase, change nothing'),
  D('migrate', 'move software you already have'), D('verify', 'prove the new behaves like the old'),
  D('stop', 'stop cleanly; everything checkpointed'), D('resume', 're-check the ground, then carry on'), D('ship', 'release, rollback, undo'),
  D('settings', 'models, tiers, runners, caps, brand, frameworks'), D('design', 'design references'), D('tracker', 'the live board, and a QR code for your phone'),
  D('ext', 'extensions'), D('completion', 'shell completion'),
]);

/** Flags, by command. A flag with `values` completes them; one with `files` hands over to the shell. */
const FLAGS = Object.freeze({
  'show *': [D('--all', 'every project, not just this one'), D('--json', 'machine-readable')],
  'show docs': [D('--at', 'as things were at that commit')],
  'show cost': [D('--at', 'as things were at that commit')],
  'show plan': [D('--cost', 'the forecast per sprint')],
  'run sprint': [{ value: '--until', description: 'blocked: stop when anything needs a human · gate: stop at the sprint gate', values: [D('blocked', 'the overnight setting'), D('gate', 'stop at the sprint gate')] }, D('--lanes', 'how many agents at once (default 2)'), D('--headless', 'CI form; non-zero exit if anything blocked')],
  'run check': [D('--headless', 'CI form'), D('--ci', 'warnings are information; errors fail the build'), D('--security', 'the scan\'s read pass, as a check'), D('--deps', 'the dependency audit'), D('--servers', 'every declared MCP server')],
  'run scan': [D('--url', 'probe the deployed application at this address')],
  'run docs': [D('--at', 'as things were at that commit')],
  'new project': [D('--preview', 'show the questions it would ask; write nothing'), D('--import', 'there is code here: read it and build the spec from it'), D('--name', 'the project name'), D('--describe', 'what you are building')],
  'new feature': [D('--preview', 'show the questions it would ask; write nothing')],
  'new bug': [D('--test', 'the failing test that reproduces it'), { value: '--severity', description: 'high, medium or low', values: [D('high', ''), D('medium', ''), D('low', '')] }],
  'new sprint': [D('--by', 'your name: closes the finished sprint at its gate')],
  analyze: [{ value: '--depth', description: 'quick, standard or deep', values: [D('quick', 'no model calls at all; free to run on anything'), D('standard', 'the default'), D('deep', 'reads more files and more history')] }, { value: '--focus', description: 'security, cost, migration or quality', values: [D('security', 'dependencies, secrets, injection, auth boundaries'), D('cost', 'what it would take to work on, add to, run and migrate'), D('migration', 'what carries across, where the seams are'), D('quality', 'coverage, complexity, duplication, dead code')] }, { value: '--compare', description: 'two codebases side by side', files: true }, D('--pdf', 'a report as a PDF'), D('--brand', 'a report in the client\'s livery'), D('--json', 'machine-readable')],
  verify: [D('--live', 'shadow mode: real traffic to both, only the old is served'), { value: '--replay', description: 'replay recorded traffic through both', files: true }, D('--data', 'compare old and new data after a move'), D('--report', 'what is verified, what is not, what differs')],
  'plan project': [D('--approve', 'approve the plan'), D('--by', 'your name'), D('--cost', 'the forecast per sprint')],
  'plan sprint': [D('--order', 'ids in the new order, comma-separated'), D('--defer', 'ids to move out of the sprint'), D('--by', 'your name')],
  'migrate shift': [],
  completion: [D('--check', 'is the installed script the installed version')],
});

// ---------------------------------------------------------------- the index

export const indexPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'completion.json');

export async function readIndex() {
  try {
    const parsed = JSON.parse((await readText(indexPath())) ?? '{}');
    return { version: parsed.version ?? null, current: parsed.current ?? null, projects: parsed.projects ?? [], byPath: parsed.byPath ?? {} };
  } catch {
    return { version: null, current: null, projects: [], byPath: {} };
  }
}

export async function packageVersion() {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return pkg.version;
}

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  } catch {
    return '';
  }
};

/** Files a `show why` can answer for: named in a requirement, or written by a commit that names one. */
async function provenanceFiles(root, requirements) {
  const found = new Map();
  for (const requirement of requirements) {
    const named = `${requirement.approach}\n${requirement.verification}`;
    for (const match of named.matchAll(/(?<![\w/])((?:[\w-]+\/)+[\w.-]+\.\w{1,8})\b/g)) {
      if (!found.has(match[1])) found.set(match[1], requirement.id);
    }
  }
  const log = git(root, ['log', '-200', '--format=%x1e%(trailers:key=VibeKit-Requirement,valueonly)', '--name-only']);
  for (const record of log.split('\x1e').slice(1)) {
    const [head, ...files] = record.split('\n');
    const id = head.trim().split(/\s/)[0];
    if (!/^(?:REQ|MIG|BUG)-/.test(id)) continue;
    for (const file of files) if (file.trim() && !found.has(file.trim())) found.set(file.trim(), id);
  }
  return [...found.entries()].slice(0, 500).map(([path, id]) => ({ path, id }));
}

/**
 * Rebuild this project's entry, and the project list, from the files. Called after any command
 * that may have changed state; never from a completion.
 */
export async function refreshCompletionIndex(root, { folder = null } = {}) {
  const path = resolve(root);
  const { folderIn, readRegistry, summarise } = await import('./projects.js');
  const { currentProject } = await import('./current.js');
  const index = await readIndex();
  const known = folder ?? (await folderIn(path));
  index.version = await packageVersion();

  const registry = await readRegistry();
  const previous = new Map(index.projects.map((entry) => [entry.path, entry]));
  index.projects = [];
  for (const entry of registry) {
    const line = entry.path === path && known ? (await summarise(entry).catch(() => null))?.line : previous.get(entry.path)?.line;
    index.projects.push({ name: entry.name, path: entry.path, line: line ?? 'not read yet' });
  }
  index.current = (await currentProject())?.path ?? null;

  if (known) {
    const { sprintBoard } = await import('./folder/sprints.js');
    const { listRequirements } = await import('./folder/requirements.js');
    const [board, requirements] = await Promise.all([sprintBoard(path, known).catch(() => null), listRequirements(path, known).catch(() => [])]);
    const sprints = (board?.sprints ?? []).map((row, at, all) => ({
      n: row.n, title: row.title, done: row.done, total: row.total, closed: Boolean(row.closed),
      // "run sprint completes only sprints whose dependencies are met": every earlier sprint finished.
      ready: all.slice(0, at).every((earlier) => earlier.closed || earlier.complete || !earlier.total),
    }));
    const tags = git(path, ['for-each-ref', '--sort=-v:refname', '--format=%(refname:short)\t%(creatordate:short)', 'refs/tags/v*']).split('\n').filter(Boolean).map((line) => { const [tag, date] = line.split('\t'); return { tag, date }; });
    index.byPath[path] = {
      name: registry.find((entry) => entry.path === path)?.name ?? path.split(/[\\/]/).pop(),
      folder: known,
      sprints,
      tags,
      files: await provenanceFiles(path, requirements),
      done: requirements.filter((entry) => entry.status === 'done').map((entry) => ({ id: entry.id, title: entry.title })),
      imported: await exists(join(path, known, 'understanding.md')),
      migrating: await exists(join(path, known, 'workflow/migration.md')),
      refreshed: new Date().toISOString(),
    };
  }
  await writeText(indexPath(), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

// ---------------------------------------------------------------- the handler

const FILES = '\t__files';

/** The project the completion is for: the directory we stand in if it is indexed, else the one `use project` chose. */
function projectFor(index, cwd) {
  const here = resolve(cwd);
  let candidate = here;
  while (candidate) {
    if (index.byPath[candidate]) return index.byPath[candidate];
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return index.current ? index.byPath[index.current] ?? null : null;
}

const matching = (entries, partial) => entries.filter((entry) => String(entry.value).toLowerCase().startsWith(String(partial ?? '').toLowerCase()));

/**
 * Everything the next word could be, given the words so far. Pure: the index is passed in, so
 * it is testable, and the shell scripts only ever format what comes back.
 */
export function suggestions(words, index, { cwd = process.cwd() } = {}) {
  const partial = words[words.length - 1] ?? '';
  const before = words.slice(0, -1);
  const [verb, noun] = before;
  const project = projectFor(index, cwd);

  if (!before.length) return matching(VERBS, partial);
  if (!GRAMMAR[verb]) return [];

  const command = FLAGS[`${verb} ${noun}`] ? `${verb} ${noun}` : FLAGS[verb] ? verb : null;
  const flags = [...(FLAGS[command] ?? []), ...(verb === 'show' ? FLAGS['show *'] : [])];

  // A value for the flag just typed.
  const previous = before[before.length - 1];
  const flag = flags.find((entry) => entry.value === previous);
  if (flag?.values) return matching(flag.values, partial);
  if (flag?.files) return [{ value: '', description: '__files' }];
  if (partial.startsWith('-')) return matching(flags, partial);

  // The noun.
  if (before.length === 1) {
    if (verb === 'migrate' && project && !project.imported && !project.migrating) return [];
    if (verb === 'analyze') return [{ value: '', description: '__files' }];
    if (verb === 'tracker') return matching(index.projects.map((entry) => D(entry.name, entry.line)), partial);
    if (verb === 'stop' || verb === 'resume') return [];
    return matching(GRAMMAR[verb], partial);
  }

  // The name, from the data.
  if (before.length === 2) {
    if (verb === 'use' && noun === 'project') return matching(index.projects.map((entry) => D(entry.name, entry.line)), partial);
    if ((verb === 'use' || verb === 'run') && noun === 'sprint' && project) {
      const rows = project.sprints.filter((row) => !row.closed && (verb === 'use' || row.ready));
      return matching(rows.map((row) => D(String(row.n), `${row.title} · ${row.done} of ${row.total}`)), partial);
    }
    if (verb === 'ship' && noun === 'rollback' && project) return matching(project.tags.map((row) => D(row.tag, `released ${row.date}`)), partial);
    if (verb === 'ship' && noun === 'undo' && project) return matching(project.done.map((row) => D(row.id, row.title)), partial);
    if (verb === 'show' && noun === 'why' && project) return matching(project.files.map((row) => D(row.path, row.id)), partial);
    if (verb === 'verify' && noun === 'triage') return [];
    if (verb === 'migrate' && noun === 'shift' && project) return matching(project.done.filter((row) => row.id.startsWith('MIG-')).map((row) => D(row.id, row.title)), partial);
    if (verb === 'completion' && noun === 'install') return matching([D('bash', ''), D('zsh', ''), D('fish', '')], partial);
  }
  if (verb === 'verify' && noun === 'triage' && before.length === 3) return matching([D('expected', 'old and new differ on purpose'), D('tolerable', 'a difference nobody will act on'), D('real', 'a behaviour that must match before the slice is done')], partial);
  return [];
}

/** `vibekit __complete <shell> <words…>` — the entry `bin/vibekit` routes here. */
export async function complete(argv) {
  // argv is `__complete <shell> <words…>`; the shell only matters to the script that called.
  const [, , ...words] = argv;
  const index = await readIndex();
  const rows = suggestions(words, index);
  if (rows.length === 1 && rows[0].description === '__files') return void process.stdout.write(`${FILES}\n`);
  process.stdout.write(rows.map((row) => `${row.value}\t${row.description}`).join('\n') + (rows.length ? '\n' : ''));
}

// ---------------------------------------------------------------- the scripts

export const SHELLS = Object.freeze(['bash', 'zsh', 'fish']);

const marker = (shell, version) => `# vibekit completion ${version} (${shell}) · vibekit completion --check verifies this matches the installed version`;

export function script(shell, version) {
  if (shell === 'bash') {
    return [
      marker('bash', version),
      '_vibekit() {',
      '  local IFS=$\'\\n\'',
      '  local cur="${COMP_WORDS[COMP_CWORD]}"',
      '  local -a lines',
      '  mapfile -t lines < <(vibekit __complete bash "${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)',
      '  COMPREPLY=()',
      '  if [[ ${#lines[@]} -eq 1 && "${lines[0]}" == $\'\\t__files\' ]]; then',
      '    COMPREPLY=($(compgen -f -- "$cur")); return',
      '  fi',
      '  local line',
      '  for line in "${lines[@]}"; do',
      '    local value="${line%%$\'\\t\'*}"',
      '    [[ -n "$value" ]] && COMPREPLY+=("$value")',
      '  done',
      '}',
      'complete -F _vibekit vibekit',
      '',
    ].join('\n');
  }
  if (shell === 'zsh') {
    return [
      '#compdef vibekit',
      marker('zsh', version),
      '_vibekit() {',
      '  local -a lines pairs',
      '  lines=("${(@f)$(vibekit __complete zsh "${words[@]:1:$((CURRENT-1))}" 2>/dev/null)}")',
      '  if [[ ${#lines} -eq 1 && "${lines[1]}" == $\'\\t__files\' ]]; then _files; return; fi',
      '  local line value desc',
      '  for line in "${lines[@]}"; do',
      '    [[ -z "$line" ]] && continue',
      '    value="${line%%$\'\\t\'*}"; desc="${line#*$\'\\t\'}"',
      '    pairs+=("${value//:/\\\\:}:${desc}")',
      '  done',
      '  _describe -t vibekit \'vibekit\' pairs',
      '}',
      '_vibekit "$@"',
      '',
    ].join('\n');
  }
  if (shell === 'fish') {
    return [
      marker('fish', version),
      'function __vibekit_complete',
      '  set -l tokens (commandline -opc)',
      '  set -l current (commandline -ct)',
      '  set -l out (vibekit __complete fish $tokens[2..-1] $current 2>/dev/null)',
      '  if test (count $out) -eq 1; and test "$out[1]" = \\t__files',
      '    __fish_complete_path $current',
      '  else',
      '    printf \'%s\\n\' $out',
      '  end',
      'end',
      'complete -c vibekit -f -a \'(__vibekit_complete)\'',
      '',
    ].join('\n');
  }
  throw new Error(`"${shell}" is not a shell this completes. One of: ${SHELLS.join(', ')}.`);
}

// ---------------------------------------------------------------- install and check

/** Where each shell loads a completion from without any configuration: the user-level path first. */
export function installLocations(shell, home = homedir()) {
  const locations = {
    bash: [join(home, '.local/share/bash-completion/completions/vibekit'), '/etc/bash_completion.d/vibekit', '/usr/local/etc/bash_completion.d/vibekit', '/opt/homebrew/etc/bash_completion.d/vibekit'],
    zsh: [join(home, '.zsh/completions/_vibekit'), join(home, '.zfunc/_vibekit'), '/usr/local/share/zsh/site-functions/_vibekit', '/opt/homebrew/share/zsh/site-functions/_vibekit'],
    fish: [join(home, '.config/fish/completions/vibekit.fish')],
  };
  return locations[shell] ?? [];
}

export const installPath = (shell, home = homedir()) => installLocations(shell, home)[0] ?? null;

/** The shell a person is using, from the environment; null when it cannot be told. */
export function shellOf(env = process.env) {
  const name = String(env.SHELL ?? '').split(sep).pop().split('/').pop();
  return SHELLS.includes(name) ? name : null;
}

/** Every installed script, with the version it carries beside the version this is. */
export async function completionStatus({ home = homedir() } = {}) {
  const version = await packageVersion();
  const installed = [];
  for (const shell of SHELLS) {
    for (const path of installLocations(shell, home)) {
      const text = await readText(path);
      if (text === null) continue;
      const found = text.match(/^# vibekit completion (\S+) \((\w+)\)/m)?.[1] ?? null;
      installed.push({ shell, path, version: found, current: found === version });
    }
  }
  return { version, installed, stale: installed.filter((entry) => !entry.current) };
}

export async function installCompletion(shell, { home = homedir() } = {}) {
  const path = installPath(shell, home);
  if (!path) throw new Error(`"${shell}" is not a shell this completes. One of: ${SHELLS.join(', ')}.`);
  await writeText(path, script(shell, await packageVersion()));
  const note = shell === 'zsh' ? `Make sure ${dirname(path)} is on your fpath before compinit: fpath=(${dirname(path)} $fpath)` : shell === 'bash' ? 'Loaded by bash-completion 2.x on the next shell.' : 'Loaded by fish on the next shell.';
  return { shell, path, note };
}
