import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { projectDocs } from '../docs/catalog.js';
import { listFeatures } from '../features.js';
import { exists, readText } from '../fsutil.js';
import { recordStatusChange } from '../journal.js';
import { isKnowledgeEnabled, knowledgeFolder, knowledgeHealth, knowledgeManifest, publishKnowledge, searchKnowledge } from '../knowledge.js';
import { loadProject } from '../project.js';

const USAGE = 'Usage: vibecheck knowledge <status | search "<query>" | manifest [folder] | publish>';
const PROJECT_DOCS = [
  { file: 'specs/00-product.md', name: 'product', description: 'Product vision, users and scope' },
  { file: 'specs/01-architecture.md', name: 'architecture', description: 'System architecture' },
  { file: 'specs/03-standards.md', name: 'standards', description: 'Coding standards and review checklist' },
  { file: 'specs/security.md', name: 'security-baseline', description: 'Security baseline and controls' },
];

function status(project) {
  const { ok, detail } = knowledgeHealth(project);
  console.log(`${ok ? '✔' : '✖'} ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function search(project, query) {
  const results = await searchKnowledge(project, query);
  if (!results.length) return console.log('No matching documents (see "vibecheck knowledge status").');
  results.forEach(({ title, snippet, path }) => console.log(`- ${title}${snippet ? ` — ${snippet}` : ''}${path ? `\n  ${path}` : ''}`));
}

async function manifest(project, folder) {
  const target = folder || project.knowledge.playbook;
  const output = await knowledgeManifest(project, target);
  console.log(output || `Nothing in "${target}" yet. Create it with /opencontext-create or: oc folder create ${target} -d "My defaults"`);
}

async function adrDocs(root) {
  const dir = join(root, 'specs/decisions');
  if (!(await exists(dir))) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md'));
  return files.map((file) => ({ file: `specs/decisions/${file}`, name: `adr-${file.replace(/\.md$/, '')}`, description: `Decision record ${file}` }));
}

async function publish(project, _query, root) {
  const livingDocs = project.docs.enabled ? projectDocs(project).map((doc) => ({ file: doc.path, name: `doc-${doc.kind}`, description: `${doc.title} (living doc)` })) : [];
  const docs = [...PROJECT_DOCS, ...livingDocs, ...(await adrDocs(root))];
  let published = 0;
  for (const doc of docs) {
    const content = await readText(join(root, doc.file));
    if (content && (await publishKnowledge(project, { ...doc, content }))) published += 1;
  }
  const doneFeatures = (await listFeatures(root)).filter((feature) => feature.status === 'done');
  for (const feature of doneFeatures) if ((await recordStatusChange(project, feature)).knowledge) published += 1;
  console.log(published ? `✔ Published ${published} document(s) to OpenContext: ${knowledgeFolder(project)}/` : '✖ Nothing published — see "vibecheck knowledge status"');
}

const ACTIONS = { status, search, manifest, publish };

export async function knowledge({ root, args }) {
  const [action, ...words] = args;
  const text = words.join(' ').trim();
  const run = ACTIONS[action];
  if (!run || (action === 'search' && !text)) throw new Error(USAGE);
  const project = await loadProject(root);
  if (!isKnowledgeEnabled(project)) throw new Error('Knowledge is off. Set "knowledge": { "provider": "opencontext" } in specs/project.json.');
  await run(project, text, root);
}
