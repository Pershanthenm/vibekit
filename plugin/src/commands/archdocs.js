import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DEFAULT_BRAND, renderBrandYaml, withContrastNotes } from '../docs/arch/brand.js';
import { HLD_TEMPLATE } from '../docs/arch/documents.js';
import { docsDrift } from '../docs/arch/drift.js';
import { extractBrand, wordmarkSvg } from '../docs/arch/extract.js';
import { FORMATS, convert, toHtml } from '../docs/arch/formats.js';
import { generateDocs, generateModel } from '../docs/arch/generate.js';
import { atCommit, commitDate, diffDocs } from '../docs/arch/history.js';
import { API_TEMPLATE, DATA_TEMPLATE, LLD_TEMPLATE, RUNBOOK_TEMPLATE } from '../docs/arch/library.js';
import { SRS_TEMPLATE, TECHSPEC_TEMPLATE } from '../docs/arch/specs.js';
import { DOCS_DIR, brandPath, templatesDir } from '../docs/arch/paths.js';
import { repoState } from '../evidence.js';
import { exists, readText, writeText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit docs`. Documentation Feature Spec §8.
 *
 * Thin, like every other command: resolve the folder, call into src/docs/arch/, print. The two
 * speeds live in the generator — the model with every requirement, the documents at gates.
 */

const DOCUMENTS = ['hld', 'lld', 'api', 'data', 'runbook', 'srs', 'techspec'];
const BUILT_IN = { hld: HLD_TEMPLATE, lld: LLD_TEMPLATE, api: API_TEMPLATE, data: DATA_TEMPLATE, runbook: RUNBOOK_TEMPLATE, srs: SRS_TEMPLATE, techspec: TECHSPEC_TEMPLATE };

export async function archdocs(options) {
  const { root, args, folder: chosen, docs: docsDir, model: modelOnly, brand, 'scaffold-templates': scaffold, at, diff } = options;
  const folder = chosen ?? (await folderName(root));
  const docs = docsDir ?? DOCS_DIR;
  const context = { folder, docs };

  if (brand) return writeBrand(root, docs, brand, options['allow-private']);
  if (scaffold) return scaffoldTemplate(root, docs, scaffold);
  if (diff) return showDiff(root, args, context);
  if (modelOnly && !at) return justTheModel(root, context);

  const only = args.filter((argument) => DOCUMENTS.includes(argument));
  const formats = FORMATS.filter((format) => format !== 'md' && options[format]);

  if (at) {
    // §7: a document handed to somebody matches a tag, and being able to reproduce it exactly is
    // the difference between a document and a claim about a document. The working tree is never
    // touched — the past is rebuilt in a throwaway worktree.
    const produced = await atCommit(root, at, async (tree, commit) => {
      const result = await generateDocs(tree, { ...context, only, commit, date: commitDate(root, commit) });
      const copied = [];
      for (const name of result.documents) {
        const body = await readText(join(tree, docs, name));
        const target = join(root, docs, `${name.replace(/\.md$/, '')}@${at}.md`);
        await writeText(target, body);
        copied.push(`${docs}/${basename(target)}`);
      }
      return { commit, copied, model: result.model };
    });
    console.log(`✔ regenerated as at ${at} (${produced.commit.slice(0, 7)})`);
    for (const path of produced.copied) console.log(`    ${path}`);
    return;
  }

  const commit = repoState(root)?.commit ?? null;
  const result = await generateDocs(root, { ...context, only, commit });
  console.log(`✔ ${result.documents.join(', ')} · ${result.model.containers.length} container(s), ${result.model.entities.length} entit${result.model.entities.length === 1 ? 'y' : 'ies'}`);
  for (const path of result.written) console.log(`    ${path}`);

  for (const component of result.model.components.filter((entry) => entry.unplanned)) {
    console.log(`  ! ${component.path} is in the code but not in the intended structure — every diagram of it is already wrong`);
  }

  for (const format of formats) await writeFormat(root, docs, result, format);
}

async function writeFormat(root, docs, result, format) {
  for (const name of result.documents) {
    const markdown = await readText(join(root, docs, name));
    const stem = name.replace(/\.md$/, '');
    const html = await toHtml(markdown, { docsRoot: join(root, docs), brand: result.brand, title: `${result.model.name} — ${stem}` });
    const htmlPath = join(root, docs, `${stem}.html`);

    if (format === 'html') {
      await writeText(htmlPath, html);
      console.log(`    ${docs}/${stem}.html`);
      continue;
    }

    // Word and PDF go through a converter: turning our SVG into the PNG those formats want means
    // rasterising vector text, and a document with its diagrams missing would be worse than none.
    await writeText(htmlPath, html);
    const outcome = convert(htmlPath, join(root, docs, `${stem}.${format}`), format);
    if (outcome.ok) console.log(`    ${docs}/${stem}.${format} (via ${outcome.by})`);
    else console.log(`  ! ${stem}.${format} not written: ${outcome.reason}`);
  }
}

async function justTheModel(root, context) {
  const result = await generateModel(root, context);
  console.log(`✔ ${result.written.length} file(s) written · ${result.diagrams.length} diagram(s)`);
  for (const path of result.written) console.log(`    ${path}`);
}

async function showDiff(root, args, context) {
  const [from, to] = args;
  if (!from || !to) throw new Error('Usage: vibekit docs --diff <from> <to>');
  const result = await diffDocs(root, from, to, context);
  console.log(result.markdown);
}

/**
 * §5 — two files and a preview, not a folder of templates. The built-in structures pick the brand
 * up immediately, so most teams never need a template at all.
 */
async function writeBrand(root, docs, source, allowPrivate = false) {
  if (await exists(brandPath(root, docs))) {
    throw new Error(`${docs}/brand.yml already exists. It is yours; edit it rather than regenerating it.`);
  }

  const fromSource = typeof source === 'string' && source !== 'true' && source.length > 1;
  const extracted = fromSource
    ? await extractBrand(source, { allowPrivate: Boolean(allowPrivate) }).catch((error) => {
      // A failed extraction is reported, not guessed: a plausible-looking logo from somewhere
      // else is worse than the wordmark fallback and a line saying what happened.
      console.log(`  ! could not read ${source}: ${error.message}`);
      return null;
    })
    : null;

  const brand = extracted?.brand ?? withContrastNotes(DEFAULT_BRAND);
  await writeText(brandPath(root, docs), renderBrandYaml(brand, extracted?.source ?? null));
  console.log(`✔ ${docs}/brand.yml written. Edit it freely — VibeKit never overwrites it.`);

  if (extracted) {
    for (const note of extracted.missing) console.log(`  ! ${note}`);
    if (extracted.notice) console.log(`  ${extracted.notice}`);
    if (!extracted.logo) {
      await writeText(join(root, docs, 'assets/logo.svg'), wordmarkSvg(brand.company?.name ?? 'Wordmark', brand));
      console.log(`    ${docs}/assets/logo.svg (wordmark)`);
    }
  }
  for (const note of brand.notes ?? []) console.log(`  ! ${note}`);
}

async function scaffoldTemplate(root, docs, name) {
  if (!DOCUMENTS.includes(name)) throw new Error(`--scaffold-templates takes one of: ${DOCUMENTS.join(', ')}.`);
  const path = join(templatesDir(root, docs), `${name}.md`);
  if (await exists(path)) throw new Error(`${docs}/templates/${name}.md already exists. Delete it to go back to the built-in structure.`);
  await writeText(path, BUILT_IN[name]);
  console.log(`✔ ${docs}/templates/${name}.md written. It wins for that document only; the others keep the built-in structure.`);
}

/** `vibekit drift` for the documentation half. */
export async function archdrift({ root, folder: chosen, docs: docsDir }) {
  const folder = chosen ?? (await folderName(root));
  const result = await docsDrift(root, { folder, docs: docsDir ?? DOCS_DIR });
  if (!result.checked) {
    console.log('No docs/ folder. Run `vibekit docs` to write one.');
    return;
  }
  const errors = result.findings.filter((entry) => entry.severity === 'error');
  if (!result.findings.length) {
    console.log('✔ The documentation matches the code.');
    return;
  }
  for (const entry of errors) {
    console.log(`✖ ${entry.message}`);
    if (entry.fix) console.log(`    fix: ${entry.fix}`);
  }
  for (const entry of result.findings.filter((item) => item.severity === 'warning')) console.log(`! ${entry.message}`);
  if (errors.length) process.exitCode = 1;
}

export { writeFile };
