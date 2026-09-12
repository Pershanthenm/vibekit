// What someone sees when they type `vibecheck` with nothing after it, or misspell a command.
//
// The old behaviour printed forty lines of usage in both cases — and a typo exited 0, so a
// script could not tell a mistake from success. A first-time reader got every command at once
// with no clue which to run first.
//
// This answers one question instead: given the state of this folder, what should you do next?

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listFeatures } from './features.js';
import { exists } from './fsutil.js';
import { nextAction } from './next.js';
import { PROJECT_FILE, loadProject } from './project.js';

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

// Files that mean "there is already a codebase here", so `adopt` is the honest first suggestion
// rather than `init`, which would scaffold over the top of someone's work.
const CODE_MARKERS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'pubspec.yaml',
];

async function looksLikeExistingCode(root) {
  const markers = await Promise.all(CODE_MARKERS.map((file) => exists(join(root, file))));
  if (markers.some(Boolean)) return true;
  try {
    return (await readdir(join(root, 'src'))).length > 0;
  } catch {
    return false;
  }
}

function startingOptions(hasCode) {
  const start = [
    ['vibecheck wizard', 'pick your stack in a browser, then come back'],
    ['vibecheck init', 'answer the same questions here in the terminal'],
  ];
  // Ordered by what is actually true of this folder, rather than always leading with `init`.
  return hasCode
    ? [['vibecheck adopt', 'there is already code here — adopt it, do not scaffold over it'], ...start]
    : start;
}

async function noProjectScreen(root) {
  const hasCode = await looksLikeExistingCode(root);
  return [
    '',
    `  ${bold('vibecheck')} ${dim('· spec-driven development for Claude Code, Cursor and Multica')}`,
    '',
    `  ${hasCode ? 'There is code here, but no vibecheck project yet.' : 'No project here yet.'}`,
    '',
    `  ${heading('Start here')}`,
    commandList(startingOptions(hasCode)),
    '',
    `  ${dim(`Not sure? Run ${hasCode ? 'vibecheck adopt' : 'vibecheck wizard'}.`)}`,
    `  ${dim('Every command: vibecheck --help')}`,
    '',
  ].join('\n');
}

const describeStack = (project) => [project.stack.backend, project.stack.frontend, project.stack.database]
  .map((entry) => String(entry ?? '').split(' — ')[0])
  .filter(Boolean)
  .join(' · ');

async function projectScreen(root, project) {
  const features = await listFeatures(root);
  const done = features.filter((feature) => feature.status === 'done').length;
  const next = await nextAction(root, project).catch(() => null);

  const lines = [
    '',
    `  ${bold(project.project.name)} ${dim(`· ${describeStack(project) || 'stack not chosen yet'}`)}`,
    `  ${dim(`${features.length} feature${features.length === 1 ? '' : 's'} · ${done} done`)}`,
    '',
  ];

  if (next) {
    lines.push(`  ${heading('Do this next')}`);
    lines.push(`  ${next.reason}`);
    lines.push(`  ${bold(next.command)}`);
    if (next.gate) lines.push(`  ${dim(`Waiting on you: ${next.gate}`)}`);
    lines.push('');
  }

  lines.push(`  ${heading('Also useful')}`);
  lines.push(commandList([
    ['vibecheck dashboard', 'the whole lifecycle and test status, in your browser'],
    ['vibecheck list', 'every feature, its stage and progress'],
    ['vibecheck check', 'are the specs valid and the generated files in sync?'],
    ['vibecheck health', 'is everything this project needs installed and working?'],
  ]));
  lines.push('');
  lines.push(`  ${dim('Every command: vibecheck --help')}`);
  lines.push('');
  return lines.join('\n');
}

/** The screen for a bare `vibecheck`: what to do next, given what is actually in this folder. */
export async function startScreen(root) {
  if (!(await exists(join(root, PROJECT_FILE)))) return noProjectScreen(root);
  const project = await loadProject(root).catch(() => null);
  if (!project) {
    return [
      '',
      `  ${bold('vibecheck')}`,
      `  ${PROJECT_FILE} exists but could not be read.`,
      `  ${bold('vibecheck check')} ${dim('shows what is wrong')}`,
      '',
    ].join('\n');
  }
  return projectScreen(root, project);
}

// Levenshtein, small and iterative. Only ever run against the command list, so the input is tiny.
function distance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = current;
    }
  }
  return previous[right.length];
}

/**
 * The closest command to what was typed, when it is close enough to be worth guessing. A third
 * of the word may differ; beyond that a suggestion is noise and "no such command" is the more
 * useful answer.
 */
export function closestCommand(typed, names) {
  const budget = Math.max(1, Math.floor(typed.length / 3));
  const [best] = names
    .map((name) => ({ name, score: distance(typed.toLowerCase(), name.toLowerCase()) }))
    .filter((entry) => entry.score <= budget)
    .sort((left, right) => left.score - right.score);
  return best?.name ?? null;
}

/** What to print when a command does not exist. The caller is responsible for exiting non-zero. */
export function unknownCommand(typed, names) {
  const suggestion = closestCommand(typed, names);
  return [
    `vibecheck: no such command "${typed}"`,
    suggestion ? `Did you mean ${bold(`vibecheck ${suggestion}`)}?` : '',
    dim('Run "vibecheck" for what to do next, or "vibecheck --help" for every command.'),
  ].filter(Boolean).join('\n');
}
