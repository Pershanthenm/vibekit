import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverInfo } from '../multica.js';
import { userCursorAgentsCurrent, userCursorAgentsDir } from '../commands/cursor-agents.js';
import { marketplaceAddArg, teamPluginsSync } from '../team.js';
import { firstAvailable, httpOk, majorVersion, probe } from './probe.js';

export const PLUGIN_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const MARKETPLACE_DIR = dirname(PLUGIN_DIR.replace(/[\\/]$/, ''));

const UNIX = (command) => ({ macos: command, linux: command, wsl: command });
const status = (ok, detail, extra = {}) => ({ ok, detail, ...extra });
const missing = (what = 'not installed') => status(false, what);
const pluginListed = (name) => {
  const result = probe('claude', ['plugin', 'list']);
  if (!result.found) return missing('Claude Code not installed');
  if (!result.ok) return status(false, 'could not list plugins (check in Claude Code with /plugin)', { unknown: true });
  return result.output.includes(name) ? status(true, 'installed') : missing('plugin not installed');
};

const localVersion = () => {
  try {
    return JSON.parse(readFileSync(join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

const UPDATE_PLUGIN = 'claude plugin marketplace update vibe-check-cli && claude plugin update vibe-check-cli@vibe-check-cli';

function pluginCurrent() {
  const listed = probe('claude', ['plugin', 'list', '--json']);
  if (!listed.found) return missing('Claude Code not installed');
  let entry;
  try {
    entry = JSON.parse(listed.output).find((plugin) => plugin.id === 'vibe-check-cli@vibe-check-cli');
  } catch {
    return pluginListed('vibe-check-cli');
  }
  if (!entry) return missing('plugin not installed');
  if (!entry.enabled) return status(false, 'installed but disabled', { fix: 'enable' });
  const wanted = localVersion();
  if (wanted && entry.version !== wanted) return status(false, `installed ${entry.version}, but your folder has ${wanted}`, { fix: 'update' });
  return status(true, `installed ${entry.version} (run /reload-plugins after installing or updating)`);
}

const usesDocker = (project) => project && (
  project.workflow.engine === 'multica' || project.multica.board || project.security.controls.includes('containers')
  || /docker|testcontainers/i.test(`${project.stack.hosting} ${project.standards.testing.framework}`)
);

export const TOOLS = [
  {
    id: 'node', name: 'Node.js 20+', why: 'runs vibecheck, hooks and MCP shims', needed: () => true,
    check: () => { const version = probe('node').firstLine; return majorVersion(version) >= 20 ? status(true, version) : missing(version ? `${version} is too old` : undefined); },
    install: { macos: 'brew install node', linux: 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && . "$HOME/.nvm/nvm.sh" && nvm install 22', wsl: 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && . "$HOME/.nvm/nvm.sh" && nvm install 22', windows: 'winget install OpenJS.NodeJS.LTS' },
  },
  {
    id: 'git', name: 'Git', why: 'worktrees for parallel lanes, commits, merges', needed: () => true,
    check: () => { const result = probe('git'); return result.ok ? status(true, result.firstLine) : missing(); },
    install: { macos: 'xcode-select --install', linux: 'sudo apt-get install -y git', wsl: 'sudo apt-get install -y git', windows: 'winget install Git.Git' },
  },
  {
    id: 'docker', name: 'Docker', why: 'Multica self-hosting, Testcontainers, container scans', needed: usesDocker,
    check: () => {
      const info = probe('docker', ['info']);
      if (info.ok) return status(true, 'running');
      return probe('docker').ok ? status(false, 'installed but not running — start Docker Desktop (or the docker service)', { fix: 'start' }) : missing();
    },
    install: { macos: 'brew install --cask docker-desktop', linux: 'curl -fsSL https://get.docker.com | sh', wsl: 'Install Docker Desktop on Windows and enable WSL integration', windows: 'winget install Docker.DockerDesktop' },
  },
  {
    id: 'claude', name: 'Claude Code', why: 'the orchestrator', needed: () => true,
    check: () => { const result = probe('claude'); return result.ok ? status(true, result.firstLine) : missing(); },
    install: { ...UNIX('curl -fsSL https://claude.ai/install.sh | bash'), windows: 'winget install Anthropic.ClaudeCode' },
    after: 'Run `claude` once and sign in.',
  },
  {
    id: 'team-marketplaces', name: 'Team plugin marketplaces', why: 'where the plugins your team shares come from', needed: () => teamPluginsSync().length > 0,
    check: () => {
      const listed = probe('claude', ['plugin', 'marketplace', 'list', '--json']);
      if (!listed.found) return missing('Claude Code not installed');
      let names = [];
      try { names = JSON.parse(listed.output).map((entry) => entry.name); } catch { return status(false, 'could not read marketplaces', { unknown: true }); }
      const absent = [...new Set(teamPluginsSync().filter((plugin) => !names.includes(plugin.marketplace)).map((plugin) => plugin.marketplace))];
      return absent.length ? missing(`missing: ${absent.join(', ')}`) : status(true, 'all added');
    },
    get install() {
      const sources = [...new Map(teamPluginsSync().map((plugin) => [plugin.marketplace, plugin.source])).values()];
      const commands = sources.map((source) => `claude plugin marketplace add "${marketplaceAddArg(source)}"`);
      return { ...UNIX(commands.join(' && ')), windows: commands.join('; ') };
    },
  },
  {
    id: 'vibecheck-plugin', name: 'Vibe-check-cli plugin in Claude Code', why: 'hooks, skills and the vibecheck CLI inside Claude Code', needed: () => true,
    check: () => pluginCurrent(),
    install: { ...UNIX(`claude plugin marketplace add "${MARKETPLACE_DIR}" && claude plugin install vibe-check-cli@vibe-check-cli`), windows: `claude plugin marketplace add "${MARKETPLACE_DIR}"; claude plugin install vibe-check-cli@vibe-check-cli` },
    update: UPDATE_PLUGIN,
    enable: 'claude plugin enable vibe-check-cli@vibe-check-cli',
    after: 'Load it into Claude Code: type /reload-plugins in your session (or restart Claude Code; in Cursor, Developer: Reload Window).',
  },
  {
    id: 'vibecheck-cli', name: 'vibecheck command in your terminal', why: 'menus and status outside Claude Code', needed: () => true,
    check: () => { const result = probe('vibecheck', ['version']); return result.ok ? status(true, result.firstLine) : missing(); },
    install: { ...UNIX(`npm install -g "${PLUGIN_DIR}"`), windows: `npm install -g "${PLUGIN_DIR}"` },
  },
  {
    id: 'cursor-agents', name: 'Subagents and team skills in Cursor', why: 'the same subagents and skills for Cursor\'s agent', needed: () => true,
    check: async () => ((await userCursorAgentsCurrent()) ? status(true, `installed in ${userCursorAgentsDir()}`) : missing(`not installed (or outdated) in ${userCursorAgentsDir()}`)),
    install: { ...UNIX(`node "${join(PLUGIN_DIR, 'bin', 'vibecheck')}" cursor-agents`), windows: `node "${join(PLUGIN_DIR, 'bin', 'vibecheck')}" cursor-agents` },
  },
  {
    id: 'cursor-agent', name: 'Cursor CLI (agent)', why: 'headless Cursor agents for parallel lanes', needed: (project) => !project || project.workflow.engine === 'cursor',
    check: () => { const found = firstAvailable(['cursor-agent', 'agent']); return found ? status(true, found.firstLine) : missing(); },
    install: { ...UNIX('curl https://cursor.com/install -fsS | bash'), windows: "irm 'https://cursor.com/install?win32=true' | iex" },
    after: 'Sign in: run `agent` once, or set CURSOR_API_KEY.',
  },
  {
    id: 'agentmemory', name: 'agentmemory server', why: 'shared memory for Claude and Cursor', needed: (project) => !project || project.memory.provider === 'agentmemory',
    check: async (project) => {
      const url = (process.env.AGENTMEMORY_URL || project?.memory.url || 'http://localhost:3111').replace(/\/$/, '');
      if (await httpOk(`${url}/agentmemory/livez`)) return status(true, `running at ${url}`);
      return probe('agentmemory').found && probe('agentmemory').ok ? status(false, `installed but not running at ${url}`, { fix: 'start' }) : missing(`not running at ${url}`);
    },
    install: { ...UNIX('npm install -g @agentmemory/agentmemory@latest'), windows: 'Use WSL2 for agentmemory (native Windows needs a manual iii-engine install)' },
    start: 'agentmemory',
  },
  {
    id: 'agentmemory-plugin', name: 'agentmemory hooks in Claude Code and Cursor', why: 'automatic session capture', needed: (project) => !project || project.memory.provider === 'agentmemory',
    check: () => pluginListed('agentmemory'),
    install: { ...UNIX('claude plugin marketplace add rohitg00/agentmemory && claude plugin install agentmemory@agentmemory && agentmemory connect cursor'), windows: 'claude plugin marketplace add rohitg00/agentmemory; claude plugin install agentmemory@agentmemory' },
  },
  {
    id: 'opencontext', name: 'OpenContext CLI', why: 'your cross-project knowledge library', needed: (project) => !project || project.knowledge.provider === 'opencontext',
    check: () => { const result = probe('oc'); return result.ok ? status(true, result.firstLine) : missing(); },
    install: { ...UNIX(`npm install -g @aicontextlab/cli && cd "${homedir()}" && oc init --tools cursor,claude`), windows: `npm install -g @aicontextlab/cli; cd "${homedir()}"; oc init --tools cursor,claude` },
  },
  {
    id: 'multica', name: 'Multica CLI + local server', why: 'agent board and Multica lanes, self-hosted on this machine', needed: (project) => Boolean(project && (project.workflow.engine === 'multica' || project.multica.board)),
    check: async () => {
      if (!probe('multica', ['version']).ok) return missing();
      const server = await serverInfo();
      if (!server.url || !(await httpOk(`${server.url}/health`, 3000))) return status(false, server.url ? `server at ${server.url} not reachable` : 'no server configured', { fix: 'configure' });
      const daemon = probe('multica', ['daemon', 'status', '--output', 'json']);
      if (!daemon.ok || /not running|stopped|dead|inactive/i.test(daemon.output)) return status(false, `server ok at ${server.url}; daemon not running`, { fix: 'start' });
      return status(true, `${server.local ? 'self-hosted here' : 'remote server'} at ${server.url}, daemon running`, { warn: !server.local });
    },
    configure: 'multica setup self-host',
    interactive: ['configure'],
    install: { macos: 'curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server', linux: 'curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server', wsl: 'curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server', windows: '$env:MULTICA_MODE="with-server"; irm https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.ps1 | iex' },
    start: 'multica daemon start',
    after: 'Open the Multica app it prints (usually http://localhost:3000), create an agent on this machine\'s runtime (Agents → New agent), put its name in multica.agent in specs/project.json, then run: vibecheck multica selftest',
  },
];

export const toolsFor = (project) => TOOLS.filter((tool) => tool.needed(project));
