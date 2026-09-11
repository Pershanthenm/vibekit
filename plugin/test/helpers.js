import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';

console.log = () => {};

export const EXAMPLE = new URL('../examples/project.example.json', import.meta.url).pathname;
export const BIN = new URL('../bin/vibecheck', import.meta.url).pathname;
export const read = (root, path) => readFile(join(root, path), 'utf8');
export const sh = (cwd, command, ...args) => execFileSync(command, args, { cwd, encoding: 'utf8' });

export async function newProject(...initArgs) {
  const root = await mkdtemp(join(tmpdir(), 'vibecheck-'));
  await run(['init', '--dir', root, ...initArgs]);
  return root;
}

export async function exitCodeOf(argv) {
  await run(argv);
  const code = process.exitCode ?? 0;
  process.exitCode = 0;
  return code;
}

export async function fillSpec(root, id, { tasks }) {
  const dir = join(root, 'specs/features', id);
  const spec = (await readFile(join(dir, 'spec.md'), 'utf8')).replace(/TODO:? ?/g, '');
  await writeFile(join(dir, 'spec.md'), spec);
  await writeFile(join(dir, 'plan.md'), '# Plan\n\nShared list API and UIs.\n');
  await writeFile(join(dir, 'tasks.md'), `# Tasks\n\n${tasks.join('\n')}\n`);
}

const execFileAsync = promisify(execFile);

export async function runHook(root, event, input, env = {}) {
  const child = execFileAsync('node', [BIN, 'hook', event], { cwd: root, env: { ...process.env, ...env } });
  child.child.stdin.end(JSON.stringify({ cwd: root, ...input }));
  try {
    const { stdout } = await child;
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

export async function startFakeAgentmemory(memories = []) {
  const saved = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.url === '/agentmemory/remember') saved.push(JSON.parse(body));
      const payload = request.url === '/agentmemory/smart-search' ? { results: [...memories, ...saved.map((item) => item.content)].map((content) => ({ content })) } : { ok: true };
      response.writeHead(request.url === '/agentmemory/remember' ? 201 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, saved, close: () => new Promise((resolveClose) => server.close(resolveClose)) };
}

export function gitInit(root) {
  sh(root, 'git', 'init', '-q', '-b', 'main');
  sh(root, 'git', 'config', 'user.email', 'test@example.com');
  sh(root, 'git', 'config', 'user.name', 'Test');
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'chore: specs');
}

export async function installFakeOpenContext(results = []) {
  const { mkdtemp: makeTemp, writeFile: write, chmod } = await import('node:fs/promises');
  const dir = await makeTemp(join(tmpdir(), 'fake-oc-'));
  const contextsRoot = join(dir, 'contexts');
  const log = join(dir, 'calls.log');
  const script = `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  --version) echo "oc 0.0.0-fake" ;;
  search) cat <<'JSON'
${JSON.stringify({ results })}
JSON
  ;;
  context) echo "- playbook/stack.md — Preferred stack: TypeScript, Expo, Postgres" ;;
esac
exit 0
`;
  await write(join(dir, 'oc'), script);
  await chmod(join(dir, 'oc'), 0o755);
  const env = { PATH: `${dir}:${process.env.PATH}`, OPENCONTEXT_CONTEXTS_ROOT: contextsRoot };
  return { dir, contextsRoot, log, env };
}

export async function setDocsEnabled(root, enabled) {
  const { readFile: readRaw, writeFile: write } = await import('node:fs/promises');
  const path = join(root, 'specs/project.json');
  const project = JSON.parse(await readRaw(path, 'utf8'));
  await write(path, JSON.stringify({ ...project, docs: { ...project.docs, enabled } }, null, 2));
  await run(['sync', '--dir', root]);
}

export async function writeTracedTests(root, featureId, criteria = [1]) {
  const { mkdir, writeFile: write } = await import('node:fs/promises');
  await mkdir(join(root, 'tests'), { recursive: true });
  const number = featureId.slice(0, 3);
  const body = criteria.map((criterion) => `test('${number}:AC-${criterion} behaves as specified', () => {});`).join('\n');
  await write(join(root, 'tests', `${featureId}.test.js`), `${body}\n`);
}

const FAKE_MULTICA = `#!/usr/bin/env node
const fs = require('fs');
const statePath = process.env.FAKE_MULTICA_STATE;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { issues: [], projects: [], comments: [] };
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const all = (name) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []));
const find = (ref) => state.issues.find((issue) => issue.key === ref || issue.id === ref);
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const out = (value) => process.stdout.write(typeof value === 'string' ? value + '\\n' : JSON.stringify(value));
const [area, action, ref] = args;
if (area === '--version') out('multica 0.0.0-fake');
else if (area === 'auth') out('Logged in as test@example.com');
else if (area === 'daemon') out({ status: process.env.FAKE_MULTICA_DAEMON || 'running', agents: ['claude'] });
else if (area === 'config') out('Server URL: ' + (process.env.FAKE_MULTICA_SERVER || 'http://localhost:8080') + '\\nApp URL: http://localhost:3000');
else if (area === 'agent') out([{ name: 'Lambda' }]);
else if (area === 'project' && action === 'list') out(state.projects);
else if (area === 'project' && action === 'create') { const project = { id: 'proj-' + (state.projects.length + 1), title: option('--title') }; state.projects.push(project); out(project); }
else if (area === 'issue' && action === 'create') {
  const issue = { id: 'uuid-' + (state.issues.length + 1), key: 'SPEC-' + (state.issues.length + 1), title: option('--title'), description: option('--description'), assignee: option('--assignee'), project: option('--project'), parent: option('--parent'), status: option('--status') || 'backlog', metadata: {} };
  state.issues.push(issue); out(issue);
}
else if (area === 'issue' && action === 'metadata') { const issue = find(args[3]); issue.metadata[option('--key')] = option('--value'); }
else if (area === 'issue' && action === 'list') {
  const filters = all('--metadata').map((pair) => { const [key, ...rest] = pair.split('='); return [key, JSON.parse(rest.join('='))]; });
  out(state.issues.filter((issue) => filters.every(([key, value]) => String(issue.metadata[key]) === String(value)) && (!option('--project') || issue.project === option('--project'))));
}
else if (area === 'issue' && action === 'get') out(find(ref));
else if (area === 'issue' && action === 'status') find(ref).status = args[3];
else if (area === 'issue' && action === 'comment') state.comments.push({ issue: args[3], content: option('--content') });
const WRITES = ['create', 'metadata', 'status', 'comment'];
if (WRITES.includes(action)) save();
`;

export async function installFakeMultica() {
  const { chmod, mkdtemp: makeTemp, writeFile: write, readFile: readRaw } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const dir = await makeTemp(join(tmpdir(), 'fake-multica-'));
  await write(join(dir, 'multica'), FAKE_MULTICA);
  await chmod(join(dir, 'multica'), 0o755);
  const statePath = join(dir, 'state.json');
  const env = { PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_MULTICA_STATE: statePath };
  const state = async () => JSON.parse(await readRaw(statePath, 'utf8'));
  const update = async (change) => {
    const current = await state();
    change(current);
    await write(statePath, JSON.stringify(current));
  };
  return { dir, env, state, update };
}

export async function patchProject(root, patch) {
  const { readFile: readRaw, writeFile: write } = await import('node:fs/promises');
  const path = join(root, 'specs/project.json');
  const project = JSON.parse(await readRaw(path, 'utf8'));
  const merged = { ...project };
  for (const [key, value] of Object.entries(patch)) merged[key] = { ...project[key], ...value };
  await write(path, JSON.stringify(merged, null, 2));
  await run(['sync', '--dir', root]);
}

export const PASSING_SUITES = { commands: { test: 'true', smoke: 'true', ui: 'true' } };
