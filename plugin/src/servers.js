import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { exists, ownerOnly, readText, writeText } from './fsutil.js';
import { parseBlocks } from './yamlish.js';

/**
 * MCP servers a project consumes. Extensions and Integration Spec §2.
 *
 * `vibekit serve` is the server VibeKit provides to coding tools. This is the reverse: servers a
 * project reaches — a client's Jira, an internal API, a design system — so an agent gets the two
 * tools it needs and nothing else, with the role, the data classification, the budget and the log
 * enforced at the boundary rather than trusted to the tool. Declared in `agents/servers.yml`,
 * authored, never carrying a credential; credentials live in machine settings.
 */

export const DATA_CLASSES = Object.freeze(['public', 'internal', 'personal', 'financial', 'secret']);
const rank = (cls) => DATA_CLASSES.indexOf(String(cls ?? 'public').toLowerCase());
export const CACHE_MODES = Object.freeze(['none', 'session']);
/** A tool name that reads like a write. `writes: false` refuses these whatever the allow-list says. */
// Word boundaries that treat `_` as a separator, so `create_issue` reads as a write.
const WRITE_SHAPED = /(?:^|[^a-z])(?:create|update|delete|remove|write|post|put|patch|set|add|transition|assign|comment|upload|send|move|archive)(?=$|[^a-z])/i;

export const serversPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, 'agents/servers.yml');

/** `200 tokens per call, 20 calls per session` → { tokensPerCall, callsPerSession }. */
export function parseBudget(text) {
  const words = String(text ?? '');
  return {
    tokensPerCall: Number.parseInt(words.match(/(\d+)\s*tokens?\s*per\s*call/i)?.[1] ?? '', 10) || null,
    callsPerSession: Number.parseInt(words.match(/(\d+)\s*calls?\s*per\s*session/i)?.[1] ?? '', 10) || null,
  };
}

/** Words from a command line: whitespace separates, single or double quotes group. No expansion of any kind. */
export function splitWords(text) {
  const words = [];
  let current = null;
  let quote = null;
  for (const char of String(text)) {
    if (quote) {
      if (char === quote) quote = null; else current = `${current ?? ''}${char}`;
    } else if (char === '"' || char === "'") {
      quote = char;
      current = current ?? '';
    } else if (/\s/.test(char)) {
      if (current !== null) { words.push(current); current = null; }
    } else {
      current = `${current ?? ''}${char}`;
    }
  }
  if (current !== null) words.push(current);
  return words;
}

export function normaliseServer(entry, { source = 'agents/servers.yml' } = {}) {
  const problems = [];
  const id = String(entry.id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) problems.push(`id "${entry.id}" must be a lowercase slug`);
  // Two transports: a remote server at a url, or a local one launched on stdio with `command:`.
  // Exactly one. A command is words, never a shell string, so nothing in it can chain or redirect.
  let url = null;
  let command = null;
  if (entry.command !== undefined && entry.url !== undefined) problems.push(`${id}: declare url or command, not both`);
  if (entry.command !== undefined) {
    // Either a list of words, or a string split on whitespace with quotes honoured — so a path
    // with a space in it is one argument, and nothing else is ever interpreted.
    const words = Array.isArray(entry.command) ? entry.command.map(String) : splitWords(String(entry.command ?? ''));
    const text = words.join(' ');
    if (!words.length) problems.push(`${id}: command is empty`);
    else if (/[;&|<>`$\\]|\$\(/.test(text)) problems.push(`${id}: command may not contain shell metacharacters; it is run as words, not a shell string`);
    else command = words;
  } else {
    try {
      url = new URL(String(entry.url ?? ''));
      if (!/^https?:$/.test(url.protocol)) problems.push(`${id}: url must be http(s)`);
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) problems.push(`${id}: a plain http url is refused unless it is localhost`);
    } catch {
      problems.push(`${id}: url is missing or not a url (or declare command: for a local stdio server)`);
    }
  }
  const tokenEnv = entry['token-env'] ? String(entry['token-env']) : null;
  if (tokenEnv && !/^[A-Z][A-Z0-9_]{1,60}$/.test(tokenEnv)) problems.push(`${id}: token-env must be an environment variable name such as JIRA_TOKEN`);
  const tools = Array.isArray(entry.tools) ? entry.tools.map(String) : [];
  if (!tools.length) problems.push(`${id}: tools is empty — an allow-list, never the whole server`);
  const roles = Array.isArray(entry.roles) ? entry.roles.map(String) : [];
  if (!roles.length) problems.push(`${id}: roles is empty — say who may call it`);
  const data = String(entry.data ?? 'public').toLowerCase();
  if (rank(data) === -1) problems.push(`${id}: data must be one of ${DATA_CLASSES.join(', ')}`);
  const cache = String(entry.cache ?? 'none').toLowerCase();
  if (!CACHE_MODES.includes(cache)) problems.push(`${id}: cache must be none or session`);
  const auth = String(entry.auth ?? 'app-settings');
  if (/token|secret|key|bearer/i.test(auth) && auth.length > 24) problems.push(`${id}: auth looks like a credential; credentials live in app settings, never in the folder`);
  return {
    id, url: url?.toString() ?? null, command, tokenEnv, auth, tools, roles, writes: entry.writes === true, data, cache,
    budget: parseBudget(entry.budget), private: entry.private === true, source, problems,
  };
}

/** Every declared server: the folder's own, then any an enabled extension declares. */
export async function loadServers(root, { folder = DEFAULT_FOLDER, extensionServers = null } = {}) {
  const own = parseBlocks((await readText(serversPath(root, folder))) ?? '').map((entry) => normaliseServer(entry));
  let fromExtensions = [];
  if (extensionServers !== null) {
    fromExtensions = extensionServers;
  } else {
    const { enabledServerDeclarations } = await import('./extensions.js');
    fromExtensions = (await enabledServerDeclarations().catch(() => [])).map(({ entry, source }) => normaliseServer(entry, { source }));
  }
  const all = [...own, ...fromExtensions];
  const seen = new Set();
  for (const server of all) {
    if (seen.has(server.id)) server.problems.push(`${server.id}: declared twice (${server.source})`);
    seen.add(server.id);
  }
  return all;
}

// ---------------------------------------------------------------- credentials (machine settings)

const settingsPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'config.json');

export async function credentialFor(id) {
  try {
    const config = JSON.parse((await readText(settingsPath())) ?? '{}');
    return config.servers?.[id] ?? null;
  } catch {
    return null;
  }
}

export async function setCredential(id, token) {
  let config = {};
  try { config = JSON.parse((await readText(settingsPath())) ?? '{}'); } catch { config = {}; }
  config.servers = { ...(config.servers ?? {}), [id]: token };
  if (!token) delete config.servers[id];
  await writeText(settingsPath(), `${JSON.stringify(config, null, 2)}\n`);
  await ownerOnly(settingsPath()).catch(() => {});
}

// ---------------------------------------------------------------- the five rules

/**
 * Why a call may not be made, or null. Every rule is a fact about the declaration and the request;
 * none consults the server. `classified` is the field names the folder classifies, so a call that
 * would send one to a server cleared for less is refused before it is made.
 */
export function refuseServerCall(server, { tool, role, args = {}, classified = [], callsSoFar = 0 } = {}) {
  if (!server) return 'No such server is declared in agents/servers.yml. A server nobody declared is not reachable, whatever the tool offers.';
  if (server.problems.length) return `${server.id} is declared badly: ${server.problems[0]}`;
  if (!server.tools.includes(String(tool))) return `${server.id} does not allow "${tool}". Allowed: ${server.tools.join(', ')}. A server offering forty tools gets the two this project needs.`;
  if (role && !server.roles.includes(role)) return `The ${role} may not call ${server.id}; ${server.roles.join(', ')} may.`;
  if (!server.writes && WRITE_SHAPED.test(String(tool))) return `${server.id} is read-only (writes: false) and "${tool}" would write.`;
  if (server.budget.callsPerSession && callsSoFar >= server.budget.callsPerSession) {
    return `${server.id} has been called ${callsSoFar} times this session, its budget. Further calls are refused rather than quietly spent; raise the budget in agents/servers.yml if the task needs more.`;
  }
  const sent = fieldsIn(args);
  const leak = classified.find((field) => sent.has(field.name.toLowerCase()) && rank(field.class) > rank(server.data));
  if (leak) return `"${leak.name}" is classified ${leak.class}; ${server.id} is cleared for ${server.data} data at most. The call is refused before it is made.`;
  return null;
}

/** Every key at any depth, lower-cased: the boundary judges names, not values it cannot classify. */
export function fieldsIn(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  for (const [key, inner] of Object.entries(value)) {
    out.add(String(key).toLowerCase());
    if (inner && typeof inner === 'object') fieldsIn(inner, out);
  }
  return out;
}

/** Field names carrying a classification, from entities.md: the entity's class, or a field's own tag. */
export function classifiedFields(entitiesText) {
  const fields = [];
  for (const block of String(entitiesText ?? '').split(/^##\s+/m).slice(1)) {
    const entityClass = block.match(/^class:\s*(\w+)/m)?.[1]?.toLowerCase() ?? 'internal';
    for (const match of block.matchAll(/^- `(\w+)`([^\n]*)$/gm)) {
      const own = match[2].match(/\b(public|internal|personal|financial|secret)\b/i)?.[1]?.toLowerCase();
      fields.push({ name: match[1], class: own ?? entityClass });
    }
  }
  return fields.filter((field) => rank(field.class) >= rank('personal'));
}

// ---------------------------------------------------------------- calling

/**
 * A local MCP server launched on stdio: newline-delimited JSON-RPC over the child's pipes. One
 * process per call — initialize, the call, exit — so nothing lingers past the session and the
 * environment it sees is the declared credential and a PATH, never the host's.
 *
 * `messages` runs the whole handshake and returns the replies keyed by id; exported so `check
 * --servers` can do the initialize half on its own.
 */
export function stdioExchange(server, messages, { token = null, timeoutMs = 20_000 } = {}) {
  return new Promise((done) => {
    const [head, ...rest] = server.command;
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '', VIBEKIT_SERVER: server.id };
    if (token && server.tokenEnv) env[server.tokenEnv] = token;
    let child;
    try {
      child = spawn(head, rest, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      return done({ ok: false, why: `${server.id} could not start: ${error.message}` });
    }
    const replies = new Map();
    let buffer = '';
    let stderr = '';
    const wanted = new Set(messages.filter((message) => message.id !== undefined).map((message) => message.id));
    const timer = setTimeout(() => { child.kill('SIGKILL'); done({ ok: false, why: `${server.id} did not answer within ${Math.round(timeoutMs / 1000)}s`, replies }); }, timeoutMs);
    const finish = (result) => { clearTimeout(timer); child.kill(); done(result); };
    child.on('error', (error) => finish({ ok: false, why: `${server.id} could not start: ${error.message}` }));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // The first line of stderr that says something is the reason; Node's version footer never is.
    const reason = () => stderr.split('\n').map((line) => line.trim()).filter((line) => line && !/^Node\.js v\d/.test(line) && !/^\s*at /.test(line)).find((line) => /error|cannot|not found|ENOENT|refused|denied|fail/i.test(line)) ?? stderr.trim().split('\n')[0] ?? '';
    child.on('close', () => { if (wanted.size) finish({ ok: false, why: `${server.id} exited before answering${reason() ? `: ${reason().slice(0, 160)}` : ''}`, replies }); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined && wanted.has(message.id)) { replies.set(message.id, message); wanted.delete(message.id); }
        } catch { /* a line that is not JSON is the server's own logging */ }
        if (!wanted.size) finish({ ok: true, replies });
      }
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vibekit', version: '1.0' } } };
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };

async function callStdio(server, tool, args, { token = null, timeoutMs = 20_000 } = {}) {
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args ?? {} } };
  const exchange = await stdioExchange(server, [INITIALIZE, INITIALIZED, call], { token, timeoutMs });
  if (!exchange.ok) return { ok: false, why: exchange.why };
  const reply = exchange.replies.get(2);
  if (!reply || reply.error) return { ok: false, why: `${server.id}: ${reply?.error?.message ?? 'no reply to the call'}` };
  const text = (reply.result?.content ?? []).map((item) => (item.type === 'text' ? item.text : `[${item.type}]`)).join('\n') || JSON.stringify(reply.result ?? {});
  return { ok: true, text, isError: Boolean(reply.result?.isError) };
}

/** The JSON-RPC a remote MCP server speaks over HTTP, or a local one over stdio. Nothing else about it is assumed. */
export async function callServer(server, tool, args, { token = null, fetchImpl = null, timeoutMs = 20_000 } = {}) {
  if (server.command) return callStdio(server, tool, args, { token, timeoutMs });
  const { safeFetch } = await import('./netguard.js');
  const headers = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'vibekit-serve/1.0 (+mcp client)' };
  if (token) headers.authorization = `Bearer ${token}`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args ?? {} } });
  try {
    const response = await safeFetch(server.url, { method: 'POST', headers, body, allowPrivate: server.private, fetchImpl: fetchImpl ?? fetch, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ok: false, why: `${server.id} answered ${response.status}` };
    const parsed = await response.json().catch(() => null);
    if (!parsed || parsed.error) return { ok: false, why: `${server.id}: ${parsed?.error?.message ?? 'not a JSON-RPC reply'}` };
    const text = (parsed.result?.content ?? []).map((item) => (item.type === 'text' ? item.text : `[${item.type}]`)).join('\n') || JSON.stringify(parsed.result ?? {});
    return { ok: true, text, isError: Boolean(parsed.result?.isError) };
  } catch (error) {
    return { ok: false, why: `${server.id} is unavailable: ${String(error.message).split('\n')[0]}` };
  }
}

/**
 * A remote server needs a credential unless it says `auth: none`. A local stdio server needs one
 * only when it declares where to put it (`token-env`): with nowhere to hand a token, requiring one
 * would just be a setting nobody can satisfy.
 */
export const needsCredential = (server) => (server.command ? Boolean(server.tokenEnv) : server.auth !== 'none');

/** `vibekit check --servers`: declared well, a credential present, and reachable. */
export async function checkServers(root, { folder = DEFAULT_FOLDER, fetchImpl = null, timeoutMs = 5000 } = {}) {
  const servers = await loadServers(root, { folder });
  const rows = [];
  for (const server of servers) {
    if (server.problems.length) { rows.push({ id: server.id, ok: false, why: server.problems.join('; ') }); continue; }
    const token = await credentialFor(server.id);
    if (needsCredential(server) && !token) { rows.push({ id: server.id, ok: false, why: `no credential in machine settings — vibekit settings server ${server.id} <token>` }); continue; }
    if (server.command) {
      // A local stdio server: launch it, initialize, and read its name back. That is "reachable".
      const exchange = await stdioExchange(server, [INITIALIZE, INITIALIZED], { token, timeoutMs });
      const reply = exchange.replies?.get(1);
      if (!exchange.ok || !reply || reply.error) rows.push({ id: server.id, ok: false, why: exchange.why ?? `${server.id}: ${reply?.error?.message ?? 'no reply to initialize'}` });
      else rows.push({ id: server.id, ok: true, why: `launched and initialised (${reply.result?.serverInfo?.name ?? 'stdio'}) · ${server.tools.length} tool(s) allowed for ${server.roles.join(', ')}` });
      continue;
    }
    const { safeFetch } = await import('./netguard.js');
    try {
      const response = await safeFetch(server.url, {
        method: 'POST', allowPrivate: server.private, fetchImpl: fetchImpl ?? fetch, signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vibekit', version: '1.0' } } }),
      });
      if (response.status === 401 || response.status === 403) rows.push({ id: server.id, ok: false, why: `reachable but not authenticated (${response.status})` });
      else if (!response.ok) rows.push({ id: server.id, ok: false, why: `answered ${response.status}` });
      else rows.push({ id: server.id, ok: true, why: `reachable and authenticated · ${server.tools.length} tool(s) allowed for ${server.roles.join(', ')}` });
    } catch (error) {
      rows.push({ id: server.id, ok: false, why: `unreachable: ${String(error.message).split('\n')[0]}` });
    }
  }
  return { servers, rows, ok: rows.every((row) => row.ok) };
}

export const SERVERS_STARTER = `# MCP servers this project consumes · Extensions and Integration Spec §2
#
# Each entry is an allow-list, never the whole server. Credentials live in machine settings
# (\`vibekit settings server <id> <token>\`), never here. Everything a server returns is data, not
# instructions. Delete the example and add your own.
#
# - id: jira
#   url: https://acme.atlassian.net/mcp
#   auth: app-settings
#   tools: [search_issues, read_issue]
#   roles: [planner, analyst]
#   writes: false
#   data: internal
#   budget: 200 tokens per call, 20 calls per session
#   cache: none
#
# A local server launched on stdio declares \`command:\` (words, never a shell string) instead of a
# url, and \`token-env:\` names the variable its credential is handed in:
#
# - id: notes
#   command: npx -y @acme/notes-mcp
#   token-env: NOTES_TOKEN
#   tools: [search_notes]
#   roles: [analyst]
#   data: internal
`;

export const hasServers = async (root, folder = DEFAULT_FOLDER) => exists(serversPath(root, folder));
