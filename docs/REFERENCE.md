# Vibe-check-cli — full reference

The complete feature and configuration reference. For an overview, see the [README](../README.md); to set up a machine, see [ONBOARDING.md](../ONBOARDING.md).

An always-on, spec-driven agent workflow. **Claude Code is the orchestrator; Cursor agents are parallel workers; the specs are the contract between them.**

```
                 ┌───────────── specs/ (the contract) ─────────────┐
                 │ project.json · features/<id>/spec · plan · tasks │
                 └───────────────▲─────────────────────▲───────────┘
                                 │ reads/writes         │ reads only
 You ── approve gates ──▶  Claude Code (orchestrator)   │
                           hooks: always on             │
                           /vibe-check-cli:run loop          │
                                 │ vibecheck dispatch   │
                     ┌───────────┼───────────┐          │
                     ▼           ▼           ▼          │
                 lane-1       lane-2      lane-3 ───────┘
                 Cursor agent in its own git worktree + branch
                                 │ vibecheck merge
                                 ▼
                 Claude verifies (lint · typecheck · tests), ticks tasks, reviews
```

**New developer?** Follow [ONBOARDING.md](../ONBOARDING.md) (Windows, Mac, Linux). **Setting up on your own?** Everything runs inside Cursor with the Claude Code extension. Step by step for [Mac](../SETUP-MAC.md) or [Windows](../SETUP-WINDOWS.md). **Sharing one setup with your team:** [TEAM.md](../TEAM.md).

**Fastest start:** `bash plugin/scripts/bootstrap.sh --minimal` on macOS, Linux or WSL2, or `plugin\scripts\bootstrap.ps1 --minimal` on Windows (either can be run by Claude itself, with `--yes`). It installs Node if needed, then `vibecheck setup` works out what your machine and project need, asks before each install, configures and starts local services, and finishes with `vibecheck health`. Run `vibecheck health --live` any time to prove the whole chain: Claude Code answers with the Vibe-check-cli hooks loaded, Cursor answers headlessly, and memory round-trips.

**New here? Read [GUIDE.md](../GUIDE.md)**: the operating manual for multi-agent scaffolding, testing, validating against the spec, security and frontend design with Claude Code + Cursor.

## Install (inside Claude Code)

```text
/plugin marketplace add /path/to/vibe-check-cli        (or owner/repo once you push it to GitHub)
/plugin install vibe-check-cli@vibe-check-cli
/reload-plugins
```

The plugin puts the `vibecheck` CLI on Claude Code's PATH, registers the hooks and adds the `/vibe-check-cli:*` skills. No separate terminal needed. Optional: `npm install -g ./plugin` to use `vibecheck` in a normal terminal too.

**Required tools.** `vibecheck setup` installs **Docker**, the **Cursor CLI** (`cursor-agent`) and **agentmemory** on every machine, alongside Node.js, Git and Claude Code. These are requirements rather than per-project extras: a project that picks one engine or memory provider would otherwise never install the others, and the gap only surfaces the day you switch. Run `vibecheck setup --dry-run` to see the plan without changing anything, and `vibecheck health` to see what is still missing.

Two costs worth knowing up front. Docker Desktop is a heavy install that wants a reboot, and it is now proposed on every machine. And agentmemory has **no automatic install on native Windows**: setup prints it as a manual WSL2 step rather than running it, so `vibecheck health` keeps reporting it until you move to WSL2 or accept a standing red line. Sign-ins are yours to do: `agent login` for the Cursor CLI, and `claude` once for Claude Code.

**Memory (agentmemory).** Start the memory server once (`npx -y @agentmemory/agentmemory@latest`, keep it running), then `/plugin install agentmemory@agentmemory` (projects created by Vibe-check-cli already list its marketplace and enable it in `.claude/settings.json`). For Cursor, run `agentmemory connect cursor` or install its Cursor plugin, so Cursor agents read and write the same memory.

**Knowledge library (OpenContext).** `npm install -g @aicontextlab/cli`, then run `oc init` **from your home directory**. It sets up OpenContext's MCP server and `/opencontext-*` skills for Claude Code and Cursor at user level. It also rewrites the `AGENTS.md` of whatever repo you run it in; if that happens in a Vibe-check-cli project, `vibecheck sync --force` restores it. Optionally install the OpenContext desktop app to browse and edit the library. See "Three layers of context" below.

## The process

**Day 1 — specify.** In an empty folder, open Claude Code (in Cursor's Claude Code panel) and run:

```text
/vibe-check-cli:new-project a meal-planning app for web, iOS and Android
```

Claude scaffolds `specs/`, interviews you (product, targets, stack, architecture, standards, quality bar, autonomy, parallel engine), writes the project spec, ADRs, a `foundation` feature (skeleton, tooling, CI) and one draft spec per v1 capability. It then asks you to approve the foundation spec.

**Every day after — run.** Say "continue" or run `/vibe-check-cli:run`. Claude loops through `vibecheck next`:

| Feature status | What Claude does | Stops for you? |
|---|---|---|
| `draft` | Completes the spec, lists open questions | **Yes — spec approval** |
| `approved` | Architect subagent writes plan + tasks, designed for parallel lanes | **Yes — plan approval** (only when `autonomy: gated`) |
| `planned` / `in-progress` | Sequential tasks: test-engineer then implementer subagents. A ready block of `[P]` tasks: dispatched to Cursor agents in worktrees, then merged | No |
| all tasks ticked | Read-only reviewer writes `review.md`; fixes on your OK; marks `done` | Only if there are blocking findings |

Then it moves to the next feature. Every step ends with verification, `vibecheck check` and a commit.

**Where Cursor fits.** Plans put shared groundwork (contracts, schema) first, then a block of `[P]` tasks with disjoint files (API · web UI · mobile UI), then integration and e2e. Claude runs `vibecheck dispatch <id>` in the background: one git worktree and branch per lane, dependencies installed, one headless `cursor-agent` per lane with a focused brief. Lanes commit with task ids and never touch `specs/`. When they finish, `vibecheck merge <id>` merges each branch, removes worktrees and hands back to Claude to verify and tick tasks.

Prefer watching agents in Cursor's UI? Set `"engine": "manual"`. Dispatch then only prepares the worktrees and prompt files; open each worktree in Cursor, start an agent, paste its prompt, and tell Claude when they're done. `"engine": "claude"` uses headless Claude Code instead.

## Adopting an existing codebase

Most work isn't greenfield. `vibecheck adopt` points Vibe-check-cli at a repository that already
exists and describes it **as it is**, without a rewrite.

It walks the tree once and detects languages by share of files, plus frameworks and versions from
`package.json`, `*.csproj`, `packages.config`, `pom.xml`, `build.gradle`, `requirements*.txt`,
`pyproject.toml`, `composer.json` and `go.mod`. Dependency and build folders (`node_modules`,
`bin`, `obj`, `vendor`, `packages`, …) are skipped, so vendored code can't skew the result.

It writes four things:

| File | What it holds |
|---|---|
| `specs/project.json` | The as-is stack, marked `"origin": "adopted"` |
| `assessment/adopt.md` | What was found, what was **not**, and every manifest it read |
| `docs/architecture.md` | As-is structure from the top-level folders |
| `docs/data-model.md` | An `erDiagram` parsed from EF6 or EF Core migrations, stamped against them |

**Nothing is guessed.** Where a command can't be detected it is left empty and listed under "Not
determined" — including where a language preset would otherwise have supplied a plausible
default. An invented test command is worse than an absent one, because agents trust it. For the
same reason the data model shows columns but never infers relationships, and says so plainly when
no migration parses rather than emitting an empty diagram.

Adopting a repository that already has `specs/project.json` changes nothing: it reports what it
would have recorded and exits. Use `--force` to overwrite, `--json` for machine-readable output.

Existing code needs no specs. New work goes through features as usual.

**One consequence to expect:** `vibecheck check` requires a test command, so an adopted project
isn't green until you supply one. That's deliberate — agents have no way to verify their work
without it.

Assess, modernize and migrate are specified but not built. See
[BROWNFIELD.md](BROWNFIELD.md), which marks every acceptance criterion as built or not.

## Claude Code and Cursor, working together

| Role | Who | How |
|---|---|---|
| Orchestrator | Claude Code (panel in Cursor) | Specs, plans, dispatch, merge, verification, review; kept on the workflow by hooks |
| Builders | Cursor agents and Claude agents | One lane each, in its own git worktree |
| Shared brain | Both | `AGENTS.md`, `specs/`, Cursor rules, agentmemory, OpenContext |

Route lanes to whichever agent suits the work, by the files a lane touches:
```jsonc
"workflow": {
  "engine": "claude",                                   // default for lanes no route matches
  "routes": [
    { "match": "src/*.WebApp/**|web/**", "engine": "cursor" },   // front end → headless Cursor agent
    { "match": "src/*.Mobile/**", "engine": "manual" }            // mobile → you, in Cursor's Agents window
  ]
}
```
`vibecheck lanes <id>` shows who gets each lane before you dispatch. A lane goes to the route that matches most of its files; ties go to the earlier route.

## Any platform, any stack, any licensing policy

Vibe-check-cli doesn't assume you build web apps. The first question is what you're building first (web, mobile, desktop, or an API/backend), and every later round adapts:

| Round | Questions |
|---|---|
| What you're building | platform · also on (other platforms) · app type · expected users |
| Constraints | licensing · ecosystem (Microsoft, Google, open source) · team skills · where the data lives (including offline-first on the device) |
| Architecture and security | architecture · sign-in · security controls · compliance |
| Stack | one question per layer your app actually needs: backend (including backend-as-a-service or none), web, mobile, desktop |
| Data and delivery | database (skipped for backend-as-a-service) · hosting (only when there's a server) · integrations |
| Agent workflow | autonomy · parallel engine · memory, knowledge and living docs |

Every question has up to four options, picked with arrow keys: Claude Code's menus in `/vibe-check-cli:new-project`, or `vibecheck init` / `vibecheck advise` in a terminal. "Other" is always available.

**36 components across five layers**, each with its real licence:

| Layer | Components |
|---|---|
| Backend | ASP.NET Core, Laravel, NestJS, FastAPI, Django, Spring Boot, Go, Rails, Supabase, Firebase, none (local-only) |
| Web | Vue, Next.js, Angular, SvelteKit, Blazor, server-rendered + HTMX, Flutter web |
| Mobile | Flutter, React Native (Expo), .NET MAUI, native (SwiftUI + Compose), Kotlin Multiplatform, Ionic Capacitor |
| Desktop | Tauri, Electron, Avalonia, WPF, Qt, Compose Multiplatform, Flutter, .NET MAUI, Kotlin Multiplatform |
| Database | PostgreSQL, MySQL, MariaDB, SQL Server, SQLite, MongoDB |

**Licensing is a hard filter, based on each component's licence class:**

| Policy | Allows | Rules out, for example |
|---|---|---|
| Permissive open source only | MIT, Apache, BSD, public domain; vendor SDKs the platform requires | MySQL and MariaDB (GPL), Qt (LGPL), MongoDB (SSPL), Firebase and SQL Server (proprietary) |
| Any open source | also GPL, LGPL, MPL | MongoDB (SSPL), Firebase, SQL Server |
| Open source preferred | everything, with a −2 penalty for proprietary and source-available | nothing |
| Commercial is fine | everything | nothing |

**Scoring is transparent and cross-layer aware:** team languages, ecosystem, hosting fit (e.g. IIS favours ASP.NET Core), app type, scale and compliance. Layers also inform each other: Flutter desktop and web score higher when you picked Flutter for mobile, MAUI when the backend is .NET, HTMX only with a server-rendering backend, SQLite when there's no server. Every point shows up in the recommendation and in the technology-selection ADR, alongside the licences and the excluded options.

**Bring your own stack:**
- Type any technology under "Other" on a layer. It's recorded as your choice; set its commands in `specs/project.json`.
- Or add components permanently in `~/.vibecheck/components.json`. They're scored like built-ins (language and licence rules, preferences):
  ```json
  [{ "id": "phoenix", "layer": "backend", "label": "Elixir Phoenix", "languages": ["Elixir"],
     "licence": { "name": "MIT", "class": "permissive" }, "summary": "Fault-tolerant realtime framework",
     "testing": "ExUnit", "commands": { "install": "mix deps.get", "test": "mix test", "lint": "mix credo" } }]
  ```
- Mark favourites: `vibecheck advise prefer aspnetcore vue postgres`, or a whole preset, `vibecheck advise prefer dotnet-vue` (+3 each).
- Skip the questions with a preset: `vibecheck advise apply flutter-supabase` (see `vibecheck advise presets`: dotnet-vue, dotnet-blazor, php-laravel, node-ts, python-django, java-spring, flutter-supabase, local-desktop).

The result fills in `project.json`: targets, stack per layer, repository layout (one folder per code layer; the .NET house layout keeps `src/<App>.WebApp`), sign-in libraries for the backend, hosting or app-store/installer distribution, and combined install/lint/test/build commands across layers.

## Security baseline, by menu

Straight after the stack choice, security rounds pick controls tailored to that stack and your earlier answers. SSO moves account protection to your identity provider; open-source-only policies remove paid secret managers; SaaS adds tenant isolation; Windows hosting drops container scanning. Device-only apps skip server questions, and mobile and desktop apps get client protections (OS keystore, signed releases, verified updates, certificate pinning). Secure defaults are pre-selected, and your compliance level marks controls as required. Deselecting a required control records it as an accepted risk.

Applying the baseline (`vibecheck security`, or the menus in `/vibe-check-cli:new-project`):
- stores the controls in `specs/project.json` and generates `specs/security.md` (implementation per control for your stack, ASVS references);
- adds the rules to AGENTS.md and a Cursor rule for auth, config and data-access files;
- adds one acceptance criterion per control to the foundation feature, so the scaffold is built securely and each control is proven by a test;
- creates `.github/workflows/security.yml` (gitleaks, Semgrep, stack-native dependency audit, Trivy, optional ZAP) and a living threat-model doc;
- saves a summary to agentmemory and the baseline to OpenContext.

37 controls in the catalogue, each with a testable acceptance criterion and an implementation for .NET, PHP, Node, Python and Java (generic guidance for other stacks).

## Smoke and UI testing, with evidence

Every stack gets three suites in `project.json`: `test` (unit and integration), `smoke` (a few fast checks of the critical paths against a real build) and `ui` (browser, mobile or desktop UI tests with accessibility checks). Defaults per stack include Playwright for web (smoke = `--grep @smoke`), Flutter integration tests or Maestro for mobile, UI-category tests for .NET desktop, and `pytest -m smoke` for Python.

Plans must give every visible acceptance criterion a UI test and the critical path a tagged smoke test. `vibecheck verify <id> --run` runs all three suites, traces criteria to tests, and records the result as evidence for the exact commit (kept in `.git/vibecheck/`, never committed). A feature can't be done unless that evidence exists, was taken on a clean commit, matches the current commit, and every defined suite passed. Change code afterwards and the evidence is stale.

**Repeat runs catch flaky tests.** Set `standards.testing.runs` (default `1`) to the number of times each suite must pass, or pass `--repeat <n>` for a single invocation. A suite that passes on some runs and fails on others is recorded as **flaky**, and a flaky suite does not count as evidence — the gate reports `passed 2 of 3 runs` and blocks, rather than accepting whichever run happened to come out green. A suite that fails every time is a plain failure, not a flake, and is reported as such: the two need different fixes. Evidence recorded with fewer runs than the project now requires is rejected too, so raising `runs` invalidates old evidence instead of silently grandfathering it.

## Traceability: code validated against the spec

Tests name the criterion they prove: `003:AC-2 rejects assigning a retired laptop`. `vibecheck verify [feature] [--run]` maps every criterion to its tests (flagging untested criteria, and tests pointing at criteria that don't exist) and optionally runs the suite. A feature can't be marked done while any criterion is untested; switch that off with `workflow.traceability: false`.

## Living documentation: docs, diagrams and designs that can't go stale

Docs live in `docs/` and describe how the system works **now**; specs describe intent. Diagrams are Mermaid, so they render in GitHub, Cursor, VS Code and OpenContext, and diff cleanly in reviews.

| Document | Required when | Diagram it must contain | Sources it tracks |
|---|---|---|---|
| `docs/architecture.md` | always | context/container flowchart or C4 | `project.json`, `01-architecture.md`, ADRs |
| `docs/data-model.md` | a database is in the stack | `erDiagram` | architecture spec + your schema/migration files |
| `docs/deployment.md` | hosting is set | flowchart or C4Deployment | `project.json`, ADRs |
| `docs/design/system.md` | web/mobile/desktop targets | — (tokens, components, design-file links) | `project.json`, NFRs |
| `docs/features/<id>.md` | every feature, before done | sequence, flow or state | the feature's spec, plan and the code files in its tasks |
| `docs/design/<id>.md` | the plan has UI states | user flow | same as the feature doc |
| `docs/roadmap.md` | generated | features by status | feature statuses |

**How staleness is detected.** Each document declares `sources` in its front matter. `vibecheck docs stamp` fingerprints those files. When any of them changes, the document is stale until someone updates it and stamps it again. Stamping refuses docs with TODOs, invalid Mermaid, a missing required diagram, or an unchanged body after the sources moved. For that last case, `--still-accurate` records a deliberate "I checked, nothing to change".

**How it's enforced:**
- **Re-architecting** (`project.json`, the architecture spec, ADRs): stamped docs that depend on them become errors immediately. The Stop hook won't let Claude end the turn until the diagrams are updated. `/vibe-check-cli:rearchitect <change>` runs the full flow: ADR for your approval, spec updates, every affected diagram, and a migration feature for code that has to move.
- **Building:** code changes make feature docs stale. That's a warning mid-feature, but `vibecheck status <id> done` refuses until the feature doc (and design doc for UI) is fresh.
- **Planning:** no feature can be planned until the architecture doc is written and stamped.
- **Every session** starts with a list of documents needing attention. Plans get a `## Documentation` section and end with a `[docs]` task. The reviewer checks docs against the code, and lane merges prompt a docs check.

Commands: `vibecheck docs status`, `vibecheck docs new <kind> [feature]`, `vibecheck docs stamp <path...> [--still-accurate]`, plus the `/vibe-check-cli:docs` skill that rewrites flagged docs from their sources. With knowledge on, `vibecheck knowledge publish` shares the living docs to OpenContext too. Turn it off with `"docs": { "enabled": false }`.

## Three layers of context

| Layer | Holds | Scope | Written by |
|---|---|---|---|
| `specs/` in the repo | What this project must do: contract, plans, ADRs | This project, versioned in git | You + Claude, through the gated workflow |
| [agentmemory](https://github.com/rohitg00/agentmemory) | What happened: decisions, failures, fixes from past sessions | Automatic, searchable | Captured by hooks, plus Vibe-check-cli milestones |
| [OpenContext](https://github.com/0xranx/OpenContext) | What you know: your playbook, API contracts, pitfalls, finished feature records | Curated, every project | You (/opencontext-iterate), plus Vibe-check-cli publishing |

When they disagree, files in `specs/` win and agents flag the conflict.

`vibecheck context <feature|topic>` merges memory and knowledge into one brief. The same brief is injected at session start (for the next feature) and embedded in every Cursor lane brief. Lanes run on your machine, so they can open the OpenContext documents the brief points to.

**OpenContext in the workflow:**
- **New project:** `/vibe-check-cli:new-project` reads your `playbook` folder first and uses it for its recommended defaults (preferred stacks, standards, known pitfalls), citing the document each default came from. Your standards follow you from project to project.
- **Planning:** `vibecheck context <id>` surfaces relevant documents alongside memories.
- **Feature done:** a feature record (problem, acceptance criteria, approach, review verdict) is published to `projects/<name>/` in your library.
- **Anytime:** `vibecheck knowledge publish` shares product, architecture, standards and every ADR, so the next project can reuse them.
- **Commands:** `vibecheck knowledge status | search "<q>" | manifest [folder] | publish`.

Searches use OpenContext's keyword mode, so no embedding costs are triggered. Semantic search stays opt-in through `oc index build`.

### agentmemory details

[agentmemory](https://github.com/rohitg00/agentmemory) is one local server (REST/MCP on `:3111`, viewer on `:3113`) shared by Claude Code and Cursor.

| Who | Does what |
|---|---|
| agentmemory's own plugins | Capture every Claude Code and Cursor session automatically (tool calls, prompts, summaries) and expose `memory_smart_search`, `memory_save` and friends |
| Vibe-check-cli, automatically | Saves milestones: spec approved (problem, acceptance criteria, out of scope), feature done (review verdict), lane merges (which lanes merged, conflicted or produced nothing) |
| Vibe-check-cli, at session start | Recalls memories relevant to the *next* feature and injects them with the workflow state |
| Vibe-check-cli, at dispatch | Embeds relevant memories in every lane brief, so headless Cursor agents get the context even without their own memory setup |
| Skills | Plan: recall before designing. Merge and review: save lessons worth keeping |

Manual use: `vibecheck memory status`, `vibecheck memory recall "auth tokens"`, `vibecheck memory remember "Chose jose over jsonwebtoken for Edge runtime support"`.

Everything memory- and knowledge-related fails open. If the server is down, the workflow runs as before; `vibecheck memory status` tells you why. Files beat memory: when a memory contradicts a spec or ADR, agents are told to trust the files and flag the conflict. Remote or secured server: set `AGENTMEMORY_URL` and `AGENTMEMORY_SECRET` in your environment (never in `project.json`).

## What's always on

| Hook | Effect |
|---|---|
| `SessionStart` (startup, resume, clear, compact) | Injects the orchestrator protocol, every feature's status and the next step, so each session and each post-compaction context starts in the workflow |
| `PreToolUse` on Write/Edit | Blocks code edits unless a feature is `in-progress`; blocks hand-edits to generated files. `specs/`, `.claude/`, `.cursor/` and root docs stay editable |
| `Stop` | Runs `vibecheck check`; if specs are inconsistent, Claude must fix them before finishing (once per turn, loop-safe) |

Hooks are silent in folders without `specs/project.json`, so installing the plugin at user level is safe.

## Pinning down what you are building

"A stock management app" is not a brief. Neither is "a recipe app". Until you know what the
thing tracks and how one of them behaves, a stack is a guess dressed as a decision — so
`new-project` asks about the **subject** before it asks about platforms or frameworks.

There is deliberately **no catalogue of app types**. Encoding stock apps, booking apps and CRMs
would make those good and everything else second-class, and the list would never end. Instead
five dimensions are asked for every app, because each one changes what gets built:

| Dimension | Why it is asked |
|---|---|
| **Subject** | The main entity; the data model, screens and reports all hang off it |
| **Identity** | Individually identified things need their own history; bulk things need a count and a threshold. Different data models, expensive to change later |
| **Lifecycle** | The states are the workflow — they decide screens, permissions and most reports |
| **Actors** | Roles decide authorisation, the most expensive thing to retrofit |
| **Proof** | What it must show later decides auditing, retention and how much of the security baseline applies |

`vibecheck advise domain "<idea>" --json` returns those dimensions with `why` each matters and
`guidance` on asking it. The options it ships are bland fallbacks: the agent replaces them with
concrete choices drawn from the user's own words.

```
"a stock management app"  → IT equipment · stationery and consumables · parts · goods for sale
"a recipe app"            → recipes · ingredients and pantry stock · meal plans · shopping lists
"something for my band"   → gigs · songs and setlists · gear · fans and mailing list
```

Generating the options is judgement a model does well and a lookup table cannot scale to, which
is why that half is an instruction rather than data. A label like "items" or "records" is
treated as a failure: one that fits any app tells you nothing.

## Filling the spec in a browser: `vibecheck wizard`

Some people would rather not answer twenty questions in a terminal. `vibecheck wizard [--out
<file>]` writes a self-contained HTML form and opens it: the same questions, the same stack
catalogue, the same starters, as a page you can scroll, revisit and change your mind in.

It is generated **from the same catalogue the CLI asks from** — `questions.js`, `components.js`
and `starters.js` — so the two can never offer different stacks. Add a component to the catalogue
and it appears in the form on the next run; nothing is retyped into the page.

The page decides nothing. It produces one thing: the `requirements.json` that `vibecheck advise
apply --from` and `vibecheck init --from` already accept. The recommendation, the licence
exclusions and the validation all still happen in the CLI, where they are tested.

- Questions that do not apply are **hidden rather than ignored** — no mobile question for a
  web-only project, no database question when the backend is a BaaS, no hosting question when
  nothing is hosted. The rules mirror `neededLayers()` in `questions.js`.
- Options your licence policy forbids disappear as soon as you choose the policy, so the form
  never offers something the CLI would refuse.
- A step in the progress rail turns green only when every question **still showing** inside it is
  answered, so conditional questions cannot leave a step stranded.
- You can hand it over half-finished. It says what is unanswered and Claude Code asks about the
  rest.

It shares its design with `vibecheck dashboard` — one rail, one palette, one set of components —
so setting a project up and then tracking it look like one product rather than two.

Like the dashboard it is written to `.git/vibecheck/` (or `.vibecheck/` outside a git repo), never
into `specs/`, so it cannot dirty the working tree.

## Boilerplate, when one actually fits

Once a stack is chosen, `vibecheck advise` offers **starters** — ABP, ASP.NET Zero, the Clean
Architecture solution template, JHipster, Cookiecutter Django, Full Stack FastAPI, a Laravel
starter kit, Nest CLI, create-t3-app, Refine, Next.js + Supabase, Very Good CLI — or generating
the structure from scratch.

Two rules keep this honest:

- **Keyed on the stack, never on the domain.** A starter is offered because it fits the backend,
  frontend and database you picked, not because someone decided a booking app should use one. A
  starter whose `needs` are unmet, or that clashes with any layer already chosen, is not shown.
- **The licence and the price are shown up front.** ABP is LGPL-3.0; ASP.NET Zero is commercial
  and paid. Under a permissive-only policy the copyleft and commercial ones are filtered out
  before you see them, the same way components are.

Choosing "from scratch" is a first-class answer, not a fallback.

## Start from requirements you already have

Not every feature starts from a blank menu. `vibecheck feature "<name>" --from <file>` reads a
requirements document you already wrote — a bulleted list, a numbered spec, a page of prose —
and seeds the feature's acceptance criteria from it.

What matters is what it does with the weak lines. Each requirement is checked for an actor, an
observable outcome, measurable wording and whether it is decided at all. Anything that fails is
**kept and marked**, never dropped:

```
- [ ] AC-3: Asset tags should be easy to enter.  <!-- TODO(unknown): no actor — who does this?;
      no observable outcome — what is true afterwards?; unmeasurable wording -->
```

It then reports how many are testable as written, lists the gaps with line numbers, and says
whether the document is a reasonable starting point or too thin — in which case
`/vibe-check-cli:clarify` asks about the gaps by menu and writes the answers back into the spec.

The same applies to an existing feature: run `/vibe-check-cli:clarify` on it and
`vibecheck analyze` to see which criteria are still undecided.

## Design before build, with a stop in the middle

A layout settled after the code is written means building the screen twice. `new-project` now
has a design step, and `/vibe-check-cli:design` can be run on any feature:

1. Artboards are generated for the screens the acceptance criteria imply — every state they
   require, not only the happy path.
2. **It stops.** You get the canvas link and it waits, the same way spec approval waits. You
   edit the canvas yourself; the version handed over is rarely the version approved.
3. The artboard you approve is recorded in the feature's design doc front matter
   (`artboard`, `canvas`, `approved_by`).
4. A feature targeting **web, ios, android or desktop** cannot move to `in-progress` until that
   record exists. A feature with no screens — an API, a migration, CI — is never gated.

It prefers the Claude Design MCP server, which needs connecting once:

```bash
claude mcp add --scope user --transport http claude-design https://api.anthropic.com/v1/design/mcp
/design-login
```

With a design system already in the repo, `/design-sync` pulls it in first so artboards start
from your real components. Without the MCP server it falls back to the built-in `/design`
canvas and says which route it used, rather than implying a design system was applied.

The record lives in a living doc, so the gate is off when `docs.enabled` is false — there would
be nowhere to write it. `workflow.design: false` turns it off for teams who design elsewhere.

## Code review is a gate, not a suggestion

Every feature is scaffolded with `specs/features/<id>/review.md`, and a feature cannot reach
`done` until it holds an approving review. Passing tests are not the same as a reviewed change.

The gate refuses when:

- no review is recorded, or the front matter has no `verdict`;
- the verdict is `changes-requested`;
- an unticked `BLOCKER` or `MAJOR` finding remains;
- the `commit` the review names is not the current one — a review of code that has since
  changed does not count, exactly as stale test evidence does not.

Recording the review is itself a commit, so a commit that touches **only** `review.md` leaves
both the review and the test evidence valid. Anything else means the code moved on.

In a project with no git repository there is no commit to tie a review to, so the verdict alone
is the gate — the same way the evidence gate steps aside without git.

`/vibe-check-cli:review-feature` delegates to the read-only **reviewer** subagent and writes the
file. Teams that review somewhere else (GitHub PRs, for example) can set
`workflow.review: false` in `specs/project.json`, alongside `traceability` and `evidence`.

## Watching it happen: `vibecheck dashboard`

`vibecheck dashboard [--open] [--out <file>] [--static] [--json]` renders the whole lifecycle to a
single self-contained HTML page: every feature's stage, its criteria and task progress, which
gates pass, block or are switched off (with the reason on hover), any running lanes, and the next
action. No scripts, no network, no build step.

It is also the **test dashboard**. Across the top: how many suites are healthy, and per feature a
table of every suite with its result, how many runs passed out of how many were required, how long
it took and the exact command. A flaky suite is labelled flaky, never shown as a tick — the page
exists to say what is true, and "passes sometimes" is not passing. It names untested criteria
rather than only counting them, and marks evidence recorded against an older commit as stale.

Rail navigation is anchors, not click handlers, and there are **no scripts and no web fonts** — a
blocked font request would leave a page opened from `file://` on a locked-down machine rendering
in Times. It follows your system light or dark theme, and works down to phone width.

`vibecheck setup`, `vibecheck dispatch` and interactive `vibecheck init` open it automatically and
refresh it as they go, so there is something to watch while a project scaffolds itself — during
setup it rewrites after every tool. The page carries a short meta-refresh; `--static` drops it for
a copy you intend to share rather than watch.

It is written to `.git/vibecheck/`, never into `specs/`. A generated file inside the working tree
would leave it dirty, which makes `vibecheck merge` refuse to run and makes the evidence gate
record a dirty commit — a page that reports on the lifecycle must not be able to block it. Set
`VIBECHECK_NO_OPEN=1` (or run in CI) to write the page without launching a browser.

## Do the artefacts agree? `vibecheck analyze`

`vibecheck check` validates the schema and detects drift. `vibecheck verify` traces acceptance
criteria to tests. Neither asks whether the spec, the plan and the tasks **agree with each
other** — and that is where specs quietly rot.

`vibecheck analyze [feature] [--fix] [--json]` reports, per feature:

| Problem | Why it matters |
|---|---|
| An acceptance criterion with no task | It will not get built, and nothing will say so |
| A task pointing at a criterion the spec does not define | The spec changed and the tasks did not |
| A task naming no criterion, or no files | Lanes cannot tell whether it overlaps another task |
| Two `[P]` tasks sharing a file | `[P]` promises they do not; dispatched lanes would collide |
| A criterion still saying TODO, TBD or ??? | It cannot be turned into a passing test |
| A planned feature with an empty or TODO plan | The status claims more than the artefacts support |
| A criterion with no test naming it | Carried through from `verify` |

It exits 1 when anything is found, so it belongs in CI beside `vibecheck check`. The output
names contradictions between artefacts: fix the artefacts, not the report.

### Appending the missing work: `--fix`

Two of those rows describe work that is simply *missing*: a criterion with no task, and a criterion
with no test. `--fix` writes them into `tasks.md` — a `[test]` and an `[impl]` task for a criterion
nobody planned, a `[test]` task alone for one that is planned but untested. Running it again appends
nothing, so it is safe in a loop.

The other rows are not appendable, and `--fix` leaves them alone. An orphan task, a lane clash, a
criterion still saying TODO, a planned feature with an empty plan — each is two artefacts
disagreeing, and appending a task would paper over a decision somebody has to make.

An appended task names no files, because nothing knows yet which files it touches. `analyze` keeps
reporting it as "names no files" until someone decides — the same state a freshly scaffolded
`tasks.md` starts in. That is the point: the gap moves from invisible to written down in the file
where planning happens.

Two skills cover the judgement half, which a CLI cannot do:

- **/vibe-check-cli:clarify** — reads a spec for what it does *not* say (undefined nouns, unset
  limits, uncovered states, missing error paths) and asks the user through menus **before** a
  plan exists. Answers go into the spec; anything still unknown is written as
  `TODO(unknown): <question>` rather than guessed.
- **/vibe-check-cli:checklist** — generates per-feature checks for the states, boundaries,
  permissions and failures acceptance criteria routinely miss. Anything that turns out to be a
  real requirement is promoted into the spec so a test can prove it.

## Evidence over guesswork

Every generated `AGENTS.md` carries a mandatory **Evidence over guesswork** section. It exists
because the expensive failure mode isn't obvious nonsense — it's confident, plausible output: an
invented config key, a test command that follows the usual convention but doesn't exist here, a
criterion quietly softened so an implementation fits, a check reported as passing because it
should have passed.

The ten rules require agents to:

- check a claim before writing it down, and cite where it came from (`path/to/file.ts:42`, a
  command and its output, or the spec section);
- never invent an API, package, flag, config key or version without confirming it exists;
- treat **unknown as a valid answer**, recorded as `TODO(unknown): <question>` and raised, rather
  than filled with something that reads well;
- never report a test, build or check as passing without running it and seeing it pass;
- avoid fixtures that merely encode the same assumption the code makes;
- take acceptance criteria from the spec rather than reshaping them to fit;
- treat the code as the evidence when spec, code and expectation disagree;
- state plainly what was **not** done — skipped parts, unrun checks, unmet criteria.

This is the same rule `vibecheck adopt` enforces in code, extended to work agents do by hand.

## Configuration — `specs/project.json` → `workflow`

```jsonc
"workflow": {
  "enforce": true,          // hooks block edits/finishing; false = advise only
  "autonomy": "gated",      // gated: you approve specs + plans · auto: specs only
  "engine": "cursor",       // cursor | claude | manual — who runs [P] lanes
  "maxLanes": 3,
  "skills": "plugin"        // plugin: /vibe-check-cli:* · project: copies skills into .claude/skills
},
"memory": {
  "provider": "agentmemory", // or "none"
  "url": "http://localhost:3111",
  "recallLimit": 5
},
"knowledge": {
  "provider": "opencontext",   // or "none"
  "folder": "",                // default: projects/<project-name>
  "playbook": "playbook"       // your cross-project defaults folder
},
"docs": {
  "enabled": true,
  "dir": "docs",
  "dataModelSources": ["**/schema.*", "**/*.prisma", "**/migrations/**", "**/models/**"]
}
```

After editing, Claude runs `vibecheck sync`. `AGENTS.md`, `CLAUDE.md`, the subagents and Cursor rules regenerate. Cursor's own parallel agents get dependency setup from `.cursor/worktrees.json`.

## CLI reference

`init` · `adopt [--force] [--json]` · `analyze [feature] [--json]` · `sync` · `feature "<name>" [--from <requirements file>]` · `status <id> <status>` · `list` · `check` · `next [--json]` · `lanes <id>` · `dispatch <id> [--engine] [--dry-run]` · `merge <id>` · `memory <status|list|search|recall|remember|correct|forget|capture>` · `scan [--json] [--open] [--out <file>]` · `knowledge <status|search|manifest|publish>` · `context <feature|topic>` · `docs <status|new|stamp>` · `advise [domain "<idea>"|next|recommend|apply [preset]|components|presets|prefer]` · `security [questions|apply|status]` · `verify [feature] [--run] [--repeat <n>]` · `wizard [--out <file>]` · `dashboard [--open] [--out <file>] [--static] [--json]` · `projects [--prune] [--json]` · `team <capture|status|import-ecc>` · `standards <list|index|inject>` · `cursor-kit [--remove]` · `setup [--dry-run] [--only]` · `health [--live]` (alias `doctor`) · `version` · `hook <event>`.

Run `vibecheck` on its own for what to do next in the current folder, or `vibecheck --help` for
every command.

### `vibecheck` with no command

A bare `vibecheck` used to print the whole manual, and so did a typo — which exited `0`, making a
mistyped command indistinguishable from a successful one. It now reads the folder and answers a
single question: *what do I do next here?*

| What is in the folder | What it offers |
|---|---|
| Nothing | `vibecheck wizard` or `vibecheck init` |
| Code, but no vibecheck project | `vibecheck adopt` **first** — suggesting `init` over someone's existing work invites them to scaffold over it |
| A real project | The stack, how many features and how many are done, the next action with the exact command, and what is waiting on you |

An unknown command prints `vibecheck: no such command "<typed>"`, suggests the nearest real one
when it is close enough to be worth guessing, and **exits 1**. A guess is only offered within a
third of the word's length: sending someone to read about the wrong command is worse than
admitting the command is unknown.

## Every supported OS, proved by CI

Windows, macOS and Linux (and WSL2) are supported, and the test suite runs on all three in CI
on every pull request — a matrix rather than one OS standing in for the others. That is
deliberate: nearly every platform bug this project has had came from something that works on
POSIX and not on Windows.

The differences that actually bite, and how they are handled:

| Difference | Handling |
|---|---|
| npm installs CLIs as `.cmd` shims on Windows | Commands are resolved on PATH (`src/which.js`); Node cannot spawn a `.cmd` by name, and refuses to spawn one at all without a shell |
| A Windows command line cannot carry a newline | A `.cmd` that wraps a Node script is run through Node directly, so multi-line arguments survive |
| PATH separator is `;` not `:` | `path.delimiter` everywhere |
| `where` lives in System32, absent from a trimmed PATH | PATH resolution is done in-process, with no subprocess |
| `true`, `mktemp`, `mkdir -p`, `sh -c` do not exist in cmd.exe | The tests use Node equivalents |
| npm's global directory | `%APPDATA%
pm` is added to the tool search path alongside the POSIX ones |

agentmemory is the one component with no automatic install on native Windows; it needs WSL2, and
`vibecheck health` reports it rather than pretending otherwise.

## Watching a build happen: `vibecheck dashboard --serve`

Serving renders current state on every request. While work is running, that is not enough — you
have to keep asking. The served console pushes instead.

**It streams.** A server-sent-events connection at `<url>events` carries two things: a `state`
event when anything the page shows has changed, and a `log` event whenever a dispatched lane writes
output. The page patches itself in place. There is no meta-refresh, so your scroll position
survives — which matters when you are watching from a phone.

**It updates without interrupting you.** An update walks the live DOM against a freshly rendered
one and changes only what differs — the text of a counter, the class on a badge, a row that
genuinely appeared. Replacing `innerHTML` would destroy and remake every element twice a second,
so the scroll would jump, focus would be lost, a half-typed filter would empty and an open menu
would shut. Anything you are using is left alone: a field you are typing in keeps what you typed,
a box you ticked stays ticked, and an element marked `data-keep` — the lane console the browser
appends to — is never touched by a render.

**It shows lane output.** `dispatch` has always written a `.log` per lane. Those logs now stream to
the page as the agents write them, tailing the last few KB when you open it late so a console is
never blank.

**It costs nothing when nobody is watching.** The interval that re-reads the project starts with the
first connection and stops with the last. Change is detected by fingerprinting the collected state
with the timestamp removed — hashing the page itself would report a change every second forever.

**It degrades, and it has to.** No `EventSource`, or a stream that connects and then says nothing,
falls back to asking for `<url>state.json` and `<url>logs.json` every two seconds. The page is
never less current than the meta-refresh it replaces.

That fallback is not theoretical. **Cloudflare quick tunnels buffer a chunked response**, so over a
tunnel the event stream connects and delivers nothing at all, for as long as the build runs. This
was measured rather than assumed: padding the opening past the buffer (2K, 16K, 64K), `no-transform`
with `identity` encoding, `--protocol http2`, and four content types each delivered zero bytes. So
the page starts a six-second watchdog and drops to polling when nothing arrives. The watchdog keys
on a `ready` event rather than `onopen`, because `onopen` fires even when the bytes never come.

Live over a tunnel therefore means a two-second poll, not a push. Locally it is a real stream.
Either way the page shows which one it is using.

### The address is random

The console is served under a 192-bit random path (`/<32 characters>/`), regenerated on every start.
Any other path returns a bare `404` that says nothing about what is running. So the address is not
guessable, and an old link stops working when you restart.

That is defence in depth, **not** authentication. A URL leaks — browser history, screenshots, link
previews. The page is therefore served with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`
and a `Content-Security-Policy` of `default-src 'none'`, and it loads nothing external at all, so
no request ever carries the path off the machine.

### Reaching it from a phone

The server stays on loopback. A tunnel dials **out** from your machine to Cloudflare and traffic
comes back down that connection, so nothing listens on your network and no router is touched.

```
vibecheck dashboard --serve --tunnel
```

That starts the console, opens a quick tunnel, and prints the address to open on your phone — the
Cloudflare hostname with the console's random path already on the end, and the same for the wizard
and the scan. Ctrl-C closes the tunnel with the console, so a tunnel never outlives what it points
at.

It also prints the address as a **QR code**, because nobody types a random 32-character path into
a phone twice. The encoder is part of vibecheck rather than a dependency; while it was written its
output was decoded by an independent implementation across every version it supports, which is how
three real faults in it were found.

**Turning it off without stopping the console.** The server owns the tunnel, not the command that
started it, so the Overview page has a switch. Closing it leaves everything on this machine
running and only takes away the way in from outside — which is what "I am done for now" usually
means. Opening one again asks Cloudflare for a fresh address, so a link you closed stays closed.
You can also start one this way having begun without `--tunnel`. Closing it drops anyone reading
over it, including you if that is how you got there; the page says so before you press it.

It needs `cloudflared` on your PATH. If it is missing the command says so, prints the install for
your platform (`winget install --id Cloudflare.cloudflared`, `brew install cloudflared`, or
Cloudflare's downloads page), and leaves the local console running.

Without `--tunnel` none of this runs and the console is exactly as local as it was. Two things
worth knowing before using one:

- A **quick tunnel** is public. Anyone with the URL reaches your machine, and the random path is
  the only thing in the way. Fine for a session you start and stop; not something to leave running.
- A **named tunnel behind Cloudflare Access** authenticates you at Cloudflare's edge, so
  unauthenticated traffic never arrives. That is the one to use for anything persistent.
- **Tailscale** exposes nothing publicly at all, and is the lowest-risk option if it is only ever
  your own devices.

The published-artifact route is closed either way: the Artifact CSP blocks `fetch` to any host
outside its allowlist, so a Claude artifact cannot call this server however it is exposed.

### Changing the project from the page

Reading needs the link. **Changing needs a token the page was never given.** The server prints one
when it starts; the first time you move a card or run a fix, the page asks for it and keeps it in
that browser. So a leaked URL — a screenshot, a shared link, browser history — reads, and cannot
write.

The endpoint is `POST <url>do`, JSON only (a cross-site form cannot set that content type), with an
allowlist of actions and nothing else: change a feature's status, tick or untick a task, save the
wizard's answers, apply them, run a scan fix. Every one goes through the same code the CLI runs, so
**a move the gates refuse in the terminal is refused here too** — dragging a card to Done with a
blocked gate returns a refusal and the card goes back where it was.

What is deliberately absent: marking a gate cleared, and resolving an issue. Both are *computed* —
evidence passes when tests actually ran on a clean commit, review passes when a verdict is written
in `review.md`. There is no field to set, so there is no button; the page offers the command instead.

### Queueing work: press Build it and an agent starts

The Queue page lists features that are in progress and a **Build it** button on each. Pressing it
adds the feature to the queue and begins working through it. There is no second button to press,
because a queue you have to remember to start is a list.

The queue holds an order and nothing else. Draining an entry runs `vibecheck dispatch <feature>` as
its own process — the same command you would run yourself — so the worktrees, the briefs, the
routing, the clean-tree check and the refusal to dispatch a feature that is not in-progress all
stay where they already were. The console has no opinion of its own about when work may start: ask
it to build a draft feature and you get back the CLI's own refusal, in the console's log.

Entries run **one at a time**; the parallelism is the lanes inside a dispatch. Two dispatches at
once would race over the same HEAD and the same worktree base. Something already running cannot be
removed — stopping an agent mid-edit is worse than letting it finish — and **Clear** takes out
everything that has not started.

The agents' output arrives on the page as it is written, exactly like a lane dispatched from the
terminal, so you can watch a build from a phone. The queue itself lives in `.git/vibecheck/`,
outside the working tree, so lining work up never dirties the repository it is about.

### What the agents remember: `vibecheck memory`

Recall answers a question; these answer the other one — what does it think it knows. A memory you
cannot see is one you cannot correct, and a wrong one is quietly repeated into every brief from
then on.

```bash
vibecheck memory list                      # what it holds for this project, newest first, with ids
vibecheck memory search "sessions"         # find one, also with ids
vibecheck memory correct <id> "<the right version>"
vibecheck memory forget <id> [<id> ...]    # irreversible
vibecheck memory capture spec security     # what vibecheck records unasked; "none" for nothing
```

Every row carries its id, because an id is what turns "that is wrong" into something you can act
on. Only current versions are listed: saving a correction supersedes what it replaced, and showing
both would present a fact and its own retraction as two things it believes.

**Correcting is delete-then-save, not an edit.** agentmemory supersedes a memory when a new one is
similar enough to it — right for an agent writing as it works, wrong for a person saying "no, it is
this", because a correction that only sometimes replaces what it corrects is worse than none.

**Forgetting reports what actually went.** The count that comes back is what was found and removed,
which is not always what was asked for; an id that was already gone is not a deletion.

**`memory.capture`** decides what vibecheck records without being asked, from the five kinds the
writing code already tags: `spec`, `done`, `lanes`, `health`, `security`. What you save yourself is
always kept — capture governs what it records unasked, not what you tell it.

## What is wrong with it: `vibecheck scan`

`scan` gathers everything the existing checks can prove about a project into one report: generated
files that no longer match their specs, criteria with no task, tasks naming no criterion, `[P]`
tasks that would collide, suites that never ran or that failed or flapped, evidence recorded against
an older commit or a dirty tree, and documents that have drifted from what they describe.

Each finding carries a severity, and the severities mean one thing consistently:

| | |
|---|---|
| **critical** | the project claims something is finished that nothing supports |
| **high** | work in flight is unsound, or evidence describes code that no longer exists |
| **medium** | a real gap that has not caused harm yet |
| **low** | tidiness, and documents that are behind |

The health score is 100 minus the weight of everything still open. It moves when something is
fixed, and not before.

### It does not scan for vulnerabilities, and says so

There is no taint analysis, no dependency CVE lookup and no secret detection here. The report
therefore states that security **was not scanned**, in the terminal and on the page, rather than
showing a security row with a zero in it. An empty list from a scanner that never ran is the most
misleading thing a report like this can print.

### Select, then execute

On the served console the scan has four pages — report, findings, fix plan, execution — under the
same secret path as everything else, so **one tunnel reaches all of it from a phone**.

Choose findings, and the plan resolves them into the few commands that actually fix them:
`vibecheck sync`, `vibecheck analyze --fix`, `vibecheck verify --all --run`. Running the plan
spawns those commands one at a time, and their output streams to the page through the same channel
as a dispatched agent's. Afterwards the project is rescanned, so the report shows what is true
rather than what was asked for.

Two of those commands are checkers, and a checker exits non-zero when it still has something to
report — `analyze --fix` appends the missing tasks and then exits 1 because the work it just wrote
down is not done. The run records the exit code and carries on; only a command that could not run
stops the plan.

Findings no command can fix — a criterion that is still undecided, a plan nobody wrote, two `[P]`
tasks that overlap — are listed separately as **needing you**, with the command to run yourself.
Selecting only those is refused rather than faked.

```
vibecheck scan                 # report in the terminal, plus a read-only page
vibecheck scan --json          # the whole thing, for a script
vibecheck dashboard --serve    # the version you can select and run from
```

The written page is read-only on purpose: opened from a `file://` path it has nothing to send a
request to, so it shows the findings and says why the buttons are not there.

## Tests run when a task is finished

Ticking a task used to be enough to move on. "Run the tests after each task" was an instruction in
the implement skill, and an instruction is something an agent can quietly not follow — a skipped run
left no trace.

The Stop hook now runs the project's `commands.test` for itself, and refuses to end the turn if it
fails:

- It runs only when a task was ticked in an **in-progress** feature since the suite last passed, so
  an ordinary turn costs nothing.
- It runs **once** however many tasks were ticked — it is the whole project's suite, not one task's.
- Only a green run is recorded, in `<git dir>/vibecheck/task-gate.json`. A failure re-gates every
  turn until it is fixed or the task is unticked.
- A suite slower than two minutes has stopped being a per-task check: the gate reports that it could
  not run rather than holding the turn open, and records nothing.
- It needs a git repository (that is where the record lives) and `workflow.enforce: true`. With
  enforcement off, nothing runs.

This is narrower than `vibecheck verify --run`, deliberately. Verify traces criteria to tests,
repeats each suite to catch flakes, and records evidence against a commit — that is the gate for
*done*. This one is the gate for *the next task*.

## Limits worth knowing

- The edit gate covers Claude's file-editing tools. Writes done through shell commands bypass it, which is why the Stop hook re-checks consistency at the end of every turn.
- Cursor lanes aren't under Claude's hooks. They're constrained by `AGENTS.md`, the always-on Cursor rule and their brief, and nothing lands without the merge-and-verify step.
- Lanes can run for many minutes. The dispatch skill runs them as a background command; check progress with `vibecheck lanes <id>` or the `.log` files next to each worktree.
- The agentmemory REST calls follow its documented routes (`remember`, `smart-search`, `memories`, `governance/memories`); the request and response shapes were read out of the shipped agentmemory 0.9.29 handlers rather than guessed, and are exercised against a stand-in server. They have **not** been round-tripped against a live agentmemory, because it needs an engine binary that was not installed on the machine this was written on. Result parsing is defensive, but if a future release changes shapes, listing or recall may come back empty until `src/memory.js` is adjusted.
- The event stream does not survive a Cloudflare quick tunnel — measured, not assumed — so over a tunnel the console polls every two seconds instead. It stays current; it is not a push.
- Queued work runs one feature at a time. A second dispatch would race over the same HEAD and worktree base, so there is no parallelism above the lane level.
- Closing a tunnel from the page drops everyone reading over it. Starting one again gets a different address; the old one is dead.
- OpenContext integration uses its documented CLI (`oc search --mode keyword --format json`, `oc context manifest`, `oc folder/doc create`) and writes document bodies into the library folder (`OPENCONTEXT_CONTEXTS_ROOT`, default `~/.opencontext/contexts`). If a future `oc` release changes its JSON output, search may come back empty until `src/knowledge.js` is adjusted.
- The security catalogue encodes common OWASP ASVS-aligned controls and sensible tooling per stack. It's a strong baseline, not a substitute for a threat model or a penetration test on sensitive systems. The generated CI workflow is valid YAML but has not run against your repository; treat its first run as a test.
- Stack scores come from explicit, editable rules in `src/advisor/recommend.js`, not a model. Licence classes reflect each project's main licence; check the licences of your full dependency tree for a real product. They encode common trade-offs, not a guarantee; the ADR records the reasoning so it can be challenged.
- Mermaid is checked for a known diagram type and the required kind per document, not fully parsed. A syntax error inside a diagram shows up when it renders; the reviewer step covers that.
- Stamping is an honest-effort check, not proof: `--still-accurate` exists because some source changes don't affect a document. The reviewer verifies docs against code before a feature is done.
- `vibecheck setup` runs official installers (some via `curl | sh` or `irm | iex`, as their vendors document). It shows every command and asks first; `--dry-run` shows the plan without changing anything.
- Escape hatches: `--force` on `status`/`sync`, or `"enforce": false`. Debug hooks with `claude --debug` and the `/plugin` Errors tab.

## What the plugin gives Claude Code

The workflow skills (`/vibe-check-cli:new-project`, `run`, `spec-feature`, `plan-feature`, `implement-feature`, `dispatch`, `merge-lanes`, `review-feature`, `docs`, `rearchitect`, `security`, `scan`, `memory`, `setup`, `health`, `spec-check`), 4 subagents (**architect**, **test-engineer**, **implementer**, **reviewer**, each reading the project's `AGENTS.md` first) and 3 hooks (session start, before edits, end of turn).

**Cursor gets the same four subagents** in its own format (`model: inherit`; the reviewer is `readonly`): in every project's `.cursor/agents/` (kept current by `vibecheck sync`) and in `~/.cursor/agents/` for use anywhere (`vibecheck cursor-agents`; installed by the bootstrap and checked by the health check). They work in Cursor's editor, its CLI lanes and Cloud Agents. Files of your own with the same names are never overwritten. Check with `claude plugin details vibe-check-cli@vibe-check-cli`. To start over completely, see "Starting over" in the setup guides (`plugin/scripts/reset.ps1` or `reset.sh`).

## Updating Vibe-check-cli

Claude Code runs the plugin from its own cached copy, so unzipping a newer version isn't enough. After replacing `~/tools/vibe-check-cli`:

```bash
claude plugin marketplace update vibe-check-cli
claude plugin update vibe-check-cli@vibe-check-cli
npm install -g ~/tools/vibe-check-cli/plugin
```

Then restart Claude Code. `vibecheck health` tells you when the installed plugin is older than your folder, and `/vibe-check-cli:setup` can run the update for you.

## Developing Vibe-check-cli

```bash
cd plugin
npm test          # integration tests (incl. mixed Cursor/Claude lanes and panel setup): machine setup, advisor, security, traceability, smoke/UI evidence, hooks, gates, docs, lanes
npm run build     # regenerate skills/ after editing src/generators/workflow.js
```
