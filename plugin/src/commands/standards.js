import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, writeText } from '../fsutil.js';
import { INDEX_FILE, STANDARDS_DIR, parseIndex, renderIndex, scanStandards, selectStandards } from '../standards.js';
import { discoverAreas, uncovered } from '../standards-discover.js';

const USAGE = `vibekit standards <command>

  list                     Every standard in the index, by domain
  index                    Rebuild ${INDEX_FILE} from the files in ${STANDARDS_DIR}/
  inject "<task>" [--paths a,b]
                           The standards relevant to that task, and nothing else
  discover                 Which parts of this codebase have no standard written about them

Standards are Markdown files under ${STANDARDS_DIR}/, one per topic, grouped into domain
folders (api/, database/, …). Each declares a description in its front matter; files in the
root of ${STANDARDS_DIR}/ are indexed under "root".`;

async function readIndex(root) {
  const text = await readFile(join(root, INDEX_FILE), 'utf8').catch(() => null);
  if (text === null) throw new Error(`No ${INDEX_FILE}. Add standards under ${STANDARDS_DIR}/ and run "vibekit standards index".`);
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
  console.log(`\n${entries.length} standard(s). Relevant ones only: vibekit standards inject "<task>"`);
}

async function runInject(root, query, paths, json) {
  if (!query && !paths.length) throw new Error('standards inject: say what you are working on, e.g. vibekit standards inject "add an error response to the orders API"');
  const hits = selectStandards(await readIndex(root), { query, paths });
  if (json) return console.log(JSON.stringify({ query, paths, standards: hits }, null, 2));

  if (!hits.length) {
    console.log(`No standard matches "${query}".`);
    console.log('That is an answer, not a failure: nothing recorded covers this yet. See everything with "vibekit standards list".');
    return;
  }
  console.log(`${hits.length} relevant standard${hits.length === 1 ? '' : 's'} — read these, not the whole library:\n`);
  for (const hit of hits) {
    console.log(`  ${hit.path}${hit.matchedBy === 'globs' ? '  (matches the files you named)' : ''}`);
    if (hit.description) console.log(`      ${hit.description}`);
  }
}

/**
 * Report what is here and what nothing has been written about — and stop there.
 *
 * Deliberately does not read the code and announce its conventions. Working out that a team
 * returns errors one way and names tests another is judgement; a command that guessed would
 * produce confident nonsense and put it in a file people then trust.
 */
async function runDiscover(root, json) {
  const report = await discoverAreas(root);
  if (json) return console.log(JSON.stringify(report, null, 2));

  if (!report.areas.length) {
    console.log('No source files found to look at.');
    return;
  }
  const missing = uncovered(report);
  console.log(`${report.standards.length} standard(s) written, ${report.areas.length} area(s) of code found.\n`);
  for (const entry of report.areas) {
    const mark = entry.covered.length ? '✔' : '·';
    console.log(`${mark} ${entry.area.padEnd(10)} ${String(entry.files).padStart(5)} file(s)  ${entry.covered.length ? entry.covered.join(', ') : 'nothing written about it'}`);
    if (!entry.covered.length) {
      console.log(`             ${entry.why}`);
      console.log(`             for example: ${entry.samples.join(', ')}`);
    }
  }
  console.log(missing.length
    ? '\nWhat those areas have in common is a judgement, not a pattern match, so this stops here.\nRun /vibekit:standards-discover to have an agent read them and draft standards for you to review.'
    : '\nEvery area of this codebase has a standard written about it.');
}

export async function standards({ root, args, json, paths: pathList }) {
  const [action = 'list', ...rest] = args;
  if (!(await exists(join(root, STANDARDS_DIR))) && !['index', 'discover'].includes(action)) {
    console.log(`No ${STANDARDS_DIR}/ folder yet.\n`);
    console.log(USAGE);
    return;
  }
  const paths = (pathList ?? '').split(',').map((path) => path.trim()).filter(Boolean);

  if (action === 'discover') return runDiscover(root, json);
  if (action === 'index') return runIndex(root, json);
  if (action === 'list') return runList(root, json);
  if (action === 'inject') return runInject(root, rest.join(' '), paths, json);
  console.log(USAGE);
}
