import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BRS_QUESTIONS, brsBody, brsGaps, parseAnswers, splitAnswer, suggestionsFor } from '../brs.js';
import { DOCS_DIR } from '../docs/arch/paths.js';
import { exists, writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { folderName } from './folder.js';

/**
 * `vibekit new brs` — build the requirements document from five answers, write it to
 * docs/brs.md, and ingest it as the project's source of record. For the person who has no BRS.
 *
 *   vibekit new brs                                   asked, one question at a time
 *   vibekit new brs --answer does="count a shelf; approve a difference" --answer never="…"
 *   vibekit new brs --from answers.json               the same keys, as a file
 *   --no-ingest                                       write the document only
 */
export const BRS_PATH = `${DOCS_DIR}/brs.md`;

export async function newBrs(options) {
  const { root, json } = options;
  const config = await loadProject(root).catch(() => null);
  if (!config?.project?.name) throw new Error('No project here. `vibekit new project` first; `new brs` writes its requirements document.');
  const name = config.project.name;

  const fromJson = options.from ? JSON.parse(await readFile(resolve(root, options.from), 'utf8')) : null;
  const answers = parseAnswers(options.answer ?? [], fromJson);
  if (!answers.what && config.project.description) answers.what = config.project.description;

  // `--suggest`: the picks each question offers, for a helper that presents them as a menu.
  if (options.suggest) {
    const context = { description: answers.what ?? config.project.description ?? null, does: splitAnswer(BRS_QUESTIONS[1], answers.does) };
    const suggestions = Object.fromEntries(BRS_QUESTIONS.map((question) => [question.key, { question: question.question, example: question.hint.split('\n'), suggestions: suggestionsFor(question.key, context) }]));
    if (json) return void console.log(JSON.stringify(suggestions, null, 2));
    for (const [key, entry] of Object.entries(suggestions)) {
      console.log(`${key.padEnd(8)} ${entry.question}`);
      for (const item of entry.suggestions) console.log(`         - ${item}`);
    }
    return suggestions;
  }

  const asker = options.asker ?? (options.yes || Object.keys(answers).length ? null : (await import('../menu.js')).createAsker());
  try {
    if (asker) {
      if (!json) {
        console.log(`A requirements document for ${name}, in your words. Five questions; Enter skips one, and the analyst asks about it later.`);
        console.log('');
      }
      for (const question of BRS_QUESTIONS) {
        if (answers[question.key]) continue;
        const picks = suggestionsFor(question.key, { description: answers.what ?? config.project.description, does: splitAnswer(BRS_QUESTIONS[1], answers.does) });
        if (!picks.length) {
          const answer = await asker.text(`${question.question}\n  e.g. ${question.hint.replace(/\n/g, '; ')}`, '');
          if (String(answer ?? '').trim()) answers[question.key] = answer;
          continue;
        }
        // Pick from suggestions first; then a line for anything the list did not have.
        const picked = await asker.choose({ id: question.key, header: question.key, question: question.question, title: question.question, multi: true, options: picks.map((item) => ({ id: item, label: item })) });
        const chosen = Array.isArray(picked) ? picked : picked?.other ? [picked.other] : [];
        const more = await asker.text('Anything else? Separate with ";", or Enter to move on', '');
        const items = [...chosen, ...splitAnswer(question, more)];
        if (items.length) answers[question.key] = items.join('\n');
      }
    }
  } finally {
    if (!options.asker) asker?.close?.();
  }

  const body = brsBody(name, answers);
  const path = join(root, BRS_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeText(path, body);
  const report = brsGaps(body);

  let source = null;
  if (!options['no-ingest']) {
    const folder = await folderName(root);
    const { ingest } = await import('./ingest.js');
    const lines = [];
    const log = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await ingest({ ...options, root, folder, args: [BRS_PATH], yes: true, json: false, title: `${name} BRS` });
    } finally {
      console.log = log;
    }
    source = lines.find((line) => /^BRS-\d+/.test(line))?.split(' ')[0] ?? 'BRS-001';
  }

  const result = { path: BRS_PATH, source, sections: report.sections, statements: report.statements, gaps: report.gaps };
  if (json) return void console.log(JSON.stringify(result, null, 2));
  console.log(`✔ ${BRS_PATH} · ${report.sections} sections · ${report.statements} requirement statement(s)${source ? ` · ingested as ${source}` : ''}`);
  if (report.gaps.length) {
    console.log('  Still thin, and the analyst will ask about it first:');
    for (const gap of report.gaps) console.log(`    - ${gap}`);
  } else {
    console.log('  Nothing obviously missing. The analyst still reads it as a person would and asks what it does not settle.');
  }
  console.log(`  Open ${BRS_PATH} and change anything; \`vibekit ingest ${BRS_PATH}\` re-reads it.`);
  return result;
}

/** Whether a project already has its document, so the wizard offers to re-read rather than rewrite it. */
export const hasBrs = (root) => exists(join(root, BRS_PATH));
