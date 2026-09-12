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

// Where tools install themselves when they are not on PATH. Most are under the home directory,
// but /usr/local/bin and /opt/homebrew/bin are not — which matters for tests: redirecting HOME
// cannot hide an `npm install -g` on macOS or Linux, so a machine that really has agentmemory
// installed could not simulate its absence, and the result would differ by whose laptop it ran on.
// VIBECHECK_TOOL_DIRS pins the list (empty for none), in the same family as VIBECHECK_PLATFORM.
const EXTRA_BIN_DIRS = () => {
  const pinned = process.env.VIBECHECK_TOOL_DIRS;
  if (pinned !== undefined) return pinned.split(delimiter).filter(Boolean);
  return [
    join(homedir(), '.local', 'bin'), join(homedir(), '.cursor', 'bin'), join(homedir(), '.claude', 'local'),
    join(homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin',
    ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []),
  ];
};

export const searchPath = () => [process.env.PATH ?? '', ...EXTRA_BIN_DIRS()].filter(Boolean).join(delimiter);
export const toolEnv = () => ({ ...process.env, PATH: searchPath() });
