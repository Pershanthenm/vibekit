import { existsSync } from 'node:fs';
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

/** A command, its arguments and spawn options, ready to run on any platform. */
export function runnable(command, args = []) {
  const resolved = resolveCommand(command);
  const shell = needsShell(resolved);
  return { command: resolved, args: shellSafe(args, shell), shell };
}
