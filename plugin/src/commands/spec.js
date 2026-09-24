import { join } from 'node:path';
import { isOpen, listAsks, openAsk } from '../folder/asks.js';
import { FORMATS, convert, toHtml } from '../docs/arch/formats.js';
import { gapsFor, unaskedGaps } from '../docs/arch/gaps.js';
import { generateDocs } from '../docs/arch/generate.js';
import { atCommit, commitDate, diffDocs } from '../docs/arch/history.js';
import { DOCS_DIR } from '../docs/arch/paths.js';
import { repoState } from '../evidence.js';
import { readText, writeText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit spec`. Specification §59.
 *
 * Two documents, both generated from the folder: the requirements specification for the business
 * and the technical specification for engineers. They are outputs, not sources — the normal path
 * is to change the folder and regenerate.
 *
 * The part that is easy to leave out and matters most: before writing, `spec` raises an ask for
 * every section it cannot fill, and the answer lands in the folder rather than in the document.
 * A gap answered into the document alone is a gap again at the next release.
 */

const DOCUMENTS = { srs: 'srs.md', tech: 'tech-spec.md' };

export async function spec(options) {
  const { root, args, folder: chosen, docs: docsDir, both, at, diff, json } = options;
  const folder = chosen ?? (await folderName(root));
  const docs = docsDir ?? DOCS_DIR;
  const context = { folder, docs };

  const wanted = args.filter((argument) => argument in DOCUMENTS);
  const only = (both || !wanted.length ? ['srs', 'techspec'] : wanted.map((name) => (name === 'tech' ? 'techspec' : name)));

  if (diff) {
    const [from, to] = args.filter((argument) => !(argument in DOCUMENTS));
    if (!from) throw new Error('Usage: vibekit spec --diff <from> [<to>]  — what changed between two points, which is what a client or an auditor asks for.');
    const result = await diffDocs(root, from, to ?? 'HEAD', context);
    console.log(result.markdown);
    return;
  }

  if (at) {
    // §59: both are available `--at <sha>`, because a specification handed to somebody describes
    // one commit and being able to reproduce it is what makes it a document rather than a claim.
    const produced = await atCommit(root, at, async (tree, commit) => {
      const result = await generateDocs(tree, { ...context, only, commit, date: commitDate(root, commit) });
      const copied = [];
      for (const name of result.documents) {
        const body = await readText(join(tree, docs, name));
        const target = join(root, docs, `${name.replace(/\.md$/, '')}@${at}.md`);
        await writeText(target, body);
        copied.push(`${docs}/${name.replace(/\.md$/, '')}@${at}.md`);
      }
      return { commit, copied };
    });
    console.log(`✔ regenerated as at ${at} (${produced.commit.slice(0, 7)})`);
    for (const path of produced.copied) console.log(`    ${path}`);
    return;
  }

  const commit = repoState(root)?.commit ?? null;
  const result = await generateDocs(root, { ...context, only, commit });
  const written = result.documents.filter((name) => Object.values(DOCUMENTS).includes(name));
  const bodies = await Promise.all(written.map((name) => readText(join(root, docs, name))));

  const existing = (await listAsks(root, folder)).filter(isOpen);
  const gaps = gapsFor(bodies, { existing });
  const unasked = unaskedGaps(bodies);

  if (json) {
    return void console.log(JSON.stringify({ documents: written, gaps, unasked }, null, 2));
  }

  console.log(`✔ ${written.join(', ')}`);
  for (const name of written) console.log(`    ${docs}/${name}`);

  if (gaps.length) {
    console.log('');
    console.log(`${gaps.length} section${gaps.length === 1 ? '' : 's'} could not be filled from the folder. Each is now an ask:`);
    for (const gap of gaps) {
      const { id } = await openAsk(root, { ask: gap.ask, plain: gap.plain, about: null }, folder).catch((error) => ({ id: `not raised (${error.message})` }));
      console.log(`  ${id}  ${gap.plain}`);
      console.log(`       answering it writes to ${folder}/${gap.lands}, not only to the document`);
    }
    console.log('');
    console.log('  vibekit ask list    ·    answer them, then run this again');
  }

  if (unasked.length) {
    console.log('');
    console.log(`  Also empty, and not worth a question yet: ${unasked.join(', ')}`);
  }

  for (const format of FORMATS.filter((name) => name !== 'md' && options[name])) {
    await writeFormat(root, docs, written, result, format);
  }
}

async function writeFormat(root, docs, written, result, format) {
  for (const name of written) {
    const markdown = await readText(join(root, docs, name));
    const stem = name.replace(/\.md$/, '');
    const html = await toHtml(markdown, { docsRoot: join(root, docs), brand: result.brand, title: `${result.model.name} — ${stem}` });
    const htmlPath = join(root, docs, `${stem}.html`);
    await writeText(htmlPath, html);

    if (format === 'html') {
      console.log(`    ${docs}/${stem}.html`);
      continue;
    }
    const outcome = convert(htmlPath, join(root, docs, `${stem}.${format}`), format);
    if (outcome.ok) console.log(`    ${docs}/${stem}.${format} (via ${outcome.by})`);
    else console.log(`  ! ${stem}.${format} not written: ${outcome.reason}`);
  }
}
