// What someone sees when they type `vibekit` with nothing after it, or misspell a command.
// CLI Spec §3.
//
// Both used to print forty lines of usage — and a typo exited 0, so a script could not tell a
// mistake from success. This answers one question instead: where am I, and what needs me?
// "Three lines and three suggestions. A help screen that lists forty commands teaches nothing."

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isOpen, listAsks } from './folder/asks.js';
import { FOLDER_NAMES } from './folder/layout.js';
import { listRequirements, readTasksState } from './folder/requirements.js';
import { sprintBoard } from './folder/sprints.js';
import { currentStage, gateState, STAGES } from './folder/workflow.js';
import { exists } from './fsutil.js';

// Colour only when someone is actually watching. Piped output, CI logs and the tests all get
// plain text, so nothing has to strip escape codes back out.
const ESC = String.fromCharCode(27);
const tty = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (tty() ? `${ESC}[${code}m${text}${ESC}[0m` : text);
export const bold = (text) => paint('1', text);
export const dim = (text) => paint('2', text);

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.length));

/** A block of `command — what it does` lines, with the commands column-aligned. */
export function commandList(entries) {
  const width = Math.max(...entries.map(([command]) => command.length));
  return entries.map(([command, description]) => `  ${bold(pad(command, width))}  ${dim(description)}`).join('\n');
}

// Files that mean "there is already a codebase here", so importing it is the honest first
// suggestion rather than `new project`, which would start a spec as if the code did not exist.
const CODE_MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'pubspec.yaml', '*.sln'];

export async function looksLikeExistingCode(root) {
  for (const file of CODE_MARKERS) {
    if (file.startsWith('*')) {
      if ((await readdir(root).catch(() => [])).some((name) => name.endsWith(file.slice(1)))) return true;
    } else if (await exists(join(root, file))) return true;
  }
  try {
    return (await readdir(join(root, 'src'))).length > 0;
  } catch {
    return false;
  }
}

async function folderIn(root) {
  for (const name of FOLDER_NAMES) if (await exists(join(root, name, 'profile.md'))) return name;
  return null;
}

async function noFolderScreen(root) {
  const hasCode = await looksLikeExistingCode(root);
  const start = hasCode
    ? [['vibekit new project --import .', 'there is code here — read it and build the spec from it'], ['vibekit analyze .', 'tell me about this codebase, change nothing'], ['vibekit use', 'the projects you already have']]
    : [['vibekit new project', 'name it, describe it, answer the questions'], ['vibekit use', 'the projects you already have'], ['vibekit analyze <path>', 'tell me about a codebase, change nothing']];
  return [
    '',
    `  ${bold('vibekit')} ${dim('· spec-driven development for coding agents, with a person deciding every question that matters')}`,
    '',
    `  ${hasCode ? 'There is code here, but no vibekit/ folder yet.' : 'No project here yet.'}`,
    '',
    commandList(start),
    '',
    `  ${dim('Every command: vibekit --help · the tour: vibekit tour')}`,
    '',
  ].join('\n');
}

/** "Hello World · sprint 3 of 3 · 2 decisions waiting" — one line about where you are. */
export async function whereLine(root, folder) {
  const [stage, requirements, tasks, asks, board, gates] = await Promise.all([
    currentStage(root, folder), listRequirements(root, folder), readTasksState(root, folder), listAsks(root, folder), sprintBoard(root, folder).catch(() => null), gateState(root, folder),
  ]);
  const { loadProject } = await import('./project.js');
  const name = (await loadProject(root).catch(() => null))?.project?.name ?? root.split(/[\\/]/).pop();
  const decisions = asks.filter(isOpen).length + (stage.n < 5 && STAGES.slice(0, 5).some((entry) => !gates[entry.n]?.passed && /approved|reviewed/.test(gates[entry.n]?.detail ?? '')) ? 1 : 0);
  const where = board?.current ? `sprint ${board.current.n} of ${board.sprints.length}` : stage.n < 5 ? `stage ${stage.n} · ${stage.name}` : 'planned';
  const held = Object.keys(tasks.held).length;
  const done = requirements.filter((entry) => entry.status === 'done').length;
  const tail = decisions ? `${decisions} decision${decisions === 1 ? '' : 's'} waiting` : held ? `${held} lane${held === 1 ? '' : 's'} running` : requirements.length ? `${done} of ${requirements.length} done` : 'nothing waiting';
  return { name, where, tail, decisions, line: `${name} · ${where} · ${tail}` };
}

async function projectScreen(root, folder, { via = null } = {}) {
  const here = await whereLine(root, folder);
  const suggestions = here.decisions
    ? [['vibekit show status', 'what needs you'], ['vibekit run', 'work the current sprint'], ['vibekit use project', 'switch project']]
    : [['vibekit run', 'work the current sprint'], ['vibekit show project', 'where things are'], ['vibekit use project', 'switch project']];
  return [
    '',
    `  ${bold(here.line)}${via ? dim(`   (via use project · ${root})`) : ''}`,
    '',
    commandList(suggestions),
    '',
  ].join('\n');
}

export async function startScreen(root, { via = null } = {}) {
  const folder = await folderIn(root);
  if (folder) return projectScreen(root, folder, { via: Boolean(via) });
  // Not in a project, but one was chosen with `use project`: that is where things apply.
  const { currentProject } = await import('./current.js');
  const chosen = await currentProject().catch(() => null);
  if (chosen) return projectScreen(chosen.path, chosen.folder, { via: true });
  return noFolderScreen(root);
}

// Levenshtein, small enough to keep here. A suggestion is only offered when the typo is close.
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return rows[a.length][b.length];
}

export function unknownCommand(name, known) {
  const closest = known.map((candidate) => ({ candidate, score: distance(name, candidate) })).sort((a, b) => a.score - b.score)[0];
  // Within a third of the word's length: sending someone to the wrong command is worse than
  // admitting the command is unknown.
  const suggestion = closest && closest.score <= Math.max(1, Math.floor(name.length / 3)) ? `\n  Did you mean: vibekit ${closest.candidate}?` : '';
  return `vibekit: no such command "${name}".${suggestion}\n  The verbs: new, use, show, plan, run, analyze, migrate, verify · stop, resume, ship. Every command: vibekit --help`;
}
