import { strict as assert } from 'node:assert';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyToken } from '../src/access.js';
import { assertRef, commitDate, resolveCommit } from '../src/docs/arch/history.js';
import { generateFolder } from '../src/folder/generate.js';
import { settingsPath, writeConfig } from '../src/prompts.js';
import { SEMVER, release } from '../src/release.js';
import { MAX_MESSAGE, createServer, serveStdio } from '../src/serve/mcp.js';
import { refuseCommand, refuseLoad, refuseOutside, refuseWrite } from '../src/serve/loads.js';
import { MAX_SESSIONS, accessFor, verbFor } from '../src/serve/tracker.js';
import { SOURCE_ID, assertSourceId, mappingPath, sourcePath } from '../src/sources.js';
import { gitInit } from './helpers.js';

/**
 * The attack surface, attacked.
 *
 * Every test here is a thing an adversarial input could do to a running server or a scripted
 * command, written as the attack rather than as the rule. Each was found by trying it: the MCP
 * server read any file on the machine, the allow-list approved `dotnet test; rm -rf /`, and the
 * Access gate refused every real action because it was checking the wrong names.
 */

const CONFIG = {
  name: 'b', description: 'd', architecture: 'clean', stack: {}, commands: {}, entities: [],
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-sec-'));
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'vibekit-sec-home-'));
  await generateFolder(root, CONFIG);
  return root;
}

// ---------------------------------------------------------------- the repository is the whole world

test('nothing outside the repository is readable through the server', async () => {
  const root = await project();
  const secret = join(tmpdir(), `vibekit-outside-${Date.now()}.txt`);
  await writeFile(secret, 'TOP SECRET');
  const server = createServer(root, {});

  for (const path of ['../outside.txt', secret, '../../../../etc/passwd', 'vibekit/../../x', './../x']) {
    const result = await server.call('vibekit_load', { path });
    assert.equal(result.isError, true, `${path} was readable`);
    assert.doesNotMatch(result.content[0].text, /TOP SECRET/);
  }
  // A normal read still works: the fence is around the repository, not around reading. Application
  // code is not governed by the stage manifest, so it is the clean case.
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/Thing.cs'), 'class Thing {}');
  const fine = await server.call('vibekit_load', { path: 'src/Thing.cs' });
  assert.notEqual(fine.isError, true);
  assert.match(fine.content[0].text, /class Thing/);
});

test('nothing outside the repository is writable, and .git is not a file an agent touches', async () => {
  const root = await project();
  const server = createServer(root, {});
  assert.match(await server.mayWrite('../x.txt'), /outside the repository/);
  assert.match(await server.mayWrite('/etc/hosts'), /absolute path/);
  assert.match(await server.mayWrite('.git/config'), /inside \.git/);
  assert.match(refuseOutside(root, 'a\0b'), /null byte/);
  assert.equal(refuseOutside(root, 'src/x.cs'), null);
});

test('refuseLoad and refuseWrite check containment before they consult any manifest', () => {
  const root = '/repo';
  assert.match(refuseLoad('../secret', { patterns: ['**'], root }), /outside the repository/);
  assert.match(refuseWrite('../secret', { writes: ['**'], root }), /outside the repository/);
  // Without a root the callers that already checked are not double-charged.
  assert.equal(refuseLoad('src/x.cs', { patterns: [] }), null);
});

// ---------------------------------------------------------------- one allowed command is one command

test('a shell operator turns one approved command into two, and is refused first', () => {
  const guardrails = '# G\n\n## Allowed commands\n\n- dotnet test\n';
  for (const command of ['dotnet test; rm -rf /', 'dotnet test && curl evil', 'dotnet test | sh', 'dotnet test $(id)', 'dotnet test `id`', 'dotnet test > /etc/passwd', 'dotnet test\nrm -rf /']) {
    assert.match(refuseCommand(command, guardrails) ?? '', /shell operator/, `${JSON.stringify(command)} was allowed`);
  }
});

test('an allowed entry matches as whole words, so a prefix approves nothing extra', () => {
  const guardrails = '# G\n\n## Allowed commands\n\n- dotnet test\n- npm run build\n';
  assert.equal(refuseCommand('dotnet test', guardrails), null);
  assert.equal(refuseCommand('dotnet test --filter AC-1', guardrails), null, 'arguments after the entry are fine');
  assert.match(refuseCommand('dotnet testx', guardrails), /not on the allowed list/);
  assert.match(refuseCommand('dotnet', guardrails), /not on the allowed list/, 'less than the entry is not the entry');
  assert.match(refuseCommand('npm run build-and-deploy', guardrails), /not on the allowed list/);
});

test('the server refuses a chained command before the runner ever sees it', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/standards/guardrails.md'), '# G\n\n## Allowed commands\n\n- dotnet test\n');
  let ran = null;
  const server = createServer(root, { run: async (command) => { ran = command; return { code: 0, output: '' }; } });

  const refused = await server.call('vibekit_run', { command: 'dotnet test; curl evil' });
  assert.equal(refused.isError, true);
  assert.equal(ran, null, 'refused before anything runs');
});

test('a JSON-RPC message that never ends is refused rather than buffered forever', async () => {
  const root = await project();
  const server = createServer(root, {});
  const written = [];
  const output = { write: (line) => written.push(line) };
  async function* input() {
    yield 'x'.repeat(MAX_MESSAGE + 10);
    yield '\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n';
  }
  await serveStdio(server, { input: input(), output });
  assert.ok(written.some((line) => /refused/.test(line)), 'the oversized message is refused');
  assert.ok(written.some((line) => /"id":1/.test(line)), 'and the server keeps serving afterwards');
});

// ---------------------------------------------------------------- an id is not a path

test('a source id has one shape, so --id can never choose where files land', async () => {
  const root = await project();
  for (const id of ['../../escape', 'BRS-001/../x', '/tmp/x', 'BRS-1', 'brs-001', 'BRS-001; rm']) {
    assert.throws(() => sourcePath(root, id), /not a source id/, `${id} was accepted`);
    assert.throws(() => mappingPath(id), /not a source id/, `${id} was accepted for the mapping`);
  }
  assert.ok(SOURCE_ID.test('BRS-001'));
  assert.ok(SOURCE_ID.test('DESC-012'));
  assert.equal(assertSourceId('BRS-001'), 'BRS-001');
});

test('the redaction mapping and the settings file are owner-only on disk', async () => {
  const { writeSource } = await import('../src/sources.js');
  const root = await project();
  await writeSource(root, { id: 'BRS-001', title: 't', version: '1', text: '1 Scope\nMail ops@x.example.\n', found: [{ kind: 'EMAIL', value: 'ops@x.example', placeholder: '[EMAIL-1]' }], redacted: true });
  if (process.platform !== 'win32') {
    assert.equal((await stat(mappingPath('BRS-001'))).mode & 0o077, 0, 'the one file that undoes a redaction must not be world-readable');
  }

  await writeConfig('tunnel-token', 'cf-secret');
  if (process.platform !== 'win32') {
    assert.equal((await stat(settingsPath())).mode & 0o077, 0, 'a settings file another account can read is a token another account has');
  }
});

// ---------------------------------------------------------------- a ref is not an option

test('a ref that begins with a dash is refused by shape, never handed to git', async () => {
  const root = await project();
  gitInit(root);
  for (const ref of ['--output=/tmp/pwned', '-x', '--upload-pack=touch /tmp/x', 'a b', 'v1..v2']) {
    assert.throws(() => assertRef(ref), /not a ref/, `${ref} was accepted`);
    assert.throws(() => resolveCommit(root, ref), /not a ref|not a commit/, `${ref} reached git`);
  }
  assert.equal(commitDate(root, '--output=/tmp/x'), null, 'commitDate refuses rather than running');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(commitDate(root, 'HEAD')), 'a real ref still works');
});

test('a typed release version is checked against the shape a tag has', async () => {
  const root = await project();
  gitInit(root);
  assert.equal(SEMVER.test('--force'), false);
  await assert.rejects(() => release(root, { version: '--force', force: true }), /not a version/);
  await assert.rejects(() => release(root, { version: 'v1.0.0 --force', force: true }), /not a version/);
});

// ---------------------------------------------------------------- the front door

function issuer() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = (payload, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) => {
    const head = b64(header);
    const body = b64({ exp: Math.floor(Date.now() / 1000) + 600, ...payload });
    const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
    return `${head}.${body}.${signature}`;
  };
  return { jwk, sign };
}

test('an algorithm-confusion token is refused: none, HMAC, and a non-RSA key', () => {
  const { jwk, sign } = issuer();
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

  assert.throws(() => verifyToken(`${b64({ alg: 'none', kid: 'k1' })}.${b64({ email: 'x@y' })}.`, { keys: [jwk] }), /Unsupported token algorithm/);
  assert.throws(() => verifyToken(`${b64({ alg: 'HS256', kid: 'k1' })}.${b64({ email: 'x@y' })}.AAAA`, { keys: [jwk] }), /Unsupported token algorithm/);
  assert.throws(() => verifyToken(sign({ email: 'x@y' }), { keys: [{ kid: 'k1', kty: 'oct', k: 'secret' }] }), /not an RSA public key/);
  assert.equal(verifyToken(sign({ email: 'x@y' }), { keys: [jwk] }).email, 'x@y');
});

test('the session cache is bounded, so a token per request cannot exhaust memory', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const access = accessFor(root, { teamDomain: 't.cloudflareaccess.com', fetchJson: async () => ({ keys: [jwk] }) });

  for (let index = 0; index < MAX_SESSIONS + 50; index += 1) {
    await access.sessionFor({ headers: { 'cf-access-jwt-assertion': sign({ email: `u${index}@example.com` }) } });
  }
  assert.ok(access.size() <= MAX_SESSIONS, `${access.size()} sessions cached`);
});

test('the role gate speaks the action names the page actually sends', () => {
  assert.equal(verbFor({ action: 'req.status', status: 'done' }), 'done');
  assert.equal(verbFor({ action: 'req.status', status: 'review' }), 'review');
  assert.equal(verbFor({ action: 'req.release' }), 'unhold');
  assert.equal(verbFor({ action: 'ask.answer' }), 'answer');
  assert.equal(verbFor({ action: 'req.add' }), 'add');
  assert.equal(verbFor({ action: 'gate.approve' }), 'approve');
  assert.equal(verbFor({ action: 'plan.reorder' }), 'reorder');
  assert.equal(verbFor({ action: 'note.add' }), 'note');
  assert.equal(verbFor({ action: 'tunnel.start' }), 'unhold');
  assert.equal(verbFor({ action: 'deploy.everything' }), null, 'an action nobody mapped is refused, not allowed by omission');
  assert.equal(verbFor({}), null);
});

test('with Access in front, a named approver can do a real action and a stranger cannot', async () => {
  const root = await project();
  await writeFile(join(root, 'vibekit/agents/humans.md'), [
    '# Humans', '', '## Approvers', '',
    '| Role | Name | May approve |', '| --- | --- | --- |',
    '| tech lead | Grace Hopper <grace@example.com> | everything |', '',
  ].join('\n'));
  const { jwk, sign } = issuer();
  const access = accessFor(root, { teamDomain: 't.cloudflareaccess.com', fetchJson: async () => ({ keys: [jwk] }) });

  const grace = await access.sessionFor({ headers: { 'cf-access-jwt-assertion': sign({ email: 'grace@example.com' }) } });
  // The real ids the page sends — the gate used to refuse all of these as unknown actions.
  assert.equal(await access.refuse(grace, { action: 'req.release', id: 'REQ-001' }), null);
  assert.equal(await access.refuse(grace, { action: 'ask.answer', id: 'Q-001' }), null);
  assert.equal(await access.refuse(grace, { action: 'req.status', id: 'REQ-001', status: 'done' }), null);
  assert.match(await access.refuse(grace, { action: 'req.add', title: 'x' }), /needs the product owner role/);

  const stranger = await access.sessionFor({ headers: { 'cf-access-jwt-assertion': sign({ email: 'nobody@example.com' }) } });
  assert.match(await access.refuse(stranger, { action: 'ask.answer' }), /read-only for you/);
});

// ---------------------------------------------------------------- a command is its words, not a string

test('a quoted argument reaches the program as one word, without its quotes', async () => {
  const { splitArgs } = await import('../src/which.js');
  // `split(/\s+/)` handed node the literal string `"process.exit(3)"`, quotes included, which
  // evaluates to a string and exits 0 — so a red test command was recorded as green.
  assert.deepEqual(splitArgs('node -e "process.exit(3)"'), ['node', '-e', 'process.exit(3)']);
  assert.deepEqual(splitArgs('dotnet test --filter "Category=Smoke"'), ['dotnet', 'test', '--filter', 'Category=Smoke']);
  // Outside quotes a backslash escapes the next character on Unix (`c\ d` → `c d`).
  // On Windows it is a path separator, so the same bytes stay two words.
  assert.deepEqual(
    splitArgs("echo 'a b' c\\ d"),
    process.platform === 'win32' ? ['echo', 'a b', 'c\\', 'd'] : ['echo', 'a b', 'c d'],
  );
  assert.deepEqual(splitArgs('a "b \\"quoted\\" c"'), ['a', 'b "quoted" c']);
  assert.deepEqual(splitArgs('  spaced   out  '), ['spaced', 'out']);
  assert.deepEqual(
    splitArgs('"C:\\Program Files\\nodejs\\node.exe" -e "process.exit(3)"'),
    ['C:\\Program Files\\nodejs\\node.exe', '-e', 'process.exit(3)'],
    'a Windows path inside quotes is one word, backslashes included',
  );
  assert.throws(() => splitArgs('bad "quote'), /Unbalanced/);
});

test('nothing is expanded: a dollar or a semicolon is a character, not an instruction', async () => {
  const { splitArgs } = await import('../src/which.js');
  assert.deepEqual(splitArgs('echo $HOME; ls'), ['echo', '$HOME;', 'ls'], 'no shell means no expansion and no chaining');
});

test('a red command run by verify is recorded red, now that its arguments survive the trip', async () => {
  const { runCommand } = await import('../src/folder/evidence.js');
  const root = await project();
  const red = await runCommand(root, `"${process.execPath}" -e "process.exit(3)"`);
  assert.equal(red.code, 3, 'exit 3 must arrive as exit 3');
  const green = await runCommand(root, `"${process.execPath}" -e "process.exit(0)"`);
  assert.equal(green.code, 0);
});
