const TIMEOUT_MS = 2000;
const SNIPPET_LENGTH = 400;
const TEXT_FIELDS = ['content', 'narrative', 'summary', 'title', 'text'];

export const isMemoryEnabled = (project) => project.memory.provider === 'agentmemory';

function connection(project) {
  const url = (process.env.AGENTMEMORY_URL || project.memory.url).replace(/\/$/, '');
  const secret = process.env.AGENTMEMORY_SECRET;
  return { url, headers: { 'Content-Type': 'application/json', ...(secret && { Authorization: `Bearer ${secret}` }) } };
}

async function request(project, path, body) {
  const { url, headers } = connection(project);
  const response = await fetch(`${url}/agentmemory/${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

export async function remember(project, content, concepts = []) {
  if (!isMemoryEnabled(project)) return false;
  try {
    await request(project, 'remember', { content, concepts: projectConcepts(project, ...concepts) });
    return true;
  } catch {
    return false;
  }
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
