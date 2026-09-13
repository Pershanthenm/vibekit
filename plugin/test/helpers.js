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

// Never launch a browser from a test. `vibecheck dashboard` opens one on purpose, and `setup`,
// `init` and `dispatch` open it for you — so a suite that exercises any of them spawns real tabs
// on the developer's machine. Four test files used to set this themselves and eight others did
// not, which is the kind of rule that only holds until someone writes the ninth file. Every test
// imports this module, so the guard belongs here rather than in each of them.
process.env.VIBECHECK_NO_OPEN = '1';

// Keep the test suite out of the developer's real home. Every scaffolded project registers itself
// in `$VIBECHECK_HOME/projects.json`, so without this a test run fills the user's own project list
// with throwaway temp folders — 47 of them, in one afternoon, before this was noticed. Seven test
// files set this themselves and the rest did not, which is the same per-file discipline that
// failed for the browser guard above. A test that wants its own home still sets it in beforeEach.
process.env.VIBECHECK_HOME = mkdtempSync(join(tmpdir(), 'vc-test-home-'));

export const EXAMPLE = fileURLToPath(new URL('../examples/project.example.json', import.meta.url));
export const BIN = fileURLToPath(new URL('../bin/vibecheck', import.meta.url));
export const read = (root, path) => readFile(join(root, path), 'utf8');
// Tests scrub process.env.PATH so the code under test cannot find real tools. The harness
// itself still has to run git and node, so it never relies on the scrubbed PATH: setup
// commands get the PATH this process started with, and node is spawned by absolute path.
const ORIGINAL_PATH = process.env.PATH;
export const withRealPath = (env = {}) => ({ ...process.env, ...env, PATH: ORIGINAL_PATH });

// A PATH with no agent tools on it (claude, cursor-agent, oc), used by tests that
// assert what happens when a tool is missing. git and node stay reachable because the code
// under test genuinely needs them — on POSIX the old '/usr/bin:/bin' happened to include
// both, which is the behaviour this reproduces on every platform.
const gitDir = which('git') ? dirname(which('git')) : '';
// `sh` too: runShell() spawns `sh -c` for every non-Windows platform, so a PATH without a shell
// is not a machine that lacks agent tools — it is a machine where nothing can run at all. On
// Windows the shell ships with Git but in a different directory from git.exe, so it is resolved
// separately rather than assumed to be a sibling.
const shellDir = which('sh') ? dirname(which('sh')) : '';
// Restore the environment by mutating it, never by replacing process.env wholesale:
// on Windows that drops entries Node itself needs, notably ComSpec, and without ComSpec
// every `shell: true` spawn fails with ENOENT — so a passing test suite reports failure.
export function restoreEnv(original) {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}

export const TOOL_FREE_PATH = [dirname(process.execPath), gitDir, shellDir].filter(Boolean).join(delimiter);

// Scrubbing PATH is not enough to simulate a missing tool: the search path deliberately also
// looks in ~/.local/bin, ~/.claude/local, ~/.cursor/bin and %APPDATA%\npm, so on a developer
// machine that really has Claude Code installed the check still finds it. Pointing HOME at an
// empty directory makes those look-aside dirs empty too, which is what "not installed anywhere"
// actually means. Call it after setting PATH; restoreEnv() in afterEach puts the real one back.
export function isolateHome() {
  const home = mkdtempSync(join(tmpdir(), 'vc-empty-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = join(home, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = join(home, 'AppData', 'Local');
  // Redirecting HOME is not enough on macOS or Linux: /usr/local/bin and /opt/homebrew/bin are
  // searched too, and that is exactly where `npm install -g` puts agentmemory and the OpenContext
  // CLI. Without this the same test passes on a bare CI runner and fails on a real developer Mac.
  process.env.VIBECHECK_TOOL_DIRS = '';
  return home;
}
export const sh = (cwd, command, ...args) => execFileSync(command, args, { cwd, encoding: 'utf8', env: withRealPath() });

// Cross-platform stand-ins for the POSIX utilities the tests used to shell out to
// (mktemp -d, mkdir -p, echo > file, sh -c '… && …'). Windows has none of them.
export const tempDir = (prefix = 'vibecheck-') => mkdtempSync(join(tmpdir(), prefix));

export function writeFileIn(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

// Features cannot reach `done` without a recorded review. Tests about the other gates record
// an approving one so they still exercise what they are actually about.
export async function approveReview(root, featureId, reviewer = 'Test Reviewer') {
  const { reviewPath } = await import('../src/review.js');
  const { repoState } = await import('../src/evidence.js');
  const { writeFile: write } = await import('node:fs/promises');
  const state = repoState(root);
  await write(reviewPath(root, featureId), `---\nverdict: approved\ncommit: ${state ? state.commit : ''}\nreviewer: ${reviewer}\n---\n\n## Findings\n\n`);
  if (state) commitAll(root, `chore: review ${featureId}`);
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

// Tests that describe a Linux machine write POSIX install commands, and those run through
// `sh -c`. A Windows temp path dropped into one is destroyed by the shell, which reads every
// backslash as an escape: C:\Users\… arrives as C:Users…. Git's sh accepts forward slashes on
// Windows, so this makes an interpolated path survive the trip.
export const posix = (path) => path.replace(/\\/g, '/');

// A stand-in for any local service the checks probe over HTTP — agentmemory, in
// practice. Answers 200 on every path, which is all `httpOk` asks of it.
export async function startFakeHttp(body = { ok: true }) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((closed) => server.close(closed)),
  };
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
