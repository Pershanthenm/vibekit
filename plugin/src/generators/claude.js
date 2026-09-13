import { ARCHITECTURES } from '../architectures.js';
import { GENERATED_NOTICE, architectureBullets, bullets, file, frontMatter, markdown, standardsBullets } from './shared.js';
import { AGENT_ROLES, genericAgentBody } from './agents.js';
import { PROJECT_CONTEXT, SKILLS } from './workflow.js';

export function renderSkill(skill, context, notice = GENERATED_NOTICE) {
  const meta = frontMatter({
    name: skill.name,
    description: JSON.stringify(skill.description),
    'argument-hint': skill.argumentHint && JSON.stringify(skill.argumentHint),
    'disable-model-invocation': skill.userOnly ? 'true' : undefined,
  });
  return markdown(meta, notice, skill.body(context));
}

function subagents(project) {
  const { name } = project.project;
  const { commands, standards } = project;
  const style = ARCHITECTURES[project.architecture.style];
  const verify = [commands.lint, commands.typecheck, commands.test].filter(Boolean).map((command) => `\`${command}\``).join(', ');

  return [
    {
      name: 'architect',
      description: 'Designs technical plans, task breakdowns and ADRs from approved feature specs. Use for planning or architectural decisions. Never writes application code.',
      tools: 'Read, Grep, Glob, Write, Edit',
      body: markdown(
        `You are the architect for ${name}. Ground truth: \`AGENTS.md\`, \`specs/01-architecture.md\`, \`specs/02-tech-stack.md\`, \`specs/decisions/\`.`,
        `**${style.label}** — ${style.summary}\n\n${architectureBullets(project)}`,
        bullets([
          'Reuse existing modules and patterns before adding new ones; justify every new dependency.',
          'Choose the simplest design that satisfies the acceptance criteria (YAGNI).',
          'Write only inside `specs/`.',
          'Map every acceptance criterion to at least one test in the plan.',
          'Flag anything that contradicts an ADR instead of working around it.',
        ]),
      ),
    },
    {
      name: 'test-engineer',
      description: 'Writes tests from acceptance criteria before implementation. Use for [test] tasks.',
      tools: 'Read, Grep, Glob, Write, Edit, Bash',
      body: markdown(
        `You write tests for ${name} using ${standards.testing.framework}.`,
        bullets([
          'One test per behaviour. Its name starts with the feature number and criterion it proves, e.g. `003:AC-2 rejects assigning a retired laptop` — `vibekit verify` traces criteria to tests by that prefix.',
          'Arrange / act / assert. No logic, sleeps or shared mutable state in tests; deterministic data only.',
          'Test through public interfaces; mock only at architecture boundaries (ports, network, clock).',
          `Run \`${commands.test}\` and confirm new tests fail for the expected reason before handing back.`,
          'Never modify production code.',
        ]),
      ),
    },
    {
      name: 'implementer',
      description: 'Implements exactly one task from a feature tasks.md. Use for [impl] tasks, including parallel [P] tasks.',
      body: markdown(
        `You implement exactly one task for ${name}.`,
        bullets([
          'Read the task, its acceptance criteria, `plan.md` and `AGENTS.md` first.',
          'Before editing a file, check what imports it and update every dependent in the same change.',
          'Make the smallest change that passes the tests. No scope creep or drive-by refactors.',
          `Verify with ${verify}. All must pass.`,
          'Report: files changed, commands run with results, and anything the plan got wrong.',
        ]),
        `Coding standards:\n\n${standardsBullets(project)}`,
      ),
    },
    {
      name: 'reviewer',
      description: 'Read-only reviewer that audits changes against the feature spec, architecture and standards.',
      tools: 'Read, Grep, Glob, Bash',
      body: markdown(
        `You review changes for ${name}. You never edit files.`,
        bullets([
          'Check against the feature\'s `spec.md`, `specs/01-architecture.md`, `specs/03-standards.md`, `specs/04-nfr.md` and every control in `specs/security.md` that the change touches.',
          'Run `vibekit verify <feature> --run`: every acceptance criterion must be traced to a passing test.',
          'Cite file:line for every finding and label it **blocking** or **suggestion**.',
          `Run ${verify} to confirm claims instead of assuming.`,
          'Be specific and brief.',
        ]),
      ),
    },
  ];
}

export const pluginAgents = () => AGENT_ROLES.map((role) => ({ name: role.name, description: role.description, tools: role.tools, body: genericAgentBody(role) }));

export function renderAgent(agent, notice = GENERATED_NOTICE) {
  const meta = frontMatter({ name: agent.name, description: JSON.stringify(agent.description), tools: agent.tools });
  return markdown(meta, notice, agent.body.trim());
}

export function claudeFiles(project) {
  if (project.workflow.skills !== 'project') return [];
  return [
    ...SKILLS.map((skill) => file(`.claude/skills/${skill.name}/SKILL.md`, renderSkill(skill, PROJECT_CONTEXT))),
    ...subagents(project).map((agent) => file(`.claude/agents/${agent.name}.md`, renderAgent(agent))),
  ];
}
