# Operating guide: Claude Code + Cursor with Vibe-check-cli

How to take an idea to secure, tested, documented software using Claude Code as the orchestrator and Cursor agents as parallel builders. It works for web, mobile, desktop and backend developers on any stack. The running example is a laptop asset-management app on .NET 9 + Vue 3 + PostgreSQL; the same steps apply to a Flutter + Supabase mobile app or an offline Tauri desktop tool.

## 1. Your cockpit

| Where | Who | Does what |
|---|---|---|
| Claude Code panel in Cursor | Claude, the orchestrator | Specs, plans, reviews, merging, verification. Hooks keep it inside the workflow |
| Cursor Agents window / `cursor-agent` | Cursor agents, the builders | One lane of parallel work each, in its own git worktree |
| Subagents (both tools) | architect, test-engineer, implementer, reviewer | Specialists Claude Code and Cursor's Agent hand work to; defined by the plugin and `.cursor/agents/` |
| Integrated terminal | You + `vibecheck` | Menus (`vibecheck advise`, `vibecheck security`), status (`list`, `verify`, `docs status`) |
| Browser preview | You | Look at the running UI; acceptance demos |

You make four kinds of decisions: requirements (by menu), stack and security (by menu), spec and plan approvals, and the final acceptance demo. Everything else is delegated.

## 2. One-time setup

Follow [SETUP-MAC.md](SETUP-MAC.md) or [SETUP-WINDOWS.md](SETUP-WINDOWS.md). In short, everything happens inside Cursor:

1. Install Cursor and Docker Desktop (on Windows, also WSL2, then connect Cursor to it).
2. Install the Claude Code extension in Cursor and sign in.
3. In Cursor's terminal, once: `bash ~/tools/vibe-check-cli/plugin/scripts/bootstrap.sh --minimal`, then reload the window.
4. In the Claude panel: `/vibe-check-cli:setup` installs the rest from a menu, and `/vibe-check-cli:health live` proves it works.
5. Mark favourites (just ask Claude: "make dotnet-vue my preferred stack") and put your playbook in OpenContext.

## 3. Start a project (about 15 minutes)

In an empty folder, in the Claude Code panel:

```text
/vibe-check-cli:new-project laptop asset management for our IT team
```

1. **Requirements by menu**, arrow keys only. The first question is your platform (web, mobile, desktop or backend), and later rounds adapt to it: a desktop tool never gets asked about web frameworks or server hosting.
2. **Stack, layer by layer**: backend (including backend-as-a-service or none), web, mobile and desktop as needed, then the database. Each option shows its licence and score, and your licensing policy filters out what it forbids. Type anything under Other to bring your own. The choices, licences and alternatives go into an ADR.
3. **Security by menu**, tailored to the stack you picked (section 7), with client-app protections for mobile and desktop.
4. **What menus can't capture**: Claude drafts the problem, users, v1 capabilities and non-goals; you correct them.
5. Claude writes the specs, draws the architecture docs and creates the `foundation` feature plus one draft per capability. You approve the foundation spec.

Prefer the terminal? `vibecheck init` runs the same menus there.

Prefer neither? `vibecheck wizard` opens the same questions as a form in your browser — useful
when you would rather see all the options at once, or hand the choices to someone who does not
live in a terminal. It saves a `requirements.json`; put it in the project and run
`vibecheck advise apply` (or tell Claude Code *"apply my requirements"*) and scaffolding carries
on exactly as above. It asks about a **boilerplate** too, offering only starters that fit the
stack you chose — with the licence and any cost shown — or generating the structure from scratch.

### Already have a codebase?

Run `vibecheck adopt` in the repository instead. It detects the stack from the manifests, writes
`specs/project.json` marked `"origin": "adopted"`, and produces as-is architecture and data-model
docs plus `assessment/adopt.md` listing every file it read.

Read `assessment/adopt.md` first, because the useful part is the **"Not determined"** section.
Adopt never guesses: a command it cannot detect is left empty rather than filled with a plausible
default, so that list is your to-do. In particular `vibecheck check` will fail until you supply a
test command, which is deliberate — agents cannot verify their work without one.

Existing code needs no specs. New work goes through features as usual. Assess, modernize and
migrate are specified but not yet built; see [docs/BROWNFIELD.md](docs/BROWNFIELD.md).

## 4. Scaffold fast with multiple agents

The same lane pattern works for every platform: a Flutter app splits into `mobile/` UI, backend functions and tests; a Tauri app into the Rust core, the web UI and packaging. The example below is the .NET + Vue foundation.

**The rule that makes parallel work safe: contracts first, then disjoint lanes, then integrate.** Conflicts come from files that everyone touches: the solution file, `Program.cs` service registration, `package.json`, shared DTOs. Those belong to sequential tasks. Everything else can fan out.

A foundation `tasks.md` designed for lanes on .NET + Vue:

```text
- [ ] T-1 [impl] Solution skeleton and contracts: .sln, Clean Architecture projects and references,
                 OpenAPI skeleton, .env.example, docker-compose with PostgreSQL (AC-1) — *.sln, src/*/**.csproj
- [ ] T-2 [test] Test harness: xUnit + Testcontainers, Vitest, Playwright (AC-1) — tests/, src/*.WebApp/vitest.config.ts
- [ ] T-3 [impl] Backend baseline: health, Serilog, auth policies, rate limiting, headers (AC-2..AC-9)
                 — src/*.WebApi/**, src/*.Infrastructure/** [P]
- [ ] T-4 [impl] Frontend baseline: Vue 3 + Vite + Pinia, SCSS design system, BFF auth client (AC-2)
                 — src/*.WebApp/** [P]
- [ ] T-5 [impl] Delivery: Dockerfile, Nginx, systemd, CI and security workflow (AC-15..AC-18)
                 — deploy/**, .github/** [P]
- [ ] T-6 [test] Security criteria tests: one test per (security: …) criterion — tests/Security/** [P]
- [ ] T-7 [test] End-to-end smoke: sign in, see the empty inventory (AC-1) — e2e/**
- [ ] T-8 [docs] Architecture, deployment and threat-model docs match what was built
```

T-1 and T-2 run first. `/vibe-check-cli:run` then reaches the `[P]` block and dispatches T-3 to T-6 to four agents at once. T-7 and T-8 run after the merge.

**Three ways to run lanes** (set in the menus, or `workflow.engine`):

| Engine | What happens | Best when |
|---|---|---|
| `cursor` | Claude runs `vibecheck dispatch` in the background; each lane gets a worktree, `npm/dotnet` install and a headless `cursor-agent` with a focused brief | You want speed and don't need to watch |
| `manual` | Worktrees and briefs are prepared; you open each worktree in Cursor's Agents window and paste its brief | You want to watch and steer each agent |
| `claude` | Same as `cursor`, with headless Claude Code | You'd rather keep everything on Claude |
| `multica` | Each lane becomes an issue on your local Multica board, assigned to your agent; the agent (on this machine's daemon) clones the project folder and pushes the lane branch back | You want a board to watch, comment on and steer agent work, still fully on your machine |

For a block of just two small tasks, Claude uses parallel subagents inside the session instead.

**Cursor and Claude in the same batch.** Add `workflow.routes` to send each lane to the agent that suits it, by the files it touches, e.g. the Vue lane to Cursor and the API and security-test lanes to Claude. With Multica, route to named agents instead (a Cursor agent and a Claude Code agent on your runtime). `vibecheck lanes <id>` shows the routing before you dispatch.

**Tips:**
- Three to four lanes is the sweet spot. More lanes means more merge work and more install time.
- Each lane owns directories, not "areas of concern". If two tasks name the same file, they aren't `[P]`.
- Lanes never edit `specs/`; they commit with the task id (`feat: T-4 …`). `/vibe-check-cli:merge-lanes` integrates, runs the tests and ticks the tasks.
- Keep one orchestrator. Parallelism lives inside a feature's lanes, not in several Claude sessions fighting over the same specs.

## 5. Test the code

Tests come first: a `[test]` task and the test-engineer subagent write failing tests from the acceptance criteria, then the implementer makes them pass.

**The naming convention that connects tests to the spec:** every test name starts with `<feature number>:AC-<n>`.

```csharp
[Fact(DisplayName = "003:AC-2 rejects assigning a retired laptop")]
public async Task Rejects_retired_laptop() { … }
```

```ts
it('003:AC-2 shows an error when assigning a retired laptop', async () => { … })   // Vitest
test('003:AC-2 admin cannot assign a retired laptop', async ({ page }) => { … })   // Playwright
```

**Test pyramid for .NET + Vue:**

| Level | Tool | Covers |
|---|---|---|
| Unit | xUnit + FluentAssertions + NSubstitute | Domain rules, application handlers |
| Integration | `WebApplicationFactory` + Testcontainers (real PostgreSQL) | Endpoints, EF Core mappings, authorization policies |
| Frontend unit | Vitest + Vue Test Utils | Components, Pinia stores |
| End to end | Playwright | Critical user journeys per target |
| Accessibility | `@axe-core/playwright` inside e2e | WCAG checks on every screen |
| Security | Tests for `(security: …)` criteria + the CI workflow | Headers, lockout, IDOR, CSRF, secrets, dependencies |

**Smoke and UI suites.** Besides unit and integration tests, every project has a `smoke` suite (a few fast checks of the critical paths, tagged `@smoke` / `Category=Smoke`) and a `ui` suite (Playwright for the Vue app, Appium or MAUI UI tests for mobile, each with an accessibility check). Plans give every visible criterion a UI test and the critical path a smoke test.

Run everything with the `test` command in AGENTS.md (for this stack: `dotnet test && npm --prefix src/<App>.WebApp run test:unit`).

**A suite that passes sometimes is not passing.** `vibecheck verify <id> --run --repeat 3` runs
each suite three times and records how many passed. Pass on every run and it counts as evidence;
pass on some and it is recorded as **flaky**, which does not. Set it once for the project with
`standards.testing.runs` instead of remembering the flag. This matters most on the suites that
touch time, ordering or the network — exactly the ones a single green run flatters.

`vibecheck dashboard --open` shows all of it in the browser: how many suites are healthy, and per
feature every suite with its result, its run tally, its duration and the command to reproduce it.

## 6. Validate the code against the spec

Six layers, from automatic to human:

| Layer | Checks | Command / trigger |
|---|---|---|
| Traceability and evidence | Every criterion has a test named `NNN:AC-n`; the test, smoke and UI suites pass on a clean commit | `vibecheck verify 003 --run` records evidence for that commit; required before `done` |
| Status gates | No TODOs in approved specs; all criteria and tasks ticked before `done` | `vibecheck status` refuses otherwise |
| Reviewer | Spec coverage, architecture boundaries, standards, security controls touched, NFRs → `review.md` | `/vibe-check-cli:review-feature 003` |
| Living docs | Feature doc, design doc and touched diagrams match the code | `vibecheck docs status`; required before `done` |
| Security CI | Secrets, SAST, dependencies, containers, optional DAST | `.github/workflows/security.yml` on every push |
| You | Walk each acceptance criterion in the running app | Move the feature's issue to Done on Multica |

If the code and the spec disagree, decide which one is wrong. If the spec was wrong, fix it first. It's the contract, and fixing it keeps every later check honest.

## 7. Security: chosen by menu, enforced by tests

After you pick a stack, two security rounds adapt to your answers:

- **Identity and access**: session style (backend cookies for web, PKCE for mobile), account protections (moved to your identity provider when you chose SSO), authorization (tenant isolation appears for SaaS), secrets (paid managers disappear when you chose fully open source).
- **Protection and assurance**: data (field encryption, backups, retention, append-only audit), edge (headers and CSP, rate limits, WAF, CORS), CI checks (Semgrep, dependency audit, Trivy, gitleaks) and monitoring (security events, PII redaction, alerts, ZAP).

Secure defaults are pre-selected, and your compliance level marks some controls as required. Deselect a required control and it's recorded as an accepted risk, not silently dropped.

**Where it's stored, and why:**

| Store | What | Why |
|---|---|---|
| `specs/project.json` | The selected controls and accepted risks | Source of truth: versioned, reviewed in pull requests |
| `specs/security.md` | Each control, how it's implemented on your stack, its ASVS reference | Generated for humans and agents |
| AGENTS.md + Cursor rule | The rules, for every Claude and Cursor agent | Applied while writing code, especially auth, config and data access |
| Foundation feature | One acceptance criterion per control | Security is built and tested in the scaffold, not bolted on later |
| `.github/workflows/security.yml` | Scanners for your stack | Catches what tests can't |
| `docs/security/threat-model.md` | Data flows, trust boundaries, STRIDE | A living doc that goes stale when the architecture changes |
| agentmemory / OpenContext | A summary / the baseline document | Recall in later sessions / reuse in your next project |

A file is the right primary store because it's versioned, reviewable and enforceable. Memory is for recall, and the knowledge library is for reuse. Change the baseline any time with `/vibe-check-cli:security`.

## 8. Design the frontend

Work in this order: design system → concepts → per-feature design → build → verify.

1. **Design system first**: `docs/design/system.md` holds the tokens, type scale, components and a link to the design files. Your SCSS structure (`_variables`, `_mixins`, `_reset`, `_animations`, `_components`, `main.scss`) is built in the foundation's frontend lane from those tokens.
2. **Three concepts** (your skill asks for them): ask Claude for three directions covering login, dashboard, navigation, user management, reporting and mobile layouts. Either:
   - use **Claude Design** to explore visually and link the result from the design doc, or
   - have Claude Code build HTML prototypes in `docs/design/mockups/` (Anthropic's frontend-design plugin helps here, if it's in your plugin marketplace).
   Pick one, and record it as an ADR ("UI direction").
3. **Per feature**: a plan with UI states requires `docs/design/<id>.md` (screens, loading/empty/error/success per target, a user-flow diagram) before the frontend lane starts. For the laptop app that means the inventory list with status and warranty filters, the laptop detail page with an assignment history timeline, the assign dialog, mobile scan-to-check-in, and reports.
4. **Build from the design doc**: the frontend lane's brief points to it, so the agent builds states you've already agreed.
5. **Verify**: Playwright journeys with axe checks, screenshots for review, a look in the browser preview, and the reviewer comparing the UI against the design doc.

## 9. What agents may and may not claim

Every generated `AGENTS.md` carries a mandatory **Evidence over guesswork** section, and it is
worth knowing what it entitles you to expect.

An agent must cite where a claim came from — a file and line, a command and its output, or the
spec section. It must not invent an API, package, flag or version without confirming it exists.
It must not report a test or build as passing unless it ran it and saw it pass. It must take
acceptance criteria from the spec rather than quietly reshaping them to fit what it built. And it
must say plainly what it did **not** do: parts skipped, checks not run, criteria unmet.

"Unknown" is an allowed answer, written as `TODO(unknown): <question>` and raised with you. That
is the point: a recorded gap is cheap, and a plausible invention is expensive. If an agent gives
you a confident answer with no source, ask for the evidence — the rules say it owes you one.

## 10. Daily loop

1. Open the project in Cursor and start Claude Code. The session opens with the state, the next step, relevant memories and documents, and any stale docs.
2. `/vibe-check-cli:run`. Answer the gates it stops at (spec approval, plan approval).
3. When it dispatches lanes, keep working or watch them in the Agents window.
4. It merges, runs tests, smoke and UI, updates docs, reviews, and moves the feature to In review on Multica with the evidence.
5. Do the acceptance demo, then drag the feature to Done on the Multica board. Vibe-check-cli records it when you next start a session.

| You want to… | Use |
|---|---|
| Add or change behaviour, including a bug | `/vibe-check-cli:spec-feature <description>` |
| Keep going | `/vibe-check-cli:run` |
| Change architecture or technology | `/vibe-check-cli:rearchitect <change>` |
| Revisit security | `/vibe-check-cli:security` |
| See where things stand | `vibecheck list`, `vibecheck verify`, `vibecheck docs status`, `vibecheck security status` |
| Pull context on a topic | `vibecheck context "<topic>"` |

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| "Blocked by the spec-driven workflow" when Claude edits code | Intended: write a small spec (`/vibe-check-cli:spec-feature`) and move it to in-progress |
| Turn won't end: "architecture changed, update the document now" | Update the flagged docs (`/vibe-check-cli:docs`) and stamp them |
| A menu question appears empty in Claude Code | Known glitch right after a skill starts; Claude asks again |
| Something doesn't work and you don't know what | `vibecheck health --live`: every failing item comes with the fix command for your OS |
| Hooks don't fire | `claude --debug`, then the `/plugin` Errors tab; check the plugin is enabled for the project |
| `oc init` rewrote AGENTS.md | `vibecheck sync --force` |
| "daemon is not running" when dispatching to Multica | `multica daemon start` (and check Docker is running for the local server) |
| Multica self-test times out | Make sure the agent is assigned to this machine's runtime and can run git; check the issue's run log in the Multica app |
| Multica lanes stay "running" | Check the issue on the board (the agent may be asking a question), then `vibecheck lanes <id>` |
| Lane merge conflict | Resolve, commit, run `vibecheck merge <id>` again; next time, move the shared file into a sequential task |
| `vibecheck verify` shows a criterion as missing | Name a test `NNN:AC-n …`, or fix the spec if the criterion is wrong |
| Memory or knowledge shows nothing | `vibecheck memory status` / `vibecheck knowledge status`; the workflow runs without them |
