import { ARCHITECTURES } from '../architectures.js';
import { renderSecurityBody, securityRules } from '../security/render.js';
import { agentRolesSection } from './agents.js';
import { SKILLS, contextFor } from './workflow.js';
import {
  GENERATED_NOTICE,
  architectureBullets,
  bullets,
  commandBullets,
  file,
  languageBullets,
  markdown,
  nfrBullets,
  section,
  stackTable,
  standardsBullets,
} from './shared.js';

export const WORKFLOW = [
  '1. `specs/project.json` is the source of truth for stack, architecture and standards. Feature specs live in `specs/features/<id>/`.',
  '2. No production code without a feature spec whose status is `approved` (or later). If none exists, write the spec first.',
  '3. Per feature: spec (`spec.md`) → plan (`plan.md`) → tasks (`tasks.md`) → implement → review (`review.md`).',
  '4. Change status only with `vibecheck status <id> <status>`; it refuses transitions the files don\'t support.',
  '5. Implement one task at a time, keep the diff scoped to it, then tick it in `tasks.md`. Tick an acceptance criterion once a passing test proves it.',
  '6. Tasks tagged `[P]` share no files with other open tasks. A ready block of them runs in parallel via `vibecheck dispatch` (one git worktree + agent per lane). Lanes only touch their own files, never edit `specs/`, and commit with the task id; the orchestrator merges and ticks.',
  '7. If the spec or plan is wrong, stop and propose a change. Never silently diverge.',
  '8. Changing stack, architecture or a cross-cutting pattern requires an ADR in `specs/decisions/`.',
  '9. Done = every acceptance criterion checked and traced to a test, the test, smoke and UI suites pass on a clean commit (`vibecheck verify <id> --run` records this as evidence), docs fresh, `vibecheck check` passes. With a Multica board, the user marks features done on Multica; Vibe-check-cli verifies and records it.',
].join('\n');

export const EVIDENCE = [
  '1. Every factual claim about this codebase must be checked before it is written down. Read the file, run the command, or say you have not.',
  '2. Cite where a claim comes from: `path/to/file.ts:42`, a command and its output, or the spec section. A reviewer must be able to reach the same conclusion without rerunning your reasoning.',
  '3. Never invent an API, package, function, flag, config key or version. Before using one, confirm it exists in the manifest, the lockfile, the installed source or the official docs. A plausible name is not evidence.',
  '4. Unknown is a valid answer, and always better than a guess. Write `TODO(unknown): <question>` in the spec or plan and raise it, rather than filling the gap with something that reads well.',
  '5. Do not invent commands. Use the ones under "Commands"; if the one you need is absent, say so instead of assuming a conventional name.',
  '6. Never claim a test, build or check passed unless you ran it and saw it pass. Report failures with the actual output. "Should work" is not a result.',
  '7. Do not fabricate test fixtures that encode assumed behaviour, then assert against them. A test that passes because both sides share your assumption proves nothing.',
  '8. Acceptance criteria come from the spec. Do not soften, drop or add one to make an implementation fit; change the spec and say why.',
  '9. When the spec, the code and your expectation disagree, the code is the evidence. Report the conflict rather than resolving it silently.',
  '10. Say plainly what you did not do: parts skipped, checks not run, criteria not met. Unreported gaps are the costliest kind.',
].join('\n');

export const STANDARDS = [
  'Project standards live in `standards/`, one topic per file, grouped into domain folders and indexed by `standards/index.yml`.',
  'Read the index first, then open only the standards that match the task. Loading the whole library wastes context and buries the rules that matter.',
  '`vibecheck standards inject "<task>"` lists the relevant ones; add `--paths a,b` to match standards scoped by globs to the files you are touching.',
  'If nothing matches, say so. Do not invent a convention and do not assume one from another project.',
  'After adding or editing a standard, run `vibecheck standards index` so the index stays true.',
].join('\n');

const REVIEW_CHECKLIST = bullets([
  'Every acceptance criterion has a test that fails without the change.',
  'No dependency points the wrong way across architecture boundaries.',
  'Names reveal intent; no dead code, debug output or commented-out code.',
  'Errors are handled and surfaced to users meaningfully.',
  'Inputs validated at boundaries; authorisation checked server-side; no secrets committed.',
  'UI covers loading, empty, error and success states and meets the accessibility target.',
  'Specs, plan and tasks reflect what was actually built.',
]);

const MEMORY_RULES = bullets([
  'Shared memory runs on agentmemory (local server, same store for Claude Code and Cursor).',
  'Before planning or a non-trivial change, recall related decisions: `vibecheck memory recall "<topic>"` or the `memory_smart_search` tool.',
  'Save what the code can\'t tell the next agent — a decision and its reason, a gotcha, a convention: `vibecheck memory remember "<fact>"` or `memory_save`.',
  'Specs, plans and ADRs stay the source of truth. If memory contradicts them, trust the files and flag the conflict.',
  'Never store secrets or personal data in memory.',
]);

const knowledgeRules = (project) => bullets([
  'Your curated, cross-project library lives in OpenContext (`~/.opencontext/contexts`), shared by Claude Code and Cursor.',
  `Starting a project or a big design decision: read your playbook first (\`vibecheck knowledge manifest\`, folder \`${project.knowledge.playbook}\`).`,
  'Before planning: `vibecheck knowledge search "<topic>"` (or the OpenContext MCP tools) for API contracts, pitfalls and earlier decisions.',
  'Lessons that apply beyond this project belong in the playbook (/opencontext-iterate). This project\'s finished features, ADRs and architecture are published automatically.',
]);

const docsRules = (project) => bullets([
  `\`${project.docs.dir}/\` describes how the system works **now**; specs describe intent. Diagrams are Mermaid, drawn from the code.`,
  'Every document declares its `sources` in front matter. When a source changes, the document is stale until it is updated and stamped (`vibecheck docs stamp <path>`).',
  'Re-architecting (specs, ADRs, `project.json`) makes architecture docs stale immediately: update them in the same change. Use the re-architect workflow rather than quiet edits.',
  'A feature is done only when its feature doc (and design doc, when it has UI) plus every touched diagram is fresh.',
  `\`${project.docs.dir}/roadmap.md\` is generated from feature statuses — don't edit it.`,
]);

const hasKnowledge = (project) => project.knowledge.provider === 'opencontext';

const testingRules = (project) => bullets([
  `Unit and integration: \`${project.commands.test}\`.`,
  project.commands.smoke && `Smoke: \`${project.commands.smoke}\` — a few fast checks of the critical paths against a real build; tag them (\`@smoke\`, \`Category=Smoke\`, \`pytest.mark.smoke\`).`,
  project.commands.ui && `UI: \`${project.commands.ui}\` — every acceptance criterion a user can see has a UI test (browser, mobile or desktop) that includes an accessibility check.`,
  'Every test name starts with the criterion it proves, e.g. `003:AC-2 rejects a retired laptop`.',
  'A feature is only done with a passing test, smoke and UI run recorded for the current commit: `vibecheck verify <id> --run`.',
]);

function renderAgentsMd(project) {
  const { project: meta } = project;
  const style = ARCHITECTURES[project.architecture.style];
  const users = meta.users.length ? `Primary users: ${meta.users.join(', ')}.` : '';
  return markdown(
    GENERATED_NOTICE,
    `# ${meta.name}`,
    meta.description,
    section('Why this exists', [meta.problem, users].filter(Boolean).join('\n\n')),
    section('Targets', project.targets.join(', ')),
    section('Tech stack', stackTable(project.stack)),
    section('Commands', `Run lint, typecheck and test before calling any task done.\n\n${commandBullets(project.commands)}`),
    section(
      `Architecture — ${style.label}`,
      `${style.summary}\n\n${architectureBullets(project)}\n\nDetails: \`specs/01-architecture.md\` · Decisions: \`specs/decisions/\``,
    ),
    section('Coding standards', `${standardsBullets(project)}\n\nReview checklist: \`specs/03-standards.md\``),
    section('Testing: unit, smoke and UI', testingRules(project)),
    section('Language rules', languageBullets(project)),
    section('Non-functional requirements', nfrBullets(project.nfr)),
    section('Spec-driven workflow (mandatory)', WORKFLOW),
    section('Evidence over guesswork (mandatory)', EVIDENCE),
    section('Standards', STANDARDS),
    section('Agent roles', agentRolesSection()),
    project.memory.provider === 'agentmemory' && section('Memory', MEMORY_RULES),
    project.security.controls.length && section('Security baseline (mandatory)', `${bullets(securityRules(project))}\n\nDetails, implementation per control and accepted risks: \`specs/security.md\`.`),
    project.docs.enabled && section('Living documentation', docsRules(project)),
    hasKnowledge(project) && section('Knowledge library', knowledgeRules(project)),
  );
}

function renderClaudeMd(project) {
  const { cmd } = contextFor(project);
  const skills = SKILLS.map(({ name }) => `\`${cmd(name)}\``).join(', ');
  return markdown(
    GENERATED_NOTICE,
    '@AGENTS.md',
    section(
      'Claude Code',
      bullets([
        `You are the orchestrator. ${cmd('run')} advances the workflow to the next human gate.`,
        `Workflow skills: ${skills}.`,
        project.workflow.enforce && 'Hooks enforce the workflow: code edits need a feature in progress, generated files are read-only, and finishing a turn runs `vibecheck check`.',
        project.memory.provider === 'agentmemory' && 'Memory: the agentmemory plugin captures sessions; vibecheck adds spec approvals, finished features and lane merges, and injects memories relevant to the next feature at session start.',
        hasKnowledge(project) && 'Knowledge: `vibecheck context <feature|topic>` merges agentmemory and OpenContext into one brief; session start and every lane brief include it automatically.',
        project.workflow.skills === 'project'
          ? 'Subagents in `.claude/agents/`: **architect** (plans, ADRs), **test-engineer** (tests from acceptance criteria), **implementer** (one task at a time), **reviewer** (read-only audit).'
          : 'Subagents from the Vibe-check-cli plugin: **architect** (plans, ADRs), **test-engineer** (tests from acceptance criteria), **implementer** (one task at a time), **reviewer** (read-only audit).',
        'Keep the main thread for coordination; delegate independent `[P]` tasks to parallel implementer subagents.',
      ]),
    ),
  );
}

function renderTechStack(project) {
  return markdown(
    GENERATED_NOTICE,
    '# Tech stack',
    `Targets: ${project.targets.join(', ')}`,
    stackTable(project.stack),
    section('Changing the stack', 'Add an ADR in `specs/decisions/` explaining why, update `specs/project.json`, then run `vibecheck sync`.'),
  );
}

function renderStandards(project) {
  return markdown(
    GENERATED_NOTICE,
    '# Coding standards',
    section('General', standardsBullets(project)),
    section('Language rules', languageBullets(project)),
    section('Commands', commandBullets(project.commands)),
    section('Review checklist', REVIEW_CHECKLIST),
  );
}

function renderNfr(project) {
  return markdown(
    GENERATED_NOTICE,
    '# Non-functional requirements',
    nfrBullets(project.nfr),
    'Every feature plan states how it meets these; the reviewer checks them.',
  );
}

export function contextFiles(project) {
  return [
    file('AGENTS.md', renderAgentsMd(project)),
    file('CLAUDE.md', renderClaudeMd(project)),
    file('specs/02-tech-stack.md', renderTechStack(project)),
    file('specs/03-standards.md', renderStandards(project)),
    file('specs/04-nfr.md', renderNfr(project)),
    project.security.controls.length && file('specs/security.md', markdown(GENERATED_NOTICE, ...renderSecurityBody(project))),
  ].filter(Boolean);
}
