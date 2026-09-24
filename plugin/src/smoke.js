import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { sectionOf } from './folder/requirements.js';
import { runnable, splitArgs } from './which.js';
import { readText } from './fsutil.js';

/**
 * Smoke against what is deployed. Specification §23.
 *
 * "Smoke is the test that runs against the *deployed* application, not the built one; a green
 * build with a red smoke is a deploy problem, and `vibekit ship rollback` is the response."
 *
 * That sentence is the whole design. The build already passed — running the same suite again
 * proves nothing. What this runs is the command `map.md` names for smoke, pointed at a real
 * address, and what it does with a failure is the point: a red smoke has exactly one correct
 * next step, and naming it is more useful than a number.
 */

const exec = promisify(execFile);

/** §23 — the walking skeleton's first smoke: health answers, database reachable, auth issues a token. */
export const DEFAULT_CHECKS = Object.freeze([
  { path: '/health', means: 'the process is up' },
  { path: '/ready', means: 'its dependencies are reachable' },
]);

/** The smoke command from `product/map.md`, which is the only place commands are allowed to live. */
export async function smokeCommand(root, folder = DEFAULT_FOLDER) {
  const map = (await readText(join(root, folder, 'product/map.md'))) ?? '';
  const fenced = sectionOf(map, 'Commands').match(/```[^\n]*\n([\s\S]*?)```/)?.[1] ?? '';
  for (const line of fenced.split('\n')) {
    const matched = line.trim().match(/^smoke\s{2,}(.+)$/);
    if (matched && !/TODO/i.test(matched[1])) return matched[1].trim();
  }
  return null;
}

/**
 * The endpoints a deployed application must answer, read from `delivery/observability.md` where
 * the team wrote them and falling back to §23's two.
 */
export async function healthChecks(root, folder = DEFAULT_FOLDER) {
  const observability = (await readText(join(root, folder, 'delivery/observability.md'))) ?? '';
  const rows = sectionOf(observability, 'Endpoints the walking skeleton must answer')
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/`/g, '')))
    .filter((cells) => cells.length >= 2 && cells[0].startsWith('/'));

  return rows.length ? rows.map(([path, means]) => ({ path, means })) : [...DEFAULT_CHECKS];
}

/**
 * Probe one endpoint of a running application.
 *
 * A non-2xx is a failure and so is a timeout, but they are reported differently: one means the
 * application answered and said no, the other means nothing answered at all, and those have
 * different causes.
 */
export async function probe(url, { timeoutMs = 10_000, fetchImpl = fetch, allowPrivate = false, resolve = undefined } = {}) {
  const started = Date.now();
  try {
    // Every hop is checked, not just the first: a public page that redirects to the metadata
    // service is the case the guard exists for.
    const { safeFetch } = await import('./netguard.js');
    const response = await safeFetch(url, { signal: AbortSignal.timeout(timeoutMs), fetchImpl, allowPrivate, ...(resolve ? { resolve } : {}) });
    return {
      url,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      why: response.ok ? null : `it answered ${response.status}`,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      ms: Date.now() - started,
      why: /abort|timeout/i.test(String(error.message)) ? `nothing answered within ${timeoutMs}ms` : String(error.message),
    };
  }
}

/**
 * Run the smoke: the team's command if they have one, the health endpoints if they do not.
 *
 * Both, when both exist. A team with a smoke suite still wants to know their health endpoint is
 * answering, and a team without one still gets something real rather than a skipped step.
 */
export async function smoke(root, { folder = DEFAULT_FOLDER, url = null, timeoutMs = 10_000, fetchImpl = fetch, allowPrivate = false, resolve = undefined } = {}) {
  if (url) {
    // Refused before anything runs, with the flag that says "yes, internal is the point".
    const { refuseUrl } = await import('./netguard.js');
    const why = await refuseUrl(url, { allowPrivate, ...(resolve ? { resolve } : {}) });
    if (why) throw new Error(why);
  }
  const command = await smokeCommand(root, folder);
  const checks = url ? await healthChecks(root, folder) : [];
  const results = { command: null, probes: [], ok: true, ran: false };

  if (command) {
    results.ran = true;
    const [binary, ...rest] = splitArgs(command);
    const spawn = runnable(binary, rest);
    const outcome = await exec(spawn.command, spawn.args, {
      cwd: root,
      shell: spawn.shell,
      maxBuffer: 16 * 1024 * 1024,
      // The deployed address is passed in the environment rather than spliced into the command:
      // a URL in a shell string is one quoting mistake away from running something else.
      env: { ...process.env, ...(url ? { VIBEKIT_SMOKE_URL: url, BASE_URL: url } : {}) },
    }).then((done) => ({ code: 0, output: `${done.stdout}${done.stderr}` }))
      .catch((error) => ({ code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }));

    results.command = { command, code: outcome.code, ok: outcome.code === 0, output: outcome.output };
    if (outcome.code !== 0) results.ok = false;
  }

  for (const check of checks) {
    results.ran = true;
    const result = await probe(new URL(check.path, url).toString(), { timeoutMs, fetchImpl, allowPrivate, resolve });
    results.probes.push({ ...result, means: check.means });
    if (!result.ok) results.ok = false;
  }

  return results;
}

/**
 * §23 — what a red smoke means, in the words that name the next step.
 *
 * "A green build with a red smoke is a deploy problem." Saying that is the useful part: the
 * instinct on a failing test is to look at the code, and this is the one case where that is the
 * wrong place to look.
 */
export function verdict(results, { tag = null } = {}) {
  if (!results.ran) {
    return {
      ok: null,
      line: 'Nothing ran: product/map.md names no smoke command, and no --url was given to probe.',
      next: 'Add a `smoke` line to the Commands block in map.md, or pass --url for the health endpoints.',
    };
  }
  if (results.ok) {
    return { ok: true, line: 'Smoke is green against the deployed application.', next: null };
  }
  return {
    ok: false,
    line: 'Smoke is red against the deployed application. The build passed, so this is a deploy problem, not a code problem.',
    next: `vibekit ship rollback${tag ? ` ${tag}` : ''}  — redeploying the last good tag is the response, and it opens a hotfix requirement with the incident note.`,
  };
}
