import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { slugify } from './features.js';
import { writeText } from './fsutil.js';
import { isInstalled } from './git.js';
import { runnable } from './which.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 5000;
const SNIPPET_LENGTH = 300;

export const isKnowledgeEnabled = (project) => project.knowledge.provider === 'opencontext';
export const knowledgeFolder = (project) => project.knowledge.folder || `projects/${slugify(project.project.name)}`;
const contextsRoot = () => process.env.OPENCONTEXT_CONTEXTS_ROOT || join(homedir(), '.opencontext', 'contexts');

async function oc(...args) {
  const oc = runnable('oc', args);
  const { stdout } = await execFileAsync(oc.command, oc.args, { timeout: TIMEOUT_MS, shell: oc.shell });
  return stdout;
}

const available = (project) => isKnowledgeEnabled(project) && isInstalled('oc');
const firstString = (item, fields) => fields.map((field) => item?.[field]).find((value) => typeof value === 'string');

export function toResults(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return [];
  }
  const items = Array.isArray(payload) ? payload : payload?.results ?? payload?.items ?? payload?.docs ?? [];
  return items
    .map((item) => ({
      title: firstString(item, ['title', 'name', 'rel_path', 'path']) ?? 'document',
      path: firstString(item, ['abs_path', 'path', 'rel_path', 'file']) ?? '',
      snippet: (firstString(item, ['snippet', 'content', 'description', 'text']) ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH),
    }))
    .filter((result) => result.path || result.snippet);
}

export async function searchKnowledge(project, query, limit = project.memory.recallLimit) {
  if (!query.trim() || !available(project)) return [];
  try {
    return toResults(await oc('search', query, '--mode', 'keyword', '--format', 'json')).slice(0, limit);
  } catch {
    return [];
  }
}

export async function knowledgeManifest(project, folder) {
  if (!available(project)) return '';
  try {
    return (await oc('context', 'manifest', folder, '--limit', '20')).trim();
  } catch {
    return '';
  }
}

export async function publishKnowledge(project, { name, description, content }) {
  if (!available(project)) return false;
  const folder = knowledgeFolder(project);
  try {
    await oc('folder', 'create', folder, '-d', `vibecheck project: ${project.project.name}`).catch(() => {});
    await oc('doc', 'create', folder, `${name}.md`, '-d', description).catch(() => {});
    await writeText(join(contextsRoot(), folder, `${name}.md`), content);
    return true;
  } catch {
    return false;
  }
}

export function knowledgeHealth(project) {
  if (!isKnowledgeEnabled(project)) return { ok: false, detail: 'knowledge.provider is "none"' };
  if (!isInstalled('oc')) return { ok: false, detail: 'OpenContext CLI not found. Install it with: npm install -g @aicontextlab/cli' };
  return { ok: true, detail: `OpenContext library at ${contextsRoot()} · project folder: ${knowledgeFolder(project)} · playbook: ${project.knowledge.playbook}` };
}
