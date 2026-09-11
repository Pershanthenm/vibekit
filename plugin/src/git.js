import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export const worktreeBase = (root) => join(dirname(root), `${basename(root)}.worktrees`);

export function isInstalled(command) {
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !probe.error;
}

export function assertCleanTree(root, reason) {
  const changes = git(root, 'status', '--porcelain');
  if (changes) throw new Error(`Uncommitted changes — ${reason}:\n${changes}`);
}

export function runLogged(command, args, { cwd, logPath }) {
  return new Promise((resolvePromise) => {
    const log = createWriteStream(logPath, { flags: 'a' });
    log.write(`\n$ ${command} ${args.map((arg) => (arg.length > 60 ? '<prompt>' : arg)).join(' ')}\n`);
    const child = spawn(command, args, { cwd, shell: args.length === 0, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', (error) => log.write(`${error.message}\n`));
    child.on('close', (code) => log.end(() => resolvePromise(code ?? 1)));
  });
}
