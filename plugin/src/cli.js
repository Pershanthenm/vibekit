import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { action } from './commands/action.js';
import { archdocs, archdrift } from './commands/archdocs.js';
import { bug } from './commands/bug.js';
import { design } from './commands/design.js';
import { ext } from './commands/ext.js';
import { ask, check, init, next, req, rescan } from './commands/folder.js';
import { githook } from './commands/githook.js';
import { hook } from './commands/hook.js';
import { ingest } from './commands/ingest.js';
import { clarify, config, replay, skills, testSkillsCommand, upgradePrompts } from './commands/maintain.js';
import { pause, resume } from './commands/pause.js';
import { project, stop } from './commands/project.js';
import { changelog, evidence, release, revert, ship } from './commands/release.js';
import { assumptions, plan, report } from './commands/report.js';
import { distil, reverse } from './commands/reverse.js';
import { security } from './commands/security.js';
import { serve } from './commands/serve.js';
import { add, quick, start, tracker, unhold } from './commands/shortcuts.js';
import { spec } from './commands/spec.js';
import { sprint } from './commands/sprint.js';
import { team } from './commands/team.js';
import { tools } from './commands/tools.js';
import { tour } from './commands/tour.js';
import { understand } from './commands/understand.js';
import { cost, docs, feature, hotfix, review, rollback, settings, undo, version } from './commands/verbs.js';
import { verify } from './commands/verify.js';
import { trace, why } from './commands/why.js';
import { startScreen, unknownCommand } from './guide.js';

/**
 * The command surface. Specification §67 and Appendix A.
 *
 * Commands are named after what a person is doing, grouped under the noun they act on, so typing
 * `vibekit project` or `vibekit sprint` with nothing after it lists what you can do with it. The
 * older verbs stay as aliases — same function, not a second implementation — so nothing that a
 * script or a hook already calls breaks.
 */

const COMMANDS = {
  // everyday
  project, sprint, action, feature, bug, hotfix, review, why, design, security, check, docs, report, release, rollback, undo, team, cost, settings, ext, tools,
  // the folder's own verbs (Appendix A)
  init, ingest, ask, req, add, start, unhold, tracker, serve, verify, drift: archdrift, trace, assumptions, evidence, changelog, ship, reverse, distil, clarify, skills, 'test-skills': testSkillsCommand, 'upgrade-prompts': upgradePrompts, rescan, githook, tour, spec, hook, version,
  // aliases: the earlier names, kept so nothing breaks
  stop, pause, resume, quick, revert, next, plan, understand, 'arch-docs': archdocs, config, replay, track: tracker,
};

/** Which name each alias is shown as in help and in "did you mean". */
export const ALIASES = Object.freeze({
  pause: 'project stop', stop: 'project stop', resume: 'project resume', next: 'sprint start', plan: 'sprint plan',
  understand: 'project import', 'arch-docs': 'docs', quick: 'hotfix', revert: 'undo', config: 'settings', replay: 'tools replay', track: 'tracker',
});

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
  // §67 sprint / project / bug / design / team
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
  help: { type: 'boolean', short: 'h' },
};

const HELP = `VibeKit — spec-driven development for coding agents, with a person deciding every question that matters

On a normal day it is two commands: \`vibekit action\` in the morning, \`vibekit sprint run\` once you have cleared it.

Projects
  vibekit project new [--name <n>] [--describe "<text>" | --from <file>] [--platform web,api]
                                                Start something: name it, say where it lives, say what you want
  vibekit project select [<name>] [--needs-me] [--last] [--rescan <dir>] [--forget <name>]
                                                Your projects with their state; pick one
  vibekit project status [--all]                Where this project is, or every project in one screen
  vibekit project import <repo> [--convert | --refresh | --speckit]
                                                Read an existing codebase and convert it
  vibekit project assess "<idea>"               Should this be built at all (vibekit ext add assess)
  vibekit project stop [--reason "…"] · resume  Stop cleanly; start again, re-checking the ground first

Sprints
  vibekit sprint plan [--cost]                  Turn the spec into sprints, in dependency order; a human approves
  vibekit sprint start                          Work the current sprint one piece at a time, watching
  vibekit sprint run [--lanes 2] [--until blocked|gate] [--headless]
                                                Work the current sprint with several agents at once
  vibekit sprint status                         This sprint: progress, lanes, what is blocked
  vibekit sprint close [N] --by "<name>"        Close the sprint at its gate — the one step VibeKit cannot do

Action needed
  vibekit action [--project <name>]             Everything waiting on you across every project, most blocking first
  vibekit action answer                         Walk through the questions one at a time, options as a menu
  vibekit action answer <n> "<answer>" …        One or several by number or id; reject <n> "<reason>" sends one back
  vibekit action export [--out answers.md]      A file to fill in offline; action answer --from answers.md applies it
  vibekit tracker [<project>] [--no-tunnel]     The same inbox on your phone: opens a tunnel and prints the QR code

Work
  vibekit feature add "<text>"                  Add one feature mid-project
  vibekit bug "<text>" --test <path> [--severity high|medium|low]
  vibekit bug assess|fix|test BUG-001           Work out the cause, repair it, prove the symptom is gone: a verdict
  vibekit hotfix "<text>"                       Production is broken: branch from the live tag, fix, test, release
  vibekit review [REQ] [--as reviewer | --approve --by "<name>"]
                                                The reviewer over anything waiting, out of band
  vibekit why <file[:line]>                     Why does this line of code exist

Design
  vibekit design                                What the app looks like now, and the intent behind it
  vibekit design add <url | image | pdf>        Add a reference; it says what it took and asks what it could not tell
  vibekit design preview [screen]               Render your real screens with the current design
  vibekit design apply · feedback "<text>"      Turn references into tokens; say what is wrong, against something specific

Quality
  vibekit security scan [--url <address>]       Measure against OWASP, CIS, POPIA and whatever else applies
  vibekit check [--ci] [--budget] [--security] [--deps] [--runners] [--done REQ] [--parity]
                                                Every mechanical check; this is what CI runs
  vibekit docs [hld lld api data runbook] [--at <tag>] [--diff <a> <b>] [--brand <url>]
                                                Regenerate the architecture documents and diagrams
  vibekit report build|budget|security [--all] [--at <sha>]
                                                Progress, cost and security as documents

Shipping
  vibekit release [<version>] [--phase N]       Verify, changelog, tag, bundle the evidence
  vibekit rollback <tag>                        Put the previous release back and open a hotfix with the incident note
  vibekit undo <id>                             Remove a shipped feature cleanly; dependants go to review

Setup
  vibekit init [--yes] [--adopt] [--from-speckit] [--delivery none|checks-only|full] [--no-library]
  vibekit team [add "<Name> <email>" --role "<role>" | codeowners]
  vibekit cost                                  Spend against forecast by sprint, model and piece of work
  vibekit settings [<key> <value> | tiers | frameworks | server <id> <token> | trust <name> <pub> | require-signed true]
  vibekit ext add <name|url> [--yes] · list · update [name] · remove <name> · verify <path> [--quick]
                                                Extensions: data only, never code; pinned to a commit; budget declared and verified
                                                against the three fixture briefs and golden outputs (npm run golden refreshes them)
  vibekit ext keygen [--out <dir>] · ext sign <path> --key <file>
                                                Signed releases: required before an extension leaves the organisation
  vibekit tools skills import <repo> [--dry-run] [--division d] [--rules flag|suggest|drop]
                                                Knowledge from a repository as skills: identity dropped, opinions flagged, provenance kept
  vibekit tools rates [refresh] · tools policy · tools skills test · tools replay --recovery
  vibekit check --servers                       Every MCP server in agents/servers.yml declared well, authenticated, reachable

Also
  vibekit ingest <file> [--yes] · ask · req · start · unhold · tracker [--tunnel] · serve [--stdio | --tracker] [--sandbox]
  vibekit verify · drift · trace --matrix · assumptions · evidence · changelog · ship · reverse · distil · clarify
  vibekit skills [catalogue [<word>] | enable <name|domain> | disable | adopt <name> | reference <name> | --for "<task>"]
  vibekit test-skills
  vibekit upgrade-prompts · rescan · githook · tour · spec · version

Options
  --dir <path>   Project root (default: current directory)
  --json         Machine-readable output where a command has it`;

export async function run(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [name, ...args] = positionals;
  const root = resolve(values.dir ?? '.');

  if (values.help) return console.log(HELP);
  // Bare `vibekit` is a question, not a mistake: answer it with what to do next here.
  if (!name) return console.log(await startScreen(root));
  // A typo used to print the help and exit 0, so a script could not tell it from success.
  if (!COMMANDS[name]) {
    console.error(unknownCommand(name, Object.keys(COMMANDS).filter((key) => !ALIASES[key])));
    process.exitCode = 1;
    return;
  }
  await COMMANDS[name]({ ...values, args, root });
}

export const commandNames = () => Object.keys(COMMANDS);
