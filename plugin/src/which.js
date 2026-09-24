import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * The absolute path of a command on PATH, or null when it is not there.
 *
 * Windows needs this. Node does not apply PATHEXT when spawning without a shell, so a `.cmd`
 * shim — which is how npm installs almost every CLI — is never found by name alone, and the
 * extensionless file beside it is a shell script Windows cannot execute. Only PATHEXT variants
 * are considered there, so the answer is always something runnable.
 *
 * This is resolved in-process rather than with `where`, which lives in System32 and is itself
 * absent from a trimmed PATH.
 */
export function which(command) {
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * A command line as its words, the way a shell would read it but without running one.
 *
 * `command.split(/\s+/)` handed node the literal string `"process.exit(3)"` — quotes included —
 * which evaluates to a string and exits 0. Every runner here spawns without a shell on purpose, so
 * this is the one place quoting is understood: double and single quotes group words, a backslash
 * escapes the next character outside single quotes, and nothing is expanded. A `$` or a `;` is a
 * character, not an instruction.
 */
export function splitArgs(text) {
  const words = [];
  let current = '';
  let quote = null;
  let started = false;
  const source = String(text ?? '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) { quote = null; continue; }
      // Only `\"` and `\\` are escapes inside double quotes. A Windows path is
      // `"C:\Program Files\nodejs\node.exe"` — treating `\P` or `\n` as an escape
      // would silently destroy it, and then the spawn would look for a different file.
      if (character === '\\' && quote === '"' && index + 1 < source.length) {
        const next = source[index + 1];
        if (next === '"' || next === '\\') { current += source[index += 1]; continue; }
      }
      current += character;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; started = true; continue; }
    if (character === '\\' && index + 1 < source.length) {
      const next = source[index + 1];
      if (process.platform === 'win32' && next !== '"' && next !== '\\') {
        current += character;
        started = true;
        continue;
      }
      current += source[index += 1];
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) { words.push(current); current = ''; started = false; }
      continue;
    }
    current += character;
    started = true;
  }
  if (quote) throw new Error(`Unbalanced ${quote} in: ${source}`);
  if (started) words.push(current);
  return words;
}

/** The command to spawn: its resolved path where one exists, otherwise the bare name. */
export const resolveCommand = (command) => which(command) ?? command;

/**
 * Node refuses to spawn a .cmd or .bat without a shell (CVE-2024-27980), so those need one.
 * Everything else is spawned directly, which keeps arguments out of a command line entirely.
 */
export const needsShell = (resolved) => process.platform === 'win32' && /[.](cmd|bat)$/i.test(resolved);

// With a shell, Node concatenates arguments without escaping them, so anything that the
// command line would otherwise split or interpret is quoted here.
const quote = (arg) => (/[\s"&|<>^()]/.test(String(arg)) ? `"${String(arg).replace(/"/g, '""')}"` : String(arg));
export const shellSafe = (args, useShell) => (useShell ? args.map(quote) : args);

// cmd.exe parses a newline as the end of a command, so an argument containing one is
// truncated and every argument after it is lost. Spawning an executable directly avoids
// that: CreateProcess passes the command line through verbatim. A .cmd shim usually sits
// beside the Node script it wraps, so run that script with this Node instead of the shim.
function nodeScriptBeside(resolved) {
  const bare = resolved.replace(/[.](cmd|bat)$/i, '');
  if (bare === resolved || !existsSync(bare)) return null;
  try {
    const head = readFileSync(bare, 'utf8').slice(0, 200);
    const shebang = head.split(String.fromCharCode(10))[0];
    return shebang.startsWith('#!') && shebang.includes('node') ? bare : null;
  } catch {
    return null;
  }
}

/** A command, its arguments and spawn options, ready to run on any platform. */
export function runnable(command, args = []) {
  const resolved = resolveCommand(command);
  const script = needsShell(resolved) ? nodeScriptBeside(resolved) : null;
  if (script) return { command: process.execPath, args: [script, ...args], shell: false };
  const shell = needsShell(resolved);
  return { command: resolved, args: shellSafe(args, shell), shell };
}
