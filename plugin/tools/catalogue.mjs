/**
 * Build the shipped catalogue: every unique skill in the upstream repository, converted to
 * VibeKit's data-only form and filed by domain under `library/catalogue/<domain>/<name>.md`.
 *
 *   node tools/catalogue.mjs <path to a clone of alirezarezvani/claude-skills>
 *
 * The catalogue is not indexed into a project by default — 388 entries would cost three times a
 * project's whole always-loaded budget — so a project enables domains or skills
 * (`vibekit skills enable engineering`, `vibekit skills enable threat-detection`) and only those
 * are written into the folder. Identity phrasing is dropped (a role is permissions, not
 * character); everything else in the source text is kept as the reference body, and the loader
 * cuts a short lead for the indexed version. Bundled scripts are not shipped: a skill is data.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { IDENTITY, IDENTITY_SECTION } from '../src/skillimport.js';
import { estimateProseTokens } from '../src/tokens.js';

const LIBRARY = fileURLToPath(new URL('../library', import.meta.url));
const clone = process.argv[2] ? resolve(process.argv[2]) : null;
if (!clone) { console.error('Usage: node tools/catalogue.mjs <clone>'); process.exit(2); }
const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim();
const licenceText = await readFile(join(clone, 'LICENSE'), 'utf8').catch(() => '');
const copyright = licenceText.split('\n').find((line) => /copyright/i.test(line))?.trim() ?? 'Copyright (c) the source authors';

/** Upstream folders → one domain word each. */
const DOMAIN = { 'engineering-team': 'engineering', 'marketing-skill': 'marketing', 'c-level-advisor': 'c-level', 'c-level-agents': 'c-level', 'research-ops': 'research', 'ra-qm-team': 'ra-qm', 'product-team': 'product' };
const SKIP = /(?:^|\/)(?:\.gemini|node_modules|templates|sample-text-processor)(?:\/|$)/;
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'when', 'user', 'users', 'asks', 'ask', 'asked', 'this', 'that', 'skill', 'use', 'using', 'your', 'you', 'is', 'are', 'be', 'it', 'its', 'as', 'at', 'by', 'from', 'into', 'any', 'all', 'about', 'tier', 'powerful', 'basic', 'standard', 'claude', 'code', 'agent', 'agents', 'plugin', 'comprehensive', 'production', 'grade', 'production-grade', 'senior', 'expert', 'specialist']);

async function walk(dir, out = []) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (entry.name === 'SKILL.md') out.push(path);
  }
  return out;
}

/** Front matter with folded (`>`) and literal (`|`) scalars, which readFrontMatter does not do. */
function frontMatter(text) {
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if (pair) {
      key = pair[1];
      const value = pair[2].trim();
      meta[key] = /^[>|]-?$/.test(value) ? '' : value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim();
    }
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Cut at the last sentence end inside the limit, so a description never stops mid-thought. */
const sentenceCut = (text, limit) => {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  return end > 60 ? head.slice(0, end + 1) : `${head.replace(/\s+\S*$/, '')}…`;
};
const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const clean = (phrase) => phrase.toLowerCase().replace(/[`"'“”‘’()[\]{}<>*_]/g, '').replace(/[.:;!?]+$/g, '').replace(/\s+/g, ' ').trim();
const usable = (phrase) => {
  const words = phrase.split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 3 && words.some((word) => !STOP.has(word)) && phrase.length >= 3 && phrase.length <= 40;
};

/**
 * Triggers from the description. Most descriptions in this repository say what they are for in
 * one of three shapes: quoted phrases, `Triggers: …`, or `Use when the user asks to X, Y or Z`.
 * A phrase over three words is cut to its last three, which is usually the noun it is about.
 */
function triggersFor(name, description) {
  const found = [];
  const push = (raw) => {
    let phrase = clean(raw);
    if (!phrase) return;
    let words = phrase.split(' ').filter((word) => word && !/^\(?\d+\)?$/.test(word));
    if (words.length > 3) words = words.filter((word) => !STOP.has(word)).slice(-3);
    phrase = words.join(' ');
    if (usable(phrase) && !found.includes(phrase)) found.push(phrase);
  };
  const text = String(description ?? '');
  // The name itself, as words, is always a trigger: it is the one phrase certain to mean this skill.
  push(name.replace(/-/g, ' '));
  for (const quoted of text.matchAll(/["“']([^"”']{3,60})["”']/g)) push(quoted[1]);
  const triggers = text.match(/triggers?(?:\s+(?:on|include|when))?\s*:?\s*([^.]+)/i);
  if (triggers) for (const part of triggers[1].split(/,|\bor\b/)) push(part);
  const useWhen = text.match(/use (?:this )?(?:skill )?when (?:the )?(?:user )?(?:asks? (?:to|for|about)|mentions|wants to|needs to|says|requests?|is)?\s*([^.]+)/i);
  if (useWhen) for (const part of useWhen[1].split(/,|\bor\b|\(\d+\)|;/)) push(part);
  const fallback = name.replace(/-/g, ' ');
  if (found.length < 3) push(fallback);
  if (found.length < 3) for (const part of text.split(/[.;:]/).slice(0, 3)) push(part);
  if (found.length < 3) push(name);
  return found.slice(0, 6);
}

function convert(body) {
  const kept = [];
  let skipping = false;
  let fence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) { fence = !fence; kept.push(line); continue; }
    if (fence) { kept.push(line); continue; }
    if (/^#{1,4}\s/.test(line)) { skipping = IDENTITY_SECTION.test(line); if (skipping) continue; }
    if (skipping) continue;
    if (IDENTITY.test(line.trim())) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const files = (await walk(clone)).filter((path) => !SKIP.test(relative(clone, path).split(sep).join('/')));
const seen = new Map();
const skipped = [];
const entries = [];
for (const path of files) {
  const rel = relative(clone, path).split(sep).join('/');
  const top = rel.split('/')[0];
  const domain = DOMAIN[top] ?? top;
  const text = await readFile(path, 'utf8');
  const { meta, body } = frontMatter(text);
  const name = slugOf(meta.name || basename(dirname(path)));
  if (!name) continue;
  if (seen.has(name)) { skipped.push({ name, path: rel, keptFrom: seen.get(name) }); continue; }
  seen.set(name, rel);
  const description = String(meta.description ?? '').replace(/\s+/g, ' ').trim();
  const converted = convert(body);
  if (estimateProseTokens(converted) < 60) { skipped.push({ name, path: rel, keptFrom: 'too short to be a skill' }); continue; }
  const title = converted.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
  const triggers = triggersFor(name, description);
  const mentionsScripts = /\.py\b|python3?\s+scripts?\/|scripts\//.test(converted);
  const file = [
    '---',
    `name: ${name}`,
    `domain: ${domain}`,
    `triggers: [${triggers.join(', ')}]`,
    `description: ${sentenceCut(description, 260)}`,
    `source: alirezarezvani/claude-skills · ${rel} @${head} · MIT`,
    '---',
    `<!-- catalogue skill: ${copyright}, MIT. Identity phrasing removed; nothing else edited.${mentionsScripts ? ' The source bundled scripts, which are not shipped: do by hand what the script checked.' : ''} -->`,
    '',
    converted.startsWith('# ') ? converted : `# ${title}\n\n${converted}`,
    '',
  ].join('\n');
  entries.push({ name, domain, path: rel, description, triggers, tokens: estimateProseTokens(converted), file });
}

await rm(join(LIBRARY, 'catalogue'), { recursive: true, force: true });
for (const entry of entries) {
  await mkdir(join(LIBRARY, 'catalogue', entry.domain), { recursive: true });
  await writeFile(join(LIBRARY, 'catalogue', entry.domain, `${entry.name}.md`), entry.file);
}

const domains = [...new Set(entries.map((entry) => entry.domain))].sort();
const lines = [
  '# The catalogue',
  '',
  `Every unique skill in [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) at commit \`${head}\` (MIT; ${copyright}), converted to data: identity removed, scripts not carried, filed by domain. ${entries.length} skills in ${domains.length} domains.`,
  '',
  'None of these is indexed into a project until it is enabled: `vibekit skills enable <domain>` or `vibekit skills enable <name>` writes the chosen ones into `skills/lib/vibekit/` with a short lead as the body and the full text as the reference. `vibekit skills catalogue [query]` searches this list. The 27 skills in `skills/` are hand-distilled versions of some of these and are on by default.',
  '',
  'Regenerate with: `node tools/catalogue.mjs <clone>`',
  '',
];
for (const domain of domains) {
  const rows = entries.filter((entry) => entry.domain === domain);
  lines.push(`## ${domain} (${rows.length})`, '', '| Skill | What it is for | Tokens |', '| --- | --- | ---: |');
  for (const row of rows) lines.push(`| ${row.name} | ${row.description.slice(0, 120).replace(/\|/g, '/')} | ${row.tokens} |`);
  lines.push('');
}
if (skipped.length) {
  lines.push('## Not carried', '', '| Skill | Path | Why |', '| --- | --- | --- |');
  for (const row of skipped) lines.push(`| ${row.name} | \`${row.path}\` | ${row.keptFrom.startsWith('too') ? row.keptFrom : `duplicate of \`${row.keptFrom}\``} |`);
  lines.push('');
}
await writeFile(join(LIBRARY, 'CATALOGUE.md'), lines.join('\n'));

const byDomain = Object.fromEntries(domains.map((domain) => [domain, entries.filter((entry) => entry.domain === domain).length]));
console.log(`✔ ${entries.length} catalogue skill(s) in ${domains.length} domain(s); ${skipped.length} skipped`);
console.log(JSON.stringify(byDomain));
const thin = entries.filter((entry) => entry.triggers.length < 3 || entry.triggers.every((trigger) => trigger === entry.name || trigger === entry.name.replace(/-/g, ' ')));
console.log(`triggers: ${entries.length - thin.length} inferred from the description, ${thin.length} fell back to the name`);
console.log(`total: ${Math.round(entries.reduce((sum, entry) => sum + entry.tokens, 0) / 1000)}k tokens on disk`);
