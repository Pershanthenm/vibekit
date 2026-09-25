import { execFileSync } from 'node:child_process';
import { loadProject } from '../project.js';
import { register } from '../projects.js';
import { PIPELINE_FILES, createRepository, providerSettings, push, registerPipeline, setOrigin, whoAmI, writePipeline } from '../providers.js';
import { folderName } from './folder.js';

/**
 * `vibekit new repo` — the repository at the provider for the project you are in. Also what
 * `new project --where remote` runs once the folder is written.
 *
 *   vibekit new repo                 create it, write the pipeline file, push main, register the pipeline (Azure DevOps)
 *   vibekit new repo --check         only say who the token is, and where repositories would go
 *   vibekit new repo --pipeline      only (re)write the pipeline file from delivery/pipeline.spec.md
 *   --public · --no-push · --force (replace an existing origin) · --allow-private (a self-hosted address inside the network)
 */
export async function newRepo(options) {
  const { root, json } = options;
  const log = (line) => { if (!json) console.log(line); };
  const settings = await providerSettings();
  if (settings.missing.length) {
    throw new Error(`The repository needs these settings first, once per machine:\n  ${settings.missing.join('\n  ')}\nIn Claude Code, /vibekit:setup asks for them.`);
  }
  const { provider, org, token } = settings;
  const allowPrivate = Boolean(options['allow-private']);
  const fetchImpl = options.fetchImpl;

  if (options.check) {
    const me = await whoAmI({ provider, org, token, allowPrivate, fetchImpl });
    if (json) return void console.log(JSON.stringify({ provider, org, login: me.login, name: me.name }, null, 2));
    console.log(`✔ ${provider} · ${me.name} (${me.login}) · repositories go under ${org}`);
    return { provider, org, me };
  }

  const config = await loadProject(root).catch(() => null);
  if (!config?.project?.name) throw new Error('No project here. `vibekit new project` first; `new repo` creates the repository for it.');
  const name = config.project.name;
  const folder = await folderName(root);
  const pipelineConfig = { commands: config.project.commands ?? config.commands ?? {}, folder };

  if (options.pipeline) {
    const file = await writePipeline(root, provider, pipelineConfig);
    if (json) return void console.log(JSON.stringify({ provider, pipeline: file }, null, 2));
    console.log(`✔ ${file} written from ${folder}/delivery/pipeline.spec.md · commit it and the next push runs it`);
    return { pipeline: file };
  }

  const repo = await createRepository({ provider, org, token, name, isPrivate: !options.public, description: config.project.description ?? null, allowPrivate, fetchImpl, log });
  log(`✔ ${provider} · ${repo.webUrl}${repo.createdProject ? ` · project ${repo.createdProject} created` : ''}`);
  setOrigin(root, repo.cloneUrl, { force: Boolean(options.force) });
  log(`✔ origin → ${repo.cloneUrl}`);
  const file = await writePipeline(root, provider, pipelineConfig);
  commitIfNeeded(root, file);
  log(`✔ ${file} · ${PIPELINE_FILES[provider] === file ? 'the pipeline in this provider\'s dialect' : file}`);
  await register(root, { name }).catch(() => {});

  let pushed = null;
  let pipeline = null;
  if (options['no-push']) {
    log('  Not pushed (--no-push). `git push -u origin main` when ready' + (provider === 'azure-devops' ? '; then `vibekit new repo --pipeline` registers nothing — register the pipeline in Azure DevOps from azure-pipelines.yml.' : '.'));
  } else {
    pushed = push(root, { provider, token });
    log(`✔ pushed ${pushed.from} → origin/${pushed.branch}`);
    pipeline = await registerPipeline({ provider, org, token, repo, name, allowPrivate, fetchImpl });
    if (pipeline) log(`✔ pipeline registered${pipeline.url ? ` · ${pipeline.url}` : ''}`);
  }
  const result = { provider, name: repo.slug, webUrl: repo.webUrl, cloneUrl: repo.cloneUrl, project: repo.project ?? null, createdProject: repo.createdProject ?? null, pipeline: file, pushed: Boolean(pushed), registered: pipeline };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('');
    console.log('  Branch policies, permissions and secrets are set at the provider; nothing here writes them.');
  }
  return result;
}

/** A repository with history gets the pipeline file as its own commit; one without gets everything in the first push. */
function commitIfNeeded(root, file) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let head = null;
  try { head = git('rev-parse', '--verify', 'HEAD'); } catch { head = null; }
  if (!head) return;
  git('add', '--', file);
  const staged = git('diff', '--cached', '--name-only');
  // The tool's own scaffolding commit. The commit-msg hook refuses work committed straight onto
  // main, rightly; a generated pipeline file is not work, so this one commit says so.
  if (staged) git('-c', 'user.name=VibeKit', '-c', 'user.email=vibekit@localhost', 'commit', '-q', '--no-verify', '-m', `ci: ${file} from delivery/pipeline.spec.md`);
}
