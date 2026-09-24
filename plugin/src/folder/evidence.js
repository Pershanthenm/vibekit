import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repoState } from '../evidence.js';
import { runnable, splitArgs } from '../which.js';
import { readText } from '../fsutil.js';
import { DEFAULT_FOLDER } from './layout.js';
import { readTasksState, requirementPath, sectionOf, writeSection } from './requirements.js';

/**
 * Evidence, not assertion. Specification §22 step 7 and §55.
 *
 * "Run `vibekit verify`. It executes the commands in map.md and captures exit codes into
 * `## Evidence`. A log line that says 'tests green' is not accepted, and `tested` is refused
 * without an evidence block whose sha matches HEAD."
 *
 * Until this existed, nothing wrote that block. `verify` recorded to `.state/` for the older
 * features flow and never opened a requirement, so the one gate between an implementer and a
 * reviewer could only be passed by a human typing the section in by hand — which is the exact
 * claim-without-evidence the gate exists to refuse.
 */

const exec = promisify(execFile);

/** The commands in `product/map.md`, the only place a command may live. */
export async function mapCommands(root, folder = DEFAULT_FOLDER) {
  const map = (await readText(join(root, folder, 'product/map.md'))) ?? '';
  const fenced = sectionOf(map, 'Commands').match(/```[^\n]*\n([\s\S]*?)```/)?.[1] ?? '';
  const commands = {};
  for (const line of fenced.split('\n')) {
    const matched = line.trim().match(/^(\w[\w-]*)\s{2,}(.+)$/);
    if (matched && !/TODO/i.test(matched[2])) commands[matched[1]] = matched[2].trim();
  }
  return commands;
}

/** Which of the map's commands count as evidence for a requirement, in the order they run. */
export const EVIDENCE_SUITES = Object.freeze(['build', 'test', 'smoke']);

/**
 * Run one command exactly as map.md wrote it, without a shell.
 *
 * The command is the team's own and is trusted, but it is still spawned directly: a shell would
 * turn a `;` in a future edit of map.md into a second command that nobody reviewed.
 */
export async function runCommand(root, command, { timeoutMs = 20 * 60_000 } = {}) {
  const [binary, ...rest] = splitArgs(command);
  const spawn = runnable(binary, rest);
  const started = Date.now();
  const outcome = await exec(spawn.command, spawn.args, { cwd: root, shell: spawn.shell, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
    .then((done) => ({ code: 0, output: `${done.stdout}${done.stderr}` }))
    .catch((error) => ({ code: error.killed ? 124 : (error.code ?? 1), output: `${error.stdout ?? ''}${error.stderr ?? ''}`, timedOut: Boolean(error.killed) }));
  return { command, ...outcome, seconds: Math.round((Date.now() - started) / 1000) };
}

export async function runEvidence(root, { folder = DEFAULT_FOLDER, suites = EVIDENCE_SUITES, runner = runCommand } = {}) {
  const commands = await mapCommands(root, folder);
  const results = [];
  for (const suite of suites) {
    if (!commands[suite]) continue;
    results.push({ suite, ...(await runner(root, commands[suite])) });
  }
  return { commands, results, ran: results.length > 0 };
}

/**
 * The block, as it is written into the requirement.
 *
 * Machine-readable on purpose. `tested` reads the sha back out of it and compares it to HEAD:
 * evidence for a commit that is not the one being handed over is evidence for something else.
 */
export function renderEvidence(results, state, { at = new Date() } = {}) {
  const lines = [
    `commit ${state?.commit ?? 'none'}${state?.dirty ? ' · working tree dirty' : ''} · ${at.toISOString().slice(0, 16)}Z`,
    '',
    ...results.map((result) => `- ${result.suite.padEnd(6)} \`${result.command}\`  exit ${result.code}${result.timedOut ? ' (timed out)' : ''}  ${result.seconds}s`),
  ];
  if (!results.length) lines.push('- nothing ran: product/map.md names no build, test or smoke command');
  return lines.join('\n');
}

export const parseEvidence = (block) => {
  const text = String(block ?? '');
  return {
    commit: text.match(/^commit\s+([0-9a-f]{7,40})/m)?.[1] ?? null,
    dirty: /working tree dirty/.test(text),
    // The exit code is the evidence; the backticked command is how this renderer happens to write
    // the line. A block that names the suite and the exit code counts however it was laid out.
    exits: [...text.matchAll(/^-\s+(\w+)\b[^\n]*?\bexit\s+(\d+)\b/gm)].map((match) => ({ suite: match[1], code: Number(match[2]) })),
  };
};

/** Record the evidence into the requirement. Returns what was written and whether it is green. */
export async function recordEvidence(root, id, { folder = DEFAULT_FOLDER, runner = runCommand } = {}) {
  const path = requirementPath(root, id, folder);
  if ((await readText(path)) === null) throw new Error(`No requirement ${id} in ${folder}/product/requirements/.`);

  const { results, ran, commands } = await runEvidence(root, { folder, runner });
  const state = repoState(root);
  const block = renderEvidence(results, state);
  await writeSection(root, id, 'Evidence', block, folder);

  return {
    id,
    ran,
    commands,
    results,
    green: ran && results.every((result) => result.code === 0),
    commit: state?.commit ?? null,
    dirty: Boolean(state?.dirty),
    block,
  };
}

/**
 * Why this requirement's evidence does not support `tested`, or null when it does.
 *
 * Three refusals, each a different lie the block could tell: none at all, one for a different
 * commit, and one whose exit codes were red.
 */
export function evidenceRefusal(requirement, state) {
  const block = requirement.evidence?.trim() ?? '';
  if (!block) {
    return `${requirement.id} has no ## Evidence block. "tests green" is a claim; run \`vibekit verify\` so the exit codes are captured.`;
  }
  const parsed = parseEvidence(block);
  if (!parsed.exits.length) {
    return `${requirement.id}'s ## Evidence records no command and no exit code. Run \`vibekit verify\`; a paragraph is not evidence.`;
  }
  const red = parsed.exits.filter((exit) => exit.code !== 0);
  if (red.length) {
    return `${requirement.id}'s evidence is red: ${red.map((exit) => `${exit.suite} exit ${exit.code}`).join(', ')}. Work that does not pass its own commands is not ready for a reviewer.`;
  }
  if (state?.commit && parsed.commit && !state.commit.startsWith(parsed.commit)) {
    return `${requirement.id}'s evidence is for commit ${parsed.commit.slice(0, 7)}, and HEAD is ${state.commit.slice(0, 7)}. Something changed since it ran; run \`vibekit verify\` again.`;
  }
  if (parsed.dirty) {
    return `${requirement.id}'s evidence was captured on a dirty working tree, so it describes files that were not committed. Commit, then run \`vibekit verify\` again.`;
  }
  return null;
}

/** The requirement this session holds, which is the one `verify` records against by default. */
export async function heldRequirement(root, folder = DEFAULT_FOLDER) {
  const { held } = await readTasksState(root, folder);
  return Object.keys(held)[0] ?? null;
}
