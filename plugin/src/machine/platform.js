import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

function isWsl() {
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

export function detectPlatform() {
  if (process.env.VIBECHECK_PLATFORM) return process.env.VIBECHECK_PLATFORM;
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return isWsl() ? 'wsl' : 'linux';
}

export const PLATFORM_NAMES = { macos: 'macOS', linux: 'Linux', wsl: 'Linux on WSL2', windows: 'Windows' };

const EXTRA_BIN_DIRS = () => [
  join(homedir(), '.local', 'bin'), join(homedir(), '.cursor', 'bin'), join(homedir(), '.claude', 'local'),
  join(homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin',
  ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []),
];

export const searchPath = () => [process.env.PATH ?? '', ...EXTRA_BIN_DIRS()].filter(Boolean).join(delimiter);
export const toolEnv = () => ({ ...process.env, PATH: searchPath() });
