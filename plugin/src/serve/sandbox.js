import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { which } from '../which.js';

/**
 * A container per session. Specification §52.
 *
 * "`vibekit serve` runs agents in a container per session: the worktree mounted read-write, the
 * rest of the filesystem read-only, network limited to the package registries in the allow-list
 * and the git remote, no access to the host's environment variables."
 *
 * The container is the last line: a prompt injection that gets past the allowed-command list and
 * the denied paths still runs inside something that can see one directory and no secrets. Each
 * clause of §52 is one flag below, and the one this cannot do honestly is named rather than
 * approximated: a container runtime cannot allow-list network *hosts*, only turn the network on or
 * off, so the network is off unless the policy names registries, and the report says which.
 *
 * File-only runners (Claude Code, Cursor) cannot be sandboxed by VibeKit at all; `check --runners`
 * reports them as unsandboxed, and the gate policy may forbid L requirements on them.
 */

const exec = promisify(execFile);

export const RUNTIMES = Object.freeze(['docker', 'podman']);

/** The image the agent's commands run in. Overridable; the default has node and git and little else. */
export const DEFAULT_IMAGE = process.env.VIBEKIT_SANDBOX_IMAGE ?? 'node:22-bookworm-slim';

/** Environment the container may see. Never the host's; only what is named, and never a secret. */
const SAFE_ENV = Object.freeze(['CI', 'TERM', 'LANG', 'VIBEKIT_SESSION', 'VIBEKIT_FOLDER']);

export const runtime = () => RUNTIMES.find((name) => which(name)) ?? null;

/**
 * The argv for one command in a container, with each §52 clause as a flag.
 *
 * Built as data and returned, rather than run, so the exact command a session used can be
 * recorded in `sessions.json` and asserted in a test without a runtime present.
 */
export function sandboxCommand(root, command, {
  runtimeName = 'docker',
  image = DEFAULT_IMAGE,
  registries = [],
  remote = null,
  env = {},
  session = null,
  folder = 'vibekit',
  proxy = process.env.VIBEKIT_EGRESS_PROXY ?? null,
} = {}) {
  const worktree = resolve(root);
  const network = registries.length ? 'bridge' : 'none';
  // §52's "network limited to the package registries in the allow-list" is a rule a runtime cannot
  // enforce, but an egress proxy can. When one is named, every tool in the container that honours
  // the proxy variables (npm, pip, dotnet, curl, git) goes through it, and its allow-list is the
  // real rule. Only with the network on: a proxy for a container with no network is noise.
  const viaProxy = network === 'bridge' && proxy ? String(proxy).trim() : null;

  const argv = [
    'run', '--rm', '--interactive',
    // the rest of the filesystem read-only; only the worktree and a scratch tmpfs are writable
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '--volume', `${worktree}:/work:rw`,
    '--workdir', '/work',
    // no capabilities, no privilege escalation, bounded processes and memory
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '512',
    '--memory', '2g',
    // the network is off unless the policy names a registry; a runtime cannot allow-list hosts
    '--network', network,
    // no host environment: the container starts empty and gets only what is named
    '--env', `HOME=/tmp`,
    '--env', `VIBEKIT_SANDBOX=1`,
    ...(session ? ['--env', `VIBEKIT_SESSION=${session}`] : []),
    ...(folder ? ['--env', `VIBEKIT_FOLDER=${folder}`] : []),
    ...Object.entries(env).filter(([key]) => SAFE_ENV.includes(key)).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    ...(viaProxy ? [
      '--env', `HTTP_PROXY=${viaProxy}`, '--env', `HTTPS_PROXY=${viaProxy}`,
      '--env', `http_proxy=${viaProxy}`, '--env', `https_proxy=${viaProxy}`,
      '--env', 'NO_PROXY=localhost,127.0.0.1', '--env', 'no_proxy=localhost,127.0.0.1',
    ] : []),
    ...(remote ? ['--label', `vibekit.remote=${remote}`] : []),
    '--label', 'vibekit=1',
    image,
    'sh', '-c', command,
  ];

  return {
    runtime: runtimeName,
    argv,
    network,
    proxy: viaProxy,
    // Said plainly, because it is the clause a container cannot honour by itself.
    caveat: !registries.length
      ? 'network is off: the policy names no registry, so nothing leaves the container'
      : viaProxy
        ? `network is on, routed through ${viaProxy} for ${registries.join(', ')}: the proxy's allow-list is the rule, and a tool that ignores HTTP_PROXY still has the network`
        : `network is on for ${registries.join(', ')}: a container runtime cannot allow-list hosts, so this is "network" not "these registries". Set VIBEKIT_EGRESS_PROXY to an allow-listing proxy for the real rule.`,
  };
}

/**
 * Run one command in a fresh container. Returns the exit code and output, and what it ran.
 *
 * `execFile` with the runtime binary and an argv, never a shell string: the sandbox exists to
 * contain the agent's command, and building the container command from a template would be one
 * more place a quote could escape.
 */
export async function runSandboxed(root, command, options = {}) {
  const name = options.runtimeName ?? runtime();
  if (!name) {
    return {
      ran: false,
      sandboxed: false,
      why: 'no container runtime: install docker or podman, or run without --sandbox and accept that this session is unsandboxed',
    };
  }
  const built = sandboxCommand(root, command, { ...options, runtimeName: name });
  const started = Date.now();
  const outcome = await exec(which(name) ?? name, built.argv, {
    timeout: options.timeoutMs ?? 20 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    // The parent's environment is not passed to the runtime process either; it needs its own path
    // to find the daemon socket and nothing else.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST ?? '', XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? '' },
  })
    .then((done) => ({ code: 0, output: `${done.stdout}${done.stderr}` }))
    .catch((error) => ({ code: error.killed ? 124 : (error.code ?? 1), output: `${error.stdout ?? ''}${error.stderr ?? ''}`, timedOut: Boolean(error.killed) }));

  return { ran: true, sandboxed: true, ...outcome, seconds: Math.round((Date.now() - started) / 1000), command: built };
}

/** Is a runtime actually reachable, not just on PATH? A socket that is not running is not a sandbox. */
export async function runtimeReady(name = runtime()) {
  if (!name) return { ready: false, why: 'no docker or podman on PATH' };
  try {
    await exec(which(name) ?? name, ['version', '--format', '{{.Server.Version}}'], { timeout: 10_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST ?? '' } });
    return { ready: true, runtime: name };
  } catch (error) {
    return { ready: false, runtime: name, why: `${name} is installed but not running: ${String(error.stderr ?? error.message).trim().split('\n')[0]}` };
  }
}
