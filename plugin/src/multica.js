import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isInstalled } from './git.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30000;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]*-\d+\b/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;

export const multicaInstalled = () => isInstalled('multica');

export async function mc(args) {
  const { stdout } = await execFileAsync('multica', args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const itemsOf = (payload) => (Array.isArray(payload) ? payload : payload?.issues ?? payload?.projects ?? payload?.items ?? payload?.data ?? []);
export const refOf = (item) => item?.key ?? item?.identifier ?? item?.id;
const flag = (name, value) => (value ? [name, value] : []);

function referenceFrom(stdout, command) {
  const ref = refOf(parseJson(stdout)) ?? stdout.match(ISSUE_KEY)?.[0] ?? stdout.match(UUID)?.[0];
  if (!ref) throw new Error(`Could not read the id returned by "multica ${command}": ${stdout.trim().slice(0, 200)}`);
  return ref;
}

export async function createIssue({ title, description, assignee, project, parent, status }) {
  const args = ['issue', 'create', '--title', title, '--description', description, ...flag('--assignee', assignee), ...flag('--project', project), ...flag('--parent', parent), ...flag('--status', status), '--output', 'json'];
  return referenceFrom(await mc(args), 'issue create');
}

export async function setMetadata(ref, entries) {
  for (const [key, value] of Object.entries(entries)) {
    await mc(['issue', 'metadata', 'set', ref, '--key', key, '--value', String(value), '--type', 'string']);
  }
}

export async function findIssues(metadata, project) {
  const filters = Object.entries(metadata).flatMap(([key, value]) => ['--metadata', `${key}=${JSON.stringify(String(value))}`]);
  return itemsOf(parseJson(await mc(['issue', 'list', ...filters, ...flag('--project', project), '--output', 'json'])));
}

export async function issueStatus(ref) {
  const payload = parseJson(await mc(['issue', 'get', ref, '--output', 'json']));
  return payload?.status ?? payload?.issue?.status ?? 'unknown';
}

export const setIssueStatus = (ref, status) => mc(['issue', 'status', ref, status]);
export const commentOn = (ref, content) => mc(['issue', 'comment', 'add', ref, '--content', content]);

export async function daemonRunning() {
  try {
    const output = await mc(['daemon', 'status', '--output', 'json']);
    const status = parseJson(output)?.status ?? output;
    return !/not running|stopped|dead|inactive/i.test(String(status));
  } catch {
    return false;
  }
}

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i;

export async function serverInfo() {
  try {
    const output = await mc(['config', 'show']);
    const url = output.match(/https?:\/\/[^\s"',]+/)?.[0]?.replace(/\/$/, '') ?? '';
    return { url, local: LOCAL_HOST.test(url) };
  } catch {
    return { url: '', local: false };
  }
}

export async function ensureProject(project) {
  if (project.multica.project) return project.multica.project;
  const title = project.project.name;
  const existing = itemsOf(parseJson(await mc(['project', 'list', '--output', 'json']))).find((item) => (item.title ?? item.name) === title);
  if (existing) return refOf(existing);
  return referenceFrom(await mc(['project', 'create', '--title', title, '--description', `vibecheck: ${project.project.description || title}`, '--output', 'json']), 'project create');
}

export async function multicaHealth(project) {
  if (!multicaInstalled()) return [{ ok: false, detail: 'multica CLI not found. Install: brew install multica-ai/tap/multica (or the install script), then multica setup' }];
  const check = async (label, args, test) => {
    try {
      const output = await mc(args);
      return { ok: test(output), detail: `${label}: ${output.trim().split('\n')[0].slice(0, 120)}` };
    } catch (error) {
      return { ok: false, detail: `${label}: ${error.message.split('\n')[0]}` };
    }
  };
  const server = await serverInfo();
  const reachable = server.url ? await fetch(`${server.url}/health`, { signal: AbortSignal.timeout(3000) }).then((response) => response.ok, () => false) : false;
  return [
    { ok: reachable, warn: reachable && !server.local, detail: !server.url ? 'server: not configured — run multica setup self-host' : `server: ${server.local ? 'self-hosted on this machine' : 'remote'} at ${server.url}${reachable ? '' : ' (not reachable — is Docker running? try: multica setup self-host)'}${reachable && !server.local ? ' — for a fully local setup run multica setup self-host' : ''}` },
    await check('auth', ['auth', 'status'], () => true),
    await check('daemon', ['daemon', 'status', '--output', 'json'], (output) => !/not running|stopped/i.test(output)),
    project.multica.agent
      ? await check(`agent "${project.multica.agent}"`, ['agent', 'list', '--output', 'json'], (output) => output.includes(project.multica.agent))
      : { ok: false, detail: 'multica.agent is not set in specs/project.json (the Multica agent that works on lanes)' },
  ];
}
