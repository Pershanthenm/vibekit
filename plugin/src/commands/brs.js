import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BRS_QUESTIONS, brsBody, brsGaps, parseAnswers } from '../brs.js';
import { DOCS_DIR } from '../docs/arch/paths.js';
import { exists, writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { folderName } from './folder.js';

/**
 * `vibekit new brs` — build the business requirements document from eight answers, write it to
 * docs/brs.md, and ingest it as the project's source of record. For the person who has no BRS.
 *
 *   vibekit new brs                                   asked, one question at a time
 *   vibekit new brs --answer users="staff, supervisor" --answer capabilities="staff: count a bin; …"
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
  if (!answers.purpose && config.project.description) answers.purpose = config.project.description;

  const asker = options.asker ?? (options.yes || Object.keys(answers).length ? null : (await import('../menu.js')).createAsker());
  try {
    if (asker) {
      if (!json) {
        console.log(`A requirements document for ${name}, in your words. Eight questions; Enter skips one, and the analyst asks about it later.`);
        console.log('');
      }
      for (const question of BRS_QUESTIONS) {
        if (answers[question.key]) continue;
        const answer = await asker.text(`${question.question}${question.list ? ' Separate items with ";".' : ''}\n  e.g. ${question.hint.replace(/\n/g, '; ')}`, '');
        if (String(answer ?? '').trim()) answers[question.key] = answer;
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
