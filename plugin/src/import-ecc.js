import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exists, readText, writeText } from './fsutil.js';
import { AGENT_ROLES } from './generators/agents.js';
import { SKILLS } from './generators/workflow.js';
import { toolEnv } from './machine/platform.js';
import { teamPaths } from './team.js';

const PACKAGE = 'ecc-universal';
const RUNTIME = /CLAUDE_PLUGIN_ROOT|~\/\.claude\/scripts|scripts\/hooks\/|"hooks"\s*:/;
const SCRIPT_CALL = /scripts\/[\w/.-]+\.(js|mjs|sh|py)/;
const BUILT_IN_SKILLS = SKILLS.map((skill) => skill.name);
const BUILT_IN_AGENTS = AGENT_ROLES.map((role) => role.name);

export async function fetchEcc(version = 'latest') {
  const dir = await mkdtemp(join(tmpdir(), 'vibecheck-ecc-'));
  const result = spawnSync('npm', ['install', '--no-save', '--ignore-scripts', '--prefix', dir, `${PACKAGE}@${version}`], { env: toolEnv(), encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`Could not download ${PACKAGE}@${version} from npm: ${(result.stderr || result.stdout).trim().split('\n').pop()}`);
  return join(dir, 'node_modules', PACKAGE);
}

const frontMatterOf = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if (pair) meta[pair[1]] = pair[2].replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: match[2] };
};

async function locate(pkg, name) {
  for (const dir of [join(pkg, 'skills', name), join(pkg, '.agents', 'skills', name)]) {
    if (await exists(join(dir, 'SKILL.md'))) return { kind: 'skill', path: dir };
  }
  if (await exists(join(pkg, 'agents', `${name}.md`))) return { kind: 'agent', path: join(pkg, 'agents', `${name}.md`) };
  if (await exists(join(pkg, 'commands', `${name}.md`))) return { kind: 'command', path: join(pkg, 'commands', `${name}.md`) };
  return null;
}

async function catalogue(pkg) {
  const names = async (dir, strip) => (await readdir(dir).catch(() => [])).map((entry) => entry.replace(strip, ''));
  return { skills: await names(join(pkg, 'skills'), ''), agents: await names(join(pkg, 'agents'), /\.md$/), commands: await names(join(pkg, 'commands'), /\.md$/) };
}

function suggest(name, all) {
  const stem = name.slice(0, Math.max(4, name.length - 2));
  return [...new Set([...all.skills, ...all.commands, ...all.agents])].filter((candidate) => candidate.startsWith(stem) || candidate.includes(name)).slice(0, 3);
}

async function assess(pkg, name, found, requested, all) {
  if (found.kind === 'skill') {
    const text = await readText(join(found.path, 'SKILL.md'));
    if (/\[DEPRECATED/i.test(frontMatterOf(text).meta.description ?? '')) return 'deprecated by ECC';
    if (RUNTIME.test(text) || (await exists(join(found.path, 'hooks')))) return 'needs ECC\'s hook runtime (keep the ECC plugin for this one)';
    if (BUILT_IN_SKILLS.includes(name)) return `name clashes with Vibe-check-cli's /${name}`;
    return null;
  }
  const text = await readText(found.path);
  if (found.kind === 'agent') return BUILT_IN_AGENTS.includes(name) ? `name clashes with Vibe-check-cli's ${name} subagent` : null;
  if (RUNTIME.test(text) || SCRIPT_CALL.test(text)) return 'needs ECC\'s scripts (keep the ECC plugin for this one)';
  if (BUILT_IN_SKILLS.includes(name)) return `name clashes with Vibe-check-cli's /${name}`;
  const agents = all.agents.filter((agent) => new RegExp(`\\b${agent}\\b`).test(text) && !requested.includes(agent));
  const clashing = agents.filter((agent) => BUILT_IN_AGENTS.includes(agent));
  if (clashing.length) return `uses ECC's ${clashing.join(', ')} agent, which differs from Vibe-check-cli's own`;
  if (agents.length) return `needs ECC agent(s) ${agents.join(', ')}; add them to the list to import them too`;
  return null;
}

function commandToSkill(name, text) {
  const { meta, body } = frontMatterOf(text);
  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(meta.description ?? `ECC command ${name}`)}`];
  if (meta['argument-hint']) lines.push(`argument-hint: ${JSON.stringify(meta['argument-hint'].replace(/^"|"$/g, ''))}`);
  lines.push('---', '');
  return `${lines.join('\n')}${body.trimStart()}`;
}

async function writeNotice(repo, pkg, version, items, requested) {
  const license = (await readText(join(pkg, 'LICENSE'))) ?? 'MIT License (see https://github.com/affaan-m/ECC)';
  const record = { source: PACKAGE, version, requested, items };
  await writeText(join(repo, 'team', 'imports', 'ecc.json'), `${JSON.stringify(record, null, 2)}\n`);
  await writeText(join(repo, 'team', 'THIRD_PARTY_NOTICES.md'), [
    '# Third-party notices',
    '',
    `The following team skills and subagents were imported from Everything Claude Code (ECC), ${PACKAGE}@${version}, https://github.com/affaan-m/ECC:`,
    '',
    ...items.map((item) => `- ${item.name} (${item.kind === 'command' ? 'command, converted to a skill' : item.kind})`),
    '',
    '```text',
    license.trim(),
    '```',
    '',
  ].join('\n'));
}

export async function recordedEccNames(repo) {
  try {
    return JSON.parse(await readText(join(repo, 'team', 'imports', 'ecc.json'))).requested ?? [];
  } catch {
    return [];
  }
}

export async function importEcc(repo, names, { from, version = 'latest' } = {}) {
  const pkg = from ?? (await fetchEcc(version));
  const resolved = JSON.parse((await readText(join(pkg, 'package.json'))) ?? '{}').version ?? version;
  const all = await catalogue(pkg);
  const paths = teamPaths(repo);
  const report = { version: resolved, imported: [], skipped: [], unknown: [] };
  for (const name of names) {
    const found = await locate(pkg, name);
    if (!found) {
      report.unknown.push({ name, suggestions: suggest(name, all) });
      continue;
    }
    const reason = await assess(pkg, name, found, names, all);
    if (reason) {
      report.skipped.push({ name, kind: found.kind, reason });
      continue;
    }
    if (found.kind === 'skill') {
      await rm(join(paths.skills, name), { recursive: true, force: true });
      await cp(found.path, join(paths.skills, name), { recursive: true, dereference: true });
    } else if (found.kind === 'agent') {
      await cp(found.path, join(paths.agents, `${name}.md`));
    } else {
      await writeText(join(paths.skills, name, 'SKILL.md'), commandToSkill(name, await readText(found.path)));
    }
    report.imported.push({ name, kind: found.kind });
  }
  if (report.imported.length) await writeNotice(repo, pkg, resolved, report.imported, names);
  return report;
}
