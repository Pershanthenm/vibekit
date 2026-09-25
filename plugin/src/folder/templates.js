import { ARCHITECTURES } from '../architectures.js';
import { FOLDER_FILES, Kind, POINTERS, filesFor } from './layout.js';

/**
 * The content of every generated file, and the starter body of every authored one.
 *
 * Two rules hold this module together. Generated output is a pure function of the config, so a
 * second run produces byte-identical bytes — the cheapest correctness test the format has, and it
 * catches a whole class of ordering bugs. And a starter body says what *belongs* in the file
 * rather than guessing at its contents: the moment the generator invents a rule, the header
 * protecting it stops meaning "a human decided this".
 */

const list = (items) => items.map((item) => `- ${item}`).join('\n');
const table = (header, rows) => [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

/** Where code goes, per architecture. If two architectures produce the same map, the answer never arrived. */
const ARCHITECTURE_LAYOUTS = {
  clean: [
    'src/Domain/            entities and business rules · imports nothing',
    'src/Application/       use cases and the ports they depend on',
    'src/Infrastructure/    database, HTTP clients, file system · implements ports',
    'src/Web/               controllers, pages, view models',
  ],
  hexagonal: [
    'src/core/              the model and its rules · imports no adapter',
    'src/ports/             interfaces the core needs or offers',
    'src/adapters/http/     inbound: routes and request mapping',
    'src/adapters/db/       outbound: persistence',
  ],
  'modular-monolith': [
    'src/modules/<name>/    one folder per business capability; owns its own data',
    'src/modules/<name>/api the public surface other modules may call',
    'src/kernel/            shared types and utilities · no business rules',
    'src/host/              the API or UI shell that wires modules together',
  ],
  layered: [
    'src/presentation/      controllers, pages, view models',
    'src/services/          application services · the only caller of repositories',
    'src/data/              repositories and persistence models',
  ],
  microservices: [
    'services/<name>/       one deployable per service; owns its own database',
    'services/<name>/api    the contract other services call',
    'contracts/             shared schemas and event definitions · versioned',
  ],
  'feature-sliced': [
    'src/features/<name>/   everything one feature needs: UI, state, API calls',
    'src/entities/<name>/   the shared model a feature works with',
    'src/shared/            primitives with no feature knowledge',
  ],
};

const architectureOf = (config) => {
  const key = config.architecture && ARCHITECTURES[config.architecture] ? config.architecture : 'clean';
  return { key, meta: ARCHITECTURES[key], layout: ARCHITECTURE_LAYOUTS[key] ?? ARCHITECTURE_LAYOUTS.clean };
};

// The five a language preset fills in, and `characterise`, which only a migration sets: the suite
// `verify` holds a slice to (CLI Spec). A preset never names it, so it appears only when a person did.
const COMMAND_NAMES = ['install', 'build', 'test', 'lint', 'format', 'characterise'];

const commandRows = (commands = {}) => {
  const names = COMMAND_NAMES.filter((name) => commands[name]);
  // Two spaces at least between name and command: that gap is how map.md's reader splits the line.
  const width = Math.max(9, ...names.map((name) => name.length + 1));
  return names.length ? names.map((name) => `${name.padEnd(width)} ${commands[name]}`).join('\n') : 'No commands recorded. `vibekit check` fails until these are real.';
};

// ---------------------------------------------------------------- pointer files

/**
 * §4. Under 150 tokens and carrying no rules of its own. Three tools read three different
 * filenames; duplicating one short body beats maintaining three rulebooks, and beats a symlink,
 * which breaks on Windows checkouts and in some CI runners.
 *
 * status.md is first in the load order on purpose: it is what tells a session which stage applies
 * and which prompt to run, so a session resumes from files rather than from a chat it never had.
 */
export function pointerBody(config, folder) {
  const summary = (config.description ?? 'What this is, and the rules for changing it.').trim();
  // 80, not 90: at 90 a wordy description lands the whole file on 151 tokens against a 150
  // budget. The full description is two files away in context.md; this line only has to identify
  // the project to someone who just opened the repo.
  const described = summary.length > 80 ? `${summary.slice(0, 77).trimEnd()}…` : summary;
  return [
    `# ${config.name}`,
    '',
    described,
    '',
    `Read \`${folder}/\` in this order before your first edit:`,
    '',
    '1. `workflow/status.md` — which stage, which prompt',
    '2. `standards/` in full',
    '3. `product/context.md`, `glossary.md`, `map.md`',
    '4. Your one requirement, and only the entities it names',
    '5. `skills/index.yml`, `memory/index.md` — a body only on a match',
    '',
    'Never edit a file whose first line says it is generated.',
    'Missing something? Write an ask in `workflow/asks/` and stop. Do not invent it.',
    '',
  ].join('\n');
}

export function gitattributesBody(folder, delivery) {
  const generated = [
    ...POINTERS.filter((file) => file.kind === Kind.Generated && file.path !== '.gitattributes').map((file) => file.path),
    ...filesFor(delivery).filter((file) => file.kind === Kind.Generated && !file.glob).map((file) => `${folder}/${file.path}`),
  ];
  return [
    '# Collapses generated files in pull request diffs, so a review shows what a human changed.',
    ...generated.map((path) => `${path} linguist-generated=true`),
    '',
    '# Never collapsed: what an agent decided to remember, ask and be told is the review.',
    `${folder}/memory/** -linguist-generated`,
    `${folder}/workflow/asks/** -linguist-generated`,
    `${folder}/workflow/answers/** -linguist-generated`,
    '',
  ].join('\n');
}

export const envExampleBody = (config) => [
  '# Names only. A value here is a secret in git forever.',
  '# Values come from the platform secret store at deploy time, and from your own .env locally.',
  '',
  ...(config.secrets ?? ['DATABASE_URL', 'AUTH_ISSUER', 'AUTH_CLIENT_ID']).map((name) => `${name}=`),
  '',
].join('\n');

export const claudeCommandBody = (folder) => [
  '---',
  'description: Do whatever VibeKit says comes next',
  '---',
  '',
  `Run \`vibekit run\`. It reads the gate, regenerates \`${folder}/workflow/status.md\`, and prints the stage prompt to run.`,
  '',
  'Then open that prompt file and follow it exactly. Load only what its `loads:` manifest names.',
  '',
].join('\n');

export const readmeBody = (config, folder) => [
  `# ${folder}/`,
  '',
  `Everything an agent and a person need to know about **${config.name}**, in plain Markdown, in git.`,
  '',
  '**Read in this order:** `profile.md` (where this came from) → `workflow/status.md` (where we are) → the area you are working in.',
  '',
  table(['Area', 'What is in it'], [
    ['`standards/`', 'What agents may and may not do. Always loaded.'],
    ['`product/`', 'What this app is. Scoped per task.'],
    ['`skills/`', 'What an agent can look up. Indexed, fetched on a trigger.'],
    ['`agents/`', 'Roles: a load set plus a write scope. Who may approve what.'],
    ['`workflow/`', 'The stage prompts, the asks inbox, the gates.'],
    ['`memory/`', 'What agents learned here that was not written down.'],
    ['`delivery/`', 'CI intent, environments, observability.'],
  ]),
  '',
  'A file whose first line says it is generated is rewritten on every run — edit the thing it came from. Everything else is yours and is never overwritten.',
  '',
  'Delete this folder and the repository still builds. That is the point.',
  '',
].join('\n');

// ---------------------------------------------------------------- generated folder files

export const abstractBody = (area, config, counts = {}) => {
  const lines = {
    product: `What ${config.name} is: ${(config.description ?? 'see context.md').trim()} Entities, requirements, sources and design live here. Read context.md, glossary.md and map.md always; read an entity section only when your requirement names it.`,
    skills: `${counts.skills ?? 0} skill(s) an agent can look up. The index is always loaded; a body is fetched only when a trigger word matches the task. Patterns are worked examples to copy from; procedures are how this team does a thing.`,
    memory: `${counts.memories ?? 0} memory(ies) about this repo: gotchas, conventions nobody wrote down, decisions made mid-task. The index is always loaded; a body loads only when its topic matches. A memory is a hint — guardrails win on conflict.`,
  };
  return `${lines[area]}\n`;
};

/**
 * §5. Only style a formatter cannot enforce. The test: if it could be a lint rule it belongs in
 * .editorconfig, not here — a rule stated in two places disagrees eventually, and the one the
 * tool reads is the one that wins.
 */
export function codeStyleBody(config) {
  const style = config.style ?? {};
  return [
    '# Code style', '',
    `Formatting is enforced by ${style.formatter ?? 'the project formatter'}; run it rather than hand-formatting. Only what it cannot check is written here.`,
    '', '## Naming', '',
    list([
      `Files: ${style.fileNaming ?? 'match the primary export'}`,
      `Tests: name the behaviour and the criterion it proves, ending in the AC id`,
      'A name says what a thing is for, not what type it is.',
    ]),
    '', '## Placement', '',
    list([
      'A new file goes where map.md says that kind of code goes.',
      'A file with no home is a sign the architecture needs a decision, not a new folder.',
    ]),
    '', '## Comments', '',
    list([
      'Explain why, never what. The code already says what.',
      'A comment that restates the line above it is deleted, not updated.',
    ]),
    '',
  ].join('\n');
}

/** §5, §52 — OWASP-aligned rules for the stack, always loaded, budget 300 tokens. */
export function securityBody(config) {
  const classes = (config.entities ?? []).filter((entity) => ['personal', 'financial', 'secret'].includes(entity.class));
  return [
    '# Security rules', '',
    '## Input and output', '',
    list([
      'Validate at the boundary, against an allow-list, before anything else runs.',
      'Parameterise every query. A query built by string concatenation is a finding, not a style note.',
      'Encode on output for the context it lands in.',
    ]),
    '', '## Authorisation', '',
    list([
      'Every endpoint declares its policy. Absent means denied.',
      'Check the caller may access **that record**, not just that type of record.',
      'Authorisation is checked server-side, always, whatever the UI showed.',
    ]),
    '', '## Secrets', '',
    list([
      'Never in the repository. Names live in .env.example and environments.md; values come from the platform store.',
      'A missing required secret fails startup loudly rather than defaulting.',
    ]),
    '', '## Logging classified data', '',
    list([
      'Never log a `secret` field.',
      'Log `personal` and `financial` fields by id only.',
      'Log every auth decision with actor, action, entity id and outcome.',
      classes.length ? `Classified here: ${classes.map((entity) => `${entity.name} (${entity.class})`).join(', ')}.` : 'No entity is classified above `internal` yet.',
    ]),
    '',
  ].join('\n');
}

export function mapBody(config, folder) {
  const { meta, layout } = architectureOf(config);
  const stack = Object.entries(config.stack ?? {}).filter(([, value]) => value).map(([key, value]) => `${key.padEnd(9)} ${value}`);
  return [
    '# Map', '',
    `Architecture: **${meta.label}**. ${meta.summary}`,
    '', '## Stack', '', '```', stack.length ? stack.join('\n') : 'No stack recorded.', '```',
    '', '## Where code goes', '', '```', layout.join('\n'),
    'tests/unit/           per class or module        tests/integration/  real dependencies',
    'tests/contract/       endpoint shapes pinned     tests/smoke/        health · db · auth, <60s',
    'tests/invariants/     property tests             tests/access/       one per access.md cell',
    'tests/fixtures/       one instance per entity · generated', '```',
    '', '## Rules this architecture imposes', '', list(meta.rules),
    '', '## Commands', '', 'These are real and must run.', '', '```', commandRows(config.commands), '```',
    '', '## Generated files', '',
    `CI is written by an agent from \`${folder}/delivery/pipeline.spec.md\`${config.ciPath ? ` into \`${config.ciPath}\`` : ''}.`,
    '',
  ].join('\n');
}

/**
 * §6. The closed vocabulary. The instruction at its head is the one that matters most in the
 * whole folder: without it, an agent short of a field name invents one, and an invented field is
 * a migration, a bug and an argument.
 */
export function entitiesBody(config) {
  const entities = config.entities ?? [];
  const body = entities.length
    ? entities.map((entity) => [
      `## ${entity.name}`, '',
      `class: ${entity.class ?? 'internal'}`, '',
      entity.description ? `${entity.description}\n` : '',
      ...(entity.fields ?? []).map((field) => `- \`${field.name}\` ${field.type}${field.class ? ` · ${field.class}` : ''}${field.notes ? ` — ${field.notes}` : ''}`),
      ...(entity.relations ?? []).map((relation) => `- ${relation}`),
      '',
    ].filter((part) => part !== '').join('\n')).join('\n')
    : 'No entities recorded yet. An agent that needs one must propose it.';

  return [
    '# Entities', '',
    'These are the only valid entity and field names. If you need one that is not here, stop and propose it. Do not invent one.',
    '',
    'Every entity carries a `class`: public · internal · personal · financial · secret. The security note on each requirement, the trust boundaries on the plan and the logging rules all derive from it.',
    '',
    body,
  ].join('\n');
}

export function requirementsIndexBody(requirements = []) {
  const rows = requirements.length
    ? requirements.map((entry) => [entry.id, entry.title, entry.size ?? '—', entry.status])
    : [['—', 'none yet', '—', '—']];
  return [
    '# Requirements', '',
    'The board. A requirement is the unit of work; `status` is the only state that moves.',
    '',
    table(['id', 'title', 'size', 'status'], rows),
    '',
    'Only `ready` requirements are offered to agents. Only a human sets `done`.',
    '',
  ].join('\n');
}

/**
 * §31 — id, title, version, date and status per source, plus whether it was redacted.
 *
 * One renderer, used by the generator and by `vibekit ingest`. Two would drift, and this file is
 * always loaded, so a disagreement about it would reach every task.
 */
export const sourcesIndexBody = (sources = []) => [
  '# Sources', '',
  'What the business asked for. Every requirement cites a section here.',
  '',
  sources.length
    ? table(['Id', 'Title', 'Version', 'Date', 'Sections', 'Redacted'], sources.map((source) => [
      source.id,
      source.title ?? '',
      source.version ?? '1',
      source.date ?? '',
      String(source.sections ?? 0),
      source.redacted === false ? '**no**' : 'yes',
    ]))
    : 'No sources yet. Add one with `vibekit ingest <file>`.',
  '',
  sources.some((source) => source.redacted === false)
    ? 'A source marked **no** went in unredacted. `vibekit check --ci` warns on it, because the folder is in git forever.'
    : '',
  '',
].filter((line) => line !== undefined).join('\n');

export const tokensBody = (config) => [
  '# Design tokens', '',
  'Colours are named by **role**, never by hue, so a rebrand is one file.',
  '', '## Colour', '',
  list([
    `surface / surface-raised / surface-sunk`,
    'text / text-muted / text-inverse',
    `accent — ${config.design?.brand ?? 'TODO: the brand colour'}`,
    'success / warning / danger',
    'border / border-strong',
  ]),
  '', '## Scale', '',
  list([
    'Type: 12 · 14 · 16 · 20 · 24 · 32 · 40',
    'Spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48',
    'Radius: 4 · 8 · 12 · full',
    `Theme: ${config.design?.theme ?? 'light and dark'}`,
    `Density: ${config.design?.density ?? 'comfortable'}`,
  ]),
  '',
].join('\n');

/**
 * §7. Indexed, never injected. Forty skills injected in full cost about 7,200 tokens; forty
 * indexed cost about 800. That difference is whether the folder fits in every task or crowds out
 * the one it was meant to serve.
 */
export function skillsIndexBody(skills = []) {
  // Nothing but the header when there are none: a placeholder sentence costs real tokens on every
  // task to say what the empty file already says.
  if (!skills.length) return '';
  return `${skills.map((skill) => [
    `- name: ${skill.name}`,
    `  triggers: [${(skill.triggers ?? []).join(', ')}]`,
    `  path: ${skill.path ?? `lib/${skill.name}.md`}`,
  ].join('\n')).join('\n')}\n`;
}

export function memoryIndexBody(memories = []) {
  if (!memories.length) return '# No memories yet. Agents leave session notes; `vibekit distil` proposes the keepers.\n';
  return [
    '# Memory index', '',
    table(['id', 'kind', 'topic', 'learned'], memories.map((memory) => [memory.id, memory.kind, (memory.topic ?? []).join(' '), memory.learned ?? ''])),
    '',
  ].join('\n');
}

export function pipelineSpecBody(config) {
  const delivery = config.delivery ?? {};
  const commands = config.commands ?? {};
  const stages = [
    ['install', commands.install ?? 'restore dependencies from lockfile', 'cache: yes'],
    ['lint', commands.lint ?? 'run the formatter in check mode', 'fail: yes'],
    ['build', commands.build ?? 'build the project', 'fail: yes'],
    ['test', commands.test ?? 'run the test suite', 'fail: yes'],
    ['sast', 'static analysis on the diff', 'fail: on high'],
    ['deps', 'vibekit check --deps', 'fail: yes'],
    ['vibekit', 'vibekit check --ci && vibekit check --security', 'fail: yes'],
  ];
  if (config.deliveryMode === 'full') {
    stages.push(['scan', 'container image scan', 'fail: on critical'], ['sbom', 'generate CycloneDX SBOM', 'on: release'], ['package', delivery.package ?? 'build and tag with the commit sha', 'on: main only']);
  }
  return [
    '# Pipeline', '',
    'VibeKit does not generate CI YAML. This is the intent; an agent writes the dialect for your platform from it.',
    '', '```',
    `Platform      ${delivery.platform ?? 'GitHub Actions'}`,
    `Triggers      ${delivery.triggers ?? 'push to any branch · pull request to main'}`,
    `Runners       ${delivery.runners ?? 'ubuntu-latest'}`,
    "Secrets       from the platform's secret store, never from the repo",
    '```', '', '## Stages', '', '```',
    stages.map(([name, command, note], index) => `${index + 1}  ${name.padEnd(9)} ${command.padEnd(44)} ${note}`).join('\n'),
    '```', '', '## Must hold', '',
    list([
      'A stage that fails stops the run',
      'The vibekit stage runs before anything is packaged',
      'No stage writes back to the repo',
      'A high or critical finding fails the run and becomes an ask on the requirement',
    ]),
    '', '## Writing the CI file', '',
    list([
      'Every stage appears in order, with the exact command given.',
      'The "Must hold" list becomes real constraints, not comments.',
      'Nothing is added that this spec does not name; a needed extra is proposed, not inserted.',
      'The generated CI file is named in map.md so the next agent can find it.',
    ]),
    '',
  ].join('\n');
}

export const environmentsBody = (config) => [
  '# Environments', '',
  'Secrets are **named** here and valued nowhere in the repo.',
  '',
  table(['Env', 'Promoted from', 'Requires', 'Approver'], [
    ['dev', 'any req/* branch', 'check green; smoke green after deploy', 'none'],
    ['staging', 'main at a tag', 'release report; e2e green; smoke green', 'tech lead'],
    ['prod', 'staging at the same tag', 'security report clean; smoke green on staging; smoke green after deploy or automatic rollback', 'product owner + tech lead'],
  ]),
  '', '## Secret names', '',
  list(config.secrets ?? ['DATABASE_URL', 'AUTH_ISSUER', 'AUTH_CLIENT_ID']),
  '',
].join('\n');

export const observabilityBody = (config) => [
  '# Observability', '',
  '## Logs', '',
  list([
    'Structured, one event per line, with a correlation id propagated across every boundary.',
    'Classified fields follow standards/security.md: never a secret, personal and financial by id only.',
  ]),
  '', '## Metrics every service exposes', '',
  list(['request rate', 'error rate', 'latency by endpoint', ...(config.background ? ['queue depth'] : [])]),
  '', '## Endpoints the walking skeleton must answer', '',
  list(['`/health` — the process is up', '`/ready` — dependencies are reachable']),
  '',
].join('\n');

// ---------------------------------------------------------------- authored starters

export function profileStarter(config) {
  return [
    '---',
    `template: ${config.template ?? 'none'}`,
    `generated: ${config.generatedOn ?? new Date().toISOString().slice(0, 10)}`,
    'vibekit: 1.0',
    'prompts: 1.0',
    'spec: 1.0',
    `stack: ${Object.values(config.stack ?? {}).filter(Boolean).join(' · ') || 'not recorded'}`,
    `architecture: ${architectureOf(config).key}`,
    `delivery: ${config.deliveryMode ?? 'checks-only'}`,
    'budget-cap: 5500',
    'memory-index-cap: 40',
    'hold-timeout: 4h',
    'ask-threshold: 3',
    'merge: squash',
    'base: main',
    'coverage-min: 80',
    'mode: balanced',
    'calibrate: true',
    '---',
    '',
    '# Profile',
    '',
    'What changed since generation, newest first. This file is yours; the generator never touches it again.',
    '',
  ].join('\n');
}

export const rulesStarter = () => [
  '# Rules', '',
  'What agents may and may not do here. Always loaded, every task, never trimmed — so keep it to what changes behaviour.',
  '', '## Always', '',
  list([
    'Write the failing test first, and confirm it fails for the right reason before making it pass.',
    'Use only the names in product/entities.md. A name you need that is not there is an ask.',
    'Say what you actually ran. "Tests pass" without a captured exit code is a claim, not evidence.',
  ]),
  '', '## Stop and ask', '',
  list([
    'You need an entity, field, package or path the folder does not have.',
    'An acceptance criterion cannot be tested as written.',
    'A rule here is in the way. A rule in the way is an ask, never a quiet edit.',
  ]),
  '', '## Done means', '',
  list([
    'Every acceptance criterion has a named passing test that fails without the change.',
    'vibekit check is green on the branch.',
    'A reviewer approved it and a human set the status.',
  ]),
  '',
].join('\n');

/** §5, §46 — a fixed shape, because `vibekit check` parses it. A guardrail it cannot read is not enforced. */
export const guardrailsStarter = (config) => [
  '# Guardrails', '',
  '## Denied paths', '',
  '- TODO/   replace with a real path in this repository; a denied path that does not exist is a check failure',
  '', '## Required before done', '',
  `- ${config.commands?.build ?? 'TODO: the build command'} succeeds with zero warnings`,
  `- ${config.commands?.test ?? 'TODO: the test command'} passes`,
  '', '## Locked', '',
  list(['No new dependencies without a proposal', 'Licence allow-list: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC', 'Allowed registries: npm, nuget, pypi']),
  '', '## Allowed commands', '',
  list([config.commands?.build, config.commands?.test, config.commands?.lint, 'git add · git commit · git push origin req/*'].filter(Boolean)),
  '', '## Denied commands', '',
  list(['git push --force', 'git reset --hard', 'rm -rf', 'anything touching main directly']),
  '',
].join('\n');

export const contextStarter = (config) => [
  '# Context', '',
  `**What this is.** ${config.description ?? 'TODO: one or two sentences.'}`,
  '',
  `**Who uses it.** ${(config.users ?? []).join(', ') || 'TODO: the actual roles, not "users".'}`,
  '',
  '**What matters.** TODO: the one or two things that must not go wrong.',
  '',
  '**Out of scope.** TODO: what this deliberately does not do.',
  '',
  'Hard ceiling: 300 tokens. If it does not fit, the scope is not decided yet.',
  '',
].join('\n');

export const glossaryStarter = () => [
  '# Glossary', '',
  'Words that mean something specific here, and would be misread otherwise.',
  '',
  '- **TODO** — what it means in this product, and what it is often confused with.',
  '',
].join('\n');

export const qualityStarter = () => [
  '# Quality', '',
  'Non-functional requirements. A requirement cites the lines it must meet under `quality:`.',
  '', '## Targets', '',
  list([
    'Q-1 TODO: response time, at which percentile, under what load',
    'Q-2 TODO: availability, measured how',
    'Q-3 TODO: accessibility level',
  ]),
  '', '## Retention and erasure', '',
  'Every data class needs a line here. A requirement that creates personal data without one is an ask.',
  '',
  list(['personal — TODO: retained how long, erased how', 'financial — TODO']),
  '',
].join('\n');

export const invariantsStarter = () => [
  '# Invariants', '',
  'Rules that hold across every requirement, which no single requirement owns. Each is backed by a property test in `tests/invariants/`, and the reviewer runs them for any requirement touching the entities named.',
  '',
  '- INV-1  [TODO]  TODO: something that must be true of this data at all times.',
  '',
].join('\n');

export const accessStarter = () => [
  '# Access', '',
  'Who may do what to which entity. An action not in this table is **denied by default**, and adding one is a proposal.',
  '',
  'The generator writes one test per cell in `tests/access/`, allowed and denied. Most real breaches are authorisation, not authentication — so this is a table the product owner can read.',
  '',
  '| Role \\ Entity | TODO |',
  '| --- | --- |',
  '| TODO | TODO: CRU own · R org · R all |',
  '',
].join('\n');

export const componentsStarter = () => [
  '# Components', '',
  'The inventory, and when to use each. UI requirements name the component they add or change.',
  '',
  '- **TODO** — when to use it, and which library implements it.',
  '',
].join('\n');

export const flowsStarter = () => [
  '# Flows', '',
  'One line per flow, with its screens in order. A UI requirement names its screen.',
  '',
  '- TODO: sign in → dashboard → …',
  '',
].join('\n');

export const assumptionsStarter = () => [
  '---',
  'reviewed:',
  '---',
  '',
  '# Assumptions', '',
  'What was assumed when it could not be asked. Every one has an id, so a requirement can name it under `assumes:` and `vibekit assumptions` can report how much is standing on it.',
  '',
  'A `confidence: low` assumption load-bearing for more than three requirements blocks the plan gate until it is confirmed or explicitly accepted as a risk.',
  '',
  '- A-001  TODO: what was assumed · checklist item: TODO · confidence: low',
  '',
].join('\n');

export const architectureStarter = (config) => {
  const { key, meta } = architectureOf(config);
  return [
    '---',
    `stack: ${Object.values(config.stack ?? {}).filter(Boolean).join(' · ') || 'TODO'}`,
    `architecture: ${key}`,
    'api: rest',
    'auth: TODO',
    'tenancy: TODO',
    'background: none',
    'deploy: container',
    'approved:',
    '---',
    '',
    '# Architecture',
    '',
    `**${meta.label}.** ${meta.summary}`,
    '',
    '## Layers and what may reference what',
    '',
    list(meta.rules),
    '',
    '## The three things this architecture forbids',
    '',
    '1. TODO', '2. TODO', '3. TODO',
    '',
    '## Design principles',
    '',
    'Each one names the check that enforces it. A principle with no check does not belong here: unenforceable prose teaches agents that rules are decorative.',
    '',
    '- TODO: a principle → TODO: the test that fails when it is broken',
    '',
    '## Cross-cutting concerns',
    '',
    'Asked once here, applied to every piece of work after. Each row names the test that enforces it; `none` is a decision too, and one that touches personal or financial data becomes a low-confidence assumption.',
    '',
    table(['Concern', 'Decision', 'Enforced by'], [
      ['authorisation', 'TODO: who may do what to which entity', 'product/access.md, one allowed and one denied test per cell'],
      ['audit', 'TODO: which actions are recorded, with what, kept how long', 'TODO: an invariant per audited action'],
      ['rate limiting', 'TODO: which endpoints, at what rate, per what key', 'TODO: a contract test per limited endpoint'],
      ['idempotency', 'TODO: which operations may be retried safely', 'TODO: same request twice → one effect'],
      ['concurrency', 'TODO: two people change the same thing at once', 'TODO: a test per contended entity'],
      ['validation', 'TODO: where input is validated, once or per layer', 'TODO: the boundary validates, inner layers assume'],
      ['logging', 'TODO: what must be logged, what never', 'check --security (classified-field grep)'],
      ['time', 'TODO: where "now" comes from; timezones stored and shown', 'TODO: no direct call to the system clock'],
    ]),
    '',
    '## Dependencies',
    '',
    'name · version · licence · last release · maintainers. Anything unverifiable, unreleased for eighteen months, or outside the licence allow-list is an ask.',
    '',
    '## Why these choices',
    '',
    'One line each, citing the stage 1 answer it came from.',
    '',
    '<!-- A human writes `approved:` above. The generator refuses to write standards/ from an unapproved record. -->',
    '',
  ].join('\n');
};

export const planStarter = () => [
  '---',
  'approved:',
  'requirements: 0',
  'phases: 1',
  '---',
  '',
  '# Plan',
  '',
  '## Phase 0: Foundation (the walking skeleton)',
  '',
  list([
    'Scaffold from map.md, CI from pipeline.spec.md, auth wired, one health endpoint',
    'Exit: vibekit check green, pipeline green, the app starts and answers /health',
  ]),
  '',
  '## Phase 1',
  '',
  '- TODO: REQ-001 …',
  '',
  '## Deferred',
  '',
  '- TODO: what is out, and the reason',
  '',
  '## Trust boundaries',
  '',
  'Where classified data crosses an auth or network boundary. Generated from the architecture record and the entity classifications.',
  '',
  '<!-- A human writes `approved:` above. Editing the order before approving is expected. -->',
  '',
].join('\n');

/**
 * §6 — a requirement is a file, not a row on a board. Seeding one from config writes the file and
 * lets the board derive from it; listing it on the board alone advertises work an agent cannot open.
 */
export const requirementStarter = ({ id, title, kind = 'requirement', size = null, entities = [], source = null }) => [
  '---',
  `id: ${id}`,
  `title: ${title}`,
  `kind: ${kind}`,
  `size: ${size ?? 'TODO'}`,
  'status: draft',
  `entities: [${entities.join(', ')}]`,
  `source: ${source ?? 'TODO'}`,
  'after: []',
  'assumes: []',
  'quality: []',
  'invariants: []',
  '---',
  '',
  `# ${title}`,
  '',
  '## Acceptance',
  '',
  'EARS form, one trigger and one response each, each with an id so a test can be named for it.',
  '',
  '- AC-1  TODO: When <trigger>, the system shall <observable response>.',
  '',
  '## Out of scope',
  '',
  '- TODO',
  '',
  '## Security',
  '',
  'Data classes touched, the auth boundary crossed, whether this introduces an external call.',
  '',
  '## Approach',
  '',
  '## Verification',
  '',
  '## Review',
  '',
  '## Log',
  '',
].join('\n');

// ---------------------------------------------------------------- roles

const ROLES = {
  analyst: {
    stages: '0, 1, A',
    loads: ['sources', 'product/context', 'product/glossary', 'memory/index'],
    mayWrite: ['vibekit/workflow/asks/**', 'vibekit/workflow/assumptions.md', 'vibekit/product/context.md', 'vibekit/product/glossary.md', 'vibekit/product/quality.md', 'vibekit/product/requirements/**'],
    mayNotWrite: ['src/**', 'tests/**', 'vibekit/standards/**', 'vibekit/workflow/architecture.md'],
    handsOffTo: 'planner',
    model: 'strong',
    body: 'You work out what the sources do not say, and ask. You do not design and you do not choose a stack — so you cannot smuggle an architecture decision into a question.',
  },
  planner: {
    stages: '2, 4',
    loads: ['workflow/answers', 'product/context', 'product/entities', 'product/invariants', 'memory/index'],
    mayWrite: ['vibekit/workflow/architecture.md', 'vibekit/workflow/plan.md', 'vibekit/product/entities.md', 'vibekit/product/access.md', 'vibekit/product/requirements/**', 'vibekit/workflow/asks/**'],
    mayNotWrite: ['src/**', 'tests/**', 'vibekit/standards/**'],
    handsOffTo: 'implementer',
    model: 'strong',
    body: 'You decide how it is built and in what order. You write no code, so the plan is judged on its own.',
  },
  designer: {
    stages: '3',
    loads: ['workflow/architecture', 'product/context'],
    mayWrite: ['vibekit/product/design/**', 'vibekit/skills/lib/ui-conventions.md'],
    mayNotWrite: ['src/**', 'vibekit/product/entities.md'],
    handsOffTo: 'planner',
    model: 'strong',
    body: 'You produce the tokens, the component inventory and the flows. Colours are named by role, never by hue.',
  },
  implementer: {
    stages: '5',
    loads: ['standards', 'product/.abstract', 'product/context', 'product/map', 'product/invariants', 'requirement', 'entities', 'skills/index', 'memory/index'],
    mayWrite: ['src/**', 'tests/**', 'vibekit/memory/sessions/**', 'vibekit/workflow/asks/**', 'vibekit/product/requirements/<held>.md'],
    mayNotWrite: ['vibekit/**', 'migrations/**'],
    handsOffTo: 'reviewer',
    model: 'mid',
    body: 'You implement one requirement. Stop and propose when the folder lacks what you need. You cannot edit standards/ or entities.md, so a rule in your way becomes an ask rather than a quiet edit.',
  },
  reviewer: {
    stages: '6',
    loads: ['standards', 'requirement', 'diff', 'entities', 'invariants', 'access'],
    mayWrite: ['vibekit/product/requirements/<reviewed>.md', 'vibekit/memory/sessions/**'],
    mayNotWrite: ['src/**', 'tests/**'],
    handsOffTo: 'human',
    model: 'strong',
    body: 'You map every criterion to a named test, re-run the evidence, and read the diff against the standards. You cannot write application code, so you cannot fix a thing and then approve your own fix. You start with a fresh context: reviewing with the implementer\'s context is reviewing with its blind spots.',
  },
  compliance: {
    stages: '5, 6',
    loads: ['standards/guardrails', 'diff'],
    mayWrite: [],
    mayNotWrite: ['**'],
    handsOffTo: 'human',
    model: 'cheap',
    body: [
      'You check the diff against the guardrails and nothing else. You can only pass or block.',
      '',
      'Loading only the guardrails and the diff is what makes this cheap enough to run on every diff rather than',
      'only at merge. Widening what you read defeats the reason this is a separate role.',
    ].join('\n'),
  },
};

export function roleStarter(role) {
  const spec = ROLES[role];
  return [
    '---',
    `role: ${role}`,
    `stages: ${spec.stages}`,
    `loads: [${spec.loads.join(', ')}]`,
    `may-write: [${spec.mayWrite.join(', ')}]`,
    `may-not-write: [${spec.mayNotWrite.join(', ')}]`,
    `hands-off-to: ${spec.handsOffTo}`,
    `model: ${spec.model}`,
    '---',
    '',
    spec.body,
    '',
    'Guardrails apply to every role and a role cannot widen them: `may-write` can only narrow what the guardrails already allow. The narrower path wins.',
    '',
  ].join('\n');
}

export const ROLE_NAMES = Object.keys(ROLES);

export const humansStarter = () => [
  '# Humans', '',
  'Who may approve what. The app enforces this; the file records it.',
  '',
  'Put an email beside each name — `Ada Lovelace <ada@example.com>`. That is what the tracker maps a',
  'Cloudflare Access login to, and what goes in the commit trailer for anything approved from a phone.',
  '', '## Approvers', '',
  table(['Role', 'Name', 'May approve'], [
    ['product owner', 'TODO', 'plan, scope, requirement priority, prod promotion'],
    ['tech lead', 'TODO', 'architecture, standards changes, gate policy, stale holds'],
    ['security', 'TODO', 'security.md, access.md, the dependency allow-list, L requirements touching secret or financial data'],
  ]),
  '',
  'Without a named security approver the tech lead holds the role, and the security report says so.',
  '', '## Gate policy', '',
  'Gates stay human by default. A rule here lets a named gate pass without a signature, and the audit trail records that it did.',
  '',
  list([
    'R-1  size: S requirements pass review on a green compliance pass',
    'R-2  a requirement touching no personal or financial data and ≤ 2 entities does not re-open plan approval',
  ]),
  '', '## Model policy', '',
  list([
    'analyst, planner, designer:      strong',
    'implementer size S:              cheap',
    'implementer size M:              mid',
    'implementer size L:              mid, strong when it touches financial or secret data',
    'reviewer:                        one tier above the implementer, and a different model',
    'compliance:                      cheap',
  ]),
  '',
  'Review is where a cheap implementer\'s mistakes are caught, so review is never cheaper than the work it reviews.',
  '',
].join('\n');

export const runnersStarter = () => [
  '# Runners', '',
  'A seat you have already bought is the cheapest thing you own. Routing pushes work onto it wherever quality allows, and spends metered tokens only where a seat cannot go — mainly unattended work.',
  '', '## Runners', '',
  '```',
  '- id: claude-code',
  '  kind: seat · mcp: yes · sandbox: partial · unattended: no',
  '  models-available: [strong, mid]',
  '  good-at: [implementation, refactor, review, long sessions, terminal work]',
  '- id: cursor',
  '  kind: seat · mcp: yes · sandbox: no · unattended: no',
  '  models-available: [strong, mid, cheap]',
  '  good-at: [file navigation, UI work, quick edits]',
  '```',
  '', '## Routing preferences', '',
  list([
    'unattended work → api runners only',
    'size L, or financial/secret data → sandbox: full, or a seat with a named human present',
    'review → never the same runner **and** model as the implementer',
    'rate-limited seat → next seat, else api at the required tier',
  ]),
  '',
].join('\n');
