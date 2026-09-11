import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { which } from '../src/which.js';
import { run } from '../src/cli.js';

console.log = () => {};

export const EXAMPLE = fileURLToPath(new URL('../examples/project.example.json', import.meta.url));
export const BIN = fileURLToPath(new URL('../bin/vibecheck', import.meta.url));
export const read = (root, path) => readFile(join(root, path), 'utf8');
// Tests scrub process.env.PATH so the code under test cannot find real tools. The harness
// itself still has to run git and node, so it never relies on the scrubbed PATH: setup
// commands get the PATH this process started with, and node is spawned by absolute path.
const ORIGINAL_PATH = process.env.PATH;
export const withRealPath = (env = {}) => ({ ...process.env, ...env, PATH: ORIGINAL_PATH });

// A PATH with no agent tools on it (claude, cursor-agent, oc, multica), used by tests that
// assert what happens when a tool is missing. git and node stay reachable because the code
// under test genuinely needs them — on POSIX the old '/usr/bin:/bin' happened to include
// both, which is the behaviour this reproduces on every platform.
const gitDir = which('git') ? dirname(which('git')) : '';
// Restore the environment by mutating it, never by replacing process.env wholesale:
// on Windows that drops entries Node itself needs, notably ComSpec, and without ComSpec
// every `shell: true` spawn fails with ENOENT — so a passing test suite reports failure.
export function restoreEnv(original) {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}

export const TOOL_FREE_PATH = [dirname(process.execPath), gitDir].filter(Boolean).join(delimiter);
export const sh = (cwd, command, ...args) => execFileSync(command, args, { cwd, encoding: 'utf8', env: withRealPath() });

// Cross-platform stand-ins for the POSIX utilities the tests used to shell out to
// (mktemp -d, mkdir -p, echo > file, sh -c '… && …'). Windows has none of them.
export const tempDir = (prefix = 'vibecheck-') => mkdtempSync(join(tmpdir(), prefix));

export function writeFileIn(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function commitAll(root, message) {
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', message);
}

export async function newProject(...initArgs) {
  const root = await mkdtemp(join(tmpdir(), 'vibecheck-'));
  await run(['init', '--dir', root, ...initArgs]);
  return root;
}

export async function exitCodeOf(argv) {
  // node:test sets process.exitCode to 1 as soon as any test fails, so it must be cleared
  // first: otherwise a command that succeeds reads the runner's failure state and every
  // later assertion in the run inherits it. The runner's value is put back afterwards.
  const runnerState = process.exitCode;
  process.exitCode = 0;
  await run(argv);
  const code = process.exitCode ?? 0;
  process.exitCode = runnerState;
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
  const child = execFileAsync(process.execPath, [BIN, 'hook', event], { cwd: root, env: { ...process.env, ...env } });
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

// A shebang script is not executable on Windows. Each fake tool is a Node script, paired
// with a .cmd shim so cmd.exe can run the same file through PATHEXT.
export async function installFakeBin(dir, name, source) {
  const { chmod, writeFile: write } = await import('node:fs/promises');
  await write(join(dir, name), source);
  await chmod(join(dir, name), 0o755);
  if (process.platform === 'win32') await write(join(dir, `${name}.cmd`), `@node "%~dp0${name}" %*`);
}

export async function installFakeOpenContext(results = []) {
  const { mkdtemp: makeTemp, writeFile: write, chmod } = await import('node:fs/promises');
  const dir = await makeTemp(join(tmpdir(), 'fake-oc-'));
  const contextsRoot = join(dir, 'contexts');
  const log = join(dir, 'calls.log');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + String.fromCharCode(10));
if (args[0] === '--version') console.log('oc 0.0.0-fake');
else if (args[0] === 'search') console.log(${JSON.stringify(JSON.stringify({ results }))});
else if (args[0] === 'context') console.log('- playbook/stack.md — Preferred stack: TypeScript, Expo, Postgres');
`;
  await installFakeBin(dir, 'oc', script);
  const env = { PATH: [dir, process.env.PATH].join(delimiter), OPENCONTEXT_CONTEXTS_ROOT: contextsRoot };
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
  await installFakeBin(dir, 'multica', FAKE_MULTICA);
  const statePath = join(dir, 'state.json');
  const env = { PATH: [dir, dirname(process.execPath), ORIGINAL_PATH].join(delimiter), FAKE_MULTICA_STATE: statePath };
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

// `true` is POSIX-only; cmd.exe has no such command, so a suite meant to pass would fail
// on Windows. Node exits 0 the same way everywhere.
export const PASSES = 'node -e ""';
export const FAILS = 'node -e "process.exit(1)"';
export const PASSING_SUITES = { commands: { test: PASSES, smoke: PASSES, ui: PASSES } };
