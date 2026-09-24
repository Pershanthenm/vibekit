import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HARD_LIMIT, SOFT_LIMIT, keepOutput, nextSessionId, readSessions, record, roomForWork } from '../session.js';
import { TOOLS, createServer, serveStdio } from '../serve/mcp.js';
import { loadRunners } from '../runners.js';
import { PROVIDERS, missingCredential } from '../models/provider.js';
import { readTiers } from '../models/registry.js';
import { NEVER_CROSSES, accessFor, refuseTunnel } from '../serve/tracker.js';
import { SESSION_HOURS } from '../access.js';
import { loadHumans } from '../humans.js';
import { runnable, splitArgs } from '../which.js';
import { folderName } from './folder.js';

/**
 * `vibekit serve`. Specification Appendix A, §55, §60 and §62.
 *
 * The MCP server and agent runner. `--stdio` is the mode a runner actually starts it in; with no
 * arguments it prints what it would expose and what it would enforce, because a server you cannot
 * inspect without wiring it into a client is a server nobody checks.
 *
 * What it deliberately does not do is call a model. That belongs to an API runner (§62), and on a
 * seat runner the model is the tool's own choice — so `serve` enforces the rules and records what
 * happened, which is the part that has to be the same everywhere.
 */

const exec = promisify(execFile);

export async function serve(options) {
  const { root, folder: chosen, stdio, json, tracker } = options;
  const folder = chosen ?? (await folderName(root));

  if (tracker) return void (await serveTracker(root, folder, options));

  const sessions = await readSessions(root, folder);
  const id = nextSessionId(sessions);
  const { runners, mode, calibrate } = await loadRunners(root, folder);

  // §52 — with --sandbox every command the agent runs goes into a fresh container: the worktree
  // writable, the rest of the filesystem read-only, the network off unless the policy names a
  // registry, and none of this process's environment. Without a runtime the session is refused
  // rather than quietly run unsandboxed, because the flag was a decision.
  const { runSandboxed, runtimeReady, sandboxCommand } = await import('../serve/sandbox.js');
  const { parsePolicy } = await import('../deps.js');
  const { readText: read } = await import('../fsutil.js');
  const wantSandbox = Boolean(options.sandbox);
  const registries = parsePolicy((await read(join(root, folder, 'standards/guardrails.md'))) ?? '').registries;
  if (wantSandbox) {
    const ready = await runtimeReady();
    if (!ready.ready) throw new Error(`--sandbox: ${ready.why}. Install docker or podman, or drop --sandbox and accept an unsandboxed session.`);
  }

  const server = createServer(root, {
    folder,
    session: id,
    run: async (command) => {
      if (wantSandbox) {
        const boxed = await runSandboxed(root, command, { registries, session: id, folder });
        if (!boxed.ran) return { code: 126, output: boxed.why };
        const result = { code: boxed.code, output: boxed.output };
        const kept = await keepOutput(root, id, `${Date.now()}.log`, `${boxed.command.caveat}\n\n${result.output}`, folder);
        return { ...result, kept };
      }
      const [head, ...rest] = splitArgs(command);
      const { command: binary, args, shell } = runnable(head, rest);
      const result = await exec(binary, args, { cwd: root, shell, maxBuffer: 32 * 1024 * 1024 })
        .then((done) => ({ code: 0, output: `${done.stdout}${done.stderr}` }))
        .catch((error) => ({ code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }));
      // §60 — nothing is discarded: the whole output goes to disk for the reviewer and `verify`.
      const kept = await keepOutput(root, id, `${Date.now()}.log`, result.output, folder);
      return { ...result, kept };
    },
  });

  if (stdio) {
    await record(root, { id, ended: null, sandbox: wantSandbox ? 'full' : 'none' }, folder);
    await serveStdio(server);
    // §2 of the integration spec — every external call, with the role and what came back, in the
    // session record: the first question a security reviewer asks is which systems the agents touched.
    await record(root, { id, ended: 'handoff', calls: server.state.serverCalls }, folder).catch(() => {});
    return;
  }

  if (json) {
    return void console.log(JSON.stringify({ session: id, mode, calibrate, tools: TOOLS, runners: runners.map((runner) => runner.id) }, null, 2));
  }

  console.log(`vibekit serve · session ${id} · mode ${mode}${calibrate ? ' · calibrating' : ''}`);
  console.log('');
  console.log('Tools it exposes (each a thin wrapper over a file operation)');
  for (const tool of TOOLS) console.log(`  ${tool.name.padEnd(18)} ${tool.description}`);

  console.log('');
  console.log('What it enforces');
  console.log(`  reads    refused outside the stage's loads: manifest, plus files the requirement cites; the attempt is logged`);
  console.log(`  writes   refused outside writes:, inside never:, or on a denied path in standards/guardrails.md`);
  console.log(`  commands refused unless standards/guardrails.md allows them`);
  console.log(`  context  checkpoint asked for at ${Math.round(SOFT_LIMIT * 100)}% of the window, session ended cleanly at ${Math.round(HARD_LIMIT * 100)}%`);
  console.log(`  cadence  file writes refused past 12 tool calls with no checkpoint`);
  console.log('');
  console.log(`  A 200k window leaves about ${roomForWork(200_000).toLocaleString()} tokens for work once the folder is loaded.`);

  const ready = await runtimeReady();
  const boxed = sandboxCommand(root, '<command>', { registries, runtimeName: ready.runtime ?? 'docker' });
  console.log('');
  console.log(`Sandbox (--sandbox) · ${ready.ready ? `${ready.runtime} ready` : ready.why}`);
  console.log(`  read-only filesystem, worktree writable, no host environment, ${boxed.network === 'none' ? 'network off' : `network on for ${registries.join(', ')}`}`);
  console.log(`  ${boxed.caveat}`);
  if (!ready.ready) console.log('  Without --sandbox the agent\'s commands run on this machine as you. check --runners reports that.');

  console.log('');
  console.log('Runners it would route to');
  if (!runners.length) console.log(`  none declared in ${folder}/agents/runners.md`);
  for (const runner of runners) {
    console.log(`  ${runner.id.padEnd(14)} ${runner.kind.padEnd(5)} sandbox ${String(runner.sandbox).padEnd(8)} ${runner.unattended ? 'unattended' : 'needs a person'}`);
  }

  // §62 — the tier only binds on an api runner, and an api runner needs a credential this tool
  // reads from the environment and never writes down.
  const { tiers, declared } = await readTiers();
  if (runners.some((runner) => runner.kind === 'api')) {
    console.log('');
    console.log('Api runners');
    if (!declared) console.log('  ! no tier mapping yet — `vibekit tools rates map` says which model each tier is');
    for (const provider of Object.keys(PROVIDERS)) {
      const missing = missingCredential(provider);
      console.log(`  ${provider.padEnd(10)} ${missing ? `${PROVIDERS[provider].env} not set` : `${PROVIDERS[provider].env} set`}`);
    }
    if (declared) {
      for (const [tier, model] of Object.entries(tiers)) console.log(`  ${tier.padEnd(10)} ${model}`);
    }
    console.log('  A key is read from the environment and never written into the repository.');
  }

  console.log('');
  console.log('  Start it the way a runner does:  vibekit serve --stdio');
  console.log('  Claude Code reads CLAUDE.md and talks to this over MCP; file-only runners get the same rules as instructions.');
}


/**
 * `vibekit serve --tracker`. Specification §57.
 *
 * The same page the dashboard renders, served from this process, reading the folder and
 * `.state/` directly. What `serve` adds is identity: with Cloudflare Access in front, every
 * request carries a signed token and the email in it maps to a role in `agents/humans.md`.
 */
async function serveTracker(root, folder, options) {
  const { serveDashboard } = await import('./dashboard.js');
  const hostname = options.hostname ?? process.env.VIBEKIT_TRACKER_HOSTNAME ?? null;
  const teamDomain = options.team ?? process.env.CLOUDFLARE_TEAM_DOMAIN ?? null;
  const audience = options.audience ?? process.env.CLOUDFLARE_ACCESS_AUD ?? null;

  const humans = await loadHumans(root, folder);
  if (!humans.approvers.length) {
    console.log(`! ${folder}/agents/humans.md names nobody with an email, so no login can map to a role.`);
    console.log('  Everyone who signs in sees a read-only page until it does.');
    console.log('');
  }

  // §57 — refuse rather than expose. An unprotected tunnel is the failure where the page works
  // perfectly for anybody who finds it, so a hostname that could not be checked behaves like a
  // hostname with no policy.
  if (hostname) {
    const refusal = await refuseTunnel(hostname, {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      force: options.force,
    });
    if (refusal) {
      console.log(`\u2716 Not starting a tunnel to ${hostname}.`);
      console.log('');
      console.log(refusal);
      process.exitCode = 1;
      return;
    }
    console.log(`\u2714 ${hostname} is behind an Access policy.`);
  }

  const access = accessFor(root, { teamDomain, audience, folder });

  if (options['dry-run']) {
    console.log(`Would serve ${folder}/ on 127.0.0.1${options.port ? `:${options.port}` : ''}, behind ${access ? `Access at ${teamDomain}` : 'a write token'}.`);
    console.log('  Nothing was started. A server that blocks is right for a person and wrong for a script.');
    return;
  }
  if (!access) {
    console.log('No Cloudflare team domain is set, so Access identity is off and the write token decides.');
    console.log('  Set CLOUDFLARE_TEAM_DOMAIN and CLOUDFLARE_ACCESS_AUD to map a login to a role in humans.md.');
  } else {
    console.log(`Access: ${teamDomain}${audience ? ` \u00b7 audience ${audience.slice(0, 8)}\u2026` : ' \u00b7 no audience set, which accepts a token minted for any app in the account'}`);
    console.log(`  Sessions expire after ${SESSION_HOURS}h, and on any change to ${folder}/agents/humans.md.`);
    console.log('  Read-only unless named: the QR code can safely be on a wall, because scanning it gets a login, not access.');
  }
  console.log(`  Never crosses the tunnel: ${NEVER_CROSSES.join(', ')}.`);
  console.log('');

  const served = await serveDashboard(root, {
    port: options.port ? Number.parseInt(options.port, 10) : undefined,
    host: '127.0.0.1',
    access,
    folder,
  });
  console.log(`  Tracker on http://127.0.0.1:${served.port}/${served.path}`);
  console.log('  Bound to localhost: the only route in is the tunnel.');
  if (!access) console.log(`  Write token: ${served.token}`);
}
