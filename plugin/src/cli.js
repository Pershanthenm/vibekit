import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { adopt } from './commands/adopt.js';
import { analyze } from './commands/analyze.js';
import { advise } from './commands/advise.js';
import { check } from './commands/check.js';
import { context } from './commands/context.js';
import { dashboard } from './commands/dashboard.js';
import { scan } from './commands/scan.js';
import { wizard } from './commands/wizard.js';
import { cursorAgents } from './commands/cursor-agents.js';
import { projects } from './commands/projects.js';
import { team } from './commands/team.js';
import { dispatch } from './commands/dispatch.js';
import { health } from './commands/health.js';
import { setup, version } from './commands/setup.js';
import { docs } from './commands/docs.js';
import { feature, status } from './commands/feature.js';
import { hook } from './commands/hook.js';
import { init } from './commands/init.js';
import { knowledge } from './commands/knowledge.js';
import { lanes } from './commands/lanes.js';
import { list } from './commands/list.js';
import { memory } from './commands/memory.js';
import { merge } from './commands/merge.js';
import { next } from './commands/next.js';
import { playbook } from './commands/playbook.js';
import { standards } from './commands/standards.js';
import { sync } from './commands/sync.js';
import { verify } from './commands/verify.js';
import { security } from './commands/security.js';
import { startScreen, unknownCommand } from './guide.js';

const COMMANDS = { init, adopt, analyze, scan, sync, feature, status, list, dashboard, wizard, check, next, lanes, dispatch, merge, memory, knowledge, context, docs, advise, security, standards, playbook, verify, health, doctor: health, setup, version, 'cursor-agents': cursorAgents, 'cursor-kit': cursorAgents, team, projects, hook };

const OPTIONS = {
  dir: { type: 'string' },
  from: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  engine: { type: 'string' },
  'dry-run': { type: 'boolean' },
  fix: { type: 'boolean' },
  json: { type: 'boolean' },
  open: { type: 'boolean' },
  out: { type: 'string' },
  static: { type: 'boolean' },
  serve: { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  tunnel: { type: 'boolean' },
  limit: { type: 'string' },
  'still-accurate': { type: 'boolean' },
  run: { type: 'boolean' },
  repeat: { type: 'string' },
  live: { type: 'boolean' },
  only: { type: 'string' },
  timeout: { type: 'string' },
  remove: { type: 'boolean' },
  repo: { type: 'string' },
  skip: { type: 'string' },
  paths: { type: 'string' },
  prune: { type: 'boolean' },
  version: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const HELP = `VibeKit — spec-driven, multi-agent development for Claude Code and Cursor

Usage
  vibekit setup [--dry-run] [--yes] [--only a,b] [--json]
                                                         Install, configure and start what this machine/project needs
  vibekit health [--live] [--json]                     Check everything (--live proves Claude, Cursor, memory end to end)
  vibekit init [--yes | --from <file.json>] [--force]  Menu-driven setup: requirements → stack recommendation → project
  vibekit adopt [--force] [--json]                     Adopt an existing codebase: detect the as-is stack and write as-is docs
  vibekit advise [domain "<idea>" | next | recommend | apply [preset] | components [layer] | presets | prefer <ids...>]
                                                         Platform-first menus; per-layer stack and licence advice
  vibekit sync [--force]                               Regenerate agent files from specs/project.json
  vibekit feature "<name>"                             Scaffold specs/features/NNN-name/
  vibekit status <feature> <status>                    draft | approved | planned | in-progress | done
  vibekit list                                         Features with status and progress
  vibekit wizard [--out <file>]                        Fill in the project spec in a browser, then: vibekit advise apply
  vibekit dashboard [--serve [--port <n>] [--host 0.0.0.0] [--tunnel]] [--open] [--out <file>] [--static] [--json]
  vibekit scan [--json] [--open] [--out <file>]
                                                         Lifecycle and test status. --serve streams changes and lane output
                                                         live, under a random path that changes every start
  vibekit check                                        Validate specs and detect drift (exit 1 on problems)
  vibekit analyze [feature] [--fix] [--json]            Do the spec, plan, tasks and tests agree? (exit 1 on contradictions)
                                                         --fix appends criteria with no task or no test to tasks.md as work
  vibekit next [--json]                                The next workflow step (what /run executes)
  vibekit lanes <feature>                              Ready [P] lanes, or the status of dispatched lanes
  vibekit dispatch <feature> [--engine cursor|claude|manual] [--dry-run]
                                                         One git worktree + headless agent per lane
  vibekit merge <feature>                              Merge finished lanes back and clean up worktrees
  vibekit memory <status | list | search "<q>" | recall "<q>" | remember "<fact>">
  vibekit memory <correct <id> "<fact>" | forget <id>... | capture [<kind>...]>
                                                         Shared long-term memory via agentmemory:
                                                         see what it holds, fix it, and choose what
                                                         vibekit records without being asked
  vibekit knowledge <status | search "<q>" | manifest [folder] | publish>
                                                         Curated cross-project knowledge via OpenContext
  vibekit context <feature id | topic>                 One brief from memory + knowledge
  vibekit docs <status | new <kind> [feature] | stamp <path...> [--still-accurate]>
                                                         Living docs & diagrams with freshness tracking
  vibekit security [questions | apply | status]       Security baseline by menu, tailored to your stack
  vibekit playbook [name]                                The instructions behind the steps that have no slash command
                                                         of their own, and your imported team skills. No name lists them
  vibekit standards <list | index | inject "<task>" | discover>
                                                         Your coding standards, injected only where relevant.
                                                         discover reports which areas of the code have none
  vibekit verify [feature] [--run] [--repeat <n>]      Trace acceptance criteria to tests, and run each suite n times (flaky ≠ passing)
  vibekit projects [--prune] [--json]                  Every VibeKit project on this machine: where it is and what's next
  vibekit team <capture | status> [--skip a,b]         Put your skills, subagents and plugins into the plugin, so every dev gets them
  vibekit team import-ecc <names> [--version x]        Import chosen Everything Claude Code skills, agents and commands into the team kit
  vibekit cursor-kit [--remove]                        Install (or remove) the subagents and team skills for Cursor
  vibekit hook <session-start|pre-edit|stop>           Claude Code hook entry points (used by the plugin)

Options
  --dir <path>   Project root (default: current directory)
  --force        Overwrite files vibekit did not generate / bypass status gates`;

export async function run(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [name, ...args] = positionals;
  const root = resolve(values.dir ?? '.');

  if (values.help) return console.log(HELP);
  // Bare `vibekit` is a question, not a mistake: answer it with what to do next here.
  if (!name) return console.log(await startScreen(root));
  // A typo used to print the help and exit 0, so a script could not tell it from success.
  if (!COMMANDS[name]) {
    console.error(unknownCommand(name, Object.keys(COMMANDS)));
    process.exitCode = 1;
    return;
  }
  await COMMANDS[name]({ ...values, args, root });
}
