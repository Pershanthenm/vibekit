// Opening a Cloudflare tunnel, so the console on this machine can be reached from a phone.
//
// The server stays on loopback either way. A tunnel dials out from here to Cloudflare and traffic
// comes back down that connection, so nothing is listening on your network and no router is
// touched. vibekit does not bundle cloudflared and does not depend on it: without `--tunnel`
// nothing here runs, and the console is exactly as local as it was.
//
// What a quick tunnel is, stated plainly because it decides whether you should use one: the
// hostname Cloudflare hands out is public. Anyone who has it reaches this machine, and the only
// things in the way are the random path the console is served under and — for anything that
// changes the project — the write token. That is fine for a session you start and stop while you
// watch a build. It is not something to leave running, and the caller is expected to say so.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Cloudflare prints the hostname it assigned; this is the only thing taken from its output. */
export const TUNNEL_URL = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/**
 * Where each platform's installer puts cloudflared, for when it is installed but not on PATH.
 *
 * This is not a guess at where it might be: an installer adds its folder to the *machine* PATH,
 * and a shell that was already open when it ran never sees it. So "cloudflared is not installed"
 * is wrong in the one case people hit most — they just installed it, in the terminal they are
 * still sitting in. Looking in the installer's own folder turns that into a working tunnel.
 *
 * The Windows path is winget's, confirmed on a machine that had just installed it. The Unix paths
 * are Homebrew's two prefixes (Apple Silicon and Intel) and the system package directory.
 */
const KNOWN_PATHS = {
  win32: ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'],
  darwin: ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'],
  linux: ['/usr/local/bin/cloudflared', '/usr/bin/cloudflared'],
};

export const DEFAULT_COMMAND = 'cloudflared';

export const installedAt = (platform = process.platform) =>
  (KNOWN_PATHS[platform] ?? KNOWN_PATHS.linux).find((path) => existsSync(path)) ?? null;

// Long enough for a cold start on a slow connection, short enough that a wedged process is not
// mistaken for a slow one.
export const TUNNEL_TIMEOUT_MS = 45_000;

const INSTALL = {
  win32: 'winget install --id Cloudflare.cloudflared',
  darwin: 'brew install cloudflared',
  linux: 'see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
};

export const installHint = (platform = process.platform) => INSTALL[platform] ?? INSTALL.linux;

/**
 * Start a quick tunnel to a local port and resolve once Cloudflare has named it.
 *
 * Rejects rather than hanging in the three ways this actually fails: cloudflared is not installed,
 * it exits before naming a tunnel (usually a network or DNS problem, where its own message is the
 * useful part), or it says nothing at all within the timeout.
 */
export function openTunnel(port, { command = DEFAULT_COMMAND, timeoutMs = TUNNEL_TIMEOUT_MS, args = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args ?? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = false;
    const close = () => {
      child.removeAllListeners('exit');
      child.kill();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      close();
      reject(new Error(`${command} did not report a tunnel address within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    // A tunnel must never be the reason a terminal will not close.
    timer.unref?.();

    const read = (chunk) => {
      if (settled) return;
      // cloudflared prints its banner and the hostname on stderr; both streams are watched so a
      // change of heart upstream does not silently break this.
      output += chunk;
      const [url] = output.match(TUNNEL_URL) ?? [];
      if (!url) return;
      settled = true;
      clearTimeout(timer);
      resolve({ url, port, close, process: child });
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error.code !== 'ENOENT') return reject(error);
      // Installed, but this shell's PATH predates the install: use it where the installer put it.
      // Only ever for the default command — a caller that named its own has named it for a reason,
      // and quietly running something else instead would be worse than failing.
      const found = command === DEFAULT_COMMAND ? installedAt() : null;
      if (found && found !== command) {
        return resolve(openTunnel(port, { command: found, timeoutMs, args }));
      }
      reject(new Error(`cloudflared is not installed, or not on PATH. Install it with:\n  ${installHint()}`));
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Its own words are more useful than anything this could invent about why.
      const tail = output.trim() ? `\n${output.trim().split('\n').slice(-4).join('\n')}` : '';
      reject(new Error(`${command} exited with ${code} before opening a tunnel.${tail}`));
    });
  });
}
