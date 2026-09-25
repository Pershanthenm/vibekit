import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { exists, writeText } from '../fsutil.js';
import { understandRepo } from '../understand.js';
import { which } from '../which.js';

/**
 * `vibekit analyze`. CLI Spec §2.
 *
 * "Read-only assessment of a codebase that is not yours, or not yours yet. Writes nothing to the
 * target repository." It reads the way `new project --import` reads — the same understanding,
 * every claim with the file it came from — and produces a report rather than a folder: what it
 * is, how it is built, what it talks to, what shape it is in, what would worry you, and what it
 * would take to work on.
 *
 * `quick` depth makes no model calls at all, so it is free to run on anything. Nor do the other
 * depths in this build: they read more files and more history. A model is never called here.
 */

export const DEPTHS = Object.freeze({
  quick: { budget: 12_000, commits: 40 },
  standard: { budget: 40_000, commits: 200 },
  deep: { budget: 120_000, commits: 800 },
});
export const FOCUSES = Object.freeze(['security', 'cost', 'migration', 'quality']);

const REMOTE = /^(?:https?:\/\/|git@|ssh:\/\/)/;

export async function analyze(options) {
  const { root, args, json } = options;
  const target = args.find((argument) => !argument.startsWith('-')) ?? null;
  if (!target) {
    console.log([
      '',
      '  analyze .                          a repo on your machine',
      '  analyze git@github.com:acme/app    clone shallow, analyse, discard',
      '  analyze . --depth quick|standard|deep',
      '  analyze . --focus security|cost|migration|quality',
      '  analyze . --pdf --brand acme.co.za a report in the client\'s livery',
      '  analyze . --compare ../other-repo  two codebases side by side',
      '',
      '  Read-only. Writes nothing to the repository it reads; --out puts the report somewhere else.',
      '',
    ].join('\n'));
    return;
  }
  const depth = String(options.depth ?? 'standard').toLowerCase();
  if (!DEPTHS[depth]) throw new Error(`--depth takes one of ${Object.keys(DEPTHS).join(', ')}.`);
  const focus = options.focus ? String(options.focus).toLowerCase() : null;
  if (focus && !FOCUSES.includes(focus)) throw new Error(`--focus takes one of ${FOCUSES.join(', ')}.`);

  const first = await analyseTarget(root, target, { depth });
  const second = options.compare ? await analyseTarget(root, String(options.compare), { depth }) : null;

  const report = second ? compareReports(first, second, { focus }) : buildReport(first, { focus });
  const markdown = second ? renderComparison(report) : renderReport(report);

  if (options.out) {
    const out = resolve(root, String(options.out));
    for (const analysed of [first, second].filter(Boolean)) {
      if (!analysed.remote && !relative(analysed.path, out).startsWith('..') && relative(analysed.path, out) !== '') throw new Error(`--out ${options.out} is inside ${analysed.path}. This writes nothing to the repository it reads; put the report somewhere else.`);
    }
    if (options.pdf) await writePdf(markdown, out, { brand: options.brand ?? null, title: report.title, allowPrivate: Boolean(options['allow-private']) });
    else await writeText(out, markdown);
    if (json) return void console.log(JSON.stringify({ out, ...(second ? { compared: [first.path, second.path] } : { target: first.path }) }));
    console.log(`✔ ${out}`);
    return;
  }
  if (options.pdf) {
    const out = resolve(root, `${(second ? 'comparison' : first.name).replace(/[^\w.-]+/g, '-')}-analysis.pdf`);
    if (!first.remote && !relative(first.path, out).startsWith('..')) throw new Error('A PDF would land inside the repository being read. Say where with --out <file>.');
    const written = await writePdf(markdown, out, { brand: options.brand ?? null, title: report.title, allowPrivate: Boolean(options['allow-private']) });
    console.log(`✔ ${written.path}${written.note ? ` · ${written.note}` : ''}`);
    return;
  }
  if (json) return void console.log(JSON.stringify(report, null, 2));
  console.log(markdown);
}

// ---------------------------------------------------------------- reading

/** A path is read in place. A URL is cloned shallow into a temp directory, read, and discarded. */
async function analyseTarget(root, target, { depth }) {
  const { budget, commits } = DEPTHS[depth];
  if (REMOTE.test(target)) {
    if (!which('git')) throw new Error('git is not installed, so a repository cannot be cloned. Clone it another way and point at the checkout.');
    const dir = await mkdtemp(join(tmpdir(), 'vibekit-analyze-'));
    try {
      try {
        execFileSync('git', ['clone', '--depth', String(Math.min(commits, 200)), '--quiet', target, dir], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 });
      } catch (error) {
        throw new Error(`Could not clone ${target}: ${String(error.stderr ?? error.message).trim().split('\n').pop()}`);
      }
      const understanding = await understandRepo(dir, { budget, commits });
      return { path: target, name: target.split('/').pop().replace(/\.git$/, ''), remote: true, depth, understanding };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  const path = resolve(root, target);
  if (!(await exists(path))) throw new Error(`No such path: ${path}`);
  const understanding = await understandRepo(path, { budget, commits });
  return { path, name: path.split(/[\\/]/).filter(Boolean).pop() ?? 'repository', remote: false, depth, understanding };
}

// ---------------------------------------------------------------- the report

const part = (understanding, key) => understanding.sections.find((section) => section.key === key) ?? { lines: [], confidence: 'low', from: [] };

/** "What it would take to work on": a plain estimate from what was read, with the reasons beside it. */
export function effortFrom(understanding) {
  const built = part(understanding, 'built');
  const quality = part(understanding, 'quality');
  const reasons = [];
  let score = 0;
  const files = understanding.budget?.files ?? 0;
  if (files > 800) { score += 2; reasons.push(`${files} files read: a large codebase`); } else if (files > 200) { score += 1; reasons.push(`${files} files: a medium codebase`); } else reasons.push(`${files} files: small`);
  const noTests = quality.lines.some((line) => /no test files/i.test(line));
  if (noTests) { score += 2; reasons.push('no tests: every change starts with writing the tests that should already exist'); }
  else if (quality.lines.some((line) => /missing test kinds/i.test(line))) { score += 1; reasons.push('some test kinds are missing'); }
  if (quality.lines.some((line) => /no CI workflow/i.test(line))) { score += 1; reasons.push('no CI: nothing runs the tests but a person'); }
  if (built.lines.some((line) => /no build or test command/i.test(line))) { score += 1; reasons.push('no build or test command in any manifest'); }
  const high = understanding.risks.filter((risk) => risk.severity === 'high').length;
  if (high) { score += 1; reasons.push(`${high} high-severity risk${high === 1 ? '' : 's'} to clear first`); }
  if (part(understanding, 'conventions').lines.some((line) => /no repeated convention/i.test(line))) { score += 1; reasons.push('no convention clear enough to name: expect a style discussion before the first change'); }
  const level = score >= 5 ? 'hard' : score >= 3 ? 'moderate' : 'straightforward';
  return { level, score, reasons, asks: understanding.asks.length };
}

const FOCUS_SECTIONS = {
  security: ['talks', 'quality'],
  cost: ['built', 'quality', 'conventions'],
  migration: ['built', 'talks', 'entities'],
  quality: ['quality', 'conventions'],
};

export function buildReport(analysed, { focus = null, at = new Date() } = {}) {
  const { understanding } = analysed;
  const keys = focus ? FOCUS_SECTIONS[focus] : ['what', 'built', 'talks', 'entities', 'quality', 'conventions'];
  const sections = keys.map((key) => ({ key, ...part(understanding, key) }));
  const effort = effortFrom(understanding);
  return {
    title: `${analysed.name} · analysis`,
    target: analysed.path, remote: analysed.remote, depth: analysed.depth, focus,
    read: at.toISOString().slice(0, 10),
    budget: understanding.budget,
    plain: understanding.plain,
    sections,
    risks: focus && focus !== 'security' ? understanding.risks.filter((risk) => risk.severity === 'high') : understanding.risks,
    decisions: focus ? [] : understanding.decisions,
    effort,
    asks: understanding.asks.map((ask) => ask.plain),
    seams: focus === 'migration' ? seamsFrom(understanding) : null,
  };
}

/** For a migration: what carries across and where the seams are, from the entities and the integrations. */
function seamsFrom(understanding) {
  const talks = part(understanding, 'talks').lines[0] ?? '';
  const entities = part(understanding, 'entities').lines[0] ?? '';
  return [
    entities.startsWith('no ') ? 'No entity files were recognised, so the data model has to come from the database itself.' : `Data that carries across: ${entities}.`,
    talks.startsWith('nothing') ? 'No external integration was recognised: the seams are internal.' : `Each integration is a seam to keep stable while the inside moves: ${talks}.`,
    'A characterisation suite around the public surface is the first slice of any migration.',
  ];
}

const TITLES = { what: 'What it is', built: 'How it is built', talks: 'What it talks to', entities: 'The data', quality: 'What shape it is in', conventions: 'How it is written' };

export function renderReport(report) {
  const out = [`# ${report.title}`, '', `Read ${report.read} · ${report.depth} · ${report.budget.read.toLocaleString()} of ${report.budget.limit.toLocaleString()} token budget · ${report.budget.files} files${report.focus ? ` · focus: ${report.focus}` : ''}`, '', 'Read-only: nothing was written to the repository. A confidence below `high` is an inference, not a reading.', '', '## In plain terms', '', report.plain];
  for (const section of report.sections) {
    out.push('', `## ${TITLES[section.key] ?? section.title}`, '', `confidence: ${section.confidence}${section.from.length ? `    from: ${section.from.join(', ')}` : ''}`, '');
    for (const line of section.lines) out.push(`- ${line}`);
  }
  if (report.seams) { out.push('', '## Where the seams are', ''); for (const line of report.seams) out.push(`- ${line}`); }
  out.push('', '## What would worry you', '');
  if (!report.risks.length) out.push('- None of the patterns checked for were found. That is not the same as none existing.');
  for (const risk of report.risks) out.push(`- **${risk.severity}** ${risk.title} — ${risk.detail}`);
  if (report.decisions.length) { out.push('', '## Decisions in the commit history', ''); for (const decision of report.decisions) out.push(`- ${decision.text}`); }
  out.push('', '## What it would take to work on', '', `**${report.effort.level}**, from what was read:`, '');
  for (const reason of report.effort.reasons) out.push(`- ${reason}`);
  if (report.asks.length) { out.push('', `${report.asks.length} thing${report.asks.length === 1 ? '' : 's'} the code could not tell:`, ''); for (const ask of report.asks) out.push(`- ${ask}`); }
  if (report.budget.skipped) out.push('', `_${report.budget.skipped} file(s) were not read: the budget ran out. \`--depth deep\` reads more._`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------- --compare

export function compareReports(first, second, { focus = null } = {}) {
  const a = buildReport(first, { focus });
  const b = buildReport(second, { focus });
  const facts = (report) => ({
    'In plain terms': report.plain,
    ...Object.fromEntries(report.sections.map((section) => [TITLES[section.key] ?? section.key, section.lines.filter(Boolean).join(' · ') || '—'])),
    'High risks': String(report.risks.filter((risk) => risk.severity === 'high').length),
    'All risks': String(report.risks.length),
    'Effort to work on': `${report.effort.level} (${report.effort.reasons[0] ?? ''})`,
    'Could not tell': String(report.asks.length),
  });
  return { title: `${first.name} against ${second.name}`, focus, left: { name: first.name, path: first.path, facts: facts(a) }, right: { name: second.name, path: second.path, facts: facts(b) } };
}

export function renderComparison(comparison) {
  const rows = Object.keys(comparison.left.facts);
  const out = [`# ${comparison.title}`, '', `Two codebases, side by side${comparison.focus ? ` · focus: ${comparison.focus}` : ''}. Read-only: nothing was written to either.`, '', `| | ${comparison.left.name} | ${comparison.right.name} |`, '| --- | --- | --- |'];
  for (const row of rows) out.push(`| ${row} | ${cell(comparison.left.facts[row])} | ${cell(comparison.right.facts[row])} |`);
  out.push('');
  return out.join('\n');
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// ---------------------------------------------------------------- --pdf

/** The report as a PDF in the client's livery, through the same renderer the architecture documents use. */
async function writePdf(markdown, out, { brand, title, allowPrivate }) {
  const { DEFAULT_BRAND } = await import('../docs/arch/brand.js');
  const { convert, toHtml } = await import('../docs/arch/formats.js');
  let livery = DEFAULT_BRAND;
  if (brand) {
    const { extractBrand } = await import('../docs/arch/extract.js');
    livery = await extractBrand(/^https?:\/\//.test(brand) ? brand : `https://${brand}`, { allowPrivate }).catch(() => DEFAULT_BRAND);
  }
  const html = await toHtml(markdown, { docsRoot: tmpdir(), brand: livery, title });
  const target = out.endsWith('.pdf') ? out : `${out}.pdf`;
  const htmlPath = target.replace(/\.pdf$/, '.html');
  await writeText(htmlPath, html);
  const outcome = convert(htmlPath, target, 'pdf');
  if (outcome.ok) return { path: target, note: `via ${outcome.by}` };
  return { path: htmlPath, note: `PDF not written: ${outcome.reason}. The HTML is written instead; open and print it.` };
}
