import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { writeConfig } from '../src/prompts.js';
import { PIPELINE_FILES, pipelineBody, slugOf } from '../src/providers.js';
import { gitInit, isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * `vibekit new repo` against a fake provider. What is checked is the conversation: which
 * endpoint, which method, which body, which header carries the token — and what the CLI does
 * with the answer: origin set, the pipeline file written, the token never in a URL or a file.
 */

async function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
}

/** A provider that records every request and answers by route. */
async function fakeProvider(routes) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const entry = { method: request.method, path: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
      requests.push(entry);
      const route = routes.find(([method, pattern]) => method === request.method && pattern.test(request.url.split('?')[0]));
      if (!route) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        return void response.end(JSON.stringify({ message: `no route for ${request.method} ${request.url}` }));
      }
      const [, , status, answer] = route;
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(typeof answer === 'function' ? answer(entry, requests) : answer));
    });
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((closed) => server.close(closed)) };
}

async function projectIn(name = 'Stock Take') {
  const root = tempDir('vibekit-repo-');
  await capture(() => run(['new', 'project', name, '--yes', '--describe', 'Staff count stock.', '--platform', 'web', '--dir', root]));
  gitInit(root);
  return root;
}

function isolated() {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  process.env.VIBEKIT_TEST_FAST = '1';
  return original;
}

const origin = (root) => execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();

test('new repo refuses without the three settings and names them', async () => {
  const original = isolated();
  try {
    const root = await projectIn();
    await assert.rejects(run(['new', 'repo', '--no-push', '--dir', root]), /git-provider[\s\S]*git-org[\s\S]*git-token[\s\S]*\/vibekit:setup/);
    await writeConfig('git-token', 'secret-token-value');
    const listed = await capture(() => run(['settings']));
    assert.match(listed, /git-token\s+set · hidden/);
    assert.doesNotMatch(listed, /secret-token-value/);
    assert.equal(await capture(() => run(['settings', 'git-token'])), 'set · hidden');
  } finally {
    restoreEnv(original);
  }
});

test('GitHub: user repo when the org path is the token owner, org repo otherwise; origin set; workflow written', async () => {
  const original = isolated();
  const provider = await fakeProvider([
    ['GET', /^\/api\/v3\/user$/, 200, { login: 'sam', name: 'Sam Lee', html_url: 'https://ghe.local/sam' }],
    ['POST', /^\/api\/v3\/user\/repos$/, 201, (entry) => ({ id: 1, clone_url: `https://ghe.local/sam/${entry.body.name}.git`, html_url: `https://ghe.local/sam/${entry.body.name}` })],
    ['POST', /^\/api\/v3\/orgs\/acme\/repos$/, 201, (entry) => ({ id: 2, clone_url: `https://ghe.local/acme/${entry.body.name}.git`, html_url: `https://ghe.local/acme/${entry.body.name}` })],
  ]);
  try {
    await writeConfig('git-provider', 'github');
    await writeConfig('git-token', 'ghp_test');
    await writeConfig('git-org', `${provider.url}/sam`);
    const root = await projectIn('Stock Take');
    const out = await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--dir', root]));
    assert.match(out, /https:\/\/ghe\.local\/sam\/stock-take/);
    assert.equal(origin(root), 'https://ghe.local/sam/stock-take.git');
    const create = provider.requests.find((entry) => entry.method === 'POST');
    assert.equal(create.path, '/api/v3/user/repos');
    assert.deepEqual({ name: create.body.name, private: create.body.private }, { name: 'stock-take', private: true });
    assert.equal(create.headers.authorization, 'Bearer ghp_test');
    const workflow = await readFile(join(root, PIPELINE_FILES.github), 'utf8');
    assert.match(workflow, /vibekit check --ci/);
    assert.match(workflow, /actions\/checkout@v4/);
    assert.doesNotMatch(workflow, /ghp_test/);
    // The pipeline file is committed on a repository that has history.
    const log = execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf8' });
    assert.match(log, /ci: \.github\/workflows\/vibekit\.yml/);

    // An organisation that is not the token's own login goes through /orgs.
    await writeConfig('git-org', `${provider.url}/acme`);
    const other = await projectIn('Ledger');
    await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--public', '--dir', other]));
    const orgCreate = provider.requests.filter((entry) => entry.method === 'POST').pop();
    assert.equal(orgCreate.path, '/api/v3/orgs/acme/repos');
    assert.equal(orgCreate.body.private, false);
    assert.equal(origin(other), 'https://ghe.local/acme/ledger.git');
    // A second run onto the same repository is idempotent; an origin that points elsewhere is not moved silently.
    await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--dir', other]));
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://elsewhere.local/team/ledger.git'], { cwd: other });
    await assert.rejects(run(['new', 'repo', '--no-push', '--allow-private', '--dir', other]), /origin is already https:\/\/elsewhere/);
    await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--force', '--dir', other]));
    assert.equal(origin(other), 'https://ghe.local/acme/ledger.git');
  } finally {
    await provider.close();
    restoreEnv(original);
  }
});

test('GitLab: the group is resolved to a namespace id and the token travels in PRIVATE-TOKEN', async () => {
  const original = isolated();
  const provider = await fakeProvider([
    ['GET', /^\/api\/v4\/user$/, 200, { username: 'sam', name: 'Sam Lee', web_url: 'https://gl.local/sam' }],
    ['GET', /^\/api\/v4\/namespaces$/, 200, [{ id: 7, full_path: 'acme/platform' }, { id: 8, full_path: 'other/platform' }]],
    ['POST', /^\/api\/v4\/projects$/, 201, (entry) => ({ id: 42, http_url_to_repo: `https://gl.local/acme/platform/${entry.body.path}.git`, web_url: `https://gl.local/acme/platform/${entry.body.path}` })],
  ]);
  try {
    await writeConfig('git-provider', 'gitlab');
    await writeConfig('git-token', 'glpat-test');
    await writeConfig('git-org', `${provider.url}/acme/platform`);
    const root = await projectIn('Stock Take');
    const out = await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--json', '--dir', root]));
    const result = JSON.parse(out);
    assert.equal(result.cloneUrl, 'https://gl.local/acme/platform/stock-take.git');
    assert.equal(result.pipeline, '.gitlab-ci.yml');
    const create = provider.requests.find((entry) => entry.method === 'POST');
    assert.equal(create.headers['private-token'], 'glpat-test');
    assert.equal(create.body.namespace_id, 7);
    assert.equal(create.body.visibility, 'private');
    assert.match(await readFile(join(root, '.gitlab-ci.yml'), 'utf8'), /vibekit check --ci/);
  } finally {
    await provider.close();
    restoreEnv(original);
  }
});

test('Azure DevOps: a project is created and polled when git-org names none; the pipeline is registered after the push', async () => {
  const original = isolated();
  let polls = 0;
  const provider = await fakeProvider([
    ['GET', /\/_apis\/connectionData$/, 200, { authenticatedUser: { providerDisplayName: 'Sam Lee', id: 'u1' } }],
    ['POST', /^\/acme\/_apis\/projects$/, 202, { id: 'op-1', status: 'queued' }],
    ['GET', /^\/acme\/_apis\/operations\/op-1$/, 200, () => ({ status: (polls += 1) < 2 ? 'inProgress' : 'succeeded' })],
    ['GET', /^\/acme\/stock-take\/_apis\/git\/repositories\/stock-take$/, 200, { id: 'repo-1', remoteUrl: 'https://dev.azure.com/acme/stock-take/_git/stock-take', webUrl: 'https://dev.azure.com/acme/stock-take/_git/stock-take' }],
    ['POST', /^\/acme\/Ledger\/_apis\/git\/repositories$/, 201, (entry) => ({ id: 'repo-2', remoteUrl: `https://dev.azure.com/acme/Ledger/_git/${entry.body.name}`, webUrl: `https://dev.azure.com/acme/Ledger/_git/${entry.body.name}` })],
    ['POST', /\/_apis\/pipelines$/, 200, { id: 9, _links: { web: { href: 'https://dev.azure.com/acme/Ledger/_build?definitionId=9' } } }],
  ]);
  try {
    await writeConfig('git-provider', 'azure-devops');
    await writeConfig('git-token', 'pat-test');
    await writeConfig('git-org', `${provider.url}/acme`);
    const root = await projectIn('Stock Take');
    const result = JSON.parse(await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--json', '--dir', root])));
    assert.equal(result.createdProject, 'stock-take');
    assert.equal(result.cloneUrl, 'https://dev.azure.com/acme/stock-take/_git/stock-take');
    assert.equal(polls, 2, 'polled the operation until it succeeded');
    const createProject = provider.requests.find((entry) => entry.method === 'POST');
    assert.equal(createProject.body.capabilities.versioncontrol.sourceControlType, 'Git');
    assert.equal(createProject.headers.authorization, `Basic ${Buffer.from(':pat-test').toString('base64')}`);
    assert.match(await readFile(join(root, 'azure-pipelines.yml'), 'utf8'), /vibekit check --ci/);
    assert.equal(result.registered, null, 'no push, so no pipeline registration');

    // With a project in git-org, the repository goes straight into it.
    await writeConfig('git-org', `${provider.url}/acme/Ledger`);
    const other = await projectIn('Ledger App');
    const second = JSON.parse(await capture(() => run(['new', 'repo', '--no-push', '--allow-private', '--json', '--dir', other])));
    assert.equal(second.project, 'Ledger');
    assert.equal(second.createdProject, null);
    assert.equal(origin(other), 'https://dev.azure.com/acme/Ledger/_git/ledger-app');
  } finally {
    await provider.close();
    restoreEnv(original);
  }
});

test('new repo --check names the account; --pipeline rewrites the file and keeps a local tail', async () => {
  const original = isolated();
  const provider = await fakeProvider([
    ['GET', /^\/api\/v3\/user$/, 200, { login: 'sam', name: 'Sam Lee', html_url: 'https://ghe.local/sam' }],
  ]);
  try {
    await writeConfig('git-provider', 'github');
    await writeConfig('git-token', 'ghp_test');
    await writeConfig('git-org', `${provider.url}/sam`);
    const root = await projectIn();
    assert.match(await capture(() => run(['new', 'repo', '--check', '--allow-private', '--dir', root])), /github · Sam Lee \(sam\)/);
    await capture(() => run(['new', 'repo', '--pipeline', '--dir', root]));
    const path = join(root, PIPELINE_FILES.github);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, `${await readFile(path, 'utf8')}  deploy:\n    runs-on: ubuntu-latest\n`);
    await capture(() => run(['new', 'repo', '--pipeline', '--dir', root]));
    const again = await readFile(path, 'utf8');
    assert.match(again, /deploy:/, 'the local tail survives');
    assert.equal((again.match(/name: vibekit/g) ?? []).length, 1, 'the generated head is not duplicated');
  } finally {
    await provider.close();
    restoreEnv(original);
  }
});

test('pipeline dialects carry the project commands and the gate; slugs are safe repository names', () => {
  for (const provider of Object.keys(PIPELINE_FILES)) {
    const body = pipelineBody(provider, { commands: { install: 'pnpm i', test: 'pnpm test', build: 'pnpm build' } });
    assert.match(body, /pnpm i/);
    assert.match(body, /pnpm build/);
    assert.match(body, /vibekit check --ci && vibekit check --security/);
    assert.match(body, /survives a regeneration/);
  }
  assert.equal(slugOf('Stock Take'), 'stock-take');
  assert.equal(slugOf('  Ledger / App!!  '), 'ledger-app');
  assert.equal(slugOf('---'), 'project');
});

test('new project --remote links a repository you already have and writes the pipeline for its host', async () => {
  const original = isolated();
  try {
    const root = tempDir('vibekit-link-');
    const out = await capture(() => run(['new', 'project', 'Ledger', '--yes', '--describe', 'Books.', '--platform', 'web', '--remote', 'git@github.com:acme/ledger.git', '--dir', root]));
    assert.match(out, /origin → git@github\.com:acme\/ledger\.git/);
    assert.equal(origin(root), 'git@github.com:acme/ledger.git');
    assert.match(await readFile(join(root, PIPELINE_FILES.github), 'utf8'), /vibekit check --ci/);
    const other = tempDir('vibekit-link-');
    await capture(() => run(['new', 'project', 'Ledger', '--yes', '--describe', 'Books.', '--platform', 'web', '--remote', 'https://dev.azure.com/acme/Ledger/_git/ledger', '--dir', other]));
    assert.match(await readFile(join(other, 'azure-pipelines.yml'), 'utf8'), /NodeTool@0/);
    // The same, for a project that already exists.
    const later = tempDir('vibekit-link-');
    await capture(() => run(['new', 'project', 'Ledger', '--yes', '--describe', 'Books.', '--platform', 'web', '--dir', later]));
    assert.match(await capture(() => run(['new', 'repo', '--link', 'https://gitlab.com/acme/ledger.git', '--dir', later])), /origin → https:\/\/gitlab\.com\/acme\/ledger\.git · \.gitlab-ci\.yml written for gitlab/);
    assert.equal(origin(later), 'https://gitlab.com/acme/ledger.git');
    const unknown = tempDir('vibekit-link-');
    await capture(() => run(['new', 'project', 'Ledger', '--yes', '--describe', 'Books.', '--platform', 'web', '--remote', 'https://git.example.com/acme/ledger.git', '--dir', unknown]));
    assert.equal(origin(unknown), 'https://git.example.com/acme/ledger.git');
  } finally {
    restoreEnv(original);
  }
});
