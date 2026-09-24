import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BUILT_IN, add, list, recordInProfile, recordPipelineStage, remove, update, verify } from '../extensions.js';
import { ownerOnly, readText } from '../fsutil.js';
import { createAsker } from '../menu.js';
import { folderIn } from '../projects.js';
import { SIGNATURE_FILE, keygen, signExtension } from '../signing.js';

/**
 * `vibekit ext add | list | update | remove | verify`. Specification §68 and the Extensions and
 * Integration Spec §4–§5.
 *
 * Core is never an extension: the folder format, asks and gates, the build and review loop,
 * evidence, convergence, memory and `check`. Everything here is a choice, and the list says which
 * choices this machine has made — with the version and the commit each one is pinned to.
 */
export async function ext(options) {
  const { root, args, json } = options;
  const [verb, name] = args;

  if (verb === 'add') return addExtension(root, name, options);
  if (verb === 'update') return updateExtension(name, options);
  if (verb === 'verify') return verifyExtension(name, options);
  if (verb === 'sign') return signRelease(name, options);
  if (verb === 'keygen') return makeKey(options);
  if (verb === 'remove') {
    if (!name) throw new Error('Usage: vibekit ext remove <name>');
    const result = await remove(name);
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(result.removed ? `✔ ${name} removed` : `${name} was not enabled.`);
    return;
  }
  if (verb && verb !== 'list') throw new Error(`Usage: vibekit ext <add <name|url|path> [--yes] | list | update [name] | remove <name> | verify <path> | sign <path> --key <file> | keygen [--out <dir>]>. Built in: ${Object.keys(BUILT_IN).join(', ')}.`);

  const rows = await list();
  if (json) return void console.log(JSON.stringify(rows, null, 2));
  console.log('Extensions · data only, never code; none can weaken a check or widen a role');
  console.log('');
  for (const row of rows) {
    console.log(`  ${row.enabled ? '●' : '○'} ${row.name.padEnd(22)} ${row.builtIn ? 'built in' : `${row.version ?? '?'} @${(row.commit ?? 'no-commit').slice(0, 12)} · from ${row.source}`}`);
    if (row.description) console.log(`    ${row.description}`);
    if (!row.builtIn) console.log(`    ${row.files} file(s) · always-loaded ${row.measured ?? 0} tokens (declared ${row.declared ?? 0}) · licence ${row.licence ?? 'none'}`);
  }
  console.log('');
  console.log('  vibekit ext add <name>            enable a built-in · vibekit ext add <https url> installs a team\'s own, pinned to a commit');
  console.log('  vibekit ext update [name]         fetch, show the diff, apply on confirmation · vibekit ext verify <path> before publishing');
  console.log('  vibekit ext keygen · ext sign     a signing key, and a signed release (§5.1) — required before anything leaves the organisation');
}

/** Show what it adds and its budget cost, then ask. `--yes` answers for a script. */
const confirmWith = (options) => async (inspection) => {
  const { manifest, counts, measured, declared, warnings } = inspection;
  console.log(`${manifest.name} ${manifest.version ?? ''} · ${manifest.licence ?? 'no licence declared'}`);
  if (manifest.description) console.log(`  ${manifest.description}`);
  console.log(`  adds: ${Object.entries(counts).filter(([key, value]) => value && key !== 'pipeline').map(([key, value]) => `${value} ${key}`).join(', ') || 'nothing countable'}${counts.pipeline ? ' · a pipeline stage' : ''}`);
  console.log(`  always-loaded: ${measured} tokens measured${declared ? ` (${declared} declared)` : ''}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  if (options.yes) return true;
  if (!process.stdin.isTTY) { console.log('  Not installed: confirm with --yes, or run this at a terminal.'); return false; }
  const asker = createAsker();
  try {
    const answer = await asker.text('Install it? (yes/no)', 'no');
    return /^y(?:es)?$/i.test(answer);
  } finally {
    asker.close();
  }
};

async function addExtension(root, source, options) {
  if (!source) throw new Error('Usage: vibekit ext add <name | https git url | folder> [--yes]');
  // The project's cap, when run inside one: an install that would breach it is refused with the numbers.
  let cap = null;
  const folder = await folderIn(root);
  if (folder) {
    const { runChecks } = await import('../folder/checks.js');
    const checks = await runChecks(root, { folder }).catch(() => null);
    if (checks?.budget) cap = { alwaysLoaded: checks.budget.alwaysLoaded, ceiling: checks.budget.ceiling };
  }
  const result = await add(source, { confirm: options.json ? async () => Boolean(options.yes) : confirmWith(options), cap, force: Boolean(options.force) });
  if (result.builtIn) {
    if (options.json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ ${result.name} enabled`);
    if (result.description) console.log(`  ${result.description}`);
    return;
  }
  if (!result.installed) {
    if (options.json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`Not installed: ${result.why}.`);
    return;
  }
  // Recorded where the project is, so a folder is explainable to somebody who did not set it up.
  if (folder) {
    await recordInProfile(root, { name: result.name, version: result.version, commit: result.commit }, folder);
    if (await recordPipelineStage(root, result.name, folder) && !options.json) console.log(`  a pipeline stage was declared below <!-- local --> in ${folder}/delivery/pipeline.spec.md — review it like any other change`);
  }
  if (options.json) return void console.log(JSON.stringify({ ...result, inspection: undefined }, null, 2));
  console.log(`✔ ${result.name} ${result.version ?? ''} installed · pinned to ${(result.commit ?? 'no commit').slice(0, 12)}${folder ? ` · recorded in ${folder}/profile.md` : ''}`);
  console.log('  Once configured, every project on this machine picks it up; the confirmation is per extension, not per project.');
}

async function updateExtension(name, options) {
  const state = await list();
  const targets = name ? [name] : state.filter((row) => !row.builtIn && row.enabled).map((row) => row.name);
  if (!targets.length) return void console.log('Nothing to update: no external extension is installed.');
  for (const target of targets) {
    const result = await update(target, {
      confirm: async ({ inspection, diff }) => {
        console.log(`${target}: ${diff.version.from ?? '?'} → ${inspection.manifest.version ?? '?'} · ${(diff.commit.from ?? '').slice(0, 12)} → ${(diff.commit.to ?? '').slice(0, 12)}`);
        for (const file of diff.added) console.log(`  + ${file}`);
        for (const file of diff.removed) console.log(`  - ${file}`);
        for (const file of diff.changed) console.log(`  ~ ${file}`);
        for (const warning of inspection.warnings) console.log(`  ! ${warning}`);
        if (options.yes) return true;
        if (!process.stdin.isTTY) { console.log('  Not applied: confirm with --yes, or run this at a terminal.'); return false; }
        const asker = createAsker();
        try { return /^y(?:es)?$/i.test(await asker.text('Apply it? (yes/no)', 'no')); } finally { asker.close(); }
      },
    });
    if (options.json) console.log(JSON.stringify({ ...result, inspection: undefined }, null, 2));
    else console.log(result.updated ? `✔ ${target} updated · pinned to ${(result.diff.commit.to ?? '').slice(0, 12)}` : `${target}: ${result.why}`);
    if (result.updated) {
      const folder = await folderIn(options.root);
      if (folder) await recordInProfile(options.root, { name: target, version: result.inspection.manifest.version, commit: result.diff.commit.to }, folder);
    }
  }
}

async function verifyExtension(path, options) {
  if (!path) throw new Error('Usage: vibekit ext verify <path to the extension folder> [--quick]');
  // The fixture briefs take a few seconds each; --quick skips them for an edit-verify loop.
  const result = await verify(path, { fixtures: !options.quick });
  if (options.json) return void console.log(JSON.stringify({ ok: result.ok, rows: result.rows, briefs: result.briefs, manifest: result.inspection.manifest, counts: result.inspection.counts, signature: result.inspection.signature }, null, 2));
  console.log(`${result.ok ? '✔' : '✖'} ${result.inspection.manifest.name ?? path}`);
  for (const row of result.rows) console.log(`  ${row.ok ? '✔' : '✖'} ${row.what.padEnd(42)} ${row.why}`);
  for (const brief of result.briefs ?? []) {
    if (!brief.moved) continue;
    console.log(`    ${brief.brief}:`);
    for (const key of ['asks', 'gaps', 'findings', 'files']) {
      for (const item of brief.moved[key].added) console.log(`      + ${key.slice(0, -1)} ${item}`);
      for (const item of brief.moved[key].removed) console.log(`      - ${key.slice(0, -1)} ${item}`);
    }
  }
  if (options.quick) {
    console.log('');
    console.log('  Skipped with --quick: the three fixture briefs against golden outputs (§5.4). Run without it before publishing.');
  }
  if (!result.ok) process.exitCode = 1;
}

/**
 * `vibekit ext sign <path> --key <private-key.pem>` — §5.1. Verify first: a signature on a release
 * that fails its own checks would only lend it credibility.
 */
async function signRelease(path, options) {
  if (!path || !options.key) throw new Error('Usage: vibekit ext sign <path to the extension folder> --key <private key file>');
  const pem = await readText(resolve(options.key));
  if (!pem) throw new Error(`${options.key} is not readable.`);
  if (!/PRIVATE KEY/.test(pem)) throw new Error(`${options.key} is not a private key. \`vibekit ext keygen\` writes one.`);
  const result = await verify(path, { fixtures: false });
  const failing = result.rows.filter((row) => !row.ok && row.what !== 'signature');
  if (failing.length) throw new Error(`not signed — verify fails:\n${failing.map((row) => `  ✖ ${row.what}: ${row.why}`).join('\n')}`);
  const record = await signExtension(resolve(path), pem);
  if (options.json) return void console.log(JSON.stringify({ ...record, publicKey: undefined }, null, 2));
  console.log(`✔ ${result.inspection.manifest.name ?? path} signed · ${SIGNATURE_FILE} written · signer ${record.signer.slice(0, 12)}…`);
  console.log('  Commit extension.sig with the release. Installers trust the key with: vibekit settings trust <name> <public-key-file>');
}

/** `vibekit ext keygen [--out <dir>]` — an Ed25519 pair; the private half is owner-only and never leaves the machine. */
async function makeKey(options) {
  const dir = resolve(options.out ?? '.');
  await mkdir(dir, { recursive: true });
  const priv = join(dir, 'vibekit-ext.key');
  const pub = join(dir, 'vibekit-ext.pub');
  if (await readText(priv)) throw new Error(`${priv} exists. Not overwriting a signing key; move it first.`);
  const pair = keygen();
  await writeFile(priv, pair.privateKey, { mode: 0o600 });
  await ownerOnly(priv).catch(() => {});
  await writeFile(pub, pair.publicKey);
  if (options.json) return void console.log(JSON.stringify({ privateKey: priv, publicKey: pub, fingerprint: pair.fingerprint }, null, 2));
  console.log(`✔ signing key written · fingerprint ${pair.fingerprint.slice(0, 12)}…`);
  console.log(`  private: ${priv}  (owner-only; keep it out of git — add it to .gitignore now)`);
  console.log(`  public:  ${pub}   (hand this to installers: vibekit settings trust <name> ${pub})`);
}
