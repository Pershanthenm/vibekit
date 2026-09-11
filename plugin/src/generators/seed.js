import { ARCHITECTURES } from '../architectures.js';
import { EXAMPLE_JSON } from '../example.js';
import { bullets, file, markdown, section } from './shared.js';

const today = () => new Date().toISOString().slice(0, 10);

function renderProduct({ project: meta }) {
  return markdown(
    `# ${meta.name} — Product`,
    section('Vision', meta.description || 'TODO'),
    section('Problem', meta.problem || 'TODO'),
    section('Users', bullets(meta.users) || '- TODO'),
    section('v1 capabilities', '- TODO: capability → feature id'),
    section('Non-goals', '- TODO'),
    section('Success metrics', '- TODO'),
  );
}

function renderArchitecture(project) {
  const style = ARCHITECTURES[project.architecture.style];
  return markdown(
    `# Architecture — ${style.label}`,
    `${style.summary} Hard rules are generated into \`AGENTS.md\` from \`specs/project.json\`; this document explains the shape of the system.`,
    section('Component diagram', ['```mermaid', ...style.diagram, '```'].join('\n')),
    section('Modules', '| Module | Responsibility | Depends on |\n|---|---|---|\n| TODO | | |'),
    section('Data flow', 'TODO: describe the main request/interaction paths end to end.'),
    section(
      'Cross-cutting concerns',
      bullets([
        'Errors: TODO (types, propagation, what users see)',
        'Logging & observability: TODO',
        'Configuration & secrets: environment variables, validated at startup',
        'Persistence & migrations: TODO',
      ]),
    ),
  );
}

function renderFirstAdr(project) {
  const style = ARCHITECTURES[project.architecture.style];
  return markdown(
    `# 0001 — Architecture style: ${style.label}`,
    bullets(['Status: accepted', `Date: ${today()}`]),
    section('Context', project.project.problem || 'TODO'),
    section('Decision', `Use ${style.label}. ${style.summary}`),
    section('Consequences', bullets(style.rules)),
  );
}

const GIT_RULES = ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];

const AGENTMEMORY_MARKETPLACE = { agentmemory: { source: { source: 'github', repo: 'rohitg00/agentmemory' } } };

function pluginSettings(project) {
  const hasMemory = project.memory.provider === 'agentmemory';
  const enabledPlugins = {
    ...(project.workflow.skills === 'plugin' && { 'vibe-check-cli@vibe-check-cli': true }),
    ...(hasMemory && { 'agentmemory@agentmemory': true }),
  };
  return {
    ...(Object.keys(enabledPlugins).length && { enabledPlugins }),
    ...(hasMemory && { extraKnownMarketplaces: AGENTMEMORY_MARKETPLACE }),
  };
}

function renderClaudeSettings(project) {
  const commandRules = Object.values(project.commands).filter(Boolean).map((command) => `Bash(${command}:*)`);
  const settings = {
    permissions: {
      allow: [...new Set(['Bash(vibecheck:*)', ...GIT_RULES, ...commandRules])],
      deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)'],
    },
    ...pluginSettings(project),
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function renderCursorWorktrees(project) {
  const setup = [project.commands.install].filter(Boolean);
  return `${JSON.stringify({ 'setup-worktree': setup }, null, 2)}\n`;
}

export function seedFiles(project) {
  return [
    file('specs/00-product.md', renderProduct(project)),
    file('specs/01-architecture.md', renderArchitecture(project)),
    file('specs/decisions/0001-architecture-style.md', renderFirstAdr(project)),
    file('specs/features/.gitkeep', ''),
    file('.claude/settings.json', renderClaudeSettings(project)),
    file('.cursor/worktrees.json', renderCursorWorktrees(project)),
    project.workflow.skills === 'project' && file('.claude/skills/new-project/project.example.json', EXAMPLE_JSON),
  ].filter(Boolean);
}
