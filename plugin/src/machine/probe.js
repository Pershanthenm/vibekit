import { spawnSync } from 'node:child_process';
import { toolEnv } from './platform.js';

const TIMEOUT_MS = 20000;

export function probe(command, args = ['--version'], { timeout = TIMEOUT_MS, cwd } = {}) {
  const result = spawnSync(command, args, { env: toolEnv(), encoding: 'utf8', timeout, cwd, shell: process.platform === 'win32' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { found: !result.error || result.error.code !== 'ENOENT', ok: result.status === 0, output, firstLine: output.split('\n')[0]?.slice(0, 120) ?? '' };
}

export function firstAvailable(commands, args) {
  for (const command of commands) {
    const result = probe(command, args);
    if (result.ok) return { command, ...result };
  }
  return null;
}

export const majorVersion = (text) => Number(String(text).match(/(\d+)\.\d+/)?.[1] ?? 0);

export async function httpOk(url, timeout = 2500) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
}

export function runShell(command, platform, { cwd } = {}) {
  const [shell, args] = platform === 'windows' ? ['powershell', ['-NoProfile', '-Command', command]] : ['sh', ['-c', command]];
  return spawnSync(shell, args, { env: toolEnv(), stdio: 'inherit', cwd }).status ?? 1;
}
