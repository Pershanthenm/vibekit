import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { roundProblems } from '../folder/converge.js';
import { runChecks } from '../folder/checks.js';
import { appendLog, listRequirements, readTasksState, writeSection } from '../folder/requirements.js';
import { gerund } from '../folder/sprints.js';
import { archdocs } from './archdocs.js';
import { folderName, req } from './folder.js';
import { config } from './maintain.js';
import { release } from './release.js';
import { revert } from './release.js';
import { report } from './report.js';
import { quick } from './shortcuts.js';
import { tools } from './tools.js';

/**
 * The everyday verbs of §67 that are one line each over something that already exists. Kept as
 * calls rather than copies so `vibekit hotfix` and `vibekit quick --hotfix` cannot drift apart.
 */

/** `vibekit feature add "<text>"` — one feature mid-project. */
export async function feature(options) {
  const [verb, ...rest] = options.args;
  if (verb !== 'add') throw new Error('Usage: vibekit feature add "<what it should do>"');
  return req({ ...options, args: ['new', ...rest] });
}

/** `vibekit hotfix "<text>"` — production is broken: an S requirement on hotfix/*, compliance pass, patch release. */
export const hotfix = (options) => quick({ ...options, hotfix: true });

/** `vibekit rollback <tag>` — put the previous release back and open a hotfix with the incident note. */
export async function rollback(options) {
  const [tag] = options.args;
  if (!tag) throw new Error('Usage: vibekit rollback <tag> [--why "<incident note>"]');
  return release({ ...options, args: [], rollback: tag });
}

/** `vibekit undo <id>` — remove a shipped feature cleanly; dependants go to review. */
export const undo = (options) => revert(options);

/** `vibekit docs` — the architecture documents and diagrams (§66). */
export const docs = (options) => archdocs(options);

/** `vibekit settings` — models, tiers, runners, caps, templates, brand, frameworks. */
export async function settings(options) {
  const [area, ...rest] = options.args;
  if (!area) {
    await config({ ...options, args: [] });
    console.log('');
    await tools({ ...options, args: ['policy'] });
    console.log('');
    console.log('  vibekit settings <key> <value>      a machine setting (team-memory, team-skills, tunnel-token, …)');
    console.log('  vibekit settings tiers [map]        which model each tier is · vibekit tools rates for the prices');
    console.log('  vibekit settings frameworks         which security frameworks a scan measures against');
    console.log('  vibekit settings trust <name> <pub> trust an extension publisher\'s key · untrust <name> · require-signed true');
    return;
  }
  // Integration spec §5.1 — which extension publishers this machine trusts. The store is machine
  // settings, like credentials: a fork must not inherit whose signature a team accepts.
  if (area === 'trust' || area === 'untrust' || area === 'trusted') {
    const { fingerprintOf, readTrusted, trustKey, untrustKey } = await import('../signing.js');
    if (area === 'untrust') {
      if (!rest[0]) throw new Error('Usage: vibekit settings untrust <name>');
      const was = await untrustKey(rest[0]);
      if (options.json) return void console.log(JSON.stringify({ name: rest[0], removed: was }));
      return void console.log(was ? `✔ ${rest[0]} is no longer trusted` : `${rest[0]} was not trusted.`);
    }
    if (area === 'trust' && rest.length) {
      const [name, file] = rest;
      if (!file) throw new Error('Usage: vibekit settings trust <name> <public key file>');
      const { readText } = await import('../fsutil.js');
      const pem = await readText(file);
      if (!pem) throw new Error(`${file} is not readable.`);
      const result = await trustKey(name, pem);
      if (options.json) return void console.log(JSON.stringify(result));
      return void console.log(`✔ ${name} trusted · ${result.fingerprint.slice(0, 12)}… · extensions it signs install without the unknown-key warning`);
    }
    const trusted = await readTrusted();
    if (options.json) return void console.log(JSON.stringify(Object.fromEntries(Object.entries(trusted).map(([name, entry]) => [name, { fingerprint: entry.fingerprint ?? fingerprintOf(entry.publicKey), added: entry.added }])), null, 2));
    if (!Object.keys(trusted).length) return void console.log('No trusted publishers. vibekit settings trust <name> <public key file> adds one; vibekit settings require-signed true refuses the rest.');
    for (const [name, entry] of Object.entries(trusted)) console.log(`  ${name.padEnd(20)} ${(entry.fingerprint ?? fingerprintOf(entry.publicKey)).slice(0, 16)}… · added ${String(entry.added ?? '').slice(0, 10)}`);
    return;
  }
  if (area === 'tiers') return tools({ ...options, args: ['rates', ...(rest[0] === 'map' ? ['map'] : [])] });
  // Integration spec §2 — credentials for consumed MCP servers: machine settings, scoped per server,
  // never in the folder and never in a commit.
  if (area === 'server' || area === 'servers') {
    const { credentialFor, loadServers, setCredential } = await import('../servers.js');
    const [id, token] = rest;
    if (id && token !== undefined) {
      await setCredential(id, token === 'none' || token === '' ? null : token);
      console.log(token && token !== 'none' ? `✔ credential for ${id} saved to machine settings (owner-only). It is never written to the folder.` : `✔ credential for ${id} removed.`);
      return;
    }
    const folder = options.folder ?? (await folderName(options.root));
    const servers = await loadServers(options.root, { folder }).catch(() => []);
    if (options.json) return void console.log(JSON.stringify(await Promise.all(servers.map(async (server) => ({ id: server.id, url: server.url, tools: server.tools, roles: server.roles, credential: Boolean(await credentialFor(server.id)) }))), null, 2));
    if (!servers.length) return void console.log(`No MCP servers declared in ${folder}/agents/servers.yml. Declare one there; the credential goes here: vibekit settings server <id> <token>.`);
    for (const server of servers) console.log(`  ${server.id.padEnd(16)} ${(await credentialFor(server.id)) ? 'credential set' : 'no credential'} · ${server.tools.length} tool(s) · ${server.roles.join(', ')} · data ${server.data}${server.problems.length ? ` · ! ${server.problems[0]}` : ''}`);
    console.log('  vibekit settings server <id> <token>   ·   vibekit settings server <id> none   ·   vibekit check --servers');
    return;
  }
  if (area === 'frameworks') {
    const { frameworksFor } = await import('../security/scan.js');
    const folder = options.folder ?? (await folderName(options.root));
    const chosen = await frameworksFor(options.root, { folder, requested: rest.length ? rest : null });
    if (options.json) return void console.log(JSON.stringify(chosen, null, 2));
    for (const framework of chosen) console.log(`  ${framework.id.padEnd(16)} ${framework.applies ? 'measured' : 'not applicable'}  ${framework.why}`);
    return;
  }
  return config({ ...options, args: [area, ...rest] });
}

/** `vibekit cost` — spend against forecast, by sprint, model and piece of work, with the escalation rate. */
export async function cost(options) {
  const folder = options.folder ?? (await folderName(options.root));
  await report({ ...options, folder, args: ['budget'] });
  const { readSessions } = await import('../session.js');
  const sessions = await readSessions(options.root, folder).catch(() => []);
  const escalated = sessions.filter((session) => session.escalated || /escalat/i.test(String(session.why ?? '')));
  if (!options.json) {
    console.log('');
    console.log(sessions.length
      ? `  Escalation rate: ${escalated.length} of ${sessions.length} session(s) (${Math.round((escalated.length / sessions.length) * 100)}%)${escalated.length / Math.max(sessions.length, 1) > 0.1 ? ' — over 10%: the cheap mapping is too weak for this template' : ''}`
      : '  No sessions recorded yet, so there is no escalation rate. The forecast above is a floor.');
  }
}

/**
 * `vibekit review` — the reviewer's mechanical half over anything waiting, out of band: which
 * criteria have no named test, whether the evidence is green for this commit, what the checks
 * say. The judgement half (a rule interpreted loosely, a clever import) is a model's job, and
 * with `--as reviewer` this holds the requirement for that session and prints the prompt.
 */
export async function review(options) {
  const { root, json } = options;
  const folder = options.folder ?? (await folderName(root));
  const requirements = await listRequirements(root, folder);
  const [only] = options.args;
  const waiting = requirements.filter((entry) => (only ? entry.id === only : ['tested', 'review'].includes(entry.status)));
  if (!waiting.length) {
    if (json) return void console.log('[]');
    console.log(only ? `${only} is not waiting for review.` : 'Nothing is waiting for a second pair of eyes.');
    return;
  }

  const checks = await runChecks(root, { folder }).catch(() => ({ findings: [] }));
  const results = [];
  for (const entry of waiting) {
    const problems = (await roundProblems(root, { folder, ids: [entry.id] })).filter((problem) => problem.kind !== 'check');
    const compliance = checks.findings.filter((finding) => finding.severity === 'error' && new RegExp(`\\b${entry.id}\\b`).test(finding.message));
    results.push({ id: entry.id, title: entry.title, status: entry.status, problems, compliance, clean: !problems.length && !compliance.length });
  }
  if (json) return void console.log(JSON.stringify(results, null, 2));

  for (const result of results) {
    console.log(`${result.clean ? '✔' : '✖'} ${gerund(result.title)}  (${result.id}, ${result.status})`);
    for (const problem of result.problems) console.log(`    - ${problem.message}`);
    for (const finding of result.compliance) console.log(`    - compliance: ${finding.message}`);
    if (result.clean) console.log('    mechanically clean: criteria mapped, evidence green for this commit, no open asks');
  }

  if (options.as === 'reviewer' && only) {
    const held = (await readTasksState(root, folder)).held[only];
    if (!held) await req({ ...options, args: ['start', only], as: 'reviewer' }).catch((error) => console.log(`  ! ${error.message}`));
    console.log(`  prompt: ${folder}/workflow/stages/6-test.md — the judgement half. Write ## Verification and ## Review, then release the hold.`);
  } else if (options.approve && only) {
    // A verdict a person types from the terminal, recorded exactly as the reviewer would.
    const result = results[0];
    if (!result.clean) throw new Error(`${only} is not mechanically clean; an approval over red facts would be a sentence, not a verdict.`);
    await writeSection(root, only, 'Review', `Approved by ${options.by ?? 'reviewer'}: criteria mapped to named tests, evidence green for this commit.`, folder);
    await appendLog(root, only, `review approved by ${options.by ?? 'reviewer'}`, folder);
    console.log(`✔ ${only} review written. A person sets done: vibekit req done ${only}`);
  } else {
    console.log('');
    console.log('  vibekit review REQ --as reviewer      hold it for a reviewer session on a different model');
    console.log('  vibekit review REQ --approve --by "<name>"   record an approval over a mechanically clean requirement');
  }
  if (results.some((result) => !result.clean)) process.exitCode = 1;
}

export async function version() {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
  console.log(`vibekit ${pkg.version}`);
}
