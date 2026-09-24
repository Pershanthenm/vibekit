/**
 * Build the shipped library's reference files and SOURCES.md from the upstream repository.
 *
 *   node tools/library.mjs <path to a clone of alirezarezvani/claude-skills>
 *
 * Each `library/skills/<name>.md` names its source in front matter (`source: <repo> · <path> @<commit>
 * · <licence>`). This copies that source file into `library/references/<name>.md` with identity
 * phrasing dropped (a role is permissions, not character) and a provenance header carrying the
 * MIT notice, then writes `library/SOURCES.md`. Scripts the source bundled are not shipped: a skill
 * is data, and the reference says so where a script was referred to.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { IDENTITY, IDENTITY_SECTION } from '../src/skillimport.js';
import { estimateProseTokens } from '../src/tokens.js';

const LIBRARY = fileURLToPath(new URL('../library', import.meta.url));
const clone = process.argv[2] ? resolve(process.argv[2]) : null;
if (!clone) { console.error('Usage: node tools/library.mjs <path to a clone of the source repository>'); process.exit(2); }

const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim();
const licenceText = await readFile(join(clone, 'LICENSE'), 'utf8').catch(() => '');
const copyright = licenceText.split('\n').find((line) => /copyright/i.test(line))?.trim() ?? 'Copyright (c) the source authors';

const names = (await readdir(join(LIBRARY, 'skills'))).filter((file) => file.endsWith('.md') && !file.endsWith('.test.md')).map((file) => file.replace(/\.md$/, '')).sort();
await mkdir(join(LIBRARY, 'references'), { recursive: true });
const rows = [];
let problems = 0;

for (const name of names) {
  const text = await readFile(join(LIBRARY, 'skills', `${name}.md`), 'utf8');
  const source = text.match(/^source:\s*(.+)$/m)?.[1];
  const parts = source?.match(/^(\S+) · (\S+) @([0-9a-f]{7}) · (\w+)$/);
  if (!parts) { console.error(`✖ ${name}: no parseable source line`); problems += 1; continue; }
  const [, repo, path, commit, licence] = parts;
  if (commit !== head) console.error(`! ${name}: cites @${commit}, the clone is at @${head}`);
  const original = await readFile(join(clone, path), 'utf8').catch(() => null);
  if (original === null) { console.error(`✖ ${name}: ${path} is not in the clone`); problems += 1; continue; }

  // Identity out, everything else kept — this is the reference, so code stays inline.
  const kept = [];
  let skipping = false;
  let fence = false;
  for (const line of original.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')) {
    if (line.startsWith('```')) { fence = !fence; kept.push(line); continue; }
    if (fence) { kept.push(line); continue; }
    if (/^#{1,4}\s/.test(line)) { skipping = IDENTITY_SECTION.test(line); if (skipping) continue; }
    if (skipping) continue;
    if (IDENTITY.test(line.trim())) continue;
    kept.push(line);
  }
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const mentionsScripts = /\.py\b|python3?\s+scripts?\//.test(body);
  const reference = [
    `# Reference: ${name}`,
    '',
    `Full source of the shipped skill \`${name}\`, kept for depth; the skill itself is the short version in \`skills/lib/vibekit/${name}.md\`.`,
    `Source: ${repo} · \`${path}\` @${commit} · ${licence}. ${copyright}. Identity phrasing was removed; nothing else was edited.`,
    mentionsScripts ? 'The source bundled scripts; VibeKit ships none of them (a skill is data). Where the text says to run one, do by hand what the script checked.' : '',
    '',
    '---',
    '',
    body,
    '',
  ].filter((line, index, all) => !(line === '' && all[index - 1] === '' && index < 6)).join('\n');
  await writeFile(join(LIBRARY, 'references', `${name}.md`), reference);
  rows.push({ name, path, commit, licence, tokens: estimateProseTokens(text.replace(/^---\n[\s\S]*?\n---\n/, '')), referenceTokens: estimateProseTokens(body) });
}

const table = [
  '# Shipped skills: sources',
  '',
  `Distilled from [${rows[0]?.path ? 'alirezarezvani/claude-skills' : 'the source repository'}](https://github.com/alirezarezvani/claude-skills) at commit \`${head}\` (MIT; ${copyright}). Each skill is VibeKit's own short version of the technique; the full source text is in \`references/\`, identity removed, and \`vibekit skills reference <name>\` prints it. Bundled scripts were not carried over.`,
  '',
  'Regenerate with: `node tools/library.mjs <clone>`',
  '',
  '| Skill | Source file | Commit | Licence | Body tokens | Reference tokens |',
  '| --- | --- | --- | --- | ---: | ---: |',
  ...rows.map((row) => `| ${row.name} | \`${row.path}\` | ${row.commit} | ${row.licence} | ${row.tokens} | ${row.referenceTokens} |`),
  '',
];
await writeFile(join(LIBRARY, 'SOURCES.md'), table.join('\n'));
console.log(`✔ ${rows.length} reference(s) written to library/references/, SOURCES.md updated${problems ? ` · ${problems} problem(s)` : ''}`);
process.exit(problems ? 1 : 0);
