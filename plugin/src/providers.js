import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { exists, writeText } from './fsutil.js';
import { safeFetch } from './netguard.js';
import { readConfig } from './prompts.js';

/**
 * The repository at the provider. GitHub, GitLab and Azure DevOps, through their own APIs, with
 * a token a person put in machine settings (`vibekit settings git-token`), never in the folder.
 *
 * What is here: create the repository (and, on Azure DevOps, the project when the organisation
 * URL names none), write the pipeline file in that provider's dialect, push, and on Azure DevOps
 * register the pipeline, since there a YAML file alone does nothing. What is not here: anything
 * the provider's UI does better — permissions, branch policies, secrets. Those are pointed at.
 */

export const PROVIDERS = Object.freeze(['github', 'azure-devops', 'gitlab']);

/** The package the pipeline installs; a pipeline variable overrides it for a fork or a pin. */
export const VIBEKIT_PACKAGE = 'https://github.com/Pershanthenm/vibekit/releases/download/v0.1.0-alpha/vibekit-0.1.0-alpha.tgz';

/** Which provider a clone URL belongs to, from its host; null when the host says nothing. */
export function providerOfUrl(url) {
  const host = String(url).replace(/^git@/, '').replace(/^[a-z+]+:\/\//, '').split(/[/:]/)[0].toLowerCase();
  if (/(^|\.)github\.com$/.test(host)) return 'github';
  if (/(^|\.)gitlab\./.test(host)) return 'gitlab';
  if (/(^|\.)dev\.azure\.com$/.test(host) || /\.visualstudio\.com$/.test(host)) return 'azure-devops';
  return null;
}

export const slugOf = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'project';

/** The settings a repository needs, read once and checked in one place so every command says the same thing. */
export async function providerSettings(overrides = {}) {
  const config = await readConfig();
  const provider = overrides.provider ?? config['git-provider'] ?? null;
  const org = overrides.org ?? config['git-org'] ?? null;
  const token = overrides.token ?? process.env.VIBEKIT_GIT_TOKEN ?? config['git-token'] ?? null;
  const missing = [];
  if (!provider || provider === 'none') missing.push('vibekit settings git-provider github|azure-devops|gitlab');
  if (!org) missing.push('vibekit settings git-org "<organisation URL>"');
  if (!token) missing.push('vibekit settings git-token "<token>"   (a token with repository create + write, from the provider\'s settings)');
  return { provider, org, token, missing };
}

// ---------------------------------------------------------------- HTTP

class ProviderError extends Error {}

async function call(url, { token, provider, method = 'GET', body = null, allowPrivate = false, fetchImpl }) {
  const headers = { Accept: 'application/json', 'User-Agent': 'vibekit' };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (provider === 'github') {
    headers.Authorization = `Bearer ${token}`;
    headers.Accept = 'application/vnd.github+json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  } else if (provider === 'gitlab') {
    headers['PRIVATE-TOKEN'] = token;
  } else {
    headers.Authorization = `Basic ${Buffer.from(`:${token}`).toString('base64')}`;
  }
  const response = await safeFetch(url, { method, headers, body: body === null ? undefined : JSON.stringify(body), allowPrivate, fetchImpl });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    const reason = json?.message ?? json?.error ?? json?.error_description ?? text.slice(0, 200) ?? response.statusText;
    throw new ProviderError(`${provider}: ${method} ${new URL(url).pathname} → ${response.status}${reason ? ` · ${String(reason).replace(/\s+/g, ' ')}` : ''}`);
  }
  return json;
}

// ---------------------------------------------------------------- where the API is

/** `https://github.com/acme` → api.github.com; a GitHub Enterprise host → `<origin>/api/v3`. */
function githubApi(org) {
  const url = new URL(org);
  return url.hostname === 'github.com' ? 'https://api.github.com' : `${url.origin}/api/v3`;
}
const gitlabApi = (org) => `${new URL(org).origin}/api/v4`;
/** `https://dev.azure.com/acme[/Project]` → { base, organisation, project }. Also `https://acme.visualstudio.com` and on-prem Azure DevOps Server. */
function azureParts(org) {
  const url = new URL(org);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (/\.visualstudio\.com$/i.test(url.hostname)) {
    return { base: url.origin, organisation: url.hostname.split('.')[0], project: segments[0] ?? null, prefix: '' };
  }
  const [organisation, project] = segments;
  if (!organisation) throw new ProviderError(`git-org for Azure DevOps needs the organisation in the URL: https://dev.azure.com/<organisation>[/<project>], not ${org}`);
  return { base: url.origin, organisation, project: project ?? null, prefix: `/${encodeURIComponent(organisation)}` };
}
const pathOf = (org) => new URL(org).pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/');

// ---------------------------------------------------------------- who am I

/** The account the token belongs to. The preflight `new repo --check` runs, and the answer to "is this path my user or an organisation?" */
export async function whoAmI({ provider, org, token, allowPrivate = false, fetchImpl }) {
  const options = { token, provider, allowPrivate, fetchImpl };
  if (provider === 'github') {
    const user = await call(`${githubApi(org)}/user`, options);
    return { login: user.login, name: user.name ?? user.login, url: user.html_url };
  }
  if (provider === 'gitlab') {
    const user = await call(`${gitlabApi(org)}/user`, options);
    return { login: user.username, name: user.name ?? user.username, url: user.web_url };
  }
  const { base, organisation, prefix } = azureParts(org);
  const data = await call(`${base}${prefix}/_apis/connectionData?api-version=7.1-preview.1`, options);
  const who = data.authenticatedUser ?? {};
  return { login: who.providerDisplayName ?? who.customDisplayName ?? who.id ?? organisation, name: who.providerDisplayName ?? who.customDisplayName ?? organisation, url: org };
}

// ---------------------------------------------------------------- create

/**
 * Create the repository. Returns { cloneUrl, webUrl, id, project? } — the clone URL without any
 * credential in it; the token goes on the push as a header and nowhere else.
 */
export async function createRepository({ provider, org, token, name, isPrivate = true, description = null, allowPrivate = false, fetchImpl, log = () => {} }) {
  const slug = slugOf(name);
  const options = { token, provider, allowPrivate, fetchImpl };

  if (provider === 'github') {
    const api = githubApi(org);
    const owner = pathOf(org).split('/')[0] ?? null;
    const me = await whoAmI({ provider, org, token, allowPrivate, fetchImpl });
    const path = owner && owner.toLowerCase() !== String(me.login).toLowerCase() ? `/orgs/${encodeURIComponent(owner)}/repos` : '/user/repos';
    const repo = await call(`${api}${path}`, { ...options, method: 'POST', body: { name: slug, private: isPrivate, description: description ?? undefined, auto_init: false } });
    return { cloneUrl: repo.clone_url, webUrl: repo.html_url, id: String(repo.id), slug };
  }

  if (provider === 'gitlab') {
    const api = gitlabApi(org);
    const group = pathOf(org);
    const me = await whoAmI({ provider, org, token, allowPrivate, fetchImpl });
    const body = { name, path: slug, visibility: isPrivate ? 'private' : 'public', description: description ?? undefined, initialize_with_readme: false };
    if (group && group.toLowerCase() !== String(me.login).toLowerCase()) {
      const namespaces = await call(`${api}/namespaces?search=${encodeURIComponent(group.split('/').pop())}`, options);
      const namespace = (namespaces ?? []).find((entry) => String(entry.full_path).toLowerCase() === group.toLowerCase());
      if (!namespace) throw new ProviderError(`gitlab: no group at ${group} that this token can see. git-org is the group's URL, for example https://gitlab.com/acme or https://gitlab.com/acme/platform.`);
      body.namespace_id = namespace.id;
    }
    const repo = await call(`${api}/projects`, { ...options, method: 'POST', body });
    return { cloneUrl: repo.http_url_to_repo, webUrl: repo.web_url, id: String(repo.id), slug };
  }

  // Azure DevOps: a repository lives in a project. The organisation URL names one, or one is
  // created with the repository's name, and a new project already contains a repository of
  // that name — so that is the one used.
  const { base, organisation, prefix } = azureParts(org);
  let { project } = azureParts(org);
  const created = { project: null };
  if (!project) {
    log(`  Azure DevOps: git-org names no project, so creating project "${slug}" (Git, Agile) …`);
    const operation = await call(`${base}${prefix}/_apis/projects?api-version=7.1`, {
      ...options, method: 'POST',
      body: { name: slug, description: description ?? `${name} — a VibeKit project`, visibility: isPrivate ? 'private' : 'public', capabilities: { versioncontrol: { sourceControlType: 'Git' }, processTemplate: { templateTypeId: 'adcc42ab-9882-485e-a3ed-7678f01f66bc' } } },
    });
    await waitForOperation(`${base}${prefix}/_apis/operations/${operation.id}?api-version=7.1`, options);
    project = slug;
    created.project = slug;
    const repo = await call(`${base}${prefix}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(slug)}?api-version=7.1`, options);
    return { cloneUrl: repo.remoteUrl, webUrl: repo.webUrl, id: repo.id, slug, project, organisation, createdProject: slug };
  }
  const repo = await call(`${base}${prefix}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`, { ...options, method: 'POST', body: { name: slug } });
  return { cloneUrl: repo.remoteUrl, webUrl: repo.webUrl, id: repo.id, slug, project, organisation, createdProject: null };
}

async function waitForOperation(url, options, { attempts = 30, delayMs = 2000, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await call(url, options);
    if (state.status === 'succeeded') return state;
    if (state.status === 'failed' || state.status === 'cancelled') throw new ProviderError(`azure-devops: project creation ${state.status}${state.resultMessage ? ` · ${state.resultMessage}` : ''}`);
    await sleep(process.env.VIBEKIT_TEST_FAST ? 0 : delayMs);
  }
  throw new ProviderError('azure-devops: project creation did not finish in time; check the organisation in the browser and run `vibekit new repo` again.');
}

/** Azure DevOps only: a pipeline is an object, not a file. Registered after the YAML has been pushed. */
export async function registerPipeline({ provider, org, token, repo, name, allowPrivate = false, fetchImpl }) {
  if (provider !== 'azure-devops') return null;
  const { base, prefix } = azureParts(org);
  const pipeline = await call(`${base}${prefix}/${encodeURIComponent(repo.project)}/_apis/pipelines?api-version=7.1-preview.1`, {
    token, provider, allowPrivate, fetchImpl, method: 'POST',
    body: { name: `${slugOf(name)}-ci`, folder: '\\', configuration: { type: 'yaml', path: '/azure-pipelines.yml', repository: { id: repo.id, name: repo.slug, type: 'azureReposGit' } } },
  });
  return { id: pipeline.id, url: pipeline._links?.web?.href ?? null };
}

// ---------------------------------------------------------------- the pipeline file

export const PIPELINE_FILES = Object.freeze({ github: '.github/workflows/vibekit.yml', gitlab: '.gitlab-ci.yml', 'azure-devops': 'azure-pipelines.yml' });

/**
 * The stages of delivery/pipeline.spec.md in the provider's dialect: install, lint, build, test
 * from the project's own commands, then `vibekit check --ci` before anything could be packaged.
 * Secrets come from the platform's store; nothing here writes back to the repository.
 */
export function pipelineBody(provider, config = {}) {
  const commands = config.commands ?? {};
  const steps = [
    ['Install', commands.install ?? 'npm ci'],
    ['Lint', commands.lint ?? null],
    ['Build', commands.build ?? null],
    ['Test', commands.test ?? 'npm test'],
  ].filter(([, command]) => command);
  const vibekit = ['Install VibeKit', 'npm install -g "$VIBEKIT_PACKAGE"'];
  const gate = ['VibeKit gate', 'vibekit check --ci && vibekit check --security'];
  const header = `# Generated by VibeKit from ${config.folder ?? 'vibekit'}/delivery/pipeline.spec.md. Edit the spec and rerun \`vibekit new repo --pipeline\`, or edit below the marker.`;

  if (provider === 'github') {
    return [
      header, 'name: vibekit', '',
      'on:', '  push:', '    branches: ["**"]', '  pull_request:', '    branches: [main]', '',
      'env:', `  VIBEKIT_PACKAGE: \${{ vars.VIBEKIT_PACKAGE || '${VIBEKIT_PACKAGE}' }}`, '',
      'jobs:', '  check:', '    runs-on: ubuntu-latest', '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4', '        with:', '          node-version: 20',
      ...[...steps, vibekit, gate].flatMap(([name, command]) => [`      - name: ${name}`, `        run: ${command}`]),
      '', '# --- local: anything below survives a regeneration ---', '',
    ].join('\n');
  }
  if (provider === 'gitlab') {
    return [
      header, 'image: node:20', '',
      'variables:', `  VIBEKIT_PACKAGE: "${VIBEKIT_PACKAGE}"`, '',
      'stages: [check]', '',
      'check:', '  stage: check', '  script:',
      ...[...steps, vibekit, gate].map(([, command]) => `    - ${command}`),
      '  rules:', '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"', '    - if: $CI_COMMIT_BRANCH',
      '', '# --- local: anything below survives a regeneration ---', '',
    ].join('\n');
  }
  return [
    header, 'trigger:', '  branches:', '    include: ["*"]', 'pr:', '  branches:', '    include: [main]', '',
    'pool:', '  vmImage: ubuntu-latest', '',
    'variables:', `  VIBEKIT_PACKAGE: "${VIBEKIT_PACKAGE}"`, '',
    'steps:',
    '  - task: NodeTool@0', '    inputs:', '      versionSpec: "20.x"', '    displayName: Node 20',
    ...[...steps, vibekit, gate].flatMap(([name, command]) => ['  - script: ' + command, `    displayName: ${name}`]),
    '', '# --- local: anything below survives a regeneration ---', '',
  ].join('\n');
}

/** Write the pipeline file; a hand-edited tail below the marker is kept. */
export async function writePipeline(root, provider, config) {
  const path = join(root, PIPELINE_FILES[provider]);
  const marker = '# --- local: anything below survives a regeneration ---';
  let tail = '';
  if (await exists(path)) {
    const { readText } = await import('./fsutil.js');
    const current = (await readText(path)) ?? '';
    const at = current.indexOf(marker);
    if (at >= 0) tail = current.slice(at + marker.length).replace(/^\n/, '');
  }
  const body = pipelineBody(provider, config);
  await writeText(path, tail ? `${body}${tail}` : body);
  return PIPELINE_FILES[provider];
}

// ---------------------------------------------------------------- git

const git = (cwd, args, extra = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...extra }).trim();

/** Point origin at the repository. An existing origin is replaced only when `force` says so. */
export function setOrigin(root, cloneUrl, { force = false } = {}) {
  let current = null;
  try { current = git(root, ['remote', 'get-url', 'origin']); } catch { current = null; }
  if (current && current !== cloneUrl && !force) throw new ProviderError(`origin is already ${current}. Pass --force to point it at ${cloneUrl}.`);
  git(root, current ? ['remote', 'set-url', 'origin', cloneUrl] : ['remote', 'add', 'origin', cloneUrl]);
  return cloneUrl;
}

/** Push main, with the token in one request header and never in the URL, the remote or the log. */
export function push(root, { provider, token, branch = 'main' }) {
  const user = provider === 'github' ? 'x-access-token' : provider === 'gitlab' ? 'oauth2' : '';
  const header = `AUTHORIZATION: Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  let head = null;
  try { head = git(root, ['rev-parse', '--verify', 'HEAD']); } catch { head = null; }
  if (!head) {
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=VibeKit', '-c', 'user.email=vibekit@localhost', 'commit', '-q', '--no-verify', '-m', 'chore: vibekit project']);
  }
  const current = git(root, ['branch', '--show-current']) || branch;
  git(root, ['-c', `http.extraheader=${header}`, 'push', '-u', 'origin', `${current}:${branch}`]);
  return { branch, from: current };
}
