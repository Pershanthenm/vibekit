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

The plugin puts the `vibecheck` CLI on Claude Code's PATH, registers the hooks and adds the `/vibe-check-cli:*` skills. No separate terminal needed. For parallel lanes on Cursor, install the Cursor CLI (`cursor-agent`) and log in once. Optional: `npm install -g ./plugin` to use `vibecheck` in a normal terminal too.

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

## Claude Code and Cursor, working together

| Role | Who | How |
|---|---|---|
| Orchestrator | Claude Code (panel in Cursor) | Specs, plans, dispatch, merge, verification, review; kept on the workflow by hooks |
| Builders | Cursor agents and Claude agents | One lane each, in its own git worktree or on Multica |
| Shared brain | Both | `AGENTS.md`, `specs/`, Cursor rules, agentmemory, OpenContext, the Multica board |

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
With Multica, route to agents instead: `{ "match": "web/**", "agent": "Nova (Cursor)" }`, with `multica.agent` (e.g. a Claude Code agent) as the default. `vibecheck lanes <id>` shows who gets each lane before you dispatch. A lane goes to the route that matches most of its files; ties go to the earlier route.

## Multica, running entirely on your machine

[Multica](https://github.com/multica-ai/multica) is a self-hostable workspace where coding agents (Claude Code, Cursor Agent, Codex and 20 more) take issues like teammates. With Vibe-check-cli it runs fully local by default: the Multica server in Docker on your machine, the Multica daemon on your machine, and agents that clone your project folder directly. No GitHub, no cloud account, no pushing.

**Get it running:**
```bash
vibecheck setup --only docker,multica   # installs Multica with its server, runs "multica setup self-host", starts the daemon
```
Then open the Multica app it prints (usually http://localhost:3000), create an agent on this machine's runtime (Agents → New agent), and put its name in `specs/project.json` under `"multica": { "agent": "<name>" }`. Prove the whole chain:
```bash
vibecheck multica selftest              # a real agent takes a throwaway issue, commits, pushes a branch back into your project, moves it to review; then it's cleaned up
```

**What it does for you:**
- **Parallel lanes** (`workflow.engine: "multica"`, or "Multica board" in the menus). Each ready `[P]` lane becomes an issue assigned to your agent, under the feature's issue. The brief says: clone this project folder, branch from this commit, commit with task ids, push the branch back, move to review. `vibecheck lanes` reads each issue's status; `vibecheck merge` merges and verifies the branches, then marks the issues done. Commit before dispatching, since lanes start from your last commit.
- **A board of your project** (`multica.board: true`). Every feature appears as an issue whose status follows the workflow (draft → backlog, approved/planned → todo, in progress, done), with every task as a sub-issue that moves to Done when it's verified. `vibecheck multica sync` backfills without duplicates.
- **Done is marked on Multica** (`multica.doneOnBoard: true`, the default with a board). When a feature passes review and has fresh evidence, `vibecheck status <id> done` moves its issue to In review with a checklist comment (criteria traced, test/smoke/UI results, commit). You drag it to Done on the board. At the next session start, or with `vibecheck multica pull`, Vibe-check-cli re-checks everything and records it in the specs, or moves it back to In review with the reason if something went stale. Local done is refused, even with `--force`. Parallel lanes stay In review after merging and move to Done only when `verify --run` passes on the merged code.
- **Health:** `vibecheck multica status` shows whether the server is self-hosted here and reachable, the daemon is running, and your agent exists. `vibecheck health` includes the same checks.

Agents on other machines or on Multica Cloud? Set `"multica": { "remote": "origin" }`: lanes then start from your git remote (push first), and agents push their branches there.

Multica's licence is Apache 2.0 plus additional conditions on hosted services, commercial embedding and branding. Self-hosting it for your own team is fine; read the terms if you plan to offer it to others.

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

`init` · `sync` · `feature "<name>"` · `status <id> <status>` · `list` · `check` · `next [--json]` · `lanes <id>` · `dispatch <id> [--engine] [--dry-run]` · `merge <id>` · `memory <status|recall|remember>` · `knowledge <status|search|manifest|publish>` · `context <feature|topic>` · `docs <status|new|stamp>` · `advise [next|recommend|apply [preset]|components|presets|prefer]` · `security [questions|apply|status]` · `verify [feature] [--run]` · `multica [status|sync|pull|selftest]` · `setup [--dry-run] [--only]` · `health [--live]` · `version` · `hook <event>`. Run `vibecheck --help` for details.

## Limits worth knowing

- The edit gate covers Claude's file-editing tools. Writes done through shell commands bypass it, which is why the Stop hook re-checks consistency at the end of every turn.
- Cursor lanes aren't under Claude's hooks. They're constrained by `AGENTS.md`, the always-on Cursor rule and their brief, and nothing lands without the merge-and-verify step.
- Lanes can run for many minutes. The dispatch skill runs them as a background command; check progress with `vibecheck lanes <id>` or the `.log` files next to each worktree.
- The agentmemory REST calls follow its documented `remember` and `smart-search` routes; result parsing is defensive, but if a future agentmemory release changes response shapes, recall may come back empty until `src/memory.js` is adjusted.
- OpenContext integration uses its documented CLI (`oc search --mode keyword --format json`, `oc context manifest`, `oc folder/doc create`) and writes document bodies into the library folder (`OPENCONTEXT_CONTEXTS_ROOT`, default `~/.opencontext/contexts`). If a future `oc` release changes its JSON output, search may come back empty until `src/knowledge.js` is adjusted.
- The security catalogue encodes common OWASP ASVS-aligned controls and sensible tooling per stack. It's a strong baseline, not a substitute for a threat model or a penetration test on sensitive systems. The generated CI workflow is valid YAML but has not run against your repository; treat its first run as a test.
- Stack scores come from explicit, editable rules in `src/advisor/recommend.js`, not a model. Licence classes reflect each project's main licence; check the licences of your full dependency tree for a real product. They encode common trade-offs, not a guarantee; the ADR records the reasoning so it can be challenged.
- Mermaid is checked for a known diagram type and the required kind per document, not fully parsed. A syntax error inside a diagram shows up when it renders; the reviewer step covers that.
- Stamping is an honest-effort check, not proof: `--still-accurate` exists because some source changes don't affect a document. The reviewer verifies docs against code before a feature is done.
- The Multica integration follows its documented CLI and was tested against a simulated `multica` with real git clones and pushes, not a live Multica server. `vibecheck multica selftest` is the check that matters on your machine: it fails clearly if your agent's runtime can't reach the project folder or push to it.
- `vibecheck setup` runs official installers (some via `curl | sh` or `irm | iex`, as their vendors document). It shows every command and asks first; `--dry-run` shows the plan without changing anything.
- Escape hatches: `--force` on `status`/`sync`, or `"enforce": false`. Debug hooks with `claude --debug` and the `/plugin` Errors tab.

## What the plugin gives Claude Code

14 skills (`/vibe-check-cli:new-project`, `run`, `spec-feature`, `plan-feature`, `implement-feature`, `dispatch`, `merge-lanes`, `review-feature`, `docs`, `rearchitect`, `security`, `setup`, `health`, `spec-check`), 4 subagents (**architect**, **test-engineer**, **implementer**, **reviewer**, each reading the project's `AGENTS.md` first) and 3 hooks (session start, before edits, end of turn).

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
npm test          # 92 integration tests (incl. mixed Cursor/Claude lanes and panel setup): machine setup, advisor, security, traceability, smoke/UI evidence, hooks, gates, docs, lanes, done-on-Multica (fake CLI + real git)
npm run build     # regenerate skills/ after editing src/generators/workflow.js
```
