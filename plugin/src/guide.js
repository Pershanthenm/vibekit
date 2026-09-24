// What someone sees when they type `vibekit` with nothing after it, or misspell a command.
//
// Both used to print forty lines of usage — and a typo exited 0, so a script could not tell a
// mistake from success. This answers one question instead: given the state of this folder, what
// should you do next? A first-time reader gets the pitch once (§65) and the one command that fits.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FOLDER_NAMES } from './folder/layout.js';
import { listRequirements, readTasksState } from './folder/requirements.js';
import { currentStage, nextAction } from './folder/workflow.js';
import { exists } from './fsutil.js';
import { gerund } from './folder/sprints.js';

// Colour only when someone is actually watching. Piped output, CI logs and the tests all get
// plain text, so nothing has to strip escape codes back out.
const ESC = String.fromCharCode(27);
const tty = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (tty() ? `${ESC}[${code}m${text}${ESC}[0m` : text);
export const bold = (text) => paint('1', text);
export const dim = (text) => paint('2', text);
const heading = (text) => paint('1;4', text);

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.length));

/** A block of `command — what it does` lines, with the commands column-aligned. */
export function commandList(entries) {
  const width = Math.max(...entries.map(([command]) => command.length));
  return entries.map(([command, description]) => `  ${bold(pad(command, width))}  ${dim(description)}`).join('\n');
}

// Files that mean "there is already a codebase here", so `project import` is the honest first
// suggestion rather than `project new`, which would start a spec as if the code did not exist.
const CODE_MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'pubspec.yaml', '*.sln'];

async function looksLikeExistingCode(root) {
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
    ? [['vibekit project import .', 'there is code here — read it and explain it back before anything is written'], ['vibekit project new', 'start a spec beside it anyway']]
    : [['vibekit project new', 'name it, say what you want, answer the questions, get a spec'], ['vibekit project select', 'your projects on this machine, with where each one got to']];
  return [
    '',
    `  ${bold('vibekit')} ${dim('· spec-driven development for coding agents, with a person deciding every question that matters')}`,
    '',
    `  ${hasCode ? 'There is code here, but no vibekit/ folder yet.' : 'No project here yet.'}`,
    '',
    `  ${heading('Start here')}`,
    commandList(start),
    '',
    `  ${dim('Every command: vibekit --help · the tour: vibekit tour')}`,
    '',
  ].join('\n');
}

async function projectScreen(root, folder) {
  const [stage, action, requirements, tasks] = await Promise.all([
    currentStage(root, folder), nextAction(root, folder), listRequirements(root, folder), readTasksState(root, folder),
  ]);
  const done = requirements.filter((entry) => entry.status === 'done').length;
  const held = Object.entries(tasks.held);
  const lines = [
    '',
    `  ${bold(root.split(/[\\/]/).pop())} ${dim(`· stage ${stage.n} ${stage.name} · ${done} of ${requirements.length} done`)}`,
    '',
  ];
  if (held.length) lines.push(`  ${heading('In progress')}`, ...held.map(([id, holder]) => `  ${gerund(requirements.find((entry) => entry.id === id)?.title ?? id)} ${dim(`(${holder.role}, ${holder.runner})`)}`), '');
  if (action) {
    lines.push(`  ${heading(action.forHuman ? 'Needs you' : 'Next')}`, `  ${action.detail ?? ''}`, commandList([[action.command, action.forHuman ? 'a decision only a person makes' : 'the next piece of work']]), '');
  } else {
    lines.push(`  ${heading('Nothing outstanding')}`, '');
  }
  lines.push(
    `  ${heading('Every day')}`,
    commandList([['vibekit action', 'everything waiting on you, most blocking first'], ['vibekit sprint run', 'work the current sprint'], ['vibekit project status', 'where things are']]),
    '',
    `  ${dim('Every command: vibekit --help')}`,
    '',
  );
  return lines.join('\n');
}

export async function startScreen(root) {
  const folder = await folderIn(root);
  return folder ? projectScreen(root, folder) : noFolderScreen(root);
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
  return `vibekit: no such command "${name}".${suggestion}\n  Every command: vibekit --help`;
}
