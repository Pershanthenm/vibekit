import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, writeText } from '../fsutil.js';
import { INDEX_FILE, STANDARDS_DIR, parseIndex, renderIndex, scanStandards, selectStandards } from '../standards.js';

const USAGE = `vibecheck standards <command>

  list                     Every standard in the index, by domain
  index                    Rebuild ${INDEX_FILE} from the files in ${STANDARDS_DIR}/
  inject "<task>" [--paths a,b]
                           The standards relevant to that task, and nothing else

Standards are Markdown files under ${STANDARDS_DIR}/, one per topic, grouped into domain
folders (api/, database/, …). Each declares a description in its front matter; files in the
root of ${STANDARDS_DIR}/ are indexed under "root".`;

async function readIndex(root) {
  const text = await readFile(join(root, INDEX_FILE), 'utf8').catch(() => null);
  if (text === null) throw new Error(`No ${INDEX_FILE}. Add standards under ${STANDARDS_DIR}/ and run "vibecheck standards index".`);
  return parseIndex(text);
}

async function runIndex(root, json) {
  const entries = await scanStandards(root);
  if (!entries.length) {
    if (json) return console.log(JSON.stringify({ written: null, standards: [] }, null, 2));
    console.log(`No standards found under ${STANDARDS_DIR}/.`);
    console.log('Add Markdown files there (one topic each, with a description in front matter), then run this again.');
    return;
  }
  await writeText(join(root, INDEX_FILE), renderIndex(entries));
  if (json) return console.log(JSON.stringify({ written: INDEX_FILE, standards: entries.map(({ body, ...rest }) => rest) }, null, 2));

  console.log(`✔ Indexed ${entries.length} standard${entries.length === 1 ? '' : 's'} into ${INDEX_FILE}`);
  for (const entry of entries) console.log(`  ${entry.domain}/${entry.name}`);
  const missing = entries.filter((entry) => !entry.description);
  if (missing.length) {
    console.log(`\n! No description in front matter: ${missing.map((entry) => entry.path).join(', ')}`);
    console.log('  Injection matches on the description, so these will rarely be selected.');
  }
}

async function runList(root, json) {
  const entries = await readIndex(root);
  if (json) return console.log(JSON.stringify(entries, null, 2));
  let domain = null;
  for (const entry of entries) {
    if (entry.domain !== domain) {
      domain = entry.domain;
      console.log(`\n${domain}`);
    }
    console.log(`  ${entry.name.padEnd(24)} ${entry.description || '(no description)'}`);
  }
  console.log(`\n${entries.length} standard(s). Relevant ones only: vibecheck standards inject "<task>"`);
}

async function runInject(root, query, paths, json) {
  if (!query && !paths.length) throw new Error('standards inject: say what you are working on, e.g. vibecheck standards inject "add an error response to the orders API"');
  const hits = selectStandards(await readIndex(root), { query, paths });
  if (json) return console.log(JSON.stringify({ query, paths, standards: hits }, null, 2));

  if (!hits.length) {
    console.log(`No standard matches "${query}".`);
    console.log('That is an answer, not a failure: nothing recorded covers this yet. See everything with "vibecheck standards list".');
    return;
  }
  console.log(`${hits.length} relevant standard${hits.length === 1 ? '' : 's'} — read these, not the whole library:\n`);
  for (const hit of hits) {
    console.log(`  ${hit.path}${hit.matchedBy === 'globs' ? '  (matches the files you named)' : ''}`);
    if (hit.description) console.log(`      ${hit.description}`);
  }
}

export async function standards({ root, args, json, paths: pathList }) {
  const [action = 'list', ...rest] = args;
  if (!(await exists(join(root, STANDARDS_DIR))) && action !== 'index') {
    console.log(`No ${STANDARDS_DIR}/ folder yet.\n`);
    console.log(USAGE);
    return;
  }
  const paths = (pathList ?? '').split(',').map((path) => path.trim()).filter(Boolean);

  if (action === 'index') return runIndex(root, json);
  if (action === 'list') return runList(root, json);
  if (action === 'inject') return runInject(root, rest.join(' '), paths, json);
  console.log(USAGE);
}
