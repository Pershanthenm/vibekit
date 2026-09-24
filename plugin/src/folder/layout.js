/**
 * The folder's shape, as data. Specification §2, §3 and §10.
 *
 * Every path VibeKit writes is declared here once, with the three facts that govern it: who owns
 * it, when it loads, and what it may cost. Scattering those across the generator is how a file
 * ends up regenerated over a rule somebody wrote by hand, which is the failure the whole format
 * is arranged to prevent.
 */

export const Kind = Object.freeze({
  /** Derived from config or the repo. Overwritten every run. A hand edit here is lost. */
  Generated: 'generated',
  /** A human decided it, or an agent wrote it for a human to keep. Created once, never touched again. */
  Authored: 'authored',
  /** Machine bookkeeping. Git-ignored, disposable, never the only copy of anything. */
  State: 'state',
});

export const Loading = Object.freeze({
  Always: 'always',
  PerTask: 'per-task',
  OnTrigger: 'on-trigger',
  UiTask: 'ui-task',
  /** Written for people, or read by tooling, but never loaded into an agent's context. */
  Never: 'never',
});

/** Offered at `vibekit init`. Visible by default: these files are meant to be read by people. */
export const FOLDER_NAMES = Object.freeze(['vibekit', '.vibekit', 'docs/vibekit']);
export const DEFAULT_FOLDER = 'vibekit';

/**
 * §10. Past this, teams start deleting rules to make room, which is the failure the limit exists
 * to catch — so `check --budget` fails rather than warns. Overridable as `budget-cap` in profile.md.
 */
export const BUDGET_CAP = 5500;

/** §8. Deployment is a separate problem and many teams already have it solved. */
export const DELIVERY_MODES = Object.freeze(['none', 'checks-only', 'full']);
export const DEFAULT_DELIVERY = 'checks-only';

/**
 * Pointer files live at the repository root, because the tools that read them look for them by
 * name and nowhere else. Each is under 150 tokens and holds no rules of its own; everything below
 * `<!-- local -->` in one is a team's own and survives a rewrite.
 */
export const POINTERS = Object.freeze([
  { path: 'CLAUDE.md', kind: Kind.Generated, source: 'pointer', loading: Loading.Always, budget: 150, readBy: 'Claude Code' },
  { path: 'AGENTS.md', kind: Kind.Generated, source: 'pointer', loading: Loading.Always, budget: 150, readBy: 'Codex, OpenCode, most others' },
  { path: '.cursorrules', kind: Kind.Generated, source: 'pointer', loading: Loading.Always, budget: 150, readBy: 'Cursor' },
  { path: '.gitattributes', kind: Kind.Generated, source: 'gitattributes', loading: Loading.Never, budget: 0, readBy: 'git, GitHub, GitLab' },
  { path: '.env.example', kind: Kind.Generated, source: 'environments', loading: Loading.Never, budget: 0, readBy: 'developers' },
  { path: '.claude/commands/vibekit-next.md', kind: Kind.Generated, source: 'commands', loading: Loading.Never, budget: 0, readBy: 'Claude Code' },
]);

/**
 * Paths inside the folder. `perUnit` marks a budget that scales with the repository rather than
 * being fixed; `base` is the file's own shell, which a per-unit budget alone cannot express.
 */
export const FOLDER_FILES = Object.freeze([
  { path: 'README.md', kind: Kind.Generated, source: 'readme', loading: Loading.Never, budget: 0 },
  { path: 'profile.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },

  // --- standards: always loaded, every task, never trimmed. Combined budget 1,500. ----------
  { path: 'standards/rules.md', kind: Kind.Authored, loading: Loading.Always, budget: 600 },
  { path: 'standards/code-style.md', kind: Kind.Generated, source: 'style', loading: Loading.Always, budget: 200 },
  { path: 'standards/security.md', kind: Kind.Generated, source: 'security', loading: Loading.Always, budget: 300 },
  { path: 'standards/guardrails.md', kind: Kind.Authored, loading: Loading.Always, budget: 400 },

  // --- product: scoped per task, which is where most of the token saving comes from ---------
  { path: 'product/.abstract', kind: Kind.Generated, source: 'abstract', loading: Loading.Always, budget: 100, ceiling: 120 },
  { path: 'product/context.md', kind: Kind.Authored, loading: Loading.Always, budget: 300, hardCeiling: true },
  { path: 'product/glossary.md', kind: Kind.Authored, loading: Loading.Always, budget: 200 },
  { path: 'product/quality.md', kind: Kind.Authored, loading: Loading.Always, budget: 200 },
  { path: 'product/invariants.md', kind: Kind.Authored, loading: Loading.Always, budget: 200 },
  { path: 'product/map.md', kind: Kind.Generated, source: 'map', loading: Loading.Always, budget: 400 },
  { path: 'product/entities.md', kind: Kind.Generated, source: 'entities', loading: Loading.PerTask, budget: 80, base: 60, perUnit: 'entity' },
  { path: 'product/access.md', kind: Kind.Authored, loading: Loading.PerTask, budget: 200 },
  { path: 'product/requirements/index.md', kind: Kind.Generated, source: 'requirements', loading: Loading.Always, budget: 15, base: 90, perUnit: 'requirement' },
  { path: 'product/requirements/REQ-*.md', kind: Kind.Authored, loading: Loading.PerTask, budget: 350, glob: true },
  { path: 'product/sources/index.md', kind: Kind.Generated, source: 'sources', loading: Loading.Always, budget: 15, base: 70, perUnit: 'source' },
  { path: 'product/design/tokens.md', kind: Kind.Generated, source: 'design', loading: Loading.UiTask, budget: 400 },
  { path: 'product/design/components.md', kind: Kind.Authored, loading: Loading.UiTask, budget: 300 },
  { path: 'product/design/flows.md', kind: Kind.Authored, loading: Loading.UiTask, budget: 150 },

  // --- skills: indexed, never injected ------------------------------------------------------
  { path: 'skills/.abstract', kind: Kind.Generated, source: 'abstract', loading: Loading.Always, budget: 100, ceiling: 120 },
  { path: 'skills/index.yml', kind: Kind.Generated, source: 'skills', loading: Loading.Always, budget: 20, base: 15, perUnit: 'skill' },
  { path: 'skills/lib/*.md', kind: Kind.Authored, loading: Loading.OnTrigger, budget: 250, glob: true },

  // --- agents: a role is a load set plus a write scope ---------------------------------------
  { path: 'agents/analyst.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'agents/planner.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'agents/designer.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'agents/implementer.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'agents/reviewer.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  // Reviewer and compliance stay separate: compliance loads only guardrails and the diff, which
  // is what makes it cheap enough to run on every diff rather than only at merge.
  { path: 'agents/compliance.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'agents/humans.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'agents/runners.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  // Integration spec §2 — the MCP servers this project consumes; an allow-list, never a credential.
  { path: 'agents/servers.yml', kind: Kind.Authored, loading: Loading.Never, budget: 0 },

  // --- workflow: the stage prompts are files, so the workflow is not locked inside the app ---
  // §10 budgets this at ~150, which does not fit the seven-row stage table it renders once build
  // starts. Measured at 158 on a fresh folder, so the target is set where the file actually lands.
  { path: 'workflow/status.md', kind: Kind.Generated, source: 'workflow', loading: Loading.Always, budget: 200 },
  { path: 'workflow/stages/0-intake.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 0 },
  { path: 'workflow/stages/1-clarify.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 1 },
  { path: 'workflow/stages/adopt.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 'A' },
  { path: 'workflow/stages/2-architecture.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 2 },
  { path: 'workflow/stages/3-design-system.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 3 },
  { path: 'workflow/stages/4-plan.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 4 },
  { path: 'workflow/stages/5-build.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 5 },
  { path: 'workflow/stages/6-test.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, stage: 6 },
  { path: 'workflow/asks/*.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, glob: true },
  { path: 'workflow/answers/*.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, glob: true },
  { path: 'workflow/assumptions.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },
  { path: 'workflow/architecture.md', kind: Kind.Authored, loading: Loading.Never, budget: 600 },
  { path: 'workflow/plan.md', kind: Kind.Authored, loading: Loading.Never, budget: 0 },

  // --- memory: file-based, in git, so it travels with clones and shows up in review ----------
  { path: 'memory/.abstract', kind: Kind.Generated, source: 'abstract', loading: Loading.Always, budget: 100, ceiling: 120 },
  { path: 'memory/index.md', kind: Kind.Generated, source: 'memory', loading: Loading.Always, budget: 15, base: 40, perUnit: 'memory' },
  { path: 'memory/repo/*.md', kind: Kind.Authored, loading: Loading.OnTrigger, budget: 150, glob: true },
  { path: 'memory/sessions/*.md', kind: Kind.Authored, loading: Loading.Never, budget: 0, glob: true },

  // --- delivery: optional, per profile.md's `delivery:` setting ------------------------------
  { path: 'delivery/pipeline.spec.md', kind: Kind.Generated, source: 'pipeline', loading: Loading.Never, budget: 400, delivery: ['checks-only', 'full'] },
  { path: 'delivery/environments.md', kind: Kind.Generated, source: 'environments', loading: Loading.Never, budget: 300, delivery: ['full'] },
  { path: 'delivery/observability.md', kind: Kind.Generated, source: 'observability', loading: Loading.Never, budget: 300, delivery: ['full'] },

  // --- state: never in git -------------------------------------------------------------------
  { path: '.state/manifest.json', kind: Kind.State, loading: Loading.Never, budget: 0 },
  { path: '.state/bindings.json', kind: Kind.State, loading: Loading.Never, budget: 0 },
  { path: '.state/tasks.json', kind: Kind.State, loading: Loading.Never, budget: 0 },
  { path: '.state/workflow.json', kind: Kind.State, loading: Loading.Never, budget: 0 },
  { path: '.state/sessions.json', kind: Kind.State, loading: Loading.Never, budget: 0 },
]);

/** Files that exist only when `delivery:` allows them. */
export const includedByDelivery = (file, delivery = DEFAULT_DELIVERY) => !file.delivery || file.delivery.includes(delivery);

export const filesFor = (delivery = DEFAULT_DELIVERY) => FOLDER_FILES.filter((file) => includedByDelivery(file, delivery));

export const generatedPaths = (delivery = DEFAULT_DELIVERY) => [
  ...POINTERS.filter((file) => file.kind === Kind.Generated).map((file) => file.path),
  ...filesFor(delivery).filter((file) => file.kind === Kind.Generated && !file.glob).map((file) => file.path),
];

export const authoredPaths = (delivery = DEFAULT_DELIVERY) =>
  filesFor(delivery).filter((file) => file.kind === Kind.Authored && !file.glob).map((file) => file.path);

export const statePaths = () => FOLDER_FILES.filter((file) => file.kind === Kind.State).map((file) => file.path);

export const stagePaths = () => FOLDER_FILES.filter((file) => file.stage !== undefined);

export const findFile = (relativePath) => [...POINTERS, ...FOLDER_FILES].find((file) => file.path === relativePath) ?? null;

/** The areas the folder is divided into, in the order a person should read them. */
export const AREAS = Object.freeze(['standards', 'product', 'skills', 'agents', 'workflow', 'memory', 'delivery']);

/** Areas that carry an `.abstract`, so an agent can judge relevance before reading more. */
export const ABSTRACT_AREAS = Object.freeze(['product', 'skills', 'memory']);
