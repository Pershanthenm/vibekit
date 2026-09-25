import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { action } from './commands/action.js';
import { analyze } from './commands/analyze.js';
import { archdocs, archdrift } from './commands/archdocs.js';
import { bug } from './commands/bug.js';
import { design } from './commands/design.js';
import { ext } from './commands/ext.js';
import { ask, check, init, next, req, rescan } from './commands/folder.js';
import { githook } from './commands/githook.js';
import { completion, newVerb, planVerb, runVerb, use } from './commands/grammar.js';
import { hook } from './commands/hook.js';
import { ingest } from './commands/ingest.js';
import { clarify, config, replay, skills, testSkillsCommand, upgradePrompts } from './commands/maintain.js';
import { migrate } from './commands/migrate.js';
import { pause, resume } from './commands/pause.js';
import { project, stop } from './commands/project.js';
import { changelog, evidence, release, revert, ship } from './commands/release.js';
import { assumptions, plan as planCost, report } from './commands/report.js';
import { distil, reverse } from './commands/reverse.js';
import { security } from './commands/security.js';
import { serve } from './commands/serve.js';
import { add, quick, start, tracker, unhold } from './commands/shortcuts.js';
import { show } from './commands/show.js';
import { spec } from './commands/spec.js';
import { sprint } from './commands/sprint.js';
import { team } from './commands/team.js';
import { tools } from './commands/tools.js';
import { tour } from './commands/tour.js';
import { understand } from './commands/understand.js';
import { cost, docs, feature, hotfix, review, rollback, settings, undo, version } from './commands/verbs.js';
import { verify } from './commands/verify.js';
import { trace, why } from './commands/why.js';
import { currentProject, resolveRoot } from './current.js';
import { dim, startScreen, unknownCommand } from './guide.js';

/**
 * The command surface. CLI Spec §1 and §2.
 *
 *   vibekit <verb> <noun> ["<name>"] [--flags]
 *
 * Eight verbs — new, use, show, plan, run, analyze, migrate, verify — plus stop, resume and
 * ship, each followed by what it acts on. Verb first, always. The name is optional. A bare verb
 * lists what it takes.
 *
 * The earlier grammar (`project new`, `sprint run`, `action`) stays as aliases — the same
 * function, not a second implementation — so nothing a script, a hook or an agent already calls
 * breaks. They are hidden from help and never suggested.
 */

const COMMANDS = {
  // the eight verbs, and the three more
  new: newVerb, use, show, plan: planVerb, run: runVerb, analyze, migrate, verify, stop, resume, ship,
  // settings and extras
  settings, design, tracker, ext, completion,
  // the folder's own verbs (Appendix A): what agents, hooks and CI call
  init, ingest, ask, req, add, start, unhold, serve, check, drift: archdrift, trace, assumptions, evidence, changelog, reverse, distil, clarify, skills, 'test-skills': testSkillsCommand, 'upgrade-prompts': upgradePrompts, rescan, githook, tour, spec, hook, version, tools, team, bug, feature, hotfix, review, why, security, docs, report, release, rollback, undo, cost, action,
  // the earlier grammar, kept so nothing breaks
  project, sprint, pause, quick, revert, next, understand, 'arch-docs': archdocs, config, replay, track: tracker, analyse: analyze, 'plan-cost': planCost,
};

/** Which command each older name is shown as. A name here is hidden from help and never suggested. */
export const ALIASES = Object.freeze({
  project: 'new project · use project · show project', sprint: 'run sprint · show sprint · new sprint', action: 'show status',
  pause: 'stop', next: 'run sprint', understand: 'new project --import', 'arch-docs': 'run docs', quick: 'new hotfix', revert: 'ship undo',
  config: 'settings', replay: 'tools replay', track: 'tracker', analyse: 'analyze', 'plan-cost': 'show plan --cost',
  feature: 'new feature', bug: 'new bug', hotfix: 'new hotfix', review: 'run review', why: 'show why', security: 'run scan · show security',
  docs: 'run docs · show docs', report: 'show cost · show security', cost: 'show cost', team: 'show team', check: 'run check',
  release: 'ship release', rollback: 'ship rollback', undo: 'ship undo',
});

/** Commands that act on the directory they are run in, whatever `use project` chose. */
const ACTS_HERE = new Set(['init', 'project', 'understand', 'analyze', 'analyse', 'ext', 'settings', 'config', 'tools', 'completion', 'version', 'hook', 'githook', 'clarify', 'tour', 'spec', 'tracker', 'track', 'serve', 'replay', 'test-skills']);

/** Commands after which the completion index is refreshed: anything that may have changed state. */
const CHANGES_STATE = new Set(['new', 'use', 'plan', 'run', 'migrate', 'verify', 'stop', 'resume', 'ship', 'init', 'ingest', 'ask', 'req', 'add', 'start', 'unhold', 'project', 'sprint', 'action', 'bug', 'feature', 'hotfix', 'release', 'rollback', 'undo', 'revert', 'quick', 'next', 'pause', 'understand', 'design', 'team', 'skills', 'ext', 'rescan', 'reverse', 'distil', 'spec', 'security', 'docs', 'arch-docs']);

const OPTIONS = {
  dir: { type: 'string' },
  from: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  out: { type: 'string' },
  port: { type: 'string' },
  host: { type: 'string' },
  tunnel: { type: 'boolean' },
  run: { type: 'boolean' },
  repeat: { type: 'string' },
  version: { type: 'string' },
  folder: { type: 'string' },
  as: { type: 'string' },
  kind: { type: 'string' },
  for: { type: 'string' },
  why: { type: 'string' },
  reason: { type: 'string' },
  plain: { type: 'string' },
  about: { type: 'string' },
  by: { type: 'string' },
  stage: { type: 'string' },
  size: { type: 'string' },
  source: { type: 'string' },
  runner: { type: 'string' },
  blocking: { type: 'boolean' },
  budget: { type: 'boolean' },
  ci: { type: 'boolean' },
  done: { type: 'string' },
  'in-hand': { type: 'string' },
  next: { type: 'string' },
  ask: { type: 'string' },
  read: { type: 'string' },
  advise: { type: 'boolean' },
  'no-tour': { type: 'boolean' },
  'no-library': { type: 'boolean' },
  domain: { type: 'string' },
  deps: { type: 'boolean' },
  offline: { type: 'boolean' },
  online: { type: 'boolean' },
  'allow-private': { type: 'boolean' },
  sandbox: { type: 'boolean' },
  both: { type: 'boolean' },
  'no-redact': { type: 'boolean' },
  matrix: { type: 'boolean' },
  cost: { type: 'boolean' },
  rollback: { type: 'string' },
  project: { type: 'string' },
  'from-speckit': { type: 'boolean' },
  speckit: { type: 'boolean' },
  to: { type: 'string' },
  url: { type: 'string' },
  phase: { type: 'string' },
  hotfix: { type: 'boolean' },
  recovery: { type: 'boolean' },
  variant: { type: 'string' },
  all: { type: 'boolean' },
  id: { type: 'string' },
  title: { type: 'string' },
  stdio: { type: 'boolean' },
  hostname: { type: 'string' },
  team: { type: 'string' },
  audience: { type: 'string' },
  runners: { type: 'boolean' },
  convert: { type: 'boolean' },
  refresh: { type: 'boolean' },
  of: { type: 'string' },
  step: { type: 'string' },
  adopt: { type: 'boolean' },
  delivery: { type: 'string' },
  tracker: { type: 'boolean' },
  'no-tunnel': { type: 'boolean' },
  qr: { type: 'boolean' },
  servers: { type: 'boolean' },
  division: { type: 'string' },
  rules: { type: 'string' },
  docs: { type: 'string' },
  model: { type: 'boolean' },
  brand: { type: 'string' },
  'scaffold-templates': { type: 'string' },
  at: { type: 'string' },
  diff: { type: 'boolean' },
  html: { type: 'boolean' },
  docx: { type: 'boolean' },
  pdf: { type: 'boolean' },
  parity: { type: 'boolean' },
  security: { type: 'boolean' },
  static: { type: 'boolean' },
  open: { type: 'boolean' },
  lanes: { type: 'string' },
  until: { type: 'string' },
  headless: { type: 'boolean' },
  'no-tag': { type: 'boolean' },
  name: { type: 'string' },
  describe: { type: 'string' },
  platform: { type: 'string' },
  where: { type: 'string' },
  'needs-me': { type: 'boolean' },
  last: { type: 'boolean' },
  rescan: { type: 'string' },
  forget: { type: 'string' },
  severity: { type: 'string' },
  'found-by': { type: 'string' },
  'found-on': { type: 'string' },
  'introduced-by': { type: 'string' },
  test: { type: 'string' },
  criterion: { type: 'string' },
  cause: { type: 'string' },
  evidence: { type: 'string' },
  choice: { type: 'string' },
  role: { type: 'string' },
  approve: { type: 'boolean' },
  decide: { type: 'string' },
  'no-bugs': { type: 'boolean' },
  quiet: { type: 'boolean' },
  quick: { type: 'boolean' },
  key: { type: 'string' },
  // CLI Spec: new, plan, analyze, verify, completion
  preview: { type: 'boolean' },
  import: { type: 'string' },
  order: { type: 'string' },
  defer: { type: 'string' },
  depth: { type: 'string' },
  focus: { type: 'string' },
  compare: { type: 'string' },
  live: { type: 'boolean' },
  replay: { type: 'string' },
  data: { type: 'boolean' },
  report: { type: 'boolean' },
  old: { type: 'string' },
  new: { type: 'string' },
  slice: { type: 'string' },
  check: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const HELP = `vibekit <verb> <noun> ["<name>"] [--flags]

On a normal day it is two commands: \`vibekit show status\` in the morning, \`vibekit run\` once you have cleared it.

  new       start something that did not exist      new project "Hello World" · new sprint · new feature "…" · new bug "…" · new hotfix "…"
  use       switch what I am working on             use project "Hello World 2" · use sprint 2 · use
  show      tell me something, change nothing       show · show project · show plan · show sprint · show status · show cost · show security
                                                    show backlog · show docs · show why src/x.js:12 · show team · show migration · show differences
  plan      decide the order of work                plan project · plan sprint
  run       do work now                             run sprint · run check · run scan · run review · run docs · run
  analyze   tell me about a codebase, change nothing   analyze . · analyze <git url> · --depth quick|standard|deep · --focus security|cost|migration|quality · --compare <path>
  migrate   move software you already have          migrate upgrade "…" · migrate replatform "…" · migrate decompose "…" · migrate status · migrate next
  verify    prove the new behaves like the old      verify · verify --live · verify --replay <log> · verify --data · verify --report

  stop      stop cleanly; everything checkpointed, nothing billed
  resume    re-check the ground, then carry on
  ship      ship release 1.2.0 · ship rollback v1.1.0 · ship undo REQ-014

  settings              models, tiers, runners, caps, brand, frameworks
  design add <url>      add a design reference
  tracker               the live board, and a QR code for your phone
  ext add <name>        install an extension
  completion <shell>    shell completion: bash, zsh, fish

Flags that appear on more than one command
  --all        every show           every project, not just this one
  --json       every show           machine-readable
  --until      run sprint           blocked: stop the moment anything needs a human · gate: stop at the sprint gate
  --lanes N    run sprint           how many agents at once (default 2)
  --headless   run sprint, run check   CI form; non-zero exit if anything blocked
  --preview    new feature, new project   show the questions it would ask; write nothing
  --at <tag>   show docs, show cost, run docs   as things were at that commit
  --dir <path> anything             act on this directory (default: here, or the project \`use project\` chose)

A bare verb lists its nouns. Bare \`vibekit\` shows where you are. Every command works with no arguments and asks for what it needs.`;

export async function run(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [name, ...args] = positionals;

  if (values.help) return console.log(HELP);
  if (name === 'help') return console.log(HELP);
  // Bare `vibekit` is a question, not a mistake: answer it with where you are and what to do next.
  if (!name) {
    const { root, redirected } = await resolveRoot({ dir: values.dir });
    return console.log(await startScreen(root, { via: redirected }));
  }
  // A typo used to print the help and exit 0, so a script could not tell it from success.
  if (!COMMANDS[name]) {
    console.error(unknownCommand(name, Object.keys(COMMANDS).filter((key) => !ALIASES[key])));
    process.exitCode = 1;
    return;
  }

  // Where to act: `--dir`; else here, if there is a project here; else the one `use project`
  // chose. Commands that create or read the directory they are run in are never redirected.
  const actsHere = ACTS_HERE.has(name) || (name === 'new' && (!args[0] || args[0] === 'project'));
  const { root, redirected } = actsHere ? { root: resolve(values.dir ?? '.'), redirected: null } : await resolveRoot({ dir: values.dir });
  if (redirected && !values.json && !values.headless && !['show', 'use'].includes(name)) console.log(dim(`  in ${redirected.name} · ${redirected.path}`));

  await COMMANDS[name]({ ...values, args, root });

  if (CHANGES_STATE.has(name) && process.env.VIBEKIT_NO_INDEX !== '1') {
    const { refreshCompletionIndex } = await import('./completion.js');
    const target = name === 'use' ? (await currentProject())?.path ?? root : root;
    await refreshCompletionIndex(target).catch(() => {});
  }
}

export const commandNames = () => Object.keys(COMMANDS);
export const visibleCommandNames = () => Object.keys(COMMANDS).filter((key) => !ALIASES[key]);
