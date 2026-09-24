import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { similarity } from './distil.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { readFrontMatter } from './frontmatter.js';
import { exists, readText, writeText } from './fsutil.js';
import { indexPath, listSkills } from './skills.js';
import { estimateProseTokens } from './tokens.js';

const posixRel = (from, to) => relative(from, to).split(sep).join('/');

/**
 * Importing skills from a repository. Extensions and Integration Spec §3.
 *
 * A repository of knowledge — an agency's conventions, a published roster of agent personas —
 * becomes VibeKit skills. Three conversions matter more than the copying: identity is dropped
 * (a role is permissions, not character), opinions that govern code are **flagged, not imported**
 * (an opinion is a rule in standards/ with a check, or it is nothing), and code worth copying
 * becomes a pattern file. Everything imported carries its provenance and its licence.
 */

export const IMPORTED_DIR = 'skills/lib/imported';
export const PATTERNS_DIR = 'skills/lib/patterns';
export const IDENTITY = /^(?:you are|as an? |act as|your (?:name|role|persona) is|i am an? )/i;
export const IDENTITY_SECTION = /^#{1,4}\s*(?:identity|personality|persona|character|voice|tone|who you are)\b/i;
/** A line that governs code: always, never, prefer, must, do not. Opinions, and flagged as such. */
export const RULE_LIKE = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:always|never|prefer|do not|don't|must(?: not)?|avoid|only use|use only)\b/i;
export const DUPLICATE_SIMILARITY = 0.6;
export const TRIGGER_OVERLAP = 0.5;
const STOP = new Set(['this', 'that', 'with', 'when', 'from', 'skill', 'should', 'always', 'about', 'your', 'their', 'into', 'have', 'will', 'which', 'these', 'those', 'using', 'agent', 'expert', 'senior', 'specialist']);

const SKILL_DIRS = /(?:^|\/)(?:skills?|agents?|personas?|prompts?|rules|commands|\.claude\/(?:agents|skills|commands)|\.cursor\/rules)(?:\/|$)/i;

/** Fetch or locate the source; returns the directory and, for a repository, the commit. */
export async function fetchSource(source) {
  if (/^(?:https?:\/\/|git@|ssh:\/\/)/.test(source)) {
    if (!/^https:\/\/|^git@|^ssh:\/\//.test(source)) throw new Error('a skills repository is fetched over https or ssh, never plain http');
    const dir = await mkdtemp(join(tmpdir(), 'vibekit-skills-'));
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--', source, dir], { stdio: 'ignore', timeout: 120_000 });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    return { dir, commit, cleanup: () => rm(dir, { recursive: true, force: true }), remote: true };
  }
  const dir = resolve(source);
  if (!(await exists(dir))) throw new Error(`${source} is not a repository url or a folder here.`);
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a repository */ }
  return { dir, commit, cleanup: async () => {}, remote: false };
}

/** The licence a repository declares, or null — knowledge nobody may redistribute is flagged. */
export async function licenceOf(dir) {
  for (const name of ['LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md', 'LICENSE.txt', 'COPYING']) {
    const text = await readText(join(dir, name));
    if (text) {
      const first = text.split('\n').find((line) => line.trim()) ?? '';
      const known = first.match(/MIT|Apache|BSD|GPL|MPL|ISC|Unlicense|CC0|Creative Commons/i)?.[0];
      return known ?? first.trim().slice(0, 60);
    }
  }
  const pkg = await readText(join(dir, 'package.json'));
  if (pkg) { try { return JSON.parse(pkg).license ?? null; } catch { return null; } }
  return null;
}

async function walk(dir, prefix = '') {
  const found = [];
  for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(join(dir, entry.name), rel)));
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) found.push(rel);
  }
  return found;
}

/** Which files are skills or personas: SKILL.md anywhere, and Markdown under the usual folders. */
export const candidateFiles = (files, { division = null } = {}) => files.filter((path) => {
  if (/(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|LICEN[CS]E|SOURCES|FLAGGED)\.md$/i.test(path)) return false;
  if (division && !path.toLowerCase().split('/').includes(String(division).toLowerCase())) return false;
  return /(?:^|\/)SKILL\.md$/i.test(path) || SKILL_DIRS.test(dirname(path) + '/');
});

/**
 * One file → one skill: body without identity, rules flagged out, code extracted, triggers guessed.
 */
export function convertPersona(text, { name: givenName, source }) {
  const meta = readFrontMatter(text);
  const stripped = String(text).replace(/^---\n[\s\S]*?\n---\n/, '');
  const title = meta.name ?? stripped.match(/^#\s+(.+)$/m)?.[1] ?? givenName;
  // The name a skill gives itself wins over the folder it sat in: `skills/api/SKILL.md` naming
  // itself `api-design` is api-design, not api.
  const name = String(meta.name ?? givenName ?? title).toLowerCase().replace(/\.mdc?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'skill';
  const description = meta.description ?? stripped.split('\n').find((line) => line.trim() && !line.startsWith('#') && !IDENTITY.test(line.trim())) ?? '';

  const flagged = [];
  const patterns = [];
  const kept = [];
  let skipping = false;
  let fence = null;
  let block = [];
  for (const line of stripped.split('\n')) {
    if (fence) {
      if (line.startsWith('```')) {
        // Code worth copying is a pattern file; a snippet stays in the body.
        if (block.length >= 8) { patterns.push({ name: `${name}-${patterns.length + 1}`, language: fence, code: block.join('\n') }); kept.push(`_Pattern: \`patterns/${name}-${patterns.length}.md\` (${fence || 'code'}, ${block.length} lines) — copy this when the shape fits._`); }
        else kept.push('```' + fence, ...block, '```');
        fence = null; block = [];
        continue;
      }
      block.push(line);
      continue;
    }
    if (line.startsWith('```')) { fence = line.slice(3).trim(); block = []; continue; }
    if (/^#{1,4}\s/.test(line)) { skipping = IDENTITY_SECTION.test(line); if (skipping) continue; }
    if (skipping) continue;
    if (IDENTITY.test(line.trim())) continue;                       // "You are a meticulous senior engineer" costs tokens and changes nothing
    if (RULE_LIKE.test(line)) { flagged.push(line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim()); continue; }
    kept.push(line);
  }

  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const words = `${title} ${description}`.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) ?? [];
  const triggers = [...new Set(words.filter((word) => !STOP.has(word)))].slice(0, 5);
  return { name, title, description: String(description).trim().slice(0, 160), body, triggers, flagged, patterns, tokens: estimateProseTokens(body), source };
}

/**
 * Import a repository. Reports what it would do with `dryRun`; writes otherwise. `rules` decides
 * what happens to flagged lines when nobody is at a terminal: `flag` (default — written to
 * FLAGGED.md with the three options), `suggest` (kept in the body under "Suggestions"), `drop`.
 */
export async function importRepository(root, source, { folder = DEFAULT_FOLDER, dryRun = false, division = null, rules = 'flag', now = () => new Date() } = {}) {
  const fetched = await fetchSource(source);
  try {
    const files = await walk(fetched.dir);
    const candidates = candidateFiles(files, { division });
    const licence = await licenceOf(fetched.dir);
    const existing = (await listSkills(root, { folder })).skills;
    const converted = [];
    for (const path of candidates) {
      const text = await readText(join(fetched.dir, path));
      if (!text || !text.trim()) continue;
      const stem = /SKILL\.md$/i.test(path) ? basename(dirname(path)) : basename(path).replace(/\.mdc?$/, '');
      const skill = convertPersona(text, { name: stem, source: path });
      if (skill.tokens < 20) continue;
      converted.push(skill);
    }

    // Duplicates: against what the folder has, and among the imports themselves. Default: keep
    // both with disjoint triggers, and say so; a person can merge later with the facts in hand.
    const duplicates = [];
    const seen = [...existing.map((skill) => ({ name: skill.name, triggers: skill.triggers, body: skill.body ?? '' }))];
    for (const skill of converted) {
      for (const other of seen) {
        const overlap = skill.triggers.filter((trigger) => other.triggers.includes(trigger));
        const alike = other.body ? similarity(skill.body, other.body) : 0;
        if (overlap.length / Math.max(skill.triggers.length, 1) > TRIGGER_OVERLAP || alike > DUPLICATE_SIMILARITY) {
          duplicates.push({ skill: skill.name, other: other.name, overlap, similarity: Math.round(alike * 100) / 100 });
          skill.triggers = skill.triggers.filter((trigger) => !overlap.includes(trigger));
          if (skill.triggers.length < 2) skill.triggers.push(`${skill.name}-imported`);
        }
      }
      seen.push({ name: skill.name, triggers: skill.triggers, body: skill.body });
    }

    const flagged = converted.flatMap((skill) => skill.flagged.map((line) => ({ skill: skill.name, line })));
    const report = { source, commit: fetched.commit, licence, files: files.length, candidates: candidates.length, skills: converted.map(({ name, title, triggers, tokens, patterns, flagged: f }) => ({ name, title, triggers, tokens, patterns: patterns.length, flagged: f.length })), duplicates, flagged, written: [], dryRun };
    if (dryRun) return report;

    for (const skill of converted) {
      const suggestions = rules === 'suggest' && skill.flagged.length ? `\n\n## Suggestions (imported opinions, not rules)\n\n${skill.flagged.map((line) => `- ${line}`).join('\n')}` : '';
      const header = `<!-- imported from ${source}${fetched.commit ? `@${fetched.commit.slice(0, 7)}` : ''} (${skill.source}) on ${now().toISOString().slice(0, 10)} · triggers inferred · confidence: low -->`;
      const body = `# ${skill.title}\n\n${header}\n\n${skill.description ? `${skill.description}\n\n` : ''}${skill.body}${suggestions}\n`;
      const path = join(root, folder, IMPORTED_DIR, `${skill.name}.md`);
      await writeText(path, body);
      report.written.push(posixRel(root, path));
      for (const pattern of skill.patterns) {
        const patternPath = join(root, folder, PATTERNS_DIR, `${pattern.name}.md`);
        await writeText(patternPath, `# ${pattern.name}\n\nLifted from ${source} (${skill.source}). Copy this when the shape fits; it is real code, not a description of code.\n\n\`\`\`${pattern.language}\n${pattern.code}\n\`\`\`\n`);
        report.written.push(posixRel(root, patternPath));
      }
    }

    // The index, in the shape the generator writes; existing entries with the same name are replaced.
    const indexFile = indexPath(root, folder);
    let index = (await readText(indexFile)) ?? '';
    for (const skill of converted) {
      index = index.replace(new RegExp(`^- name: ${skill.name}\\n(?:  .*\\n)*`, 'm'), '');
      index = `${index.trimEnd()}\n- name: ${skill.name}\n  triggers: [${skill.triggers.join(', ')}]\n  path: lib/imported/${skill.name}.md\n  confidence: low\n  source: ${source}\n`.replace(/^\n/, '');
    }
    await writeText(indexFile, index);

    // Provenance: what came from where, under which licence, at which commit.
    const sourcesPath = join(root, folder, IMPORTED_DIR, 'SOURCES.md');
    const sources = (await readText(sourcesPath)) ?? '# Imported skills\n\nWhat came from where, under which licence, at which commit. A repository with no licence is knowledge you cannot legally redistribute without somebody deciding that deliberately.\n\n| Source | Licence | Commit | Date | Skills |\n| --- | --- | --- | --- | --- |\n';
    await writeText(sourcesPath, `${sources.trimEnd()}\n| ${source} | ${licence ?? '**none — flagged**'} | ${fetched.commit ? fetched.commit.slice(0, 12) : '—'} | ${now().toISOString().slice(0, 10)} | ${converted.map((skill) => skill.name).join(', ') || '—'} |\n`);
    report.written.push(posixRel(root, sourcesPath));

    if (flagged.length && rules === 'flag') {
      const flaggedPath = join(root, folder, IMPORTED_DIR, 'FLAGGED.md');
      const previous = (await readText(flaggedPath)) ?? '# Flagged on import\n\nLines that read like rules, not techniques. In VibeKit an opinion that governs code is a rule in standards/ with a check, or it is nothing. For each: [1] make it a rule (needs a check) · [2] keep as a suggestion · [3] drop.\n';
      await writeText(flaggedPath, `${previous.trimEnd()}\n\n## ${source} · ${now().toISOString().slice(0, 10)}\n\n${flagged.map((entry, index) => `${index + 1}. **${entry.skill}**: "${entry.line}"`).join('\n')}\n`);
      report.written.push(posixRel(root, flaggedPath));
    }
    return report;
  } finally {
    await fetched.cleanup();
  }
}
