import { advise, effectiveCost, impactOf, performance, readSessions } from '../models/advise.js';
import { CAPS, TIERS, TIER_NOTES, loadCaps, loadPolicy, tierFor } from '../models/policy.js';
import { FIRST_PARTY, diffProviders, providersInUse, readOverrides, readProvider, readTiers, refresh, registryState, writeTiers } from '../models/registry.js';
import { folderName } from './folder.js';

/**
 * `vibekit tools`. Specification §63, Appendix A.
 *
 * Thin, like every other command. The registry, the policy and the intelligence live in
 * src/models/ so the reports, the tracker and the CLI cannot reach different answers.
 */

const DEFAULT_TIERS = { strong: 'claude-opus-5', mid: 'claude-sonnet-5', cheap: 'claude-haiku-4-5-20251001', local: 'none' };

export async function tools(options) {
  const { root, args, folder: chosen, json } = options;
  const [area, action] = args;

  if (area === 'rates') return rates(root, chosen, action, options);
  if (area === 'policy') return policy(root, chosen, json);
  if (area === 'skills') return skillsArea(root, chosen, action, options);
  if (area === 'replay') { const { replay } = await import('./maintain.js'); return replay({ ...options, args: options.args.slice(1) }); }

  console.log('Usage');
  console.log('  vibekit tools rates [refresh] [--advise]   The price registry, what changed, and what it costs you');
  console.log('  vibekit tools policy                       Which tier each role routes to, and the caps');
  console.log('  vibekit tools skills import <repo|folder> [--dry-run] [--division <d>] [--rules flag|suggest|drop]');
  console.log('                                             Knowledge from a repository as skills: identity dropped, opinions flagged, code as patterns');
  console.log('  vibekit tools skills test [name]           Triggers fire when they should; imported skills are untested until this runs');
  console.log('  vibekit tools replay --recovery            §60 recovery fixture');
}

/** Integration spec §3 — a repository of knowledge becomes skills, with provenance and a licence. */
async function skillsArea(root, chosen, action, options) {
  const folder = chosen ?? (await folderName(root));
  const [, , source] = options.args;
  if (action === 'test') {
    const { testSkillsCommand } = await import('./maintain.js');
    return testSkillsCommand({ ...options, args: options.args.slice(2) });
  }
  if (action !== 'import' || !source) throw new Error('Usage: vibekit tools skills import <git url | folder> [--dry-run] [--division <d>] [--rules flag|suggest|drop]');
  const rules = options.rules ?? 'flag';
  if (!['flag', 'suggest', 'drop'].includes(rules)) throw new Error('--rules takes flag (write them to FLAGGED.md), suggest (keep as suggestions) or drop.');
  const { importRepository } = await import('../skillimport.js');
  const report = await importRepository(root, source, { folder, dryRun: Boolean(options['dry-run']), division: options.division ?? null, rules });
  if (options.json) return void console.log(JSON.stringify(report, null, 2));

  console.log(`${report.dryRun ? 'Would import' : '✔ Imported'} ${report.skills.length} skill(s) from ${source}${report.commit ? ` @${report.commit.slice(0, 7)}` : ''} · ${report.candidates} candidate file(s) of ${report.files}`);
  console.log(`  licence: ${report.licence ?? 'none — flagged: knowledge you cannot legally redistribute should not reach a client repository without a decision'}`);
  for (const skill of report.skills) console.log(`  ${skill.name.padEnd(28)} ~${String(skill.tokens).padStart(4)} tokens · triggers [${skill.triggers.join(', ')}] · confidence: low${skill.patterns ? ` · ${skill.patterns} pattern(s)` : ''}${skill.flagged ? ` · ${skill.flagged} line(s) flagged` : ''}`);
  if (report.duplicates.length) {
    console.log('');
    console.log('  Near-duplicates (kept both, triggers made disjoint — merge later with the facts in hand):');
    for (const dup of report.duplicates) console.log(`    ${dup.skill} ~ ${dup.other} · shared triggers [${dup.overlap.join(', ')}] · similarity ${dup.similarity}`);
  }
  if (report.flagged.length) {
    console.log('');
    console.log(`  ${report.flagged.length} line(s) read like rules, not techniques — ${rules === 'flag' ? 'written to skills/lib/imported/FLAGGED.md' : rules === 'suggest' ? 'kept as suggestions in the body' : 'dropped'}:`);
    for (const [index, entry] of report.flagged.slice(0, 8).entries()) console.log(`    ${index + 1}. ${entry.skill}: "${entry.line}"`);
    if (report.flagged.length > 8) console.log(`    … ${report.flagged.length - 8} more`);
    console.log('    For each: [1] make it a rule in standards/ (needs a check) · [2] keep as a suggestion · [3] drop.');
    console.log('    Without this step an imported roster quietly overrides decisions taken at the architecture gate.');
  }
  if (!report.dryRun) {
    console.log('');
    console.log(`  ${report.written.length} file(s) written. Every imported skill is untested prompt content: vibekit tools skills test.`);
  }
}

/** §61 — the tiers, the policy, and the caps, all read from the files that own them. */
async function policy(root, chosen, json) {
  const folder = chosen ?? (await folderName(root));
  const [{ rules, declared }, caps, { tiers }] = await Promise.all([loadPolicy(root, folder), loadCaps(root, folder), readTiers()]);

  const work = [
    { role: 'analyst' }, { role: 'planner' }, { role: 'designer' },
    { role: 'implementer', size: 'S' }, { role: 'implementer', size: 'M' }, { role: 'implementer', size: 'L' },
    { role: 'implementer', size: 'L', classes: ['financial'] },
    { role: 'reviewer', size: 'M' }, { role: 'compliance' },
  ].map((item) => ({ ...item, ...tierFor(rules, item) }));

  if (json) return void console.log(JSON.stringify({ declared, tiers, work, caps }, null, 2));

  console.log(`Tiers · mapped in registry/tiers.yml${Object.keys(tiers).length ? '' : ' (not mapped yet)'}`);
  for (const tier of [...TIERS].reverse()) {
    console.log(`  ${tier.padEnd(7)} ${(tiers[tier] ?? '—').padEnd(28)} ${TIER_NOTES[tier]}`);
  }

  console.log('');
  console.log(`Policy · ${folder}/agents/humans.md ## Model policy${declared ? '' : ' (not written; the default stands)'}`);
  for (const item of work) {
    const what = `${item.role}${item.size ? ` size ${item.size}` : ''}${item.classes ? ' (financial)' : ''}`;
    console.log(`  ${what.padEnd(28)} ${String(item.tier ?? '—').padEnd(7)} ${item.reasons[item.reasons.length - 1] ?? ''}`);
  }

  console.log('');
  console.log(`Caps · ${folder}/profile.md, in tokens`);
  for (const cap of caps) {
    console.log(`  ${cap.key.padEnd(17)} ${cap.tokens === null ? 'not set — nothing stops a run' : cap.tokens.toLocaleString()}`);
  }
  console.log('');
  console.log('  A cap is the point at which spending more without a human looking is wrong, not a target.');
}

async function rates(root, chosen, action, options) {
  const folder = chosen ?? (await folderName(root));

  if (action === 'refresh') {
    const providers = (await providersInUse());
    const wanted = providers.length ? providers : Object.keys(FIRST_PARTY).slice(0, 1);
    for (const provider of wanted) {
      const result = await refresh(provider, { fetchPricing: fetchFirstParty });
      if (result.ok) {
        console.log(`✔ ${provider} · ${result.changes.length} change(s)`);
        for (const change of result.changes) console.log(`    ${describeChange(change)}`);
      } else {
        // §63: nothing ever blocks on the network, and a stale registry is used.
        console.log(`! ${provider} not updated: ${result.reason}`);
        console.log(`  The last good file stands${result.age ? `, fetched ${result.age}` : ''}. Every report footnotes that date.`);
      }
    }
    return;
  }

  if (action === 'map') {
    const { declared } = await readTiers();
    if (declared && !options.force) throw new Error('registry/tiers.yml already exists. It is yours; edit it, or pass --force to rewrite it.');
    await writeTiers(DEFAULT_TIERS);
    console.log('✔ registry/tiers.yml written. The repository names tiers; this file says which model each one is.');
    return;
  }

  const state = await registryState();
  const sessions = await readSessions(root, folder);
  const rows = performance(sessions);
  const provider = state.providers[0]?.provider ?? 'anthropic';
  const priced = await effectiveCost(rows, provider);

  if (options.json) {
    return void console.log(JSON.stringify({ state, rows: priced, advice: advise(priced) }, null, 2));
  }

  if (state.empty) {
    console.log(`No price registry yet (${state.dir}).`);
    console.log('  vibekit tools rates refresh    fetch from first-party pricing pages');
    console.log('  vibekit tools rates map        say which model each tier is');
    console.log('');
    console.log('  Air-gapped? Maintain registry/overrides.yml by hand; the registry reports itself as manual.');
    return;
  }

  console.log(`Registry · ${state.dir}${state.manual ? ' · manual' : ''}`);
  for (const file of state.providers) {
    console.log(`  ${file.provider.padEnd(12)} ${file.models} model(s) · ${file.fetched ? `fetched ${file.fetched}` : 'never fetched'}`);
  }

  if (!rows.length) {
    console.log('');
    console.log(`Nothing to price against yet: ${folder}/.state/sessions.json records no sessions.`);
    console.log('  Impact is always computed against your own measured usage, never a vendor\'s example workload.');
    return;
  }

  console.log('');
  console.log('Measured on this project, last 30 days');
  for (const row of priced) {
    const cost = row.effectiveCost === null ? 'unpriced' : row.effectiveCost.toFixed(4);
    console.log(`  ${row.model.padEnd(26)} ${row.role.padEnd(12)} ${String(row.size).padEnd(2)} ${String(row.completed).padStart(3)} done  effective ${cost}${row.pricedFrom ? ` (${row.pricedFrom})` : ''}`);
  }

  if (options.advise) {
    const result = advise(priced);
    console.log('');
    console.log(result.why);
    if (result.recommend) console.log(`  Suggested: ${result.recommend.model}`);
    if (result.trial) {
      console.log(`  Trial: ${result.trial.shape}`);
      console.log(`  ${result.trial.note}`);
    }
  }
}

const describeChange = (change) => {
  if (change.kind === 'new') return `${change.id} NEW  ${change.input}/${change.output}`;
  if (change.kind === 'retired') return `${change.id} RETIRED`;
  return `${change.id}  ${change.from.input}/${change.from.output} → ${change.to.input}/${change.to.output}`;
};

/** §63 — first-party pricing pages only. Aggregators are never a source of truth. */
async function fetchFirstParty(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'vibekit/1.0 (+price registry refresh)' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

export { CAPS, impactOf, diffProviders, readOverrides, readProvider };
