import { importEcc, recordedEccNames } from '../import-ecc.js';
import { buildPlugin, bumpVersion, captureTeam, readTeam, teamPaths, teamRepo } from '../team.js';

const USAGE = 'Usage: vibekit team <capture [--skip a,b] | import-ecc <name,name,...> [--version x] | status> [--repo <folder>]';
const list = (items) => (items.length ? items.join(', ') : 'none');

async function capture(repo, { skip }) {
  const report = await captureTeam(repo, { skip: skip ? skip.split(',').map((name) => name.trim()) : [] });
  const built = await buildPlugin(repo);
  const version = await bumpVersion(repo);
  console.log(`✔ Skills from your Claude folder: ${list(report.skills)}`);
  console.log(`✔ Subagents from your Claude folder: ${list(report.agents)}`);
  console.log(`✔ Plugins your team will get automatically: ${list(report.plugins)}`);
  report.skipped.forEach((item) => console.log(`! skipped ${item}`));
  report.localPlugins.forEach((item) => console.log(`! ${item} comes from a folder on this machine; teammates can't install it. Publish its marketplace to git to share it.`));
  console.log(`✔ Plugin rebuilt as ${version}: ${built.skills} skills, ${built.agents} subagents${built.team.plugins.length ? `, ${built.team.plugins.length} ${built.team.plugins.length === 1 ? 'dependency' : 'dependencies'}` : ''}`);
  console.log(`\nNext: commit and push ${repo} to your team repository. Everyone else: pull, then run vibekit setup (or /vibekit:setup).`);
}

async function importFromEcc(repo, { args, version, from }) {
  const given = (args[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const names = given.length ? given : await recordedEccNames(repo);
  if (!given.length && names.length) console.log(`Re-importing your recorded list (${names.length} names)`);
  if (!names.length) throw new Error('Name the ECC skills, agents or commands to import, e.g. vibekit team import-ecc api-design,tdd-workflow,security-reviewer');
  const report = await importEcc(repo, names, { from, version });
  console.log(`ECC ${report.version}: imported ${report.imported.length} of ${names.length}`);
  for (const kind of ['skill', 'agent', 'command']) {
    const items = report.imported.filter((item) => item.kind === kind).map((item) => item.name);
    if (items.length) console.log(`  ✔ ${kind === 'command' ? 'commands (as skills)' : `${kind}s`}: ${items.join(', ')}`);
  }
  report.skipped.forEach((item) => console.log(`  ! ${item.name} (${item.kind}) skipped: ${item.reason}`));
  report.unknown.forEach((item) => console.log(`  ✖ ${item.name} isn't in ECC ${report.version}${item.suggestions.length ? ` — did you mean ${item.suggestions.join(' or ')}?` : ''}`));
  if (!report.imported.length) return;
  const built = await buildPlugin(repo);
  const next = await bumpVersion(repo);
  console.log(`✔ Plugin rebuilt as ${next}: ${built.skills} skills, ${built.agents} subagents. Licence notice: ${teamPaths(repo).skills.replace(/skills$/, '')}THIRD_PARTY_NOTICES.md`);
  const ecc = built.team.plugins.find((plugin) => plugin.marketplace === 'ecc' || plugin.name === 'ecc');
  if (ecc) console.log('! Your team kit also lists the full ECC plugin as a dependency, so developers would get ECC twice. Uninstall it on your machine and run: vibekit team capture --skip ecc');
}

async function status(repo) {
  const team = await readTeam(repo);
  console.log(`Team kit in ${repo}/team`);
  console.log(`  skills:    ${list(team.skills)}`);
  console.log(`  subagents: ${list(team.agents.map((file) => file.replace(/\.md$/, '')))}`);
  console.log(`  plugins:   ${list(team.plugins.map((plugin) => `${plugin.name}@${plugin.marketplace}`))}`);
}

export async function team({ args, repo, skip, ...rest }) {
  const target = repo ?? teamRepo();
  if (args[0] === 'capture') return capture(target, { skip });
  if (args[0] === 'status') return status(target);
  if (args[0] === 'import-ecc') return importFromEcc(target, { args, version: rest.version, from: rest.from });
  throw new Error(USAGE);
}
