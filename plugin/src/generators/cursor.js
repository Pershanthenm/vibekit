import { ARCHITECTURES } from '../architectures.js';
import { slugify } from '../features.js';
import { TEST_GLOBS } from '../languages.js';
import { securityRules } from '../security/render.js';
import { GENERATED_NOTICE, architectureBullets, bullets, file, frontMatter, languageRules, markdown } from './shared.js';
import { cursorAgentFiles } from './agents.js';
import { isMenuSkill } from './menu.js';
import { CURSOR_CONTEXT, SKILLS } from './workflow.js';

function rule(name, { description, globs, alwaysApply = false }, body) {
  const meta = frontMatter({ description: JSON.stringify(description), globs, alwaysApply });
  return file(`.cursor/rules/${name}.mdc`, markdown(meta, GENERATED_NOTICE, body));
}

const WORKFLOW_GATE = bullets([
  'Project context, standards and the full workflow are in `AGENTS.md`.',
  'Before editing code, identify the feature in `specs/features/` and confirm its status is `approved`, `planned` or `in-progress`. If there is none, run the /spec-feature command first.',
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

function languageRuleFiles(project) {
  return languageRules(project).map(({ name, globs, rules }) =>
    rule(`vibekit-${slugify(name)}`, { description: `${name} conventions`, globs }, bullets(rules)),
  );
}

const SECURITY_GLOBS = '**/*auth*/**,**/*Auth*,**/*security*,**/*Security*,**/*.env*,**/appsettings*.json,**/config/**,**/Program.cs,**/middleware/**,**/*Repository*,**/*Controller*';

const DOCS_RULE = bullets([
  'Docs describe the code as built; read every file in the `sources` front matter before editing.',
  'Diagrams are Mermaid: architecture flowchart/C4, data model erDiagram, feature sequence diagram, design user flow.',
  'After editing run `vibekit docs stamp <path>`; never edit `stamp`, `body` or `reviewed` by hand. `roadmap.md` is generated.',
]);
const KNOWLEDGE_GATE = '- Before designing, check the OpenContext library (/opencontext-search or `vibekit context <topic>`); record cross-project lessons with /opencontext-iterate.';
const MEMORY_GATE = '- Memory is shared with Claude Code through agentmemory: search it (`memory_smart_search`) before planning, save decisions with their reason (`memory_save`).';

export function cursorFiles(project) {
  const style = ARCHITECTURES[project.architecture.style];
  const gate = [
    WORKFLOW_GATE,
    project.memory.provider === 'agentmemory' && MEMORY_GATE,
    project.knowledge.provider === 'opencontext' && KNOWLEDGE_GATE,
  ].filter(Boolean).join('\n');
  return [
    rule('vibekit-workflow', { description: 'Spec-driven workflow gate', alwaysApply: true }, gate),
    rule(
      'vibekit-architecture',
      { description: 'Architecture boundaries. Apply when creating modules, moving code between layers or adding dependencies.' },
      `**${style.label}** — ${style.summary}\n\n${architectureBullets(project)}\n\nSee \`specs/01-architecture.md\` and \`specs/decisions/\`.`,
    ),
    rule('vibekit-specs', { description: 'How to write specs, plans and tasks', globs: 'specs/**' }, SPEC_WRITING),
    rule('vibekit-tests', { description: 'Testing conventions', globs: TEST_GLOBS }, testingRule(project)),
    project.security.controls.length && rule('vibekit-security', { description: 'Security baseline for auth, config and data access code', globs: SECURITY_GLOBS }, `${bullets(securityRules(project))}\n\nFull baseline: \`specs/security.md\`.`),
    project.docs.enabled && rule('vibekit-docs', { description: 'Living documentation and diagrams', globs: `${project.docs.dir}/**` }, DOCS_RULE),
    ...languageRuleFiles(project),
    ...SKILLS.filter((skill) => isMenuSkill(skill.name))
      .map((skill) => file(`.cursor/commands/${skill.name}.md`, markdown(GENERATED_NOTICE, skill.body(CURSOR_CONTEXT)))),
    ...cursorAgentFiles(),
  ].filter(Boolean);
}
