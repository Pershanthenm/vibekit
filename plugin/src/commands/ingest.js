import { basename, extname, resolve } from 'node:path';
import { openAsk } from '../folder/asks.js';
import {
  changedSections, convertSource, detect, mappingPath, nextSourceId, readIndex, writeSource,
} from '../sources.js';
import { exists, readText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit ingest <file>`. Specification §31.
 *
 * "A BRS is not memory. Memory is what agents learned; a BRS is what the business asked for."
 *
 * The redaction step is the one that needs a human between the reading and the writing: the
 * folder is in git forever, so `ingest` shows what it found and writes nothing until somebody
 * confirms. `--yes` is for a document already known to be clean, and `--no-redact` records the
 * decision in the index rather than hiding it.
 */

export async function ingest(options) {
  const { root, args, folder: chosen, yes, 'no-redact': noRedact, id: wanted, title: givenTitle, version, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [target] = args.filter((argument) => !argument.startsWith('-'));

  if (!target) {
    throw new Error('Usage: vibekit ingest <file>   — a BRS, a brief, or anything the business wrote. Markdown and plain text go straight in; anything else is converted first.');
  }
  const path = resolve(root, target);
  if (!(await exists(path))) throw new Error(`No such file: ${path}`);

  const converted = convertSource(path);
  if (!converted.ok) throw new Error(converted.reason);
  const text = converted.native ? await readText(path) : converted.text;
  if (!String(text ?? '').trim()) throw new Error(`${target} is empty once converted, so there is nothing to cite.`);

  const entries = await readIndex(root, folder);
  const kind = /^desc/i.test(basename(path)) ? 'DESC' : 'BRS';
  const id = wanted ?? nextSourceId(entries, kind);
  const title = givenTitle ?? basename(path, extname(path)).replace(/[-_]+/g, ' ').trim();

  const found = detect(text);
  // §52 — everything an agent reads that a human did not write for it is data, not instructions.
  // A brief that says "ignore previous instructions" is shown to the analyst as exactly that.
  const { instructionShaped } = await import('../folder/checks.js');
  const shaped = instructionShaped(text);
  if (json) {
    return void console.log(JSON.stringify({ id, title, found, converted: !converted.native, by: converted.by ?? null }, null, 2));
  }

  console.log(`${id} · ${title}${converted.native ? '' : ` · converted with ${converted.by}`}`);
  console.log('');
  if (shaped.length) {
    console.log(`! ${shaped.length} line(s) read like instructions to an agent, not requirements:`);
    for (const hit of shaped.slice(0, 5)) console.log(`    line ${hit.line}: ${hit.text}`);
    console.log('  A source is data. Whatever these lines say, no agent will act on them — but a human should read them.');
    console.log('');
  }

  // §31 — shown before anything is written, because this is the step that cannot be undone by
  // editing a file later: the unredacted text would already be in the history.
  if (found.length) {
    console.log(`${found.length} thing(s) in this document should not be in git forever:`);
    for (const hit of found) console.log(`  ${hit.placeholder.padEnd(12)} ${hit.value}`);
    console.log('');
    if (!yes && !noRedact) {
      console.log('Nothing has been written. Choose one:');
      console.log(`  vibekit ingest ${target} --yes          replace each with its placeholder`);
      console.log(`  vibekit ingest ${target} --no-redact    write it as it is, and record that`);
      console.log('');
      console.log(`  The mapping is kept at ${mappingPath(id)} — outside the repository, always.`);
      return;
    }
  } else if (!yes && !noRedact) {
    console.log('No names, emails, phone numbers or amounts were found.');
    console.log(`  vibekit ingest ${target} --yes    to write it`);
    console.log('');
    console.log('  That is what the detectors look for, not a guarantee. Read it yourself too.');
    return;
  }

  const redacted = !noRedact;
  // The comparison has to happen against the sections this ingest produces, and before they are
  // written over the previous ones. Passing an empty list here meant a re-ingest could never
  // detect a change, which is the entire point of §31's "only changed sections produce asks".
  const { splitSections, redact } = await import('../sources.js');
  const { sections } = splitSections(redacted ? redact(text, found) : text);
  const change = await changedSections(root, id, sections, folder).catch(() => ({ first: true }));
  const written = await writeSource(root, { id, title, version: version ?? '1', text, found, redacted }, folder);

  console.log(`✔ ${folder}/product/sources/${id}/ · ${written.sections.length} section(s), ${written.statements.length} explicit obligation(s)`);
  console.log(`    source.md      the whole document, converted · never loaded by an agent`);
  console.log(`    .abstract      ~100 tokens, loaded when a requirement cites this source`);
  console.log(`    sections/      one file per numbered section, loaded on citation`);
  console.log(`    extract.md     what was pulled out, and the section each line came from`);

  if (redacted && found.length) {
    console.log('');
    console.log(`  Redacted. The mapping is at ${written.mapping}, outside the repository.`);
  }
  if (noRedact) {
    console.log('');
    console.log(`  ! Written unredacted, and recorded as \`redacted: no\` in the index. \`vibekit check --ci\` warns on it.`);
  }

  // §31 — a new version of the same id is a new ingest, and only the changed sections produce
  // asks. Re-asking about a section nobody touched is how an inbox stops being read.
  if (!change.first) {
    const moved = [...(change.added ?? []), ...(change.changed ?? [])];
    if (moved.length) {
      console.log('');
      console.log(`${moved.length} section(s) changed since the last ingest of ${id}: ${moved.join(', ')}`);
      for (const number of moved.slice(0, 10)) {
        const ask = await openAsk(root, {
          ask: `${id} §${number} changed in this version. Which requirements citing it need to change, and does the plan move?`,
          plain: `Section ${number} of ${title} was reworded. What does that change about what we are building?`,
          blocking: true,
        }, folder).catch(() => null);
        if (ask) console.log(`  ${ask.id}  §${number}`);
      }
    }
    for (const name of change.removed ?? []) console.log(`  ! ${name} is no longer in the document; a requirement citing it now cites nothing.`);
  }

  console.log('');
  console.log(`  Next: read ${folder}/product/sources/${id}/extract.md, then \`vibekit sprint run\` for stage 1.`);
}
