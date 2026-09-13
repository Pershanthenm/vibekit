import { ARCHITECTURES } from '../architectures.js';
import { slugify } from '../features.js';
import { TEST_GLOBS } from '../languages.js';
import { securityRules } from '../security/render.js';
import { GENERATED_NOTICE, architectureBullets, bullets, file, frontMatter, languageRules, markdown } from './shared.js';
import { isMenuSkill } from './menu.js';
import { CURSOR_CONTEXT, SKILLS } from './workflow.js';

// Antigravity reads workspace rules from `.agents/rules` and custom slash commands from
// `.agents/workflows`; the root AGENTS.md it already reads carries the full project context.
// Rules are capped at 12,000 characters each (antigravity.google/docs/rules-workflows).
export const RULE_CHARACTER_LIMIT = 12000;
const RULES_DIR = '.agents/rules';
const WORKFLOWS_DIR = '.agents/workflows';

// The docs describe a rule as "simply a Markdown file" and do not document a frontmatter schema,
// so the scope is stated in prose for the reader and activation is set per rule inside
// Antigravity, rather than invented here. Workflow frontmatter (`description`) is documented.
const applies = (scope) => `**Applies to:** ${scope}`;

function rule(name, scope, body) {
  return file(`${RULES_DIR}/${name}.md`, markdown(GENERATED_NOTICE, applies(scope), body));
}

const WORKFLOW_GATE = bullets([
  'Project context, standards and the full workflow are in `AGENTS.md`. Read it first.',
  'Before editing code, identify the feature in `specs/features/` and confirm its status is `approved`, `planned` or `in-progress`. If there is none, run the `spec-feature` workflow first.',
  'Work one task from `tasks.md` at a time and tick it when lint, typecheck and tests pass.',
  'If the spec is wrong, stop and propose a spec change instead of diverging.',
  'In a parallel lane (a worktree started by `vibekit dispatch`): do only the tasks in your brief, touch only their files, never edit `specs/`, and commit with the task id.',
]);

const SPEC_WRITING = bullets([
  '`specs/project.json` drives every generated file; after editing it run `vibekit sync`.',
  'Specs describe what and why; plans describe how. Keep them separate.',
  'Acceptance criteria use `- [ ] AC-n: Given … when … then …` and must each be testable.',
  'Tasks use `- [ ] T-n [test|impl] <what> (AC-n) — <files>`; add `[P]` only if no files overlap with other open tasks.',
  'Change status with `vibekit status <id> <status>`, never by hand.',
]);

const DOCS_RULE = bullets([
  'Docs describe the code as built; read every file in the `sources` front matter before editing.',
  'Diagrams are Mermaid: architecture flowchart/C4, data model erDiagram, feature sequence diagram, design user flow.',
  'After editing run `vibekit docs stamp <path>`; never edit `stamp`, `body` or `reviewed` by hand. `roadmap.md` is generated.',
]);

const SECURITY_SCOPE = 'auth, config and data-access code (`**/*auth*`, `**/config/**`, `**/*Controller*`, `**/*Repository*`, `**/*.env*`)';
const MEMORY_GATE = '- Memory is shared with Claude Code through agentmemory: search it before planning, and save decisions with their reason.';
const KNOWLEDGE_GATE = '- Before designing, check the OpenContext library (`vibekit context <topic>`) and record cross-project lessons there.';

function testingRule(project) {
  const { testing } = project.standards;
  return bullets([
    `Framework: ${testing.framework}. Name each test after the acceptance criterion it proves.`,
    'Arrange / act / assert; no sleeps, randomness or shared mutable state.',
    'Mock only at architecture boundaries (ports, network, clock).',
    'UI tests cover every visible acceptance criterion and run an accessibility check; the critical path also gets a tagged smoke test.',
    testing.tdd && 'Write the failing test before the implementation.',
  ]);
}

const languageRuleFiles = (project) => languageRules(project).map(({ name, globs, rules }) =>
  rule(`vibekit-${slugify(name)}`, `${name} files (\`${globs}\`)`, bullets(rules)));

const workflowFile = (skill) => file(
  `${WORKFLOWS_DIR}/${skill.name}.md`,
  markdown(frontMatter({ description: JSON.stringify(skill.description) }), GENERATED_NOTICE, skill.body(CURSOR_CONTEXT)),
);

export function antigravityFiles(project) {
  const style = ARCHITECTURES[project.architecture.style];
  const gate = [
    WORKFLOW_GATE,
    project.memory.provider === 'agentmemory' && MEMORY_GATE,
    project.knowledge.provider === 'opencontext' && KNOWLEDGE_GATE,
  ].filter(Boolean).join('\n');

  return [
    rule('vibekit-workflow', 'every task in this workspace (always on)', gate),
    rule(
      'vibekit-architecture',
      'creating modules, moving code between layers or adding dependencies',
      `**${style.label}** — ${style.summary}\n\n${architectureBullets(project)}\n\nSee \`specs/01-architecture.md\` and \`specs/decisions/\`.`,
    ),
    rule('vibekit-specs', 'files under `specs/**`', SPEC_WRITING),
    rule('vibekit-tests', `test files (\`${TEST_GLOBS}\`)`, testingRule(project)),
    project.security.controls.length && rule('vibekit-security', SECURITY_SCOPE, `${bullets(securityRules(project))}\n\nFull baseline: \`specs/security.md\`.`),
    project.docs.enabled && rule('vibekit-docs', `files under \`${project.docs.dir}/**\``, DOCS_RULE),
    ...languageRuleFiles(project),
    ...SKILLS.filter((skill) => isMenuSkill(skill.name)).map(workflowFile),
  ].filter(Boolean);
}
