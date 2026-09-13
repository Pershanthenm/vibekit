const TIMEOUT_MS = 2000;
const SNIPPET_LENGTH = 400;
const TEXT_FIELDS = ['content', 'narrative', 'summary', 'title', 'text'];

export const isMemoryEnabled = (project) => project.memory.provider === 'agentmemory';

function connection(project) {
  const url = (process.env.AGENTMEMORY_URL || project.memory.url).replace(/\/$/, '');
  const secret = process.env.AGENTMEMORY_SECRET;
  return { url, headers: { 'Content-Type': 'application/json', ...(secret && { Authorization: `Bearer ${secret}` }) } };
}

// Listing and deleting walk the whole store rather than answering from an index, so they are
// given longer than a recall on the critical path of a build is allowed to take.
const MANAGE_TIMEOUT_MS = 15000;

async function request(project, path, body, { method, timeoutMs = TIMEOUT_MS } = {}) {
  const { url, headers } = connection(project);
  const response = await fetch(`${url}/agentmemory/${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`agentmemory /${path} returned HTTP ${response.status}`);
  return response.json().catch(() => null);
}

function textOf(item) {
  if (typeof item === 'string') return item;
  const sources = [item, item?.memory, item?.observation];
  return sources.flatMap((source) => TEXT_FIELDS.map((field) => source?.[field])).find((value) => typeof value === 'string');
}

export function toSnippets(payload) {
  const items = Array.isArray(payload) ? payload : payload?.results ?? payload?.memories ?? payload?.items ?? [];
  return items.map(textOf).filter(Boolean).map((text) => text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH));
}

export const projectConcepts = (project, ...extra) => ['vibecheck', `project:${project.project.name}`, ...extra];

/**
 * The kinds of thing vibecheck writes to memory of its own accord, and therefore the whole list
 * of what `memory.capture` can switch off. Each is already the concept the writing code tags with,
 * so this is a list of what happens rather than a second vocabulary that has to be kept in step.
 */
export const CAPTURE_KINDS = ['spec', 'done', 'lanes', 'health', 'security'];

/**
 * Whether a write of this kind is wanted. An unrecognised write — a fact you asked to be
 * remembered yourself — is always kept: `capture` governs what the tool records without being
 * asked, not what you tell it.
 */
export function isCaptured(project, concepts = []) {
  const kind = concepts.find((concept) => CAPTURE_KINDS.includes(concept));
  if (!kind) return true;
  const wanted = project.memory.capture;
  return Array.isArray(wanted) ? wanted.includes(kind) : true;
}

export async function remember(project, content, concepts = []) {
  if (!isMemoryEnabled(project) || !isCaptured(project, concepts)) return false;
  try {
    await request(project, 'remember', { content, concepts: projectConcepts(project, ...concepts) });
    return true;
  } catch {
    return false;
  }
}

// --- Seeing, and taking back ------------------------------------------------------------------
//
// Recall answers a question; these answer "what does it know about me". They keep the id on every
// row, because an id is what turns "that one is wrong" into something you can act on — the text
// alone is only a complaint.

const MEMORY_FIELDS = ['id', 'title', 'content', 'type', 'createdAt', 'updatedAt', 'version', 'concepts', 'project'];

const toRow = (memory) => Object.fromEntries(MEMORY_FIELDS
  .map((field) => [field, memory?.[field]])
  .filter(([, value]) => value !== undefined));

/** Whether a stored memory was written about this project, by concept or by its project field. */
const forProject = (memory, project) => memory?.project === project.project.name
  || (memory?.concepts ?? []).includes(`project:${project.project.name}`);

/**
 * Everything currently held for this project, newest first.
 *
 * `latest=true` asks agentmemory for current versions only: saving a correction supersedes what it
 * replaced rather than deleting it, and showing both would present a fact and its own retraction
 * as two separate things it believes.
 */
export async function listMemories(project, { limit = 50, all = false } = {}) {
  if (!isMemoryEnabled(project)) return [];
  const payload = await request(project, `memories?latest=true&limit=${Number(limit) || 50}`, null, { timeoutMs: MANAGE_TIMEOUT_MS });
  const memories = Array.isArray(payload?.memories) ? payload.memories : [];
  return memories
    .filter((memory) => all || forProject(memory, project))
    .sort((first, second) => String(second.createdAt ?? '').localeCompare(String(first.createdAt ?? '')))
    .map(toRow);
}

/**
 * Find stored memories, keeping the id on every row.
 *
 * This asks `search` and not `smart-search`, which is not a detail. Checked against a running
 * agentmemory: `smart-search` searches *session observations* — what happened in past sessions,
 * each carrying an `obsId` — while `search` searches the memories themselves and returns each one
 * under `observation`, with its `mem_…` id. Only the second kind can be corrected or deleted,
 * which is the entire reason for asking.
 */
export async function searchMemories(project, query, limit = project.memory.recallLimit) {
  if (!isMemoryEnabled(project) || !query.trim()) return [];
  const payload = await request(project, 'search', { query, limit }, { timeoutMs: MANAGE_TIMEOUT_MS });
  const items = Array.isArray(payload) ? payload : payload?.results ?? payload?.memories ?? payload?.items ?? [];
  return items
    .map((item) => {
      const memory = item?.observation ?? item;
      return { ...toRow(memory), content: textOf(memory) ?? memory?.content };
    })
    .filter((row) => typeof row.id === 'string' && row.id.startsWith('mem_'));
}

/**
 * Delete memories outright, and say how many actually went.
 *
 * agentmemory answers with the number it found and removed, which is not always the number asked
 * for — an id that was already gone is not an error and must not be reported as a deletion.
 */
export async function forgetMemories(project, ids, reason = 'vibecheck memory forget') {
  if (!isMemoryEnabled(project)) throw new Error('Memory is off, so there is nothing to forget.');
  if (!ids.length) throw new Error('Which memories? Pass the ids that "vibecheck memory list" printed.');
  const payload = await request(project, 'governance/memories', { memoryIds: ids, reason }, { method: 'DELETE', timeoutMs: MANAGE_TIMEOUT_MS });
  return { deleted: Number(payload?.deleted ?? 0), asked: ids.length };
}

export async function recall(project, query, limit = project.memory.recallLimit) {
  if (!isMemoryEnabled(project) || !query.trim()) return [];
  try {
    return toSnippets(await request(project, 'smart-search', { query: `${project.project.name} ${query}`, limit }));
  } catch {
    return [];
  }
}

export async function memoryHealth(project) {
  const { url } = connection(project);
  if (!isMemoryEnabled(project)) return { ok: false, detail: 'memory.provider is "none"' };
  try {
    await request(project, 'livez');
    return { ok: true, detail: `agentmemory reachable at ${url}` };
  } catch (error) {
    return { ok: false, detail: `agentmemory not reachable at ${url} (${error.message}). Start it with: npx -y @agentmemory/agentmemory@latest` };
  }
}
