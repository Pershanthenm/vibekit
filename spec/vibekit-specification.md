# VibeKit Specification

Version 1.2 · 24 September 2026

## How VibeKit works, in two pages

**The problem.** Coding agents are fast and they guess. Given a vague brief they invent entities, skip rules nobody wrote down, and produce code that looks finished and is not. Every tool (Claude Code, Cursor, Codex) needs its own rules file, so teams keep four copies of the truth and none is current.

**The idea.** Put one folder in the repo, `vibekit/`, that both humans and agents read. It holds what the app is, what agents may and may not do, what words mean, what has been decided, and what is next. Every tool is pointed at it. Every stage of building the app is a prompt file inside it, so the same workflow runs from the VibeKit app, from Claude Code, or from Cursor, with no chat history needed.

**The rule that matters most.** An agent that lacks information writes an ask and stops. It never fills a gap with a guess. Asks live in one inbox, `workflow/asks/`, and a human answers them in the app or by editing the file.

**The flow.**

1. **Intake.** Describe the app or upload a BRS. The document is converted, split by its own section numbers, and stored as a source.
2. **Clarify.** The analyst works through a checklist (users, tenancy, entities, money, integrations, compliance, non-goals) and asks about everything the source does not settle. Ten questions a round, three rounds. What it cannot ask, it records as an assumption for a human to review.
3. **Architecture.** The planner proposes a stack and architecture with reasons; the human accepts or changes. The approved record generates the rules, the code map and the entity vocabulary.
4. **Design system.** Upload tokens, point at an existing system, or answer five questions. The result is a tokens file and a component inventory that agents load only on UI work.
5. **Plan.** Requirements are made testable, split small, and ordered into phases with explicit dependencies. Walking skeleton first. A human approves the order.
6. **Build.** One requirement per agent per branch. The implementer writes its approach before code, writes tests with the code, and raises a proposal the moment it needs something the folder lacks. Three proposals and it stops.
7. **Test.** A reviewer on a different model maps every acceptance criterion to a named test, runs the suite, reads the diff against the rules, and approves or lists findings. A human sets done.

Between each stage is a gate: a line a human writes. Nothing advances itself.

**Memory.** Assistants leave one-line session notes as they work. At the end of each sprint VibeKit turns those notes into a handful of proposed lessons, and a human accepts each one. Lessons load only when their topic matches the task in hand, and a lesson that keeps coming up is promoted into a rule, which is then enforced by a check rather than remembered. Memory lives in git with everything else, so it travels with a clone and shows up in review.

**Why files.** Every prompt, answer, decision and status is a Markdown file. The app is a nicer way to edit them; it is never the only way. Rename the folder, delete the app, switch tools: nothing breaks. Every decision an agent made is in a pull request where a reviewer can see it, and `vibekit evidence` bundles the trail for audit.

**What it costs in context.** About 4,200 tokens always loaded, about 5,500 for a typical task, against roughly 20,000 for the same folder loaded whole. `vibekit check --budget` enforces it.

The rest of this document is the reference: Part A the folder, Part B the workflow, Part C agents, Part D memory and sources, Part E acceptance and decisions, and the appendices with the CLI, terms, and the stage prompts themselves.

# Part A: The folder

> **In plain terms.** VibeKit puts one folder in your project that both people and AI tools read. It says what the app is, what the AI may and may not do, what words mean, and what's been decided. Some files are written by VibeKit and refreshed automatically; some are yours and never touched; some are scratch notes that don't get saved. Everything the AI reads is kept small on purpose, so it stays focused and cheap.

## 1. Purpose

VibeKit turns a description or a Business Requirements Specification into a working, tested application, and leaves behind a `vibekit/` folder that is the single source of truth for every coding agent and every human who opens the repo. `vibekit init` writes the folder; `vibekit check` verifies it; agents read it before doing anything else; the workflow in Part B drives it from first question to tested code.

This specification covers the folder format, the workflow that runs on it, the agent roles, memory, and the decisions taken. It does not cover the desktop app's screens or the CLI's internals except where the folder or workflow needs something from them.

Design goals, in priority order:

1. **One source for humans and agents.** Plain Markdown and YAML, readable in any editor, committed to git.
2. **Ask before assuming.** An agent that lacks information writes a question and stops. It never fills a gap with a guess.
3. **Files are the interface.** Every prompt, answer, decision and status is a file. The app is a nicer way to edit those files; Claude Code, Cursor, Codex or any other tool works on the same files the same way.
4. **No lock-in.** The folder can be renamed or deleted; nothing outside it breaks.
5. **Bounded context.** Every file has a token budget and a loading rule, so an agent never pays for what a task doesn't need.
6. **Safe regeneration.** A human's edits are never overwritten by the generator.
7. **Gates are human.** No stage advances itself.

## 2. Layout

A generated repo has pointer files at the root and one `vibekit/` folder. Nothing else is written outside the listed paths.

```
<repo>/
├── CLAUDE.md                pointer · generated
├── AGENTS.md                pointer · generated
├── .cursorrules             pointer · generated
├── .gitattributes           diff hints · generated
├── .env.example             variable names only · generated
├── .claude/commands/        /vibekit.* entry points · generated
└── vibekit/
    ├── README.md            one-screen orientation · generated
    ├── profile.md           template, versions, settings (caps, timeouts, merge strategy) · authored
    ├── standards/           what agents may and may not do · always loaded
    │   ├── rules.md         coding rules · authored
    │   ├── code-style.md    style a formatter can't enforce · generated
    │   ├── security.md      OWASP-aligned rules for the stack · generated
    │   └── guardrails.md    denied paths, required checks, locked rules, allowed commands · authored
    ├── product/             what this app is · scoped per task
    │   ├── .abstract        ~100 tokens · generated
    │   ├── context.md       purpose, users, out of scope · authored
    │   ├── glossary.md      words with a specific meaning · authored
    │   ├── quality.md       non-functional requirements · authored
    │   ├── invariants.md    rules that hold across all requirements · authored
    │   ├── entities.md      closed vocabulary with data classification · generated
    │   ├── map.md           folder structure, commands, test conventions, fixtures · generated
    │   ├── sources/         BRS and descriptions, converted, sectioned, redacted
    │   ├── design/          tokens.md · components.md · flows.md
    │   └── requirements/    index.md · REQ-*.md · MIG-*.md
    ├── skills/              what an agent can look up · indexed, never injected
    │   ├── .abstract
    │   ├── index.yml        name, triggers, path · generated
    │   └── lib/*.md         skill bodies · authored
    ├── agents/              roles (load set + write scope) · humans.md (approvers, gate policy) · authored
    ├── workflow/            stages · asks · answers · assumptions · architecture · plan · status
    ├── memory/              index.md · repo/ · sessions/ · .archive/
    ├── delivery/
    │   ├── pipeline.spec.md CI intent, not YAML · generated
    │   └── environments.md  dev, staging, prod; promotion gates; secret names · generated
    └── .state/              never in git
        ├── manifest.json · bindings.json · tasks.json · workflow.json · sessions.json
```

The folder name is a setting: `vibekit/` (default, visible), `.vibekit/` (hidden), `docs/vibekit/` or custom. The pointer files reference whichever path was chosen, so renaming later is a find-and-replace in four files. The default is visible on purpose: the files are meant to be read by people as well as agents, and a dotfolder works against that.

## 3. Three kinds of file

Every file in the folder is exactly one of three kinds, and confusing them is the main way the design fails.

| Kind | Meaning | Regenerated? | Hand-editable? | In git? |
| --- | --- | --- | --- | --- |
| **Generated** | Derived from config or the repo | Every run, overwritten | No, edits are lost | Yes |
| **Authored** | A human decided it, or an agent wrote it for a human to keep | Never | Yes | Yes |
| **State** | Machine bookkeeping | Continuously | No | No |

**Generated** files carry this header on line 1, naming the source that produced them:

```markdown
<!-- generated by vibekit · do not edit · source: entities -->
```

The generator refuses to overwrite a file that lacks the header. A missing header means a human edited the file, and a rule a human wrote is a decision. Decisions do not get regenerated. The refusal is reported by path and the run continues for every other file.

**Authored** files may be created by the generator if absent, with a short starter body saying what belongs there. After that first write the generator never touches them. Requirement files, asks, memory files and session notes are authored files written by agents; the generator treats them the same way.

**State** files are added to `.gitignore` by the generator. They are disposable: deleting `.state/` and running `vibekit rescan` rebuilds them. Nothing lives only in state.

Generated by path: the pointer files, `.gitattributes`, `.env.example`, `.claude/commands/*`, `vibekit/README.md`, `standards/code-style.md`, `standards/security.md`, `product/.abstract`, `product/entities.md`, `product/map.md`, `product/requirements/index.md`, `product/sources/index.md`, `product/sources/*/.abstract`, `product/sources/*/extract.md`, `product/design/tokens.md`, `skills/.abstract`, `skills/index.yml`, `workflow/status.md`, `memory/.abstract`, `memory/index.md`, `delivery/pipeline.spec.md`, `delivery/environments.md`, `tests/fixtures/*`.

Authored by path: `profile.md`, `standards/rules.md`, `standards/guardrails.md`, `product/context.md`, `product/glossary.md`, `product/quality.md`, `product/invariants.md`, `product/design/components.md`, `product/design/flows.md`, `product/requirements/REQ-*.md` and `MIG-*.md`, `product/sources/*/source.md` and `sections/*`, `skills/lib/*.md`, `agents/*.md`, `workflow/stages/*.md`, `workflow/asks/*.md`, `workflow/answers/*.md`, `workflow/assumptions.md`, `workflow/architecture.md`, `workflow/plan.md`, `memory/repo/*.md`, `memory/sessions/*.md`. In adopt, `map.md` and `entities.md` start authored with a confidence field (§18).

## 4. Root pointer files

Three pointer files send every agent to the same folder, so one rulebook reaches Claude Code, Cursor, Codex and OpenCode without four copies of it. Each is under 150 tokens and contains no rules of its own.

| File | Read by | Contents |
| --- | --- | --- |
| `CLAUDE.md` | Claude Code | Read `workflow/status.md` first; the load order below; the folder path; one line naming the app |
| `AGENTS.md` | Codex, OpenCode, most others | Same content as `CLAUDE.md` |
| `.cursorrules` | Cursor | Same content, in Cursor's plain-text form |
| `.gitattributes` | git, GitHub, GitLab | `linguist-generated=true` on every generated path so diffs collapse them; `memory/` explicitly not collapsed |
| `.claude/commands/vibekit-next.md` and a Cursor rule | Claude Code, Cursor | One-liners that run `vibekit sprint run` and open the stage prompt |

Each pointer file states the load order an agent must follow before its first edit:

1. `vibekit/workflow/status.md`, to learn which stage and which prompt file apply
2. `vibekit/standards/*` in full
3. `vibekit/product/context.md`, `glossary.md`, `map.md` in full
4. The one requirement and the entities the task names
5. `vibekit/skills/index.yml` and `vibekit/memory/index.md`, then a body only when a trigger or topic matches

Pointer files are generated and carry the header. A team that wants tool-specific extras adds them below a `<!-- local -->` marker; the generator preserves everything under that marker on rewrite. Symlinks are never used, because they break on Windows checkouts and inside some CI runners.

## 5. profile.md and standards/

### profile.md

Which template this project came from, when, which VibeKit and prompt versions, and what has changed since. One screen, authored, the first thing anyone reads when they inherit the repo.

```markdown
---
template: house-dotnet-postgres
generated: 2026-09-23
vibekit: 1.0
prompts: 1.0
spec: 1.0
stack: .NET 10 · PostgreSQL 17 · Vue 3
architecture: clean
memory-index-cap: 40
---

What changed since generation, newest first.
```

`vibekit check` warns when the installed prompts are newer than `prompts:`; `vibekit upgrade-prompts` shows the diff before applying. A project's agents never change behaviour because of an update the team did not see.

### standards/

What agents may and may not do. Always loaded, every task, never trimmed. Four files, combined budget 1,500 tokens.

| File | Kind | Budget | Contents |
| --- | --- | --- | --- |
| `rules.md` | Authored | \~600 tokens | The coding rules: what to do, what to stop and ask about, what "done" means |
| `code-style.md` | Generated | \~200 tokens | Only style a formatter cannot enforce: naming, file placement, comment policy |
| `security.md` | Generated | \~300 tokens | OWASP-aligned rules for the stack: input handling, auth checks, secrets, logging of classified data |
| `guardrails.md` | Authored | \~400 tokens | Denied paths, required checks before done, locked rules, allowed and denied commands, dependency allow-list |

Changes to `standards/` are change-controlled: an agent never edits them (a rule in the way is an ask), and a human edit goes through a pull request that `vibekit check` labels `standards-change`, which requires the tech-lead approver in `agents/humans.md`.

The test for `code-style.md`: if a rule could be a lint rule, it belongs in `.editorconfig` or the equivalent, not here.

`guardrails.md` has a fixed shape so `vibekit check` can parse it:

```markdown
## Denied paths
- src/Infrastructure/Migrations/   never edit; propose a migration instead

## Required before done
- dotnet build succeeds with zero warnings
- dotnet test passes

## Locked
- No new NuGet packages without a proposal
```

A denied path that does not exist in the repo is a check failure, not a warning. A guardrail that can never fire protects nothing. Guardrails apply to every role and every recalled memory; nothing in the folder can widen them.

## 6. product/

What this specific app is. Scoped per task rather than loaded whole, which is where most of the token saving comes from.

| File | Kind | Loaded | Budget | Contents |
| --- | --- | --- | --- | --- |
| `.abstract` | Generated | Always | \~100 tokens | What is in this area, so an agent can judge relevance before reading more |
| `context.md` | Authored | Always | 300 tokens, hard ceiling | What the app is, who uses it, what matters, what is out of scope |
| `glossary.md` | Authored | Always | \~200 tokens | Words that mean something specific here |
| `map.md` | Generated | Always | \~400 tokens | Folder structure, where each kind of code goes, build and test commands, test conventions |
| `entities.md` | Generated | Scoped | \~80 tokens per entity | The closed vocabulary: every entity, its fields, types and relations |
| `requirements/index.md` | Generated | Always | \~15 tokens per requirement | One line per requirement: id, title, status |
| `requirements/REQ-*.md` | Authored | One per task | \~300 tokens each | One requirement: acceptance, entities, source, approach, verification, review, log |
| `sources/` | Mixed | On citation | See §31 | BRS documents and descriptions, converted and sectioned |
| `design/tokens.md` | Generated | UI tasks | \~400 tokens | Colours by role, type scale, spacing, radii, elevation, motion |
| `design/components.md` | Authored | UI tasks | \~300 tokens | The component inventory and when to use each |

### Scoping rules

A task names one requirement. The agent loads that file and only the entity sections it lists under `entities:`. Everything else in `entities.md` stays unread.

`entities.md` is a closed vocabulary. The instruction at its head is the one that matters most:

> These are the only valid entity and field names. If you need one that is not here, stop and propose it. Do not invent one.

`map.md` is generated from the approved architecture record and must differ across architectures. Its commands are real: the test command it prints must run.

### Requirement file shape

```markdown
---
id: REQ-014
title: Cancel a booking
kind: requirement        requirement · migration
size: M                  S · M · L (§49)
status: ready            draft · ready · in-progress · blocked · tested · review · done
entities: [Booking, Payment]
source: BRS-001 §4.2
after: [REQ-004, REQ-011]
assumes: [A-007]
quality: [Q-2]           lines in product/quality.md this must meet
invariants: [INV-1]      derived from entities; checked by vibekit
---

## Acceptance                 EARS form, one trigger and one response each (§49)
- AC-1  When a booking with status `confirmed` is cancelled more than 24 h before start, the system shall set its status to `cancelled` and issue a full refund through Payment.
- AC-2  When a booking is cancelled within 24 h of start, the system shall reject the cancellation with reason `too-late`.

## Out of scope
- Partial refunds

## Security                   data classes touched, auth boundary crossed, external calls (§39)
## Approach                   written by the implementer before coding
## Verification               written by the reviewer: AC-n → test name
## Review                     the reviewer's verdict or findings
## Log                        one line per handoff
```

**Definition of ready.** A requirement may be set `ready` only when: every criterion parses as EARS and names an observable response; `size` is set; every entity in `entities:` exists in `entities.md`; `source:` cites a section or a description; `## Security` is written for M and L; every `assumes:` id exists in `assumptions.md`; no `after:` points at a `draft`. `vibekit check` enforces this and the planner cannot bypass it. Only `ready` requirements are offered to agents. `done` is set only by a human, or by gate policy rule for size S (§49).

## 7. skills/

What an agent can look up. Indexed, never injected: the index is always in context, the bodies are fetched only when a trigger word matches the task. Forty skills injected in full cost about 7,200 tokens; forty skills indexed cost about 800.

| File | Kind | Loaded | Shape |
| --- | --- | --- | --- |
| `.abstract` | Generated | Always | \~100 tokens summarising the index |
| `index.yml` | Generated | Always | One entry per skill: `name`, `triggers`, `path`, about 20 tokens each |
| `lib/<name>.md` | Authored | On trigger | The skill body, 100 to 400 tokens, with a worked example |

```yaml
- name: tenant-scoping
  triggers: [tenant, multi-tenant, TenantId, per-customer]
  path: lib/tenant-scoping.md
- name: ui-conventions
  triggers: [component, page, form, layout]
  path: lib/ui-conventions.md
```

Rules `vibekit check` enforces: every entry has at least two triggers; `index.yml` contains no bodies (over 30 tokens per entry means a body leaked in); every `path` resolves and every file in `lib/` has an entry; a body starts with one sentence saying when to use it.

## 8. delivery/

**`delivery/` is optional.** `profile.md` carries `delivery: full | checks-only | none` (default `checks-only`). Deployment is a separate problem and many teams already have it solved, or are not there yet.

| Setting | What exists | What VibeKit still guarantees |
| --- | --- | --- |
| `none` | No `delivery/` area at all | Everything runs locally: `vibekit check`, `verify`, the test kinds, the reviewer, the gates. The definition of done is unchanged |
| `checks-only` (default) | `pipeline.spec.md` with the check stages only: install, lint, build, test, `vibekit check --ci`, `check --security` | The same checks run on every branch wherever the team's CI is, so a human reviewing a pull request sees them. Nothing about deploying, environments or promotion |
| `full` | Adds `environments.md`, promotion gates, smoke after deploy, releases and rollback (§50) | The deployment chain in this specification |

When delivery is `none` or `checks-only`, the phase gate's deployment rows drop out and its local equivalents stand: the app starts clean and the phase's end-to-end path runs. Smoke tests still exist and still run, against a locally started app rather than a deployed one. The walking skeleton is still built first; it just has to run, not ship.

The rest of this section applies when delivery is `full`.

VibeKit does not generate CI YAML. It generates a pipeline spec of under 400 tokens, and an agent writes the platform-specific file from it. GitHub Actions, Azure Pipelines, GitLab CI and Woodpecker differ in syntax and are identical in intent.

```markdown
# Pipeline

Platform      GitHub Actions
Triggers      push to any branch · pull request to main
Runners       ubuntu-latest
Secrets       from the platform's secret store, never from the repo

## Stages
1  install     restore dependencies from lockfile        cache: yes
2  lint        dotnet format --verify-no-changes         fail: yes
3  build       dotnet build -warnaserror                 fail: yes
4  test        dotnet test --collect coverage            fail: yes
5  vibekit     vibekit check --ci                        fail: yes
6  package     docker build, tag with commit sha         on: main only

## Must hold
- A stage that fails stops the run
- Stage 5 runs before anything is packaged
- No stage writes back to the repo
```

The agent contract: every stage in order with the exact command; "Must hold" becomes real constraints; nothing is added the spec does not name; the generated CI file is named in `map.md`.

## 9. .state/

Machine bookkeeping. Git-ignored, disposable, never the only copy of anything.

| File | Contents | Used for |
| --- | --- | --- |
| `manifest.json` | Path, content hash, kind and source for every generated file | Detecting hand edits; deciding what a re-run may overwrite |
| `bindings.json` | Entity to code-file bindings with hashes | Drift: an entity whose files changed without a requirement is flagged; two held requirements touching the same entity are warned |
| `tasks.json` | Requirement, role, runner, branch, start time per holder | One holder per requirement |
| `workflow.json` | Machine copy of `workflow/status.md` | Regenerating status |

All are rebuilt by `vibekit rescan`. If `.state/` is missing, the generator treats every generated file as unknown and applies the header rule, so a fresh clone is still safe to regenerate.

## 10. Loading model and token budget

A task's fixed cost is about 2,600 tokens; everything else scales with what the task names. The generator must be able to print this table for a real folder, because the number is VibeKit's main public claim.

| Loaded | Files | Budget (tokens) |
| --- | --- | --- |
| Always | pointer file | \~150 |
| Always | `workflow/status.md` | \~150 |
| Always | `standards/` (4 files) | \~1,500 |
| Always | `product/.abstract`, `context.md`, `glossary.md`, `map.md` | \~1,000 |
| Always | `product/quality.md`, `product/invariants.md` | \~400 |
| Always | `product/requirements/index.md` (20 requirements) | \~300 |
| Always | `skills/index.yml` (40 skills) | \~800 |
| Always | `memory/index.md` (40 entries) | \~600 |
| Per task | one requirement | \~350 |
| Per task | named entities (typically 2 to 4) | \~250 |
| On trigger | one skill body, one memory body | \~400 |
| UI tasks | `design/tokens.md`, `flows.md` line | \~450 |
| **Typical task total** |  | **\~6,300** |

The always-loaded set is \~4,900 tokens; the same folder loaded whole is roughly 22,000. `vibekit check --budget` fails when the always-loaded set exceeds `budget-cap` in `profile.md` (default 5,500), the point at which teams start deleting rules to make room. Every stage prompt carries its own `loads:` manifest and `vibekit check --stage N` flags a session that read outside it.

## 11. Generator rules

The format only holds if the generator follows seven rules. A folder produced any other way cannot be trusted.

1. **Write to temp, then move.** The whole folder is assembled in a temporary directory and moved into place in one step. A failed run never leaves a half-written folder.
2. **Idempotent.** Running twice on the same config produces byte-identical output.
3. **Header check before overwrite.** A generated path whose file lacks the header is skipped and reported, never overwritten.
4. **Authored files are created once.** If present, untouched; if absent, written with a starter body.
5. **Nothing outside the listed paths is touched.** The output target is the pointer files plus the chosen folder.
6. **Rules-only mode is a first-class target.** A brownfield team can adopt the folder without any application code being generated into their repo.
7. **The budget is reported.** Every run prints the always-loaded token total.

Output target settings, chosen once at `vibekit init`:

| Setting | Options |
| --- | --- |
| Project root | Any path; the repo being worked in |
| Folder name | `vibekit/` · `.vibekit/` · `docs/vibekit/` · custom |
| Application code | Same repo · a subfolder · rules only, write no code |

## 12. Requirements as the unit of work, and the asks inbox

The requirement is the unit of work; there is no separate task list. `requirements/index.md` is the board, and a requirement's `status` is the only state that moves.

| Status | Set by | Meaning |
| --- | --- | --- |
| `draft` | Analyst or human | Written, not ready for an agent |
| `ready` | Human, via plan approval | Acceptance criteria complete; agents may pick it up |
| `in-progress` | Agent, via `vibekit start REQ-014` | One agent holds it; recorded in `.state/tasks.json` |
| `blocked` | Agent | Waiting on an ask |
| `tested` | Implementer | Code and tests written, `vibekit check` green, handed to reviewer |
| `review` | Reviewer, or a BRS re-ingest | Findings to address, or the source changed underneath it |
| `done` | Human, after review approved | Never set by an agent |

An agent may move a requirement forward but never to `done`. An agent holds one `in-progress` requirement at a time.

### The asks inbox

`workflow/asks/` is the one place for everything an agent needs a human to decide. Two kinds, one shape.

**Plain language first.** Every ask, gate and status line shown to a person leads with a `## In plain terms` section: two or three sentences a non-technical colleague would understand, no file paths, no identifiers, no jargon, and the choices phrased as outcomes ("each team's data stays private" rather than "TeamId on every aggregate with a global query filter"). The technical detail stays in the file below it and is one tap away in the app. The analyst and planner prompts require the plain section; `vibekit check` fails an ask without one or with a plain section longer than 60 words. People will not remember the technical version and should not have to.

- **Question** (`kind: question`): the agent needs information. Raised in stages 1 to 4.
- **Proposal** (`kind: proposal`): the agent needs permission to add something the folder lacks (an entity, field, rule, skill, package or path). Raised in any stage, mostly build.

```markdown
---
id: P-007
kind: proposal            question · proposal
for: REQ-014
stage: 5
asked: 2026-09-23
by: implementer (claude-code)
blocking: true
topic: [refund, payment]
status: waiting           open/waiting · answered/accepted · rejected · deferred
---

## Ask
Add `Refund` entity with fields amount, reason, issuedAt; Booking has many Refunds.

## Why it matters
REQ-014 requires a refund record and `entities.md` has none. Without it the cancellation flow cannot record what was paid back.

## Options the agent can see
1. New Refund entity (recommended)
2. Add refund fields to Payment

## Answer
(empty until a human decides; copied to workflow/answers/ with date and name)
```

Accepting a proposal is a human edit to the source (entity model, rule, skill), followed by a regenerate. The ask flips to `accepted` and the requirement returns to `ready`. Rejected asks stay as a record of what was refused and why. `vibekit check` fails when an ask has waited longer than the team's threshold (default 3 days) or an `in-progress` requirement has no entry in `tasks.json`.

### External trackers

Jira, GitHub Issues and Linear map one ticket to one `REQ-*` id through the app's integrations. The tracker owns priority and assignment; the folder owns acceptance criteria and status. Status syncs one way, folder to tracker, so an agent never needs tracker credentials.

## 13. Per-area abstracts

The generator writes a `.abstract` file, about 100 tokens, at the top of `product/` and `skills/`, generated from `context.md` and `index.yml` respectively. An agent reads the abstract to judge whether an area is relevant before reading anything larger. `vibekit check` fails when an abstract exceeds 120 tokens or is older than the files it summarises.

A context database (OpenViking was evaluated) is not integrated. If one is reconsidered, it must be optional, self-hosted, derived only from the folder, and unable to override `guardrails.md`.

# Part B: The workflow

> **In plain terms.** Building an app is seven steps: tell VibeKit what you want, answer its questions, agree how it's built, agree how it looks, agree the order of work, build one piece at a time, check each piece. Between steps, a person says "go on". The AI never guesses; when it's unsure it asks and waits. If a step is interrupted, the next session picks up from the files, not from memory of a chat.

## 14. Stages at a glance

Seven stages, plus `adopt` for existing codebases. Every stage reads files and writes files inside `vibekit/`; no stage depends on chat history. If a session dies, the next one picks up from the files.

| # | Stage | Input | Output | Gate to pass |
| --- | --- | --- | --- | --- |
| 0 | Intake | A description or a BRS upload | `product/sources/`, first `context.md` draft | Source recorded |
| 1 | Clarify | Sources | Asks raised and answered, `context.md`, `glossary.md`, `assumptions.md`, requirement drafts | Zero open blocking asks; assumptions reviewed |
| A | Adopt (brownfield only) | An existing repo | Rules-only folder, `map.md` from the real code | `vibekit check` green against the repo |
| 2 | Architecture | Answers | `workflow/architecture.md`, `standards/`, `map.md`, `entities.md` | Human approves the architecture record |
| 3 | Design system | Answers, optional upload | `design/tokens.md`, `design/components.md`, UI skill | Human approves, or `api: none` skips |
| 4 | Plan | Everything above | `REQ-*.md` set to ready, `workflow/plan.md` | Human approves the plan |
| 5 | Build | One requirement at a time | Code and unit tests on `req/REQ-*`, `## Approach`, `## Log` | `vibekit check` green per requirement |
| 6 | Test | Built requirement | `## Verification`, `## Review`, coverage per requirement | Tests green, reviewer approves, human sets `done` |

Stages 5 and 6 loop once per requirement in plan order. Phase gates sit between groups of requirements.

## 15. Workflow layout

```
vibekit/workflow/
├── status.md                 generated · current stage, gates passed, who approved, when
├── stages/                   authored by VibeKit, editable by the team · the prompt each stage runs from
│   ├── 0-intake.md
│   ├── 1-clarify.md
│   ├── adopt.md
│   ├── 2-architecture.md
│   ├── 3-design-system.md
│   ├── 4-plan.md
│   ├── 5-build.md
│   └── 6-test.md
├── asks/                     one inbox · questions and proposals (§12)
├── answers/                  human answers, one file per stage, append-only
│   ├── 1-clarify.md
│   ├── 2-architecture.md
│   └── 3-design-system.md
├── assumptions.md            what the agent assumed when it could not ask · reviewed at each gate
├── architecture.md           the approved architecture record
└── plan.md                   the approved build order
```

### Stage prompt files

Each `stages/N-*.md` is a complete instruction an agent can run from with nothing else in context. Same shape every stage:

```markdown
---
stage: 2
name: architecture
role: planner
loads: [workflow/answers/1-clarify.md, product/context.md, product/glossary.md, product/sources/*/.abstract, memory:[stack, architecture]]
writes: [workflow/asks/, workflow/architecture.md, standards/, product/map.md, product/entities.md]
budget: 10 asks per round, 3 rounds
gate: human approves workflow/architecture.md
---

## Goal
## What you must find out before writing anything
## What you write, and the exact shape of each file
## When to stop and ask
## What "done" looks like
```

`loads:` is the stage's loading manifest. An agent may read those files plus any file an ask or requirement explicitly points to, and nothing else. `budget:` is the stop budget: an agent that reaches it stops and says why. The prompts are the product's actual prompts, versioned in the repo with everything else, and a team can edit them. That is what file-driven means: the workflow is not locked inside the app.

### Rules for asks raised by any stage

1. One ask per file. An ask that asks two things gets split.
2. Options over blanks. Where the agent can see plausible answers, it lists them.
3. "Why it matters" is mandatory. It tells the human how much to care.
4. Blocking is rare. Blocking only when the answer changes the architecture or the entity model; everything else becomes an assumption.
5. Cite the source: "BRS-001 §4.2 says bookings can be cancelled but not by whom".
6. Respect the stage's budget. Past it, the agent stops and reports that the source is too thin, rather than asking forty questions.

Non-blocking asks let a stage continue with an entry in `assumptions.md` naming the ask, so the assumption can be reversed when the answer arrives. Blocking asks wait for a human; nobody answers on their behalf.

## 16. Stage 0: Intake

The app opens with one choice: describe what you want, or upload a BRS. Both end in `product/sources/`.

- **Describe.** Saved verbatim as `product/sources/DESC-001/source.md`. Nothing is interpreted yet; the text a person typed is the source of record.
- **Upload.** A BRS (docx, pdf, md) is converted to Markdown, split on its own numbered headings into `sections/`, given an abstract, and recorded in `sources/index.md`. The original file is kept as an app asset, not in the folder.
- Both can be combined: a BRS plus a paragraph of "what the BRS doesn't say".

Intake writes a first draft of `product/context.md` marked `draft: true`. Stage 1 rewrites it.

**Preview.** `vibekit add --preview <file or text>` runs stages 0 and 1 in a temporary folder and prints the asks the analyst would raise, writing nothing to the repo. It answers two questions: is this document good enough to build from, or does it need a workshop first; and is the clarify checklist asking the right things. It is the demo, the sales tool, and the fastest way to test a prompt change on a real document.

Gate: source recorded. No approval needed.

## 17. Stage 1: Clarify

The analyst reads the sources and does one thing: works out what it does not know. It does not design, pick a stack, or write requirements. It writes asks.

**Loads:** `product/sources/*/.abstract`, sections on demand, `product/context.md` draft, memory topics `[domain, <glossary terms>]`.

**The checklist.** The analyst checks the source against a fixed list and raises an ask for every item the source does not settle. The list lives in `stages/1-clarify.md`, so teams extend it:

| Area | Asked when the source is silent |
| --- | --- |
| Users and roles | Who uses this? What can each role do that others cannot? |
| Tenancy | One organisation or many? Do they see each other's data? |
| Core entities | What are the five nouns the business talks about? What identifies each? |
| Lifecycle | For each core entity, what states can it be in and who moves it? |
| Money | Does anything cost money, get paid for, or get refunded? By whom, through what? |
| Integrations | What existing systems must this talk to? Which direction does data flow? |
| Volume | Roughly how many users, records, requests? Enough to change the design? |
| Compliance | Personal data? Financial data? Regulated sector? Retention rules? |
| Non-goals | What has the business explicitly said it does not want? |
| Success | How will the business know this worked? |

**Budget:** ten asks per round, three rounds. A third round still producing blocking asks is a signal that a workshop, not an agent, is needed, and the stage says so.

**Answering.** Answers go into the ask file's `## Answer` and are appended to `answers/1-clarify.md` with date and name. The app renders open asks as a form; in an editor, a human types into the file.

**Outputs, once no blocking asks are open:**

- `product/context.md`, final, under 300 tokens
- `product/glossary.md`
- `workflow/assumptions.md`: every non-blocking gap and what was assumed
- Requirement drafts: one per shall/must/will statement in the source, cited to its section, `status: draft`. The extraction is conservative; fifty weak drafts from one BRS is worse than fifteen good ones.
- Decision memories for anything in the source that is a decision rather than a requirement ("payments stay on Stripe"), as proposals

Gate: no open blocking asks, and a human has read `assumptions.md` and marked it reviewed in `status.md`. The assumptions review is the gate that matters; skipping it is how a wrong guess reaches the architecture.

## 18. Stage A: Adopt (brownfield)

For an existing codebase there is no BRS and no walking skeleton to build. `adopt` replaces stages 0 to 2 and phase 0 of the plan.

**Loads:** the repo's own tree, build files, existing README and any `CLAUDE.md`-style files.

1. `vibekit init --adopt` writes the folder in rules-only mode: no application code is generated.
2. The analyst reads the repo and writes `product/map.md`, `product/entities.md` and a `context.md` draft from what is actually there. In adopt these start as **authored** files carrying `confidence: low | medium | high` in their front matter, because they are inferred, not generated from config. Anything under high confidence becomes an ask. Once the architecture record is approved, `map.md` and `entities.md` are regenerated from it and become generated files as normal.
3. The architecture record is written as observed, not chosen, and the human corrects it.
4. `guardrails.md` starts with the paths a brownfield team almost always wants protected: migrations, generated clients, vendored code, anything under `infra/`.

Gate: `vibekit check` green against the existing repo, and a human approves the observed architecture record. From there the workflow continues at stage 3 or 4 as normal, with new requirements added by description or BRS.

## 19. Stage 2: Architecture

The planner now knows what the app is. This stage decides how it is built, and it asks rather than picks: each question has a recommended default with its reasoning so the human can accept in one word. Defaults come from team memory when it exists, else the house template.

**Loads:** `answers/1-clarify.md`, `product/context.md`, `glossary.md`, `assumptions.md`, memory topics `[stack, architecture, auth, deploy]`.

| Question | How the default is chosen |
| --- | --- |
| Language and framework | Team memory, else the house template |
| Database | Relational unless the entity model is document-shaped |
| Architecture style: clean, modular monolith, vertical slice, microservices | Modular monolith unless volume or team answers say otherwise; microservices need a stated reason |
| API shape: REST, GraphQL, gRPC, none | REST unless a front end with deep nesting was described |
| Auth: local, OAuth/OIDC, SAML, LDAP, none | OIDC for external users; SAML/LDAP when enterprise was mentioned |
| Tenancy implementation | Follows the stage 1 tenancy answer exactly |
| Background work: none, in-process queue, external broker | None unless a requirement is asynchronous |
| Deployment target: container, VM, serverless, desktop | Container |
| Observability: logs, plus metrics, plus tracing | Logs plus metrics |

An unanswered question takes the default and is recorded in `assumptions.md`, never silently.

**Output: `workflow/architecture.md`**, under 600 tokens, authored, cited by every later stage:

```markdown
---
stack: .NET 10 · PostgreSQL 17 · Vue 3
architecture: clean
api: rest
auth: oidc
tenancy: per-organisation, TenantId on every aggregate
background: in-process queue
deploy: container
approved: 2026-09-23 by <name>
---

## Layers and what may reference what
## Where each kind of code goes
## The three things this architecture forbids
## Why these choices (one line each, citing the stage 1 answer)
```

From this record the generator writes `standards/rules.md` (starter), `standards/code-style.md`, `standards/guardrails.md` (starter, denied paths derived from the layer rules), `product/map.md` including test conventions, and `product/entities.md` from the stage 1 entity answers.

Gate: a human sets `approved:`. The generator refuses to write `standards/` from an unapproved record. For v1 the house .NET, PostgreSQL, Vue clean-architecture record is fixed; stage 2 shows it and asks "accept?" until enough projects have run to know which questions change the answer.

## 20. Stage 3: Design system

Skipped with a status line when the architecture recorded no front end. Otherwise it runs before planning, because component names appear in requirements. If design is not ready, `api: pending` lets planning proceed with generic component names, to be resolved before phase 1 build.

**Loads:** `architecture.md`, `product/context.md`, memory topics `[design, ui, brand]`.

**Three ways in:**

1. **Upload.** A tokens file (Style Dictionary JSON, Tailwind config, Figma tokens export) or a brand guide. Parsed into `design/tokens.md`.
2. **Reference.** A URL or a named design system. Tokens are taken from it.
3. **Questions.** The minimum, then a restrained default: brand colour, light/dark/both, density, type preference, and whether the app is mostly forms, tables or content.

**Outputs:** `design/tokens.md` (generated, under 400 tokens, loaded on UI tasks), `design/components.md` (authored: the component inventory with one line on when to use each and which library implements it), and a `skills/lib/ui-conventions.md` skill with triggers `[component, page, form, layout]`.

Gate: a human approves `tokens.md` and `components.md`, ideally after the app renders a sample page from them.

## 21. Stage 4: Plan

The planner turns draft requirements into a build order. This is the last cheap place to be wrong.

**Loads:** `architecture.md`, `product/context.md`, `entities.md`, `requirements/index.md`, every draft `REQ-*.md`, `design/components.md`, memory topics `[planning, sequencing]`.

**Finishing the requirements.** Each draft is completed: acceptance criteria, entities, out of scope, source citation. The planner raises an ask when a requirement cannot be made testable ("the system should be fast": how fast, measured how?). A requirement touching more than four entities, or needing more than one branch, is split. Survivors are set to `ready` on plan approval.

**The plan file**, `workflow/plan.md`, authored so a human can reorder it:

```markdown
---
approved: 2026-09-23 by <name>
requirements: 23
phases: 4
---

## Phase 0: Foundation (the walking skeleton)
- Scaffold from map.md, CI from pipeline.spec.md, auth wired, one health endpoint
- Exit: vibekit check green, pipeline green, app starts and answers /health

## Phase 1: Core entities
- REQ-001 Create organisation           entities: Organisation
- REQ-002 Invite user                   entities: Organisation, User        after: REQ-001
- REQ-004 Create booking                entities: Booking, Organisation     after: REQ-001

## Phase 2: Lifecycle
- REQ-014 Cancel a booking              entities: Booking, Payment          after: REQ-004, REQ-011

## Deferred
- REQ-019 Reporting dashboard           reason: depends on phase 2 data
```

Ordering rules: walking skeleton first; entities before lifecycle; dependencies explicit as `after:` (the plan is a DAG and `vibekit check` fails on a cycle); parallel lanes visible (no shared entities, no `after:` link); deferred is a decision with a reason. No estimates: agents are bad at them and the numbers get treated as promises.

**BRS v2 mid-build.** A re-ingest diffs `sections/` against the previous version. Changed sections mark their requirements `review`, and the whole plan is re-approved by a human before build continues, unless a gate policy rule in `agents/humans.md` (§49) narrows re-approval to the affected phase. Requirements added after plan approval by `add`, `ingest` or `quick` are slotted per §49 and do not by themselves re-open the plan.

Gate: a human sets `approved:` in `plan.md`. Editing the order before approving is expected.

## 22. Stage 5: Build

Runs once per requirement in plan order. `workflow/` is not loaded during build; the plan already decided this requirement is next.

**Loads:** the scoped set from §10: pointer file, `standards/*`, `product/.abstract`, `context.md`, `glossary.md`, `map.md`, `design/tokens.md` on UI tasks, the one `REQ-*.md`, the entity sections it names, `skills/index.yml`, `memory/index.md`, and bodies on trigger.

**The loop, per requirement:**

1. `vibekit start REQ-014 --as implementer` checks the requirement is `ready`, its `after:` dependencies are `done`, no one else holds it; creates branch `req/REQ-014`; records the holder in `.state/tasks.json`.
2. The implementer writes `## Approach` into the requirement file before touching code: which files it will create or change, in which layer. Five to ten lines. The cheapest place to catch a wrong direction.
3. It builds. On anything the folder does not cover it writes a proposal to `workflow/asks/` and sets `blocked`. It does not invent an entity, field, package or path.
4. It writes unit tests alongside the code, in the same commit, following `map.md`. A requirement with acceptance criteria and no tests mapping to them is not finished.
5. `vibekit check` runs: guardrails, entity names, denied paths, budget, required-before-done. Failures return to step 3.
6. It appends a `## Log` line and sets `status: tested`, handing off to the reviewer.

**Budget:** three proposals on one requirement, then `blocked` with a note that the requirement is under-specified.

**Rules:** one requirement per session; the walking skeleton is built from `map.md` and `pipeline.spec.md` alone and must deploy green before phase 1; acceptance criteria are the contract and an untestable one is an ask, not a reinterpretation; anything `map.md` is silent about is a proposal to update `map.md`, not a free choice.

## 23. Stage 6: Test

A separate stage with a separate role, on a different model from the implementer by default, because an agent grading its own work grades generously.

**Loads:** `standards/*`, the requirement file, the diff of `req/REQ-014` against `main`, the named entity sections, test conventions from `map.md`.

**The reviewer, in order:**

1. **Maps criteria to tests.** For each acceptance criterion, names the test that proves it. Written into `## Verification`. A criterion with no test is a finding.
2. **Runs the suite** with the command `map.md` gives. Coverage is reported per requirement, not globally, because the global number hides the untested one.
3. **Reads the diff against `standards/`** for what `vibekit check` cannot catch mechanically: a rule interpreted loosely, a layer crossed by a clever import, a name that is valid but not what the glossary means.
4. **Writes the verdict** in `## Review`: approved, or numbered findings each tied to a criterion or rule. Findings return the requirement to `in-progress` with the same implementer.

**Budget:** two review rounds, then escalate to a human with both verdicts attached.

**Test conventions**, written into `map.md` at stage 2:

| Kind | When required | Where | Runs |
| --- | --- | --- | --- |
| Unit | Every requirement | `tests/unit/<layer>/`, one file per class or module | On every commit |
| Integration | Touches a database, queue or external system | `tests/integration/`, against the real dependency from `docker compose` | On every `req/*` push |
| Contract | Adds or changes an API endpoint | `tests/contract/`, request and response shapes pinned | On every `req/*` push |
| Smoke | Always; grows one check per phase | `tests/smoke/`: health and readiness endpoints, one request per phase's main path, a database round-trip, an auth round-trip. Under 60 seconds, no fixtures beyond seed | After every deploy to any environment; before any promotion; at every phase gate; `vibekit check --smoke <env>` on demand |
| Invariant | Requirement's entities appear in `invariants.md` | `tests/invariants/`, property tests | With the reviewer, every requirement touching those entities |
| Access | Requirement's entities appear in `access.md` | `tests/access/`, generated allowed and denied per cell | With the reviewer |
| End-to-end | Phase gate only | `tests/e2e/`, one full path per phase | At phase gates and before prod promotion |

The walking skeleton (phase 0) ships with the first smoke test: health answers, database reachable, auth issues a token. Each phase adds one smoke check for its main path, written by the implementer of the phase's last requirement and reviewed at the gate. Smoke is the test that runs against the *deployed* application, not the built one; a green build with a red smoke is a deploy problem, and `vibekit ship rollback` is the response.

A `compliance` agent may run before the reviewer as a cheap pass: guardrails and diff only, and it can only block.

**Definition of done**, checked by `vibekit check --done REQ-014`: every criterion has a named passing test; `vibekit check` green on the branch; `## Approach`, `## Verification`, `## Review`, `## Log` present; no open asks for this requirement; a human has set `status: done`.

### Findings and bugs

A finding is something wrong that was noticed. Whether it is fixed here or becomes its own work item follows one rule, so nothing is lost and nothing is smuggled into an unrelated change:

| Where it was found | What happens |
| --- | --- |
| During the requirement that caused it, inside its scope | Fixed on the same branch. Recorded in `## Review` and `## Log`, no work item created |
| During a requirement, but outside its scope | A `BUG-*` is created and linked; the current requirement continues unless the bug blocks its criteria |
| After the requirement is `done` | A `BUG-*`, linked to the requirement that introduced it |
| By an automated check on `main` (drift, security, deps, invariant, smoke) | A `BUG-*`, created by the check itself, with the check named as its finder |

**A bug is a requirement.** It is created in `product/requirements/BUG-NNN.md` with `kind: bug`, sized, and carrying EARS criteria like any other. The criterion is the absence of the defect ("When a due date is entered from a timezone east of UTC, the system shall show the same calendar day the user chose"), and the failing test that exposed it becomes its acceptance test, committed with the bug before any fix. It goes through the same build loop, the same review, and the same definition of done.

**Required fields**, filled by whoever or whatever found it: `found-by` (role and runner, or the check name), `found-on` (the requirement or branch), `introduced-by` (the requirement, when traceable through `bindings.json`), `severity`, and the failing test. `vibekit check` refuses a bug without a reproducing test, because a bug nobody can reproduce is a report, not work.

**Severity decides placement**, not priority arguments:

- `high` — data loss, a security finding, a broken invariant, or anything reaching `main`: enters the current phase immediately and blocks the phase gate.
- `medium` — wrong behaviour with a workaround: backlog, scheduled by a human at the next gate.
- `low` — cosmetic or tidiness: backlog, no gate impact.

An agent may create and size a bug, and may fix one that is assigned to it. It may never set severity above `medium` (that is a human judgement about impact) and never close one.

**Sprint gate:** every piece of work in the sprint `done`, the sprint's end-to-end path passes, `vibekit security scan` clean of high findings, documents regenerated, all three reports produced, lessons proposed, and a human closes the sprint in `status.md`. That last step is the only one VibeKit cannot do for you.

## 24. Status, gates, and running from any tool

### status.md

One generated file is the single point of truth about where things are. Every tool reads it first; the app renders it as a progress view.

```markdown
<!-- generated by vibekit · do not edit · source: workflow -->
# Workflow status

stage: 5 build · phase 1 of 4

| Stage | State | Gate | Approved by | Date |
| --- | --- | --- | --- | --- |
| 0 intake | complete | source recorded | — | 2026-09-21 |
| 1 clarify | complete | assumptions reviewed | J. Naidoo | 2026-09-21 |
| 2 architecture | complete | architecture.md approved | J. Naidoo | 2026-09-22 |
| 3 design system | complete | tokens + components approved | J. Naidoo | 2026-09-22 |
| 4 plan | complete | plan.md approved | J. Naidoo | 2026-09-22 |
| 5 build | in progress | phase 1: 3 of 7 done | | |

Open blocking asks: 0 · Open asks: 1 (P-007) · Held: REQ-004 (implementer, claude-code, 2h)
Next: REQ-002 · Parallel lane open: REQ-011
```

### Gates

A gate is a line a human writes: `approved:` in the gate's file, or a review line in `answers/`. In the app it is a button that writes that line. `vibekit sprint run` reads the gate, regenerates `status.md`, and prints the next stage's prompt path. Nothing in VibeKit sets `approved:` itself.

### Resuming

Any session, any tool, starts the same way: read the pointer file, which says to read `status.md`, which names the stage, which names the prompt file, which lists what to load. No session needs the previous session's chat.

### Running from each tool

| Tool | How |
| --- | --- |
| VibeKit app | Asks as forms, gates as buttons, status as a view, diff view for review; runs agents through `vibekit serve`. The files are still written; the app is a front end to them |
| Claude Code | `/vibekit-next` from `.claude/commands/`, or "run vibekit/workflow/stages/2-architecture.md". `CLAUDE.md` carries the load order |
| Cursor | The generated Cursor rule; asks answered by editing files; agent mode runs the stage prompt |
| Codex, OpenCode, others | Via `AGENTS.md` |
| CI | Stage 6 and `vibekit check --done` on every `req/*` branch; `vibekit distil` on phase completion |

### Evidence export

`vibekit evidence REQ-014` or `--phase 1` bundles `status.md`, gate approvals, the requirement's `## Approach`, `## Verification`, `## Review`, `## Log`, and every ask it raised into one Markdown or PDF. The Core tier's audit trail is a command, not a side effect.

# Part C: Agents

> **In plain terms.** Different AI jobs get different permissions, like people on a team. The one that asks questions can't design. The one that plans can't write code. The one that writes code can't change the rules. The one that checks the code can't fix it and then approve its own fix. Two of them can work at once on different pieces without getting in each other's way.

## 25. Several tools, one rulebook

Multi-agent means two things and the folder handles both: several tools reading the same rules, and several agents working the same repo at once.

| Runner | Reaches the folder via | Notes |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` + `vibekit serve --stdio` (MCP) | MCP re-sends rules after a context compaction |
| Cursor | `.cursorrules` + MCP |  |
| Codex, OpenCode | `AGENTS.md` + MCP |  |
| Anything else | `AGENTS.md` only | No compaction recovery; `vibekit check --runners` reports this |

`vibekit check --runners` verifies each configured runner can read the folder and reports "rules reaching every agent: N of N".

## 26. Roles

A role is a named subset of the folder plus a write scope. Roles live in `vibekit/agents/`, one authored file each; every session declares one at start (`vibekit start REQ-014 --as implementer`).

| Role | Stages | Reads | May write | Never writes |
| --- | --- | --- | --- | --- |
| `analyst` | 0, 1, A | Sources, context draft, repo (adopt) | `workflow/asks/`, `assumptions.md`, `context.md`, `glossary.md`, requirement drafts, `map.md` (adopt only) | Code, `standards/`, `architecture.md` |
| `planner` | 2, 4 | Answers, context, entities, memory | `architecture.md`, `plan.md`, `entities.md`, `requirements/`, asks | Code, `standards/` (the generator writes those) |
| `designer` | 3 | Architecture, context | `product/design/*`, the UI skill | Code, entities |
| `implementer` | 5 | Scoped set for one requirement | `src/**`, `tests/**`, `## Approach` and `## Log` in its requirement, `memory/sessions/` | `vibekit/**` otherwise; migrations unless `map.md` allows |
| `reviewer` | 6 | Standards, requirement, diff | `## Verification`, `## Review`, `## Log`, `memory/sessions/` | Application code |
| `compliance` | 5, 6 | Guardrails, diff | A block note in `## Review` | Anything else; it can only stop |

```markdown
---
role: implementer
loads: [standards, product/abstract, product/context, product/map, requirement, entities, skills/index, memory/index]
may-write: [src/**, tests/**, vibekit/memory/sessions/**, vibekit/product/requirements/<held>.md#approach, #log]
may-not-write: [vibekit/**, migrations/**]     may-write entries are exceptions to may-not-write; the narrower path wins
hands-off-to: reviewer
model: mid          advisory hint: strong · mid · cheap
---

You implement one requirement. Stop and propose when the folder lacks what you need.
```

`guardrails.md` applies to every role and a role cannot widen it; `may-write` can only narrow what the guardrails allow.

**Why these boundaries.** The analyst cannot design, so it cannot smuggle an architecture choice into a question. The planner cannot write code, so the plan is judged on its own. The implementer cannot edit `standards/` or `entities.md`, so a rule in its way becomes an ask, not a quiet edit. The reviewer cannot write code, so it cannot fix and approve its own fix. Compliance can only block, so it stays cheap.

**Model choice.** Analyst, planner and reviewer benefit from the strongest available model; implementer runs well on a mid-tier model once the scoped set is small; compliance on the cheapest that can read a diff. The reviewer runs on a different model from the implementer by default. Hints are advisory; the runner decides.

## 27. Ownership, concurrency and handoffs

- One requirement, one holder, recorded in `.state/tasks.json`. A second `vibekit start` on a held requirement is refused.
- One branch per requirement, `req/REQ-014`, so parallel agents never share a working tree.
- Two agents may hold different requirements touching the same entity; `bindings.json` warns at `vibekit start` so the human can sequence them. It does not block.
- Regeneration of the folder is a human action on `main`, never something an agent does mid-task.
- There is no orchestrator agent. The plan is the orchestration, `vibekit sprint run` hands out the next ready requirement, and the app or CI decides how many implementers to run. Keeping orchestration out of the agents keeps it out of the folder; it is the part most likely to change.

A handoff is a `## Log` line in the requirement file, appended by the agent finishing, or for stages 0 to 4 a line in `status.md`. The receiving agent reads the file it was pointed at and nothing else about the previous session:

```markdown
## Log
- 2026-09-23 14:10 implementer (claude-code) → reviewer: done on req/REQ-014, 3 files, tests green, see P-007
- 2026-09-23 15:02 reviewer (cursor, other model) → human: approved, one naming nit fixed inline
- 2026-09-23 15:20 reviewer: remember: integration tests need `docker compose up db` first
```

A `remember:` line is how an agent flags something for memory; distil picks it up.

# Part D: Memory and sources

> **In plain terms.** The AI keeps short notes on what it learned while working, like "the tests need the database running first". Now and then those notes are tidied into a few lessons a person approves. Lessons that keep coming up become rules. Nothing is deleted, only filed away. A requirements document you upload isn't a lesson; it's the source, and every requirement points back to the paragraph it came from.

## 28. What memory is

Memory is what an agent learned about this repo that was not in the folder: a gotcha, a convention nobody wrote down, a decision made mid-task. Not chat transcripts. Three kinds:

| Kind | Example | Lifespan |
| --- | --- | --- |
| Episodic | "Tried to add Refund via EF migration, hit the Migrations guardrail, used a proposal instead" | Archived out of the index once older than the last 20 merged requirements; never deleted |
| Semantic | "Integration tests need Postgres running; `docker compose up db` first" | Until superseded |
| Decision | "We chose soft-delete for Booking; see REQ-014 log" | Permanent |

Memory is file-based and lives in git so it travels with clones and shows up in pull-request review.

## 29. Layout and file shape

```
vibekit/memory/
├── .abstract              generated · ~100 tokens
├── index.md               generated · one line per memory: id, kind, topic, date · capped at 40 entries
├── repo/                  semantic and decision memories, one file each · authored (via asks)
│   ├── M-001-postgres-for-tests.md
│   └── M-002-soft-delete-booking.md
├── sessions/              episodic, one file per day, append-only · written by agents
│   └── 2026-09-23.md
└── .archive/              memories out of the index · kept for the evidence trail, still in git
```

```markdown
---
id: M-001
kind: semantic            episodic · semantic · decision
topic: [testing, postgres, docker]
learned: 2026-09-23
by: implementer (claude-code) on REQ-014
confidence: high          high · medium · low
scope: repo               repo · team · me
supersedes: —
promoted-to: —
---
Integration tests need a live Postgres. Run `docker compose up db` before `dotnet test`. Without it, 14 tests fail with connection-refused, which looks like a code bug.
```

Under 150 tokens. `by` is what makes it reviewable. One file per memory, never a shared file, so parallel branches do not conflict; `sessions/` files are named by date and appended in order, so a two-branch merge on the same day is trivial. `.gitattributes` marks `memory/` as not generated, so reviewers see what agents decided to remember.

## 30. Loading and writing

**Loading** follows the skills discipline: `memory/index.md` always loaded, about 15 tokens per entry, capped by `memory-index-cap` in `profile.md` (default 40); a body loads only when its `topic` matches the task. Per stage:

| Stage | Topics matched | Effect |
| --- | --- | --- |
| 1 clarify | `[domain, <glossary terms>]` | Skips questions this team has answered before; cites the memory |
| 2 architecture | `[stack, architecture, auth, deploy]` | Defaults come from last time, not the house template |
| 3 design system | `[design, ui, brand]` | Reuses the team's tokens |
| 4 plan | `[planning, sequencing]` | Avoids an ordering that caused a blocked phase before |
| 5 build | Requirement's `entities` and `topic` | The gotchas |
| 6 test | `[testing, flaky, <entities>]` | Known flaky areas get extra scrutiny |

**Writing.** Assistants write only to `memory/sessions/<date>.md`, append-only, one line per learning, plus `remember:` lines in a requirement's `## Log`. That is the only direct write, and it is why a bad session cannot poison the next ten.

Lessons in `memory/repo/` arrive as proposals in `workflow/asks/`, produced automatically at the end of every sprint and at the spec and architecture gates. A human accepts each. Team-level answers and the approved architecture record become lessons with `scope: team`, so the next project starts from them.

**Promotion.** Distil reports memories matched more than five times; the human promotes each into `standards/`, `map.md` or a skill, and the memory is archived with `promoted-to:`. A healthy project's `memory/repo/` shrinks over time as the folder learns.

**Scope.** `repo` (default) lives in this repo. `team` lives in a designated repo (`vibekit config team-memory <git url>`), pulled read-only into `.state/team-memory/` at session start, written only by distil via a pull request. `me` is per-developer memory (preferences, editor, machine setup), in scope for v1, stored outside git in `~/.vibekit/memory/<repo-id>/`, loaded only for that person's sessions, never distilled upward.

**Rules.** Nothing is ever deleted; archive instead. A memory cannot override `guardrails.md`; a recalled "we skip the migration check on Fridays" is ignored and flagged. Contradictions resolve by recency with `supersedes:`. `vibekit check` fails on a memory with no `by`, a topic that matches nothing, or an index over 40 entries.

## 31. Sources: BRS documents and descriptions

A BRS is not memory. Memory is what agents learned; a BRS is what the business asked for. It goes into the folder as a source document, and requirements, entities, glossary terms and decisions are extracted from it with traceability back to the section they came from.

```
vibekit/product/sources/
├── index.md                     generated · id, title, version, date, status per source
├── BRS-001-bookings-v2/
│   ├── .abstract                generated · ~100 tokens
│   ├── source.md                the full BRS, converted · never loaded by an agent
│   ├── sections/                one file per numbered section · loaded on citation
│   │   ├── 4.2-cancellation.md
│   │   └── 4.3-refunds.md
│   └── extract.md               generated · what was pulled out and where it went
└── DESC-001/
    └── source.md                a typed description, verbatim
```

| Item | Loaded | Size |
| --- | --- | --- |
| `sources/index.md` | Always | \~15 tokens per source |
| `.abstract` | When the task's requirement cites this source | \~100 tokens |
| One `sections/*.md` | When a REQ says `source: BRS-001 §4.2` and the agent needs the wording | 200 to 800 tokens |
| `source.md` | Never by an agent | Unbounded |

Rules: convert on ingest and commit the Markdown, not the docx; split on the document's own numbering, not by token count, so citations mean something to the business; extraction proposes only explicit shall/must/will statements and lets the human add the rest; a new BRS version is a new ingest with the same id, and only changed sections produce new asks (§21 says what happens to the plan).

**Redaction.** A BRS often carries names, email addresses, phone numbers and contract values, and the folder is in git forever. `vibekit ingest` detects these before writing, shows the human what it found, and replaces each with a stable placeholder (`[PERSON-1]`, `[EMAIL-1]`, `[AMOUNT-1]`) on confirm. The mapping is kept as an app asset outside the repo, never in the folder. A source that skipped redaction is marked `redacted: false` in `sources/index.md`, and `vibekit check --ci` warns on it.

# Part E: Acceptance, decisions and build order

> **In plain terms.** How we know it worked: a fresh AI, given only the folder, can answer the basic questions about the project and say where each answer came from. This part also lists every decision made while writing this document, and what gets built first, second and later.

## 32. Acceptance of a generated folder

A folder passes when a fresh agent session, given nothing but the folder, can answer these questions and quote the file and line each answer came from. An inferred answer is a failure.

1. What is this application, and who uses it?
2. What language, framework and database, and which versions?
3. What am I forbidden from touching?
4. What are the valid entity and field names?
5. Where does code for a `Booking` go?
6. What must be true before I say something is done?
7. Where do I look up how this team handles tenant scoping?
8. What stage is the project at, and what should I do next?
9. What did the last session learn that I should know?

**Checks to run first:** generate all supported architectures and diff `map.md` (identical output means the architecture answer never reached the generator); run the test command `map.md` prints; measure `skills/index.yml` in bytes; run the generator twice and diff.

**Cross-checks `vibekit check` fails on:** a denied path that does not exist; a requirement naming an entity not in `entities.md`; a criterion that does not parse as EARS; a `ready` requirement failing definition of ready; a skill with no triggers or an unresolved path; a generated file without its header, or an authored file with one; the always-loaded budget over `budget-cap`; an ask waiting past the threshold; a plan with a cycle; a low-confidence assumption load-bearing for more than three requirements at plan approval; an invariant with no test; a dependency outside the allow-list or unverifiable; a memory with no `by`; a detector hit in sources, memory or workflow; abstracts older than what they summarise; prompts older than the installed version; a hold past `hold-timeout`; a denied command in a log.

**Workflow fixtures.** The VibeKit repo keeps three fixture BRS documents with golden outputs: one small (a booking app, ten requirements), one medium, one ugly (contradictions, missing sections, a "should be fast"). Golden outputs are the asks clarify should raise, the entities stage 2 should extract, and the plan order. They run in VibeKit's own CI, so a prompt edit shows up as a diff in expected questions.

**The proving task.** Fresh session, nothing but the folder, attempt "add a field to Booking". Record every moment the agent wanted information the folder did not contain. Those gaps go back into this spec.

**Health metric.** Two counts on the dashboard: how often an agent wrote an ask instead of guessing, and how often a reviewer found an invented name. The first should be high early and fall as the folder improves; the second should be near zero.

## 33. Decisions taken

| # | Question | Decision (23 Sep 2026) |
| --- | --- | --- |
| 1 | Agents write `repo/` memories directly? | No. Session notes only; `repo/` memories arrive as asks |
| 2 | Episodic retention | Never delete. Archive out of the index past 40 entries or 20 merged requirements |
| 3 | Per-developer memory | In v1, outside git under `~/.vibekit/memory/` |
| 4 | When distil runs | Automatically on phase completion and at stage 1 and 2 gates; human accepts |
| 5 | Memory scope | Per repo; team memory via a designated repo |
| 6 | Who answers when the human is away | Nobody. Blocking asks wait |
| 7 | BRS v2 mid-build | Changed sections mark requirements `review`; the whole plan is re-approved |
| 8 | Design system timing | Before plan, with an `api: pending` escape hatch |
| 9 | Reviewer model | Different from the implementer by default; overridable |
| 10 | Brownfield | A short `adopt` stage replaces intake, clarify, architecture and phase 0 |
| 11 | Where proposals live | `workflow/asks/`, one inbox with questions |
| 12 | Reviewer and compliance | Two roles |
| 13 | OpenViking | Dropped. Only the per-area `.abstract` idea is kept |
| 14 | Orchestrator agent | None. The plan plus `vibekit sprint run` is the orchestration |
| 15 | Default architecture | Modular monolith; microservices need a stated reason |
| 16 | Estimates in the plan | None |
| 17 | Symlinks for pointer files | Never; duplicated content is the trade |
| 18 | CI YAML generation | Never; a spec the agent writes the dialect from |

## 34. v1 build order

In order, each proven on real material before the next starts:

### Step zero: the week that decides everything

Nothing in this specification is built until one week has been spent proving the bet it rests on. **Everything here is a claim until an agent stops instead of inventing.** That behaviour is the product; the other seventy-odd sections are engineering around it.

**What to do, in five days, with no code written:**

| Day | Do this | Judge this |
| --- | --- | --- |
| 1 | Take a real brief you already know well — one you have built from, so you know where its gaps are. Paste `stages/1-clarify.md` into Claude Code with it | Are the questions the ones a good analyst would ask? Did it find the gaps you know are there? |
| 2 | Two more briefs, one deliberately ugly: contradictions, missing sections, a "should be fast" | Does it stay sharp on a bad document, or produce forty weak questions? |
| 3 | Answer the questions by hand. Write `context.md`, `entities.md` and five requirements yourself, with EARS criteria. Fix the house architecture record | You now have a folder. Could a stranger build from it? |
| 4 | Paste `stages/5-build.md` into Claude Code, hold one requirement, watch it | Does it write the approach first? Does it stop when the folder lacks something, or invent a field name? |
| 5 | Four more requirements. Then a reviewer session on a different model over one of them | Does the reviewer find anything real? Does the implementer's "tests pass" match what actually ran? |

**The three numbers that decide whether to continue:**

1. **Stops per five requirements.** An agent that never stopped did not have enough to stop about, or is inventing. Zero is a failure, not a success.
2. **Invented names.** Any entity or field used that was not in `entities.md`. This should be zero by the third requirement; if it is not, the closed-vocabulary instruction is not strong enough and that is a prompt fix, not a feature.
3. **False claims.** Any "done" or "tests pass" that was not true when you checked. One is worth investigating; more than one means evidence capture must come before anything else is built.

**What you are allowed to skip that week:** the CLI, the app, the tracker, reports, documentation generation, memory, cost routing, security scanning, extensions. All of it. The stage prompts are Markdown files and Claude Code reads Markdown files; nothing else is needed to find out whether this works.

**If it works**, the build order below is a straightforward year of engineering and you can raise money, hire, or sell against it with a straight face.

**If it does not work**, you will know in a week rather than a year, and what you learn goes into the prompts, not into more sections of this document. The most likely failure is not that agents cannot stop — it is that the questions they ask are generic. That is fixable, and finding it on day two is worth more than everything written here.

**v1 (the loop works):** Parts A to D as written; sizes and `vibekit hotfix`; EARS criteria with `vibekit check` parsing; definition of ready; `.state/sessions.json`; the build report; allowed commands and hold timeouts; branch protection and the PR template. Order: dry-run clarify on three real BRS documents → build loop by hand with a fixed house architecture and a hand-written plan → `vibekit check` and `vibekit sprint run` → reviewer on a second model → stage 2 as "accept the house record?" and stage 4 plan generation → sessions and distil.

**v1.1 (the loop is trustworthy):** provenance ids and `vibekit why`; `vibekit drift` in CI; assumption blast radius; `## Security` per requirement, `standards/security.md`, `check --security`; invariants; gate policy; research and `check --deps`; budget and security reports; releases and environments; migrations and the `migrator` role.

**v2 (the product is complete):** design system stage; adopt and reverse; multi-implementer concurrency; team memory; evidence export; tracker sync; Spec Kit import and export; replay; revert and rollback; changelog and docs; multi-repo `system.md`; per-developer memory; cost forecast.

One language and one framework for v1: the house .NET 10, PostgreSQL 17, Vue 3 clean-architecture template. Every additional stack multiplies the `map.md` generator and the test conventions.

This specification is version 1.0 and is a living document. It changes as the build teaches us; every change adds a dated row to §33 so the reasoning is never lost.

# Part F: Beyond spec-driven development

> **In plain terms.** Other tools help you write a spec and then leave you alone. VibeKit keeps going: it can tell you why any line of code exists, warns when the code drifts from what was agreed, shows which guesses the project is standing on, builds security in from the start, tells you what the AI will cost before you start, and lets you undo a feature cleanly. And small changes stay small: a quick fix takes minutes, not a planning session.

Spec Kit, Kiro, OpenSpec and the rest share one loop: write a spec, plan, split into tasks, implement. They stop at the first generation. Everything in this part is a mechanism that continues past that point, and each one is a command or a check, not a claim.

## 35. Relationship to Spec Kit

Spec Kit's constitution, specify, plan, tasks and implement map onto `standards/`, clarify, architecture plus plan, requirements, and build. VibeKit is a superset with a different centre of gravity: Spec Kit optimises for getting to code; VibeKit optimises for what happens after the code exists.

- `vibekit init --from-speckit` reads a Spec Kit repo (`memory/constitution.md`, `specs/*/spec.md`, `plan.md`, `tasks.md`) into `standards/`, `product/sources/` and draft requirements, so a team already on Spec Kit adopts VibeKit in one command and loses nothing.
- `vibekit project import <repo> --speckit` converts a Spec Kit repo into a VibeKit folder (below). The conversion is one-way and deliberately so: VibeKit records evidence, provenance, assumptions with ids, checkpoints, memory and an audit trail that a first-generation spec repo has nowhere to put. Writing that back out would produce a lossy file nobody could trust, so it is not offered. The folder remains plain Markdown in git, and deleting it leaves the repo working, which is the lock-in answer that matters.
- Slash commands follow the convention developers already have: `/vibekit.clarify`, `/vibekit.next`, `/vibekit.build`, `/vibekit.review`, `/vibekit.why`, generated for Claude Code, Cursor, Copilot and Codex alongside the pointer files.

### Converting a Spec Kit repo

`vibekit project import <repo> --speckit` reads the Spec Kit artefacts alongside the code (§58 does the code half) and writes the VibeKit folder. Each conversion is a mapping plus a gap:

| Spec Kit artefact | Becomes | What has to be added |
| --- | --- | --- |
| `memory/constitution.md` | `standards/rules.md` and a first `guardrails.md` | Denied paths, allowed commands and required checks: a constitution states principles but rarely names what may not be touched |
| `specs/<feature>/spec.md` | `product/context.md`, `glossary.md`, and one `REQ-*.md` per requirement found | Acceptance criteria rewritten in EARS with ids, so each can be mapped to a test |
| `plan.md` | `workflow/architecture.md` as observed | Data classifications, trust boundaries, the three forbids, verified dependency list |
| `tasks.md` | Requirement breakdown and `workflow/plan.md` | Sizes, `after:` dependencies, phases, a walking skeleton first |
| Any `research.md` or `data-model.md` | `product/entities.md` | Field types, relations and a classification per entity |
| Slash-command definitions | Nothing; VibeKit generates its own | — |

The conversion is conservative. Anything it infers is marked `confidence: low` and becomes an ask rather than a silent fact, and the usual acceptance rule applies: `vibekit check` must pass before an assistant starts. Typically the conversion raises between five and fifteen asks, most of them about things the original spec never settled — which is the point, and usually the first time anyone notices.

## 36. Provenance: every line has a why

Every statement in the folder traces to a source section, a human answer, an assumption, or a memory. Requirements carry `source:`; assumptions carry the checklist item and ask id; generated files carry `source:` in their header; memories carry `by:` and the requirement they came from.

`vibekit why <path>[:<line>]` walks the chain and prints it:

```
src/Bookings/CancelBooking.cs:41
  ← REQ-014 acceptance criterion AC-2 ("Cancelling issues a refund through Payment")
  ← BRS-001 §4.3, second paragraph
  ← Q-004 answered 2026-09-21 by J. Naidoo: "refund via the payment provider, not manual"
  ← assumption A-007 (refund within 24h; confidence: medium; not yet confirmed)
```

The last line is the point: a developer can see that a behaviour rests on an unconfirmed assumption before they build on top of it. No spec-first tool offers this because none of them keep the chain.

## 37. Drift: the spec cannot rot

Specs in most tools are read once and drift from the code within weeks. VibeKit runs `vibekit drift` in CI on every merge and fails on:

| Drift | Detected by |
| --- | --- |
| Code with no requirement | A changed file whose entity binding (`bindings.json`) points at no `REQ-*` in `in-progress`, `tested` or `done` |
| A requirement with no code | `done` but its `## Verification` names a test that no longer exists |
| A criterion with no test | `## Verification` missing a row for an `AC-n` |
| A source that moved | A `sections/*.md` hash changed after the requirement citing it was `done` |
| A rule nobody follows | A `standards/` line that `vibekit check` has never once fired on in 50 requirements (candidate for deletion, reported not failed) |
| An assumption that became load-bearing | See §38 |

Acceptance criteria get stable ids (`AC-1`, `AC-2`) so a test can name the criterion it proves in its own name (`Cancel_ConfirmedBooking_IssuesRefund_AC2`), and the mapping is mechanical rather than a reviewer's judgement.

## 38. Assumption blast radius

Every assumption in `assumptions.md` gets an id. Every requirement that relies on one names it under `assumes:`. `vibekit assumptions` reports each assumption with the number of requirements standing on it, sorted:

```
A-003  single currency (ZAR)                confidence: low     load-bearing for 11 requirements   ← confirm before phase 2
A-007  refunds within 24h                    confidence: medium  load-bearing for 3 requirements
A-012  admins can see all organisations      confidence: high    load-bearing for 1 requirement
```

The plan gate refuses to approve a phase in which a `confidence: low` assumption is load-bearing for more than three requirements until it is either confirmed by a human answer or explicitly accepted as a risk. This turns "we assumed and found out in month three" into a line on a screen at planning time.

## 39. Security as a stage output, not a review afterthought

VibeKit's origin is security. It shows up in three places:

1. **Per-requirement security note.** Stage 4 adds a `## Security` block to every requirement: data classification of the entities it touches (public, internal, personal, financial), the auth boundary it crosses, and whether it introduces an external call. The implementer must address each line; the reviewer checks it. The analyst raises an ask when a requirement touches personal or financial data and the source says nothing about who may see it.
2. **`vibekit check --security`.** Secret scanning on every commit to a `req/*` branch; a dependency policy (`guardrails.md` Locked section names allowed registries and a licence allow-list); an OWASP-aligned rule set for the stack in `standards/security.md`, always loaded, budget 300 tokens.
3. **Threat model on the plan.** `plan.md` gets a `## Trust boundaries` section generated from the architecture record and the entity classifications, so an auditor can see where personal data crosses a boundary before any code exists.

## 40. Cost before build

Because every stage has a loading manifest and every requirement a scoped set, the token cost of a requirement is computable before it is built. `vibekit plan --cost` prints per-requirement and per-phase estimates (always-loaded set plus scoped set plus a per-role multiplier learned from this repo's sessions), and `status.md` shows actual against estimate as phases complete. A team knows the agent bill for phase 2 before approving it. No spec-first tool can produce this number because none of them bound what an agent reads.

## 41. Reverse spec for brownfield

`adopt` (§18) writes rules and a map from an existing repo. `vibekit reverse` goes further: for a repo with tests, it drafts one requirement per test class, with the acceptance criteria inferred from test names and the entities from the types touched, all `confidence: low` and `status: draft`. A legacy codebase gets a spec it never had, and every subsequent change goes through the same loop as greenfield. Spec Kit is greenfield-first; this is where most real software lives.

## 42. Replay: prompts are tested against history

Every ask an agent raised and every answer a human gave is kept (`workflow/asks/`, `workflow/answers/`). When a stage prompt changes, `vibekit replay --stage 1 --project <path>` re-runs the new prompt against a past project's sources and diffs the asks it raises against the ones it raised then. Fixtures (§32) catch regressions on invented cases; replay catches them on real ones. Prompt changes ship with a replay report or they do not ship.

## 43. Requirement-level rollback

One requirement per branch, one branch per requirement, and a `## Log` in every requirement file means `vibekit revert REQ-014` is well defined: revert the merge, set the requirement back to `ready`, log why, and mark every requirement with `after: [REQ-014]` as `review`. A feature can be pulled out cleanly a month after it shipped, with the spec updated in the same commit.

## 44. The human inbox is measured

Every human decision (ask, gate, review, memory acceptance) is a file with a timestamp. `status.md` shows decisions pending, median wait, and the oldest. `vibekit check` warns when the oldest exceeds the team threshold. Tools that run agents faster only move the bottleneck to the human; VibeKit makes the bottleneck visible so it can be managed, and the app's one job on a Monday morning is to show the ten decisions that unblock the most work, ranked by blast radius.

## 45. What this adds up to

|  | Spec-first tools | VibeKit |
| --- | --- | --- |
| Start from | A typed description | A description or the BRS the business wrote, sectioned and cited |
| Unknowns | Clarified once | Asked with a budget; assumed with an id; blast radius measured |
| Context | Specs loaded whole | Bounded, scoped, budgeted, cost-forecast |
| Rules reach agents | Per-tool files | One folder, MCP re-send after compaction, `--runners` check |
| After first generation | Nothing | Reviewer on a second model, phase gates, drift in CI |
| Provenance | None | `vibekit why` from any line of code to the BRS paragraph |
| Security | None | Per-requirement note, trust boundaries, `--security` check |
| Brownfield | Weak | `adopt` and `reverse` |
| Learning | None | File-based memory, distil, promotion into rules |
| Audit | None | `vibekit evidence`, every decision a dated file |
| Undo | Manual | `vibekit revert REQ` |
| Prompt quality | Trust | Fixtures and replay against real history |

The one-line version: spec-driven development that does not stop at the first generation. It asks before it assumes, bounds what agents read, reviews on a second model, remembers, and can show you why every line exists.

# Part G: Operations, gaps closed, and reporting

> **In plain terms.** The everyday realities: what happens when the AI crashes mid-task, which commands it's allowed to run, how code gets merged and released, how a live problem gets fixed fast, and the three reports you can pull any time: where we are, what it's costing, and how secure it is. Plus a page you can open on your phone to see all of that and make decisions from anywhere.

## 46. What agents hit in the first week

**Migrations.** `guardrails.md` denies the migrations path to implementers. When an accepted entity proposal changes the data model, the planner writes a migration task `MIG-NNN.md` under `product/requirements/` with `kind: migration`, owned by a `migrator` role that may write only the migrations path and its tests. It goes through the same review. An implementer whose requirement needs a migration that does not exist yet sets `blocked` on the `MIG-*`, not on a proposal.

**Stale holds.** `profile.md` carries `hold-timeout: 4h`. A hold older than that with no commit on its branch is reported by `vibekit check` and cleared by `vibekit unhold REQ-014`, which logs who cleared it and why and returns the requirement to `ready`. Work on the branch is kept. (`release` is reserved for the release process in §50.)

**Allowed commands.** `guardrails.md` gains a fourth section:

```markdown
## Allowed commands
- dotnet build · dotnet test · dotnet format
- docker compose up db · docker compose down
- git add · git commit · git push origin req/*
## Denied commands
- git push --force · git reset --hard · rm -rf · docker system prune · any command touching main directly
```

`vibekit serve` enforces the list when it runs the agent; file-only runners get it as an instruction in the pointer file and `vibekit check` flags a log that mentions a denied command.

**Merging.** When a requirement reaches `done`, `vibekit sprint run` opens a pull request from a generated template: title from the requirement, body with `## Approach`, `## Verification`, `## Review`, the security note and an evidence link. A human merges. Merge strategy (`squash` default, `merge`, `rebase`) is a `profile.md` setting. Nothing in VibeKit merges to `main`.

**Test data.** `map.md` names `tests/fixtures/`. The generator writes one valid instance per entity from `entities.md` (`fixtures/booking.json`), regenerated when entities change, and a `seed` command for integration tests. Fixtures are Generated files; test-specific data lives beside the test.

## 47. Homes for what had none

| Need | File | Kind | Loaded | Written at |
| --- | --- | --- | --- | --- |
| Non-functional requirements: performance targets, availability, retention, accessibility level | `product/quality.md` | Authored | Always, \~200 tokens | Stage 1 from the volume and compliance answers; requirements cite `quality:` lines |
| Screens and flows | `product/design/flows.md` | Authored | UI tasks | Stage 3, one line per flow with screens in order; UI requirements name their screen |
| Environments and config | `delivery/environments.md` + generated `.env.example` (names only, never values) | Generated | On deploy or config work | Stage 2 from the deploy answers |
| Multi-repo systems | `system.md` in a designated parent repo: the list of repos, the entities shared between them, and which repo owns each | Authored | Stage 2 and 4 | One `vibekit/` per repo; the parent is read-only to agents |
| Who may approve | `agents/humans.md`: named roles (product owner, tech lead, security), what each may approve, and which ask kinds route to whom | Authored | By the app at gates | `vibekit init`; the app enforces it, the file records it |
| Folder orientation | `vibekit/README.md`: one screen, "read profile.md, then status.md, then the area you are in" | Generated | Humans only | Every run |

**Changelog and docs.** `vibekit changelog <from-tag> <to-tag>` lists every requirement that reached `done` between two tags, grouped by phase, with source citations. `vibekit docs` writes a README section from `context.md` and `map.md`, an entity reference from `entities.md`, and an API reference from the contract tests. Both are Generated files; a team that edits them by hand takes them over.

**Detector everywhere.** The redaction detector from §31 also runs in `vibekit check` over `memory/` and `workflow/`, because session notes are free text and will eventually contain a connection string. A hit is a check failure until the line is redacted.

## 48. Reporting

Three reports, one source of truth. Every number comes from files already in the folder or `.state/`; nothing is tracked separately. Each report is a live view in the app and a `vibekit report <kind> [--phase N | --since <date>] [--md | --pdf]` export for people who do not open the app.

### Build report

For a sponsor or a stand-up: where the project is and what is in the way.

| Section | Source | Shows |
| --- | --- | --- |
| Progress | `requirements/index.md`, `plan.md` | Requirements by status per phase; phases complete; the walking skeleton's deploy state |
| Throughput | `## Log` timestamps | Requirements to `done` per week; median time ready→done; review round-trips per requirement |
| Blocked | `workflow/asks/`, `.state/tasks.json` | Open asks by kind and age; held requirements and holder; oldest pending human decision |
| Risk | `assumptions.md` | Load-bearing low-confidence assumptions still unconfirmed |
| Drift | `vibekit drift` | Any drift finding since the last report |
| Quality | `## Verification`, coverage per requirement | Criteria without tests (should be zero); coverage per phase |
| Next | `plan.md`, `vibekit sprint run` | The next five requirements and open parallel lanes |

### Budget report

For whoever pays for tokens: forecast against actual, and where the money goes.

| Section | Source | Shows |
| --- | --- | --- |
| Forecast | `vibekit plan --cost` | Estimated tokens per phase at plan approval |
| Actual | `.state/sessions.json` (tokens in and out per session, per role, per requirement, per runner, recorded by `vibekit serve`; file-only runners report via the log line) | Spent per phase, per role, per requirement |
| Variance | Both | Estimate vs actual per requirement; the ten most over |
| Waste | Sessions | Sessions that ended `blocked`; review round-trips; requirements restarted |
| Context health | `vibekit check --budget` | Always-loaded total over time; files nearest their ceiling |
| Per-model | Sessions | Spend by model, so the cheap-model-for-compliance decision is visible |

Tokens are converted to currency with a `rates.yml` in app settings, never in the folder.

### Security report

For a security lead or an auditor: what touches sensitive data and what protects it.

| Section | Source | Shows |
| --- | --- | --- |
| Data map | `entities.md` classifications, `## Security` per requirement | Every entity carrying personal or financial data and the requirements that touch it |
| Trust boundaries | `plan.md` `## Trust boundaries` | Where classified data crosses an auth or network boundary |
| Checks | `vibekit check --security` history | Secret-scan hits, dependency policy violations, denied-command attempts, by requirement and date |
| Guardrail activity | `vibekit check` | Which guardrails fired, how often, on which requirements; rules that never fire |
| Review findings | `## Review` | Security findings raised by reviewer or compliance, open and closed |
| Redaction | `sources/index.md`, detector runs | Sources ingested without redaction; detector hits in memory or workflow |
| Access | `agents/humans.md`, gate lines | Who approved what, when; approvals by someone outside their role (should be zero) |
| Evidence | `vibekit evidence` | One-click bundle for the requirements or phase in scope |

### Rules for all three

- A report never contains a number that cannot be traced to a file. Each figure links to its source in the app; the export footnotes it.
- Reports are read-only. Nothing is fixed from a report; it points at the file to fix.
- `vibekit report --all --phase N` is what a phase gate produces alongside the evidence bundle, so the human approving a phase sees build, budget and security on one page.
- Reports run on the folder as of any commit (`--at <sha>`), so a report from last month can be regenerated and will match.

## 49. Answering the criticisms of spec-driven development

The public complaints about Spec Kit and its peers are consistent: a pile of markdown, hours of planning for small changes, wrong library choices, gates that feel like hindrance, one-pass waterfall, vague acceptance criteria, and nothing that holds across requirements. Each has a mechanism here.

### Proportional rigour

Every requirement carries `size: S | M | L`, set by the planner and changeable by a human. Size decides ceremony, not the other way round:

|  | S (a fix, a field, a copy change) | M (a feature within one or two entities) | L (a new flow, a new entity, an integration) |
| --- | --- | --- | --- |
| Clarify | None; the description is the spec | Mini-clarify scoped to the requirement | Full checklist |
| `## Approach` | Optional | Required | Required, reviewed before code |
| Review | Compliance pass only (guardrails and diff) | Reviewer | Reviewer on a second model, plus compliance |
| Plan | Slotted without re-approval | Slotted; phase re-approved only if it changes dependencies | Plan re-approved |
| Security note | Inherited from the entity classifications | Written | Written and reviewed |
| Budget | 1 proposal | 3 proposals | 3 proposals |

`vibekit quick "fix: cancellation email uses wrong timezone"` creates an S requirement from the text, names its entities from the words it recognises, starts it on a branch and opens the implementer in one command. A validation bug is twenty minutes in VibeKit as well; the ceremony exists for the requirements that need it.

`vibekit check` promotes a size when the work disagrees with it: an S requirement whose diff touches three entities or adds a migration is bumped to M and the review upgraded before it can reach `tested`.

### Research before choosing

Stage 2 and any package proposal go through a research step. The planner verifies every proposed package or framework against its registry (NuGet, npm, PyPI) and records `name, version, licence, last release, maintainers` in `architecture.md` under `## Dependencies`. Anything it cannot verify, that has had no release in eighteen months, or whose licence is outside the allow-list in `guardrails.md`, is an ask, not a choice. `vibekit check --deps` re-runs the check in CI so a dependency that goes stale after approval is reported. Wrong-library selection is the most-cited SDD failure and it is a lookup, not a judgement.

### Gate policy

Gates stay human by default, but `agents/humans.md` carries a policy a human sets once, and the audit trail records when a gate passed under a rule rather than a signature:

```markdown
## Gate policy
- R-1  size: S requirements pass review on a green compliance pass
- R-2  a requirement touching no personal or financial data and ≤ 2 entities does not re-open plan approval
- R-3  a plan re-approval where only one phase changed needs the phase owner, not the product owner
- R-4  memory proposals with confidence: high from a reviewer session are accepted automatically; the human sees them in the next report
```

The answer to "gates are a hindrance" is that decision autonomy and implementation autonomy are different things: agents get the second in full, and the policy lets a team hand over as much of the first as it is comfortable with, explicitly and reversibly.

### Incremental change

The workflow is not one pass. A requirement can arrive at any point by three routes: a typed description (`vibekit add "..."`), a new or changed BRS section (`vibekit ingest`), or `vibekit hotfix`. Each new requirement gets a mini-clarify scoped to itself (only checklist items its entities touch, three asks maximum), is sized, and is slotted into the current or next phase by the planner with `after:` links. The whole plan is re-approved only when the gate policy says so. After the first build phase, this is how most work arrives; the full BRS pass is the exception, not the norm.

### Acceptance criteria in EARS

Every acceptance criterion is written in EARS form and carries an id:

```markdown
## Acceptance
- AC-1  When a booking with status `confirmed` is cancelled more than 24 h before start, the system shall set its status to `cancelled` and issue a full refund through Payment.
- AC-2  When a booking is cancelled within 24 h of start, the system shall reject the cancellation with reason `too-late`.
- AC-3  While a refund is pending, the system shall not allow the booking to be rebooked.
- AC-4  The system shall record every cancellation with the acting user and timestamp.
```

The five EARS patterns (ubiquitous `shall`, event-driven `when`, state-driven `while`, optional `where`, unwanted `if … then`) are the only forms allowed. `vibekit check` fails a criterion that does not parse. A criterion that parses but names no observable response is an ask. Because each criterion is one trigger and one response, the reviewer's mapping in `## Verification` is mechanical: one test per `AC-n`, named for it. This is also the contract between product, design and engineering: readable by all three, executable by the last.

### Invariants

Some rules hold across every requirement, and no single requirement owns them. They live in `product/invariants.md`, always loaded, budget 200 tokens, each with an id and the entities it constrains:

```markdown
- INV-1  [Booking, Refund]   The sum of a booking's refunds never exceeds the sum of its payments.
- INV-2  [Booking]           A booking has exactly one organisation for its whole life.
- INV-3  [User, Organisation] A user with no organisation cannot hold any role.
```

Each invariant is backed by a property test in `tests/invariants/`, generated as a stub when the invariant is written and completed by the implementer of the first requirement touching those entities. The reviewer runs the invariant tests for every requirement whose entities appear in an invariant, whatever its size, and `vibekit drift` reports an invariant with no test. Invariants are the one piece of formal-methods thinking that is cheap enough to always do, and the spec-first tools skipped it.

## 50. Development process controls

The controls a regulated or disciplined team expects, stated once so nothing in the workflow can bypass them.

### Definitions

| Control | Where defined | Enforced by |
| --- | --- | --- |
| Definition of ready | §6 | `vibekit check` refuses `ready` |
| Definition of done | §23 | `vibekit check --done` |
| Phase exit | §23 | Phase gate with all three reports |
| Change control for `standards/`, `invariants.md`, `guardrails.md`, `architecture.md` | §5, §49 | PR label `standards-change`; tech-lead approver required; agents never edit |

### Branching and protection

- `main` is protected: no direct pushes, PR required, required checks `vibekit check --ci`, `vibekit check --security`, `vibekit check --deps`, `vibekit drift`, the test suite from `map.md`, and the `standards-change` approver rule when the label is present.
- `req/REQ-*` and `req/MIG-*` are the only branch prefixes agents may create. `hotfix/*` and `release/*` are human-created.
- Merge strategy is `profile.md`'s `merge: squash | merge | rebase`; squash by default so one requirement is one commit on `main`, which is what makes `vibekit revert` (§43) and `vibekit changelog` clean.
- Human code review: size L always requires a named human reviewer on the PR in addition to the reviewer agent; M requires it when the security note lists personal or financial data; S does not. Set in `agents/humans.md`; recorded on the PR.

### Releases

`vibekit release <version>` on `main`: verifies every requirement in the release's phases is `done`, runs `vibekit report --all`, writes the changelog from requirements between the last tag and `HEAD`, tags with semantic versioning (`major` when an L requirement changed a public contract, `minor` for new requirements, `patch` for S only), and records the tag and report bundle in `.state/` and the evidence store. Nothing deploys from an untagged commit.

### Environments and promotion

`delivery/environments.md` names the environments (dev, staging, prod by default), what each requires to promote into it, and who may approve the promotion:

```markdown
| Env     | Promoted from          | Requires                                              | Approver                     |
| dev     | any req/* branch       | vibekit check green; smoke green after deploy         | none                         |
| staging | main at a tag          | release report; e2e green; smoke green after deploy   | tech lead                    |
| prod    | staging at the same tag| security report clean; smoke green on staging; product owner sign-off; smoke green after deploy or automatic rollback | product owner + tech lead |
```

Secrets are named here and valued nowhere in the repo. `.env.example` lists the names.

### Hotfixes

A production defect is `vibekit quick --hotfix "..."`: an S requirement on `hotfix/<tag>-<slug>` branched from the production tag, compliance pass plus one named human reviewer, `patch` release, then the same change merged forward to `main` as its own S requirement so the log shows both. The hotfix path skips the plan; it never skips `vibekit check --security`.

### Coverage and quality thresholds

`profile.md` carries `coverage-min` (default 80 per cent of changed lines per requirement, not global) and `quality.md` carries the performance and availability targets. The reviewer fails a requirement below the coverage floor; `vibekit report build` shows the trend. Global coverage is reported but never gated, because it hides the untested requirement.

### Traceability

The traceability matrix is not a document anyone maintains; it is `vibekit why` (§36) run across the folder: `vibekit trace --matrix` emits source section → requirement → criterion → test → commit for every `done` requirement, and `vibekit drift` fails when any link is broken. Auditors get `vibekit evidence --phase N` plus the matrix.

### Retrospective

Closing a sprint produces the lesson proposals, all three reports, and a short retrospective: the questions that took longest to answer, the work with the most review round-trips, and anything that escalated to a stronger model. What the team decides from that becomes either a lesson or a change to `standards/` through change control.

### Incident and rollback

`vibekit revert REQ` (§43) for a feature; `vibekit release --rollback <tag>` for a deployment, which redeploys the previous tag and opens a hotfix requirement pre-filled with the incident note. Both leave a `## Log` line and appear in the next build and security reports.

## 51. Git integration

Git is the database. Every state VibeKit cares about is a file in a commit, so the repo's history is the audit trail and `status.md` can always be rebuilt from it. This section is everything an agent does with git and everything git does for VibeKit.

### Identity and attribution

Every commit an agent makes is attributed to the agent and to the human who authorised the work, so `git blame` answers "who decided this" as well as "what wrote this":

```
REQ-014: cancel booking, refund through Payment (AC-1, AC-2)

Implements acceptance criteria AC-1 and AC-2 of REQ-014.
Tests: Cancel_ConfirmedBooking_IssuesRefund_AC1, Cancel_WithinWindow_Rejected_AC2

VibeKit-Requirement: REQ-014
VibeKit-Role: implementer
VibeKit-Runner: claude-code
VibeKit-Model: <model id>
VibeKit-Session: 2026-09-23T14:10Z
Co-authored-by: J. Naidoo <j.naidoo@example.com>
```

The author is `vibekit-<role> <role@vibekit.local>`, the committer is the human whose session it was, and the trailers are what `vibekit trace` and the reports read. Commit signing is a `profile.md` setting (`sign: required | optional | off`); when required, `vibekit serve` signs with the human's key and file-only runners cannot commit, only stage, so the human commits.

### Commit rules, enforced by hooks

`vibekit init` installs hooks (via `core.hooksPath`, so they are in the repo and versioned):

| Hook | Does |
| --- | --- |
| `pre-commit` | Secret detector; formatter check; `vibekit check --fast` (guardrail paths and entity names in the staged diff only, under two seconds) |
| `commit-msg` | Requires the `REQ-`/`MIG-` prefix and the `VibeKit-Requirement` trailer on any branch under `req/` or `hotfix/`; refuses a commit on `main` |
| `pre-push` | Refuses `--force` to any protected branch; refuses a push from a branch whose requirement is not held by this session |
| `post-merge` | Regenerates `status.md` and `requirements/index.md` when a `req/*` branch lands |

Conventional prefix, one requirement per commit, small commits: an agent that stages files from two requirements is refused by `pre-commit`.

### Worktrees for concurrency

Parallel implementers never share a working tree. `vibekit start` creates a git worktree per requirement under `.vibekit-worktrees/<REQ>/` (git-ignored), checks out `req/<REQ>` there, and points the agent at it. Two agents on two requirements are two directories; a crash in one cannot dirty the other. `vibekit unhold` and `done` remove the worktree; `vibekit check` reports orphaned ones.

### Keeping branches current

Before setting `tested`, the implementer rebases its branch onto `main` (`rebase-before-test: true` in `profile.md`, default). A clean rebase is silent. A conflict is not something an agent resolves on its own: it writes an ask of `kind: conflict` naming the files and the other requirement whose merge caused it, sets `blocked`, and stops. A human or the planner resolves it, usually by sequencing. `bindings.json` exists to make this rare by warning at `start`.

### Pull requests and provider integration

`vibekit sprint run` opens the PR through the provider's API (GitHub, GitLab, Azure DevOps, Gitea, Bitbucket; configured in app settings, never in the folder) with the generated template from §46. The integration also:

- Posts `vibekit check`, `drift`, `--security` and `--deps` as PR checks, so branch protection can require them by name.
- Posts the reviewer's `## Review` findings as PR review comments on the lines they concern, and its approval as a PR review, so the human sees agent review where they see all review.
- Writes a **CODEOWNERS** file from `agents/humans.md` and the layer rules in `map.md`: `standards/`, `invariants.md` and `guardrails.md` owned by the tech lead; `product/` by the product owner; application layers by whoever `humans.md` names. The provider then enforces the human-review rule in §50 natively.
- Applies labels from the requirement: `size:S`, `phase:2`, `security:personal-data`, `standards-change`.
- Listens for merge, close and comment webhooks to move requirement status and to turn a human's PR comment addressed to the agent into a `## Review` finding.

### Branch model

`base: main` by default. Teams on git-flow set `base: develop` in `profile.md` and `release/*` branches are cut from it by `vibekit release`; the rest of the model is unchanged. Long-lived feature branches are not supported and not needed: a phase is the unit of parallel work, and phases land on `main` requirement by requirement.

### Tags and history

- Every release is an annotated tag `v<semver>` carrying the changelog; every phase completion is a lightweight tag `phase/<n>`.
- Reports and `vibekit why` accept `--at <sha|tag>`, so any state can be reproduced.
- `status.md`, `requirements/index.md`, `memory/index.md` and `.state/*` are derivable from history; `vibekit rescan --from-history` rebuilds them from commits and trailers alone, which is the recovery path when `.state/` is lost or a fresh clone is made.

### What is ignored

The generator manages a block in `.gitignore`: `.state/`, `.vibekit-worktrees/`, `.env`, and the redaction mapping. Everything else in `vibekit/` is committed, including memory. `.gitattributes` marks generated paths `linguist-generated` and marks `memory/`, `workflow/asks/` and `workflow/answers/` as not generated so they are always visible in diffs.

### Monorepos and multi-repo

One `vibekit/` per deployable repo. In a monorepo with several deployables, one `vibekit/` at the root with `system.md` naming each package and the package paths in `map.md`; requirements carry `package:`. Across repos, `system.md` in the designated parent lists them and the shared entities; cross-repo requirements are two requirements with `after:` across repos, linked by id, and `vibekit drift` in each repo checks the shared entity hashes match.

## 52. Security

Three things need securing: the application being built, the agents building it, and VibeKit itself. Earlier sections cover pieces (`standards/security.md` §5, redaction §31, the security note and trust boundaries §39, allowed commands §46, the security report §48); this section is the whole.

### A. The application being built

**Data classification is structural.** Every entity in `entities.md` carries `class: public | internal | personal | financial | secret`, set at stage 2 from the compliance answers. Everything else derives from it: the security note per requirement, the trust boundaries on the plan, which requirements need a human security reviewer, what the logging rules forbid, and what the security report shows.

**Access control matrix.** `product/access.md`, authored at stage 2, generated tests at stage 4:

```markdown
| Role \ Entity | Booking | Payment | Refund | Organisation |
| member        | CRU own | R own   | R own  | R own        |
| admin         | CRUD org| R org   | CRU org| RU own       |
| support       | R all   | R all   | R all  | R all        |
```

The generator writes one test per cell in `tests/access/` (allowed and denied), and the reviewer runs them for any requirement touching a listed entity. An action not in the matrix is denied by default and adding one is a proposal. Most real breaches are authorisation, not authentication; this makes it a table the product owner can read.

**Threat model, proportional.** Size L requirements and any requirement touching `secret` or `financial` data get a `## Threat model` under the security note: STRIDE-lite, one line per applicable threat and the control that answers it. M requirements inherit from the trust boundaries; S requirements have none. `vibekit check --security` refuses `ready` on an L requirement without one.

**Pipeline stages.** `pipeline.spec.md` gains required stages the agent must carry into the CI dialect: SAST on every `req/*` push; dependency and licence audit (`check --deps`); container image scan before `package`; SBOM generation (CycloneDX) attached to every release; artefact signing and provenance attestation on release. A stage that finds a high or critical finding fails the run; the finding becomes an ask of `kind: security` on the requirement.

**Data protection.** `product/quality.md` carries the retention and erasure rules per data class (POPIA and GDPR both require them). The planner raises an ask when any requirement creates `personal` data without a retention line. Every entity with `personal` data gets a generated erasure requirement (`REQ-ERASE-<entity>`) in the phase where the entity is created, so the right-to-erasure path exists before the data does.

**Logging rules** in `standards/security.md`: never log a `secret`; log `personal` and `financial` fields only by id; every auth decision logged with actor, action, entity id, outcome. `vibekit check --security` greps for classified field names in log statements.

### B. The agents

**Least privilege per role.** Each role in `agents/` runs with a token scoped to its write set: the implementer's git token can push only to `req/*`, the reviewer's can comment and approve but not push, compliance is read-only. No role ever holds a production credential, a database password, or a cloud key; if a task needs one, it is a human action outside the loop.

**Sandbox.** `vibekit serve` runs agents in a container per session: the worktree mounted read-write, the rest of the filesystem read-only, network limited to the package registries in the allow-list and the git remote, no access to the host's environment variables. File-only runners cannot be sandboxed by VibeKit; `vibekit check --runners` reports them as unsandboxed and the gate policy may forbid L requirements on them.

**Untrusted content.** Everything an agent reads that a human did not write for it is data, not instructions: BRS text, memory bodies, PR comments arriving by webhook, package READMEs, test output. Every stage prompt states this. Sources are scanned on ingest for instruction-shaped text ("ignore previous", "you are now") and the analyst is shown a warning; memory proposals containing instruction-shaped text are rejected by `vibekit check`. A prompt injection that succeeds still hits the allowed-command list, the denied paths, the sandbox and a reviewer on a different model.

**Secrets.** The detector runs on ingest, on every commit (hook), on memory and workflow (check), and on agent output before it is written. A hit stops the write. Secret *names* live in `environments.md` and `.env.example`; values come from the platform's store at deploy time and from the developer's local `.env` never committed.

**Model and data handling.** Which models and providers may be used, and whether code may leave the organisation, is set in app settings and enforced by `serve`: a `models-allowed` list, a `data-residency` flag that restricts to self-hosted or regional endpoints, and a record in `sessions.json` of which model saw which files. The security report shows it.

### C. VibeKit itself

- **Authentication.** Core tier: SSO (OIDC, SAML), SCIM provisioning, roles mapped to `agents/humans.md`. Free tier: local accounts.
- **Audit.** Every action in the app that writes a file is a commit with trailers (§51); every gate approval, ask answer and report export is logged with user, time and IP in an append-only audit log exportable to a SIEM. The app has no write path that bypasses git.
- **Data.** The app stores settings, provider tokens (encrypted at rest, per organisation), the redaction mapping, and report caches. It never stores a copy of the repo beyond the working clone, and never sends folder contents anywhere except the configured model endpoint. Telemetry is opt-in and contains no file contents.
- **Self-hosted.** The reference deployment is the container on the customer's infrastructure with the customer's model keys. The managed offering is the same container operated by VibeKit with a signed DPA; nothing in the folder format depends on which.
- **Supply chain of VibeKit.** Signed releases, SBOM published, dependencies pinned and audited in VibeKit's own CI with the same `check --deps`, and a published security policy and disclosure address.
- **Backups and recovery.** Nothing to back up beyond git and the settings database; `vibekit rescan --from-history` rebuilds all derived state.

### D. Compliance mapping

| Framework | Where the evidence comes from |
| --- | --- |
| OWASP ASVS | `standards/security.md` rules mapped to ASVS ids; `check --security` output |
| SOC 2 / ISO 27001 change management | Definition of ready and done, gate approvals, `standards-change` control, PR history, `vibekit evidence` |
| POPIA / GDPR | Data classification, retention lines, erasure requirements, redaction records, data-residency setting |
| SLSA | Signed releases, provenance attestation, SBOM per release |
| PCI DSS (where `financial` data exists) | Access matrix tests, logging rules, trust boundaries, security report |

`vibekit report security --framework <name>` filters the report to that framework's rows. The evidence is the same files; the report only chooses which to show.

### E. Security roles in `agents/humans.md`

A `security` approver is required for: any change to `standards/security.md`, `access.md` or the dependency allow-list; any L requirement touching `secret` or `financial` data; any promotion to prod when the security report has an open high finding; any change to the gate policy itself. Without a named security approver the tech lead holds the role, and the report says so.

## 53. Non-goals

What VibeKit deliberately does not do. Each is a request that will arrive and a reason to say no.

| Not doing | Why |
| --- | --- |
| An orchestrator agent | The plan plus `vibekit sprint run` is the orchestration. An orchestrator is where token spend, unexplainable behaviour and vendor lock-in come from |
| A visual workflow builder or custom stages | The stage prompts are editable files. Teams that need a different process edit the prompt; a builder would make the process unversionable |
| Replacing the issue tracker | Jira, GitHub Issues and Linear own priority and assignment; the folder owns acceptance criteria and status. One-way sync, never two |
| Production access for agents | No role holds a production credential. Deploys are human actions through the pipeline; agents write the pipeline spec |
| Generating CI YAML, IaC, or Kubernetes manifests directly | The spec-then-agent-writes-the-dialect pattern (§8) covers every platform without a generator per platform |
| Estimates | Agents are bad at them and the numbers get treated as promises. Cost forecasts (§40) are tokens, not hours |
| Its own model | VibeKit runs on whatever models the team allows. It never trains on customer folders |
| A chat interface as the primary surface | Files are the interface; the app is forms, buttons and views over them. A chat that isn't recorded as a file is a decision nobody can audit |
| Hosting customer code | The reference deployment is the customer's infrastructure. The managed offering runs the same container and stores no repo beyond the working clone |
| Supporting every stack in v1 | One house template until five real projects have shipped. Each stack multiplies the map generator and the test conventions |

## 54. Observability of the built application

Stage 2 asks about observability and nothing wrote it down. `delivery/observability.md`, generated from the architecture record: the log format and the classified-field rules from §52, the metrics every service exposes (request rate, error rate, latency by endpoint, queue depth where a queue exists), the health and readiness endpoints the walking skeleton must answer, and the tracing header propagated across boundaries. The implementer of phase 0 wires it; the reviewer checks the health endpoint and the log format on every requirement that adds an endpoint. A `runbook.md` per environment is drafted at release from the same file and the security note, and is authored from then on.

## 55. Building faster with fewer hallucinations

Agents hallucinate in three ways: they invent names, they invent APIs, and they claim results that did not happen. They are slow when they generate what could have been copied. The closed entity vocabulary, guardrails and asks handle invented names. These mechanisms handle the rest.

### Copy, don't generate

**The house template is a real repository, not a generator.** Phase 0 is `git clone` of a maintained template repo plus a rename pass, not code generation. The template already deploys, has CI, auth, a health endpoint, one entity end to end, and every test kind from §23 with one example each. An agent's first job is never "create a project"; it is "add an entity to a project that already works". This is the single largest speed win available and it removes the entire class of scaffold hallucinations.

**Pattern library in skills.** `skills/lib/patterns/` holds one complete, tested example per pattern the stack uses: a command handler, a query, a repository, an endpoint with its contract test, a background job, a migration. Each is real code lifted from the template with a one-line "copy this when". The implementer's `## Approach` names which pattern each new file follows, and the reviewer checks the shape matches. Agents copying a known-good pattern produce fewer novel mistakes than agents composing from memory.

**Search before create.** Before writing any new type, the implementer runs the search the `find-existing` skill prescribes (grep for the entity name and the pattern name across `src/`). If a candidate exists, the approach says "extend X" and the reviewer flags any new file that duplicates an existing one. Most duplicated code from agents is a search they did not run.

### Ground every claim

**Approaches cite paths that exist.** Every path in `## Approach` marked as "change" must exist; `vibekit check --approach` verifies it before the agent writes code. A plan built on an imagined file is caught in seconds instead of after an hour.

**APIs are read, not remembered.** The `verify-api` skill (triggers: any package name from `## Dependencies`) requires the agent to open the installed package's actual surface (the `.xml` doc or decompiled signature in the NuGet cache, `node_modules/<pkg>/*.d.ts`, `site-packages/<pkg>` stubs) before calling it, and to quote the signature in a comment on first use. Compilers catch most invented APIs in typed stacks; this catches them before the compile and in untyped ones.

**Tests before code, from the criteria.** The build loop order becomes: approach → write a failing test per `AC-n` → run it and confirm it fails → implement → run it and confirm it passes. A criterion pinned by a failing test cannot be quietly reinterpreted, and the reviewer's mapping is already written by the time review starts.

**Typed stacks by default.** The house template is a typed language with a strict compiler and nullable checks on. Untyped stacks are supported but the security note and reviewer round budget are stricter for them. The compiler is the cheapest hallucination detector there is.

### Claims are evidence, not statements

**Handoff requires output, not assertion.** A `## Log` line that says "tests green" is not accepted. The implementer runs `vibekit verify`, which executes the commands in `map.md`, captures exit codes and the test summary, and writes a signed evidence block into the requirement file:

```markdown
## Evidence
- build   exit 0   2026-09-23T14:08Z   sha 3f2a…
- test    exit 0   47 passed, 0 failed, 0 skipped   AC-1 ✓ AC-2 ✓
- check   exit 0   budget 4,870 / 5,500
```

`status: tested` is refused without an evidence block whose sha matches `HEAD`. The reviewer re-runs `verify` and compares; a mismatch is a finding of `kind: claim`, which is tracked in the build report as its own metric because it is the one that matters most.

**No skipped tests.** A skipped or disabled test in the diff is a finding, always. A test the agent cannot make pass is an ask against the criterion, not a `[Skip]`.

**Re-read before handoff.** The last step of build is re-reading the requirement file top to bottom and confirming, criterion by criterion, that a named test exists. Context compaction mid-session is when agents forget criteria; this step is cheap and catches it.

### Keep context small and current

**Loads manifests are enforced, not advisory.** `vibekit serve` refuses file reads outside the stage's `loads:` plus explicitly cited files, and logs the attempt. An agent that wants to read more is an agent that is about to reason from something the task did not need.

**Determinism per role.** `serve` sets low temperature and a fixed seed for implementer, migrator and compliance; normal sampling for analyst and planner, where breadth is wanted. Model parameters are per role in app settings and recorded in `sessions.json`.

**Freshness after compaction.** When a runner reports a context compaction (Claude Code and Cursor do), `serve` re-sends `standards/*`, the requirement file and the evidence block so far. File-only runners get a rule in the pointer file: re-read the requirement after any long operation.

### Measure it

Three numbers in the build report, per phase, trending: `claim` findings per requirement (the agent said something untrue), invented-name findings per requirement (a name not in the folder), and review round-trips. The first two should trend toward zero within a few phases as the pattern library and memory fill in. If they do not, the prompt, not the model, is the first suspect, and `vibekit replay` is how you find out.

## 56. Skills: lifecycle, testing and interoperability

§7 defines the format. This section defines where skills come from, how they earn their place, and how they travel.

### Three kinds of skill

| Kind | Example | Written by | Lives in |
| --- | --- | --- | --- |
| **Pattern** | A command handler, an endpoint with its contract test, a security-sensitive operation (§55) | Lifted from the house template; reviewed once by the tech lead (security patterns by the security approver) | `skills/lib/patterns/` |
| **Procedure** | How this team does tenant scoping; how to add a migration here; how to verify an API signature | Promoted from memory (§30) or authored at stage 2 | `skills/lib/` |
| **Tool** | A VibeKit-shipped skill: `find-existing`, `verify-api`, `ui-conventions`, `ears-writer` | Shipped with VibeKit, versioned with the prompts | `skills/lib/vibekit/` |

Tool skills are generated and carry the header; a team that edits one takes it over. Pattern and procedure skills are authored.

### Where skills come from

1. **The template ships with its patterns.** A house template is not accepted until every pattern its architecture uses has a skill with a worked example and a test (below).
2. **Memory promotion.** A memory matched more than five times (§30) is proposed as a procedure skill. The proposal includes the sessions that matched it, so the reviewer can see it earned its place.
3. **Reviewer findings.** A finding the reviewer raises three times across requirements (`vibekit report build` counts them) is proposed as a skill or a rule. If it is about *how* to do something, skill; if it is about *whether*, rule.
4. **Authored at stage 2.** The planner writes the procedure skills the architecture implies (one per layer boundary, one per external integration), as stubs an implementer completes on first use.

A skill nobody asked for is not written. `vibekit check` reports skills whose triggers have matched zero tasks in the last 50 requirements as candidates for archiving, the same rule as memory.

### Every skill has a test

A skill is a prompt fragment, and prompt fragments regress silently. Each skill file has a sibling `<name>.test.md`:

```markdown
---
skill: tenant-scoping
triggers-on: ["add a TenantId filter to the bookings query", "per-customer report"]
must-not-trigger-on: ["rename the tenant column"]
given: tests/fixtures/skills/tenant-scoping/    # a small repo state
expect:
  - file: src/Bookings/Queries/ListBookings.cs
    contains: [".Where(b => b.TenantId == tenant.Id)"]
  - no-file: src/Bookings/TenantFilter.cs        # must extend, not create
---
```

`vibekit test-skills` runs each against the pinned implementer model: checks the triggers fire and only fire when they should, runs the skill on the fixture, and asserts the expectations. It runs in VibeKit's CI for tool skills and in the team's CI for their own, and `vibekit replay` covers the rest. A skill without a test loads with a warning and cannot be promoted from repo to team scope.

### Budget and conflicts

- A skill body is 100 to 400 tokens; over 400 is split into two skills or one skill plus a pattern file it points at.
- Two skills whose triggers overlap by more than half are flagged; either merge them or make the triggers disjoint. Overlapping skills are how agents get two instructions for one task.
- At most three skill bodies load for one task. If more match, the three with the most specific triggers load and the log says which were left out.

### Scope and sharing

Skills have the same three scopes as memory: `repo` (default), `team` (a designated skills repo, pulled read-only at session start, written by PR), and `vibekit` (shipped). `vibekit skills promote <name> --to team` opens the PR with the skill, its test, and its match history. A team skill overrides a shipped one of the same name; a repo skill overrides both. `vibekit check` reports the override chain so nobody is surprised by which version fired.

### Interoperability with the tools' own skills

Every major runner now has a skills mechanism, and a VibeKit skill should work in all of them without being rewritten:

| Runner | Its format | What the generator writes |
| --- | --- | --- |
| Claude Code | `SKILL.md` folders with front matter | `.claude/skills/<name>/SKILL.md` per VibeKit skill, front matter mapped from `index.yml` triggers; body is a pointer to `vibekit/skills/lib/<name>.md` so there is one source |
| Cursor | `.cursor/rules/*.mdc` with globs | One rule per skill with globs derived from the pattern's paths in `map.md` |
| Copilot | `.github/instructions/*.instructions.md` with `applyTo` | One file per skill |
| Codex, OpenCode | `AGENTS.md` sections | The index inlined, bodies by reference |

The pointer files and `.claude/commands/` are already generated; skill projections are generated beside them, carry the header, and regenerate when `index.yml` changes. A skill written in one tool's native format can be imported: `vibekit skills import .claude/skills/foo` converts it to `lib/foo.md` plus an `index.yml` entry with the triggers inferred from its description, marked `confidence: low` until a human edits the triggers.

### VibeKit's own skill

VibeKit ships one skill about itself, `vibekit/folder`, always projected into every runner's format: what the folder is, the load order, the ask rule, how to read `status.md`, and the command list. It is what makes a tool that has never seen VibeKit behave correctly on the first session, and it is the answer to "what if the pointer file gets ignored": the skill fires on the words `vibekit`, `requirement`, `ask`, `guardrail`.

## 57. Live tracker

A single page, reachable from any device, that shows where the build is, what is blocked, what security findings are open and what is scheduled next, and lets an authorised person act on it: answer an ask, approve a gate, reorder the plan, leave a note. Every action becomes a commit. It is the §24 status view made portable.

### What it is

`vibekit serve --tracker` serves the page from the same process as the MCP runner, reading the folder and `.state/` directly and pushing changes over server-sent events, so the page is live without polling. It is a progressive web app: installable on a phone, works offline for reading, queues actions while offline and replays them when back. `vibekit tracker --qr` prints a QR code to the terminal and writes `tracker-qr.png` to the outputs folder; scanning it opens the page.

### What it shows

One screen, four cards, ordered by what needs a human most. Everything on the screen is the plain-language version (§12): what it means, what happens if you choose each option, and why it matters, in words a product owner uses. Technical detail, file names and ids are behind a "details" tap on every card. A decision the person can make in one read, without remembering anything from an earlier one, is the bar.

| Card | Source | Content |
| --- | --- | --- |
| **Needs you** | `workflow/asks/`, gates, PRs awaiting review | Open asks sorted by blast radius (how many requirements wait on each); gates ready to approve; PRs needing a named human. Each with a one-tap action |
| **Where we are** | `status.md`, `plan.md`, `tasks.json` | Stage and phase; requirements by status; who holds what and for how long; the next five in plan order; parallel lanes open |
| **Security** | `report security` | Open high or critical findings; unredacted sources; detector hits; guardrail activity in the last 24 h; dependencies flagged by `check --deps` |
| **Schedule** | `plan.md`, `report build` throughput | Phases with completion estimate derived from measured throughput (never an agent's estimate); milestones and release tags; what is deferred and why |

Tapping any item opens the underlying file rendered read-only, with `vibekit why` one tap away on any requirement or criterion. The three full reports (§48) are one tap from the security and schedule cards.

### What you can do from it

| Action | Who | What it writes |
| --- | --- | --- |
| Answer an ask, pick an option | Any approver whose role in `humans.md` routes that ask kind | `## Answer` in the ask file; append to `workflow/answers/` |
| Approve or reject a gate | The role `humans.md` names for that gate | The `approved:` line, or a rejection note in `status.md` |
| Reorder or defer requirements | Product owner or tech lead | `plan.md`, with a log line |
| Change a requirement's size or status to `review` | Tech lead | The requirement's front matter |
| Add a requirement or quick fix | Product owner (add), tech lead (quick) | `vibekit add` / `vibekit hotfix` with the text typed |
| Leave a note on anything | Anyone with access | A `## Notes` line in the file, attributed and timestamped |
| Accept or reject a memory proposal | Tech lead | The ask's status and the memory file |
| Release a stale hold | Tech lead | `vibekit unhold` |

Nothing on the page can edit code, `standards/`, `guardrails.md` or `architecture.md` content. Those are pull requests.

### Send back to the cloud

Every action is written to the file, committed on the tracker's own branch `tracker/<user>` with §51 trailers (`VibeKit-Role: human`, `VibeKit-Via: tracker`), and pushed to the remote. `serve` then merges `tracker/*` into the current working branch when the change is to workflow files (asks, answers, status, plan), which is always a clean merge because those files are append-only or single-owner; anything that would conflict is left on the branch as a PR and the page says so. Offline actions queue on the device, signed with the session, and replay in order on reconnect; a queued action whose target changed underneath it is shown for re-confirmation rather than applied.

### Exposure through Cloudflare Tunnel

The tracker is never exposed by opening a port. `vibekit serve --tracker --tunnel cloudflare` starts a named `cloudflared` tunnel from the tunnel token in app settings, mapping `tracker.<your-domain>` to the local page. Requirements:

- **Cloudflare Access in front of it, always.** The tunnel is bound to an Access application with a policy (one-time PIN to an allowed email domain at minimum; the organisation's SSO in Core). `serve` refuses to start the tunnel if the hostname has no Access policy, checked through the Cloudflare API.
- **Identity from the Access JWT.** Every request carries the Access token; `serve` verifies it against Cloudflare's public keys and maps the email to a name and role in `agents/humans.md`. An email not in `humans.md` sees a read-only page or nothing, per a setting. This is the identity the commit trailers and the audit log record.
- **Read-only unless named.** Write actions require the role that `humans.md` gives that action. The QR code can safely be on a wall: scanning it gets a login, not access.
- **Tunnel-only.** `serve --tracker` binds to localhost; the only route in is the tunnel. Other providers (ngrok, Tailscale Funnel, a reverse proxy with OIDC) fit the same `--tunnel <provider>` slot; Cloudflare is the reference.
- **What crosses the tunnel.** Rendered status, asks, plan, reports and file views. Never a repository clone, never secrets, never `.env`. Diffs are shown for PRs awaiting review because reviewers need them; the setting `tracker-show-diffs` can turn that off for public-ish deployments.
- **Session limits.** Access session length is set in Cloudflare; `serve` additionally expires its own session after `tracker-session` (default 12 h) and on any change to `humans.md`.

### Notifications

Optional, from the same events: a push notification (PWA) or a message to Slack, Teams or email when an ask opens, a gate becomes ready, a security finding is high or critical, or a hold goes stale. Routed by the same `humans.md` roles, so the product owner is not paged about a dependency licence and the security approver is not asked about copy text.

### In the free tier

The tracker, QR, tunnel and one-time-PIN Access are free-tier; SSO-backed Access, per-role write scopes beyond a single approver, notifications to Slack or Teams, and the audit export are Core, consistent with Appendix F.

## 58. Understand and convert an existing repo

> **In plain terms.** Point VibeKit at a project you already have and it reads the code and tells you, in plain language, what the app is, how it's built, what it talks to, where the risks are, and how well tested it is. It asks about anything it can't tell. When you're happy the picture is right, one command turns that understanding into a VibeKit folder, so the project can be worked on the VibeKit way from then on. Nothing in the existing code is changed.

`vibekit project import <path or git url>` is the brownfield front door. It runs before `adopt` (§18) and `reverse` (§41) and produces the understanding they act on.

### What it reads

The repo tree, build and dependency files, migrations and schema, routes and controllers, tests, CI config, Dockerfiles and infra, README and any existing `CLAUDE.md`, `.cursorrules` or `AGENTS.md`, and the last 200 commits. It reads code in the order the loading model prefers: manifests and structure first, then one representative file per layer, then anything a question sends it to. Budget: 40,000 tokens of reading for a first pass, reported.

### What it writes: the understanding report

`vibekit/understanding.md`, authored (a human corrects it), every line carrying a confidence:

```markdown
## In plain terms
This is a booking system for gyms. Members book classes; staff manage schedules; it takes card payments
through Stripe and sends email through SendGrid. About 60 screens, 14 database tables, 210 tests.
It is built the way .NET apps usually are, in layers, and it deploys as one container.

## What it is                 confidence: high    from: README, routes, entities
## How it is built            confidence: high    from: project layout, DI registration
   layers · patterns actually in use · where each kind of code lives · the commands that build and test it
## Entities and data          confidence: medium  from: EF model, migrations
   14 entities · classification guessed from field names (email, cardLast4 → personal, financial) · to confirm
## What it talks to           confidence: high    from: HttpClient registrations, config keys
   Stripe · SendGrid · an internal reporting API (undocumented)
## Quality                    confidence: medium  from: test projects, CI
   210 tests · 61% coverage · no contract tests · no smoke test · CI runs unit only
## Risks                      confidence: medium
   secrets in appsettings.Development.json (2) · 3 dependencies with no release in 2 years · SQL built by string
   concatenation in ReportsController (2 sites) · no tenant filter on 4 queries
## Conventions nobody wrote down   confidence: low  from: repeated patterns
   every handler validates with FluentValidation · dates are UTC · soft-delete via IsDeleted
## What I could not tell      → asks
```

Everything under "Risks" is also written as security findings so the security report has them from day one. Everything under "Conventions nobody wrote down" is a candidate rule or skill.

### Asks it raises

Only what the code cannot answer: who uses this, which of the integrations are still live, whether the undocumented API is yours, what the data classifications are, which conventions are intentional. Ten at most; the same ask shape and plain-language rule as §12. Answers correct the report.

### Convert

`vibekit project import --convert` (or `vibekit sprint run` after the report is approved) turns the corrected understanding into the folder:

| Understanding section | Becomes |
| --- | --- |
| What it is | `product/context.md`, `glossary.md` (starter) |
| How it is built | `workflow/architecture.md` as observed · `product/map.md` with the real commands · `standards/code-style.md` from observed style |
| Entities and data | `product/entities.md` with classifications · `product/access.md` skeleton |
| What it talks to | `## Dependencies` in the architecture record · `delivery/environments.md` with the secret names found |
| Quality | `product/quality.md` starter · `tests/smoke/` stub · the missing test kinds listed as generated requirements |
| Risks | Open security findings · `guardrails.md` denied paths for the risky areas |
| Conventions | `standards/rules.md` starter · one skill stub per convention |
| Commit history | `memory/repo/` decision memories for the ten most-referenced decisions in commit messages |

Then `reverse` (§41) drafts one requirement per existing test class, and the workflow continues at stage 4 with rules-only mode: no application code is generated, and the first build requirements are usually the gaps the report found (a smoke test, the string-concatenated SQL, the missing tenant filter).

### Guarantees

- Read-only until `--convert`, and `--convert` writes only the pointer files and the folder. Existing files are never modified; existing `CLAUDE.md`-style files are kept below the `<!-- local -->` marker.
- `vibekit check` runs against the converted folder immediately and must be green before any agent starts; §18's gate.
- Every claim in the report cites the file it came from, so `vibekit why` works on the understanding as well as on new code.
- The report is re-runnable: `vibekit project import --refresh` diffs the code against the last understanding and reports what changed, which is how a repo that was converted six months ago gets re-checked.

In the everyday verbs, `understand` is the eighth, and the only one you use on someone else's code.

## 59. Generated SRS and technical specification

> **In plain terms.** At any point, VibeKit can write the two documents people usually ask for: a requirements specification (what the system does, for the business) and a technical specification (how it's built, for engineers). Both come from the folder, so they're never out of date, and before writing them VibeKit asks about anything the folder doesn't cover yet. For an existing project, this is how you get the documentation it never had.

`vibekit spec` generates two documents from the folder. They are outputs, not sources: editing them by hand is allowed (they become authored, §3) but the normal path is to change the folder and regenerate. Both are available as Markdown, Word and PDF, and both carry the commit they were generated from.

### When it runs

- **Greenfield:** first draft after the architecture gate (stage 2), full draft after plan approval (stage 4), regenerated at every phase gate and release. The SRS after stage 1 is the document you send back to the business to confirm you understood the BRS.
- **Brownfield:** immediately after `vibekit project import --convert` (§58). The questions it raises are usually the first real work on the project.
- **On demand:** `vibekit spec [srs | tech | --both] [--at <sha>]`.

### The questions it asks first

`spec` walks each section below and, for any it cannot fill from the folder, raises an ask (§12, plain language first, ten at most). Typical gaps: performance targets, availability expectations, data retention periods, who the external interfaces are owned by, browser and device support, accessibility level, backup and recovery expectations, and the operating hours the system must be available. Answers land in `quality.md`, `context.md` or `architecture.md`, never only in the document, so the next generation has them.

### Software Requirements Specification

Structured on the IEEE 830 / ISO 29148 shape that procurement and QA teams expect, every statement traceable:

| Section | Generated from |
| --- | --- |
| 1 Introduction: purpose, scope, definitions, references | `context.md`, `glossary.md`, `sources/index.md` |
| 2 Overall description: product perspective, user classes, operating environment, constraints, assumptions | `context.md`, `access.md` roles, `architecture.md`, `assumptions.md` (with confidence) |
| 3 Functional requirements | One entry per `REQ-*`: id, title, size, source citation, EARS criteria `AC-n`, entities, status. Grouped by phase or by flow (`flows.md`) |
| 4 External interfaces: user, hardware, software, communications | `flows.md` and `components.md`; `## Dependencies` and trust boundaries; `environments.md` |
| 5 Non-functional requirements: performance, availability, security, privacy, accessibility, maintainability | `quality.md`, `standards/security.md`, data classifications, retention rules, `invariants.md` |
| 6 Data requirements | `entities.md` with classifications and relations; erasure requirements |
| 7 Open questions and deferred scope | Open asks; `plan.md` deferred list with reasons |
| Appendix: traceability matrix | `vibekit trace --matrix`: source section → requirement → criterion → test |

### Technical specification

| Section | Generated from |
| --- | --- |
| 1 Architecture overview, layers, allowed references, the three forbids | `architecture.md`, `map.md` |
| 2 Component and module map, where each kind of code lives | `map.md`, `system.md` if multi-repo |
| 3 Data model: entities, fields, types, relations, classifications, migrations to date | `entities.md`, `MIG-*` |
| 4 API contracts: endpoints, request and response shapes, auth requirements, error shapes | Contract tests (`tests/contract/`), `access.md`; OpenAPI emitted alongside |
| 5 Security design: auth, authorisation matrix, trust boundaries, threat models, logging rules, secrets handling | §52 files and per-requirement security notes |
| 6 Integrations: each external system, direction, failure mode, credentials location | `## Dependencies`, `environments.md` |
| 7 Build, test and deployment: commands, test kinds and where they run, pipeline stages, environments and promotion, observability | `map.md`, §23 table, `pipeline.spec.md`, `environments.md`, `observability.md` |
| 8 Operations: runbook, health and readiness, rollback, backups | `runbook.md`, §50 |
| 9 Decisions log | `memory/repo/` decision memories and `assumptions.md`, dated |
| 10 Conventions and standards | `standards/*`, the skills index |

### Rules

- Every requirement and every claim in either document links back to its file; the PDF footnotes the path and commit, the Markdown links it. A statement `spec` cannot trace is not written.
- The documents show the status of each requirement at generation time, so the SRS at phase 2 shows what is done, in progress and deferred rather than pretending everything is future.
- Both carry a change log between generations (`vibekit spec --diff <sha>`), which is what a client or auditor asks for when the BRS moved.
- Plain-language summaries (§12) head each SRS section; the technical spec is technical throughout.
- Generation is part of `vibekit ship release`: a release ships with the SRS and technical spec that describe it.

## 60. Session context management

> **In plain terms.** An AI session has a limited memory for the task in front of it, and the longer it runs the more it forgets from the start. VibeKit keeps each session short and focused, saves a checkpoint of progress into the requirement file every few steps, and when a session runs out of room or crashes, the next one reads the checkpoint and carries on exactly where it stopped. What the AI learned long-term is a separate thing (Part D); this is about not losing the thread today.

Three layers of memory, each with one home:

| Layer | Lives | Lifetime | Managed by |
| --- | --- | --- | --- |
| Working context | The model's context window | One session | `serve` (this section) |
| Task state | The requirement file: `## Approach`, `## Checkpoint`, `## Evidence`, `## Log` | One requirement | The agent, checkpointing |
| Long-term memory | `memory/` | The project | Distil and promotion (Part D) |

### Context window budget

`serve` knows each model's window and tracks usage per session. The folder's always-loaded set takes \~4,900 tokens; the scoped set for a requirement \~1,500; that leaves the rest for work. `serve` sets a soft limit at 60 per cent of the window and a hard limit at 80 per cent:

- At the soft limit the agent is told to checkpoint (below) and to finish its current step without starting another file.
- At the hard limit `serve` ends the session cleanly: checkpoint written, worktree left as is, requirement stays `in-progress` with the holder recorded, and a new session is started from the checkpoint. The log line says `continued after context limit`.

Tool output is trimmed before it enters context: test runs are reduced to the summary line plus failing tests; build output to errors and warnings; file reads over 300 lines are refused unless the agent names a line range; `grep` results are capped at 50 hits. The full output is kept in `.state/sessions/<id>/` for the reviewer and for `verify`.

### Checkpoints

Every agent writes `## Checkpoint` in its requirement file after each completed step of the build loop (§22), and at the soft limit:

```markdown
## Checkpoint   2026-09-23T14:32Z   session s-0419   step 2 of 6
done:     AC-1 test written (failing) · AC-2 test written (failing) · CancelBooking handler created
in hand:  wiring RefundService into the handler; file src/Bookings/CancelBooking.cs open, line 41
next:     run tests → expect AC-1 pass, AC-2 fail → implement too-late branch
open:     P-007 (Refund entity) waiting; assumed option 1 in the meantime, marked in Approach
read:     standards/*, REQ-014, entities#Booking,#Payment, skills/idempotent-handlers, memory/M-003
```

A checkpoint is small (under 200 tokens), replaces the previous one, and is committed with the work. It is the only thing a resumed session needs beyond the standard scoped set: ` vibekit resume on an in-progress requirement loads the checkpoint  ` and the stage prompt tells the agent to continue from `next:` rather than re-plan.

### Compaction protocol

Runners that compact context (Claude Code, Cursor) notify `serve`. On compaction, `serve` re-sends, in this order: `standards/*` in full, the requirement file (which now includes the checkpoint), the entity sections named, and nothing else. The agent is instructed to re-read `## Approach` and `## Checkpoint` before its next action. File-only runners get the same instruction in the pointer file: after any compaction or any operation over ten minutes, re-read the requirement.

### Session isolation

- One session, one requirement, one role, one worktree. A session never carries context from another requirement.
- The reviewer always starts a fresh session with a fresh context; it never inherits the implementer's window. Reviewing with the implementer's context is reviewing with its blind spots.
- Subtasks an agent spawns (a runner's subagents) inherit the loads manifest, not the parent's full context, and return a summary of under 300 tokens. The parent's checkpoint records what was delegated.
- Sessions are numbered and recorded in `.state/sessions.json` with model, role, requirement, tokens in and out, compactions, checkpoints written, and how the session ended (handoff, blocked, context limit, crash, unhold).

### Recovery

| Failure | What happens |
| --- | --- |
| Context limit | Clean end, checkpoint, new session continues |
| Crash mid-step | Last checkpoint stands; uncommitted files in the worktree are kept; the resumed session is told "the worktree may be ahead of the checkpoint; reconcile before continuing" |
| Hold times out | `unhold` (§46); the next holder starts from the checkpoint and the worktree, and the log says who held it before |
| Runner switched (start in Claude Code, resume in Cursor) | Same files, same checkpoint; the log records the runner change. This is the case the file-driven design exists for |

### Pausing the project

Session-level interruption is handled above. Project-level pause is the deliberate kind: stop for the weekend, for a month, for a budget freeze.

`vibekit stop [--reason "..."]`:

1. Signals every running session to checkpoint at its next step and stop cleanly.
2. Leaves branches, worktrees and uncommitted work exactly as they are; commits each checkpoint so nothing lives only on disk.
3. Releases holds in `.state/tasks.json` so no requirement is stuck to a session that no longer exists, and sets those requirements to `paused` rather than `ready` so nothing auto-starts.
4. Writes a resume note into `status.md`: what was in flight, what was blocked and on whom, which asks were open, and the phase's position.
5. Runs `vibekit distil` so what the sessions learned is not lost while the project is cold.

`paused` is its own state, distinct from `blocked`: blocked means waiting on a person, paused means waiting on the project to restart. Both appear separately on the board.

`vibekit resume` re-establishes ground truth rather than trusting the note. Before any agent runs it reports, and asks about anything that changed while the project was cold:

| Checked on resume | Why |
| --- | --- |
| `vibekit check` and the full test suite on `main` | The repo may have moved; someone may have merged by hand |
| Worktree reconciliation per paused requirement (§60) | Uncommitted work is described before it is built on |
| `check --deps` | A dependency may have gone stale, been yanked, or published a vulnerability |
| Prompt and spec versions in `profile.md` | VibeKit may have upgraded; a prompt diff is shown before it is applied |
| Source documents | A BRS may have been re-ingested; affected requirements go to `review` |
| Open asks | Still open, and now older than the threshold; shown first |
| Model mappings | `strong`, `mid` and `cheap` may point at different models than they did |

Nothing still valid is re-planned. A requirement whose checkpoint verifies, whose worktree reconciles and whose criteria are unchanged returns to `in-progress` and continues from `next:`. Anything that fails a check returns to `ready` with a log line saying why, and a long pause (over `stale-after`, default 30 days) additionally suggests `vibekit project import --refresh` before resuming.

A paused project costs nothing: no sessions run, no caps tick, and the tracker shows the resume note instead of a progress view.

### Hardening

**Checkpoints are verified, not trusted.** A checkpoint's `done:` line may only claim what `verify` can confirm. When a session resumes, `serve` runs `vibekit verify --quick` (build plus the tests the checkpoint names) before the agent reads anything, and rewrites `done:` to what actually passed. A checkpoint that claimed more than the evidence shows is logged as a `claim` finding against the session that wrote it (§55), and the resumed agent sees the corrected version. The agent never gets to inherit its own optimism.

**Worktree reconciliation.** On resume, `serve` diffs the worktree against the last checkpoint's commit. Uncommitted changes are listed to the agent as "files changed since the checkpoint, not described by it" with the diff, and the stage prompt's first instruction is to reconcile: keep, revert, or describe each before continuing. If the diff touches a denied path, it is reverted automatically and logged. Nothing in an unreconciled worktree is built upon.

**Checkpoint cadence is enforced.** `serve` counts steps and tool calls since the last checkpoint; past 12 tool calls or one completed loop step without one, it injects the instruction to checkpoint now and refuses further file writes until one is written. A session that ends without a checkpoint in its last 12 calls is flagged in the build report.

**Recovery is a tested path.** VibeKit's own CI runs the recovery fixture on every release: start a requirement on a fixture repo, kill the session at a random step between 2 and 5, resume, and require the requirement to reach `tested` with the same evidence a straight run produces. Three variants: kill after checkpoint, kill mid-edit before checkpoint, and resume on a different runner. A release that fails the fixture does not ship. Teams can run the same fixture against their own template with `vibekit tools replay --recovery`.

**Drift between checkpoint and requirement.** If the requirement file changed under a running session (a human edited a criterion from the tracker, or a BRS re-ingest set it to `review`), `serve` stops the session at the next step, logs `requirement changed during session`, and the resume reads the new requirement with the old checkpoint marked `stale: criteria changed`. The agent re-plans from `## Approach`, which is cheap, rather than continuing against criteria that no longer exist.

### What this replaces

No session summaries, no conversation transcripts, no "memory of the chat". The requirement file with its approach, checkpoint, evidence and log is the complete record of the work, readable by a person, and it is what the next session, the reviewer, the tracker and `vibekit why` all read.

## 61. Model routing and cost control

> **In plain terms.** Not every job needs the most expensive AI. Deciding how the app is built does; renaming a field doesn't. VibeKit sends each job to the cheapest model that does it well, moves up to a stronger one only when the cheap one fails, and never lets a task or a phase spend past a number you set. You see the bill per piece of work, and what each model was used for.

### Tiers, not models

The folder never names a model; it names a tier. App settings map tiers to models and the mapping changes without touching the repo:

| Tier | Used for | Example mapping (settings, per organisation) |
| --- | --- | --- |
| `strong` | Judgement: clarify, architecture, plan, review of L, security review, understanding an existing repo | The best available frontier model |
| `mid` | Production: implementing M and L requirements, migrations, design system extraction | A mid-priced capable model |
| `cheap` | Mechanical: S requirements, scaffolding from the template, fixtures, docs generation, changelog, compliance pass, distil first pass | A small fast model |
| `local` | Never leaves the machine: secret detection, redaction, EARS parsing, embedding for skill and memory matching | A local model or no model at all |

`sessions.json` records the tier and the actual model for every session, so the budget report can show both.

### Routing policy

The default policy, editable in `agents/humans.md` under `## Model policy` and overridable per requirement:

```markdown
## Model policy
- analyst, planner, designer:         strong
- implementer  size S:                 cheap
- implementer  size M:                 mid
- implementer  size L:                 mid, strong if the requirement touches financial or secret data
- migrator:                            mid
- reviewer:                            one tier above the implementer, and a different model
- compliance:                          cheap
- understand, spec:                    strong for the report; cheap for generation from the folder
- distil, changelog, docs, fixtures:   cheap
```

The reviewer rule is the important one: review is where a cheap implementer's mistakes are caught, so review is never cheaper than the work it reviews.

### Escalation

Cheap first, escalate on evidence, never on a hunch:

1. An S or M requirement starts on its policy tier.
2. If the reviewer returns findings twice (§23 budget), the third attempt runs one tier up, with the findings in context.
3. If a `claim` finding (§55) or an invented-name finding occurs, the requirement is re-run one tier up from the last checkpoint immediately; cheap models that hallucinate on a task do not get a second try at the same tier.
4. If three requirements in a phase escalate, the planner is asked whether the phase's default tier should move up, and the answer is recorded.

Escalations are logged with the reason, and the budget report shows them as their own line: they are the cost of trying cheap first, and the number should be small.

### Caps

Three caps in `profile.md`, all in tokens, converted to currency by the app's `rates.yml`:

| Cap | Default | On breach |
| --- | --- | --- |
| `cap-requirement` | 3× the forecast for its size (§40) | Session ends at the next checkpoint; requirement `blocked` with reason `over budget`; a human decides: raise the cap for this one, escalate tier, or split it |
| `cap-phase` | The phase forecast × 1.5 | No new requirement starts; the tracker shows it; the product owner raises or re-scopes |
| `cap-day` | Set by the team | `serve` pauses new sessions until midnight or a human override; running sessions checkpoint and stop |

Caps are ceilings, not targets. The forecast (§40) is the expected number; the cap is the point at which spending more without a human looking is wrong.

### Spending less for the same result

- **Prompt caching.** The always-loaded set (\~4,900 tokens) is identical across every session on a repo. `serve` orders it first in the prompt and marks it cacheable on providers that support caching, which typically cuts input cost on that portion by an order of magnitude. Order is stable so the cache holds: pointer, standards, product core, indexes, then the scoped set.
- **Batch the non-urgent.** Distil, changelog, docs, spec regeneration and the security report run through batch endpoints where the provider offers them, at reduced cost, overnight or at phase gates.
- **Trim before it enters.** §60's tool-output trimming is a cost control as much as a context one; test logs are the largest avoidable input on most sessions.
- **Don't re-read.** A resumed session loads the checkpoint, not the transcript.
- **Local for the mechanical.** Detection, parsing and matching never call a paid model.

### What the reports show

The budget report (§48) adds: spend by tier; spend by role; escalations with reasons; cache hit rate on the always-loaded set; the ten most expensive requirements and whether they were over forecast; and a line per model with tokens in, tokens out and cost. The security report shows which model saw files classified `secret` or `financial`, because data residency (§52) is also a routing rule: a requirement touching those classes may only route to models in the `data-residency` set.

## 62. Routing across runners

> **In plain terms.** People use different AI coding tools, and most of those tools choose their own AI model on a subscription you've already paid for. VibeKit can't reach inside them to pick a cheaper model, so instead it routes the *work*: it says which tool a piece of work should be done in, and why. A subscription seat you've already bought is the cheapest thing you own, so VibeKit uses it first and only spends on metered tokens where a seat can't go.

### Two kinds of runner

|  | Seat runners | API runners |
| --- | --- | --- |
| Examples | Claude Code, Cursor, Copilot, Windsurf, Codex CLI | `vibekit serve` calling a provider directly; CI agents |
| Who picks the model | The tool and its user | VibeKit, per §61 |
| Cost shape | Flat per seat per month, rate-limited | Metered per token |
| Marginal cost of one more requirement | \~zero until the rate limit | Real |
| Sandbox, command allow-list, token accounting | Partial (MCP gives rules and tools; not the model or a sandbox) | Full |
| Runs unattended | No, a person is at the keyboard | Yes |

This is the fact the architecture turns on: **a seat is a sunk cost and an API call is a marginal cost.** Routing exists to push work onto sunk cost wherever quality allows, and to spend metered tokens only where a seat cannot go, which is mainly unattended work in CI and at night.

### The routing decision, in order

Every session starts with `vibekit sprint run`, which answers three questions in this order and records all three in `sessions.json`:

1. **Attended or unattended?** Is a person at a keyboard right now? Attended work goes to a seat runner by default. Unattended work (CI review, overnight distil, smoke after deploy, batch spec generation) has no seat available and goes to an API runner.
2. **Which runner?** From `agents/runners.md` (below): the person's preferred seat if they have one, unless the job needs something that seat lacks, in which case the reason is stated. Rate limit reached on a seat is itself a reason to move.
3. **Which tier?** §61's policy, which only binds on API runners. On a seat runner the tier is a *minimum*: VibeKit states "this job needs at least mid", and the runner's own model selection either satisfies it or the session is refused with an explanation.

### `agents/runners.md`

Authored, one entry per runner the team uses:

```markdown
## Runners
- id: claude-code
  kind: seat · mcp: yes · sandbox: partial · unattended: no
  models-available: [strong, mid]        what the seat's plan can select
  seats: 4 · rate-limit: per-5h window
  good-at: [implementation, refactor, review, long sessions, terminal work]
- id: cursor
  kind: seat · mcp: yes · sandbox: no · unattended: no
  models-available: [strong, mid, cheap]
  seats: 6
  good-at: [implementation with lots of file navigation, UI work, quick edits]
- id: api-sonnet
  kind: api · mcp: n/a · sandbox: full · unattended: yes
  tier: mid · residency: eu-west
- id: api-haiku
  kind: api · sandbox: full · unattended: yes
  tier: cheap

## Routing preferences
- unattended work                     → api runners only
- size L, or financial/secret data    → sandbox: full, or a seat with a named human present
- review                              → never the same runner AND model as the implementer
- overnight batch (distil, docs, spec)→ api, cheap, batch endpoint
- rate-limited seat                   → next seat, else api at the required tier
```

`vibekit check --runners` verifies each entry can actually reach the folder, reports which are unsandboxed (§52), and reports seat utilisation so you can see whether you are paying for seats you do not use or hitting limits you should raise.

### The triangle, made explicit

Cost, speed and quality. You cannot have all three; the spec's position is that **quality is fixed by the gates and the other two are the dials.** A requirement cannot ship without its criteria tested, its checks green and its review passed, whatever runner or tier produced it. So the choice VibeKit offers is where on the cost/speed line a piece of work sits, never whether it is correct.

`profile.md` carries a `mode` that sets the defaults, changeable per phase:

| Mode | What it does | Use when |
| --- | --- | --- |
| `thrift` | Seats first for everything attended; S on cheap; batch everything batchable; one implementer at a time; escalate only on evidence | Steady development, cost matters more than the calendar |
| `balanced` (default) | §61 policy as written; seats for attended work, api for unattended; two parallel lanes | Most of the time |
| `sprint` | Every independent requirement gets a lane, api runners used alongside seats to raise concurrency, tier one above policy to cut rework, batch disabled | A deadline; you are buying speed with money |

The mode never touches the gates, the checks, the review rule or the definition of done. It changes how many things run at once and what they run on. `vibekit report budget` shows the cost of the mode you chose against what the other two would have cost, computed from the same forecast, so the trade is visible rather than felt.

### Why seats first is usually right

A seat's marginal cost is zero until its rate limit. The limit, not the price, is the scarce resource, so the architecture treats seat capacity as a budget to spend deliberately: `vibekit sprint run` hands a person the requirement that most needs a strong model *while their seat is fresh*, and pushes mechanical work (fixtures, docs, changelog, compliance, distil) to cheap API runners so seat capacity is not burned on work a small model does fine. When a seat hits its limit mid-requirement, §60's checkpoint means the work moves to an API runner or another seat without losing the thread, and the log records the move.

### What must stay true whatever the runner

- The folder is the only interface. Every runner reads the same files and writes the same files.
- A checkpoint written in one runner is resumable in another. This is tested in the recovery fixture (§60).
- Review is never the same runner *and* model as the implementation.
- Unsandboxed runners cannot hold L requirements or anything touching secret or financial data unless a named human is present, per the gate policy.
- Every session records runner, tier, model, why it was chosen, tokens and outcome, so the budget and security reports are complete regardless of where work happened.

### Calibration

Calibration is a setting, not advice. `profile.md` carries `calibrate: true` (the default on a new template): while it is on, size S runs on `mid` rather than `cheap` and the mode stays `balanced`. At each phase gate `vibekit sprint run` reports the escalation rate; when a phase completes under 10 per cent, it proposes dropping S to `cheap` and a human accepts. Above 10 per cent, the `cheap` mapping is too weak for this template and the fix is the mapping in app settings, not the policy. `calibrate` is set once per template, not once per project: a template that has been calibrated ships with `calibrate: false` and the S tier its escalation data supports.

## 63. Model registry and rate intelligence

> **In plain terms.** Model prices change every few months and new models appear constantly. You should not have to keep a spreadsheet. VibeKit keeps a price list for every provider you use, refreshes it on a schedule, shows you exactly what changed and what it will cost you, and tells you when a different model would do the same work for less — based on how models have actually performed on your projects, not on a vendor's benchmark.

### The registry

`~/.vibekit/registry/` (per install, shared across projects; a team can point at a shared one) holds one file per provider:

```yaml
# registry/anthropic.yml
fetched: 2026-09-23T06:00Z
source: https://www.anthropic.com/pricing          # first-party only
checksum: sha256:…
models:
  - id: claude-haiku-4-5
    input: 1.00
    output: 5.00
    cache_read: 0.10
    context: 200000
    status: current
    first_seen: 2025-10-01
  - id: claude-sonnet-5
    input: 2.00
    output: 10.00
    context: 1000000
    status: current
  - id: claude-opus-5-5
    input: 4.00
    output: 20.00
    cache_read: 0.20
    status: current
  - id: claude-opus-5
    input: 5.00
    output: 25.00
    status: current
  - id: claude-fable-5-1
    input: 10.00
    output: 50.00
    cache_read: 0.25
    status: current
discounts:
  cache_hit: 0.10          # of input
  batch: 0.50              # of both
```

Currency, and any negotiated rate, is an override file the registry never touches: `registry/overrides.yml`. An enterprise contract price wins over the public one, and the report says which was used.

### Fetching

`vibekit tools rates refresh` (run weekly by default, and on demand):

1. Fetches **only first-party pricing pages and pricing APIs** of providers in use. Aggregator sites and blogs are never a source of truth: they are frequently stale and sometimes wrong, and a wrong price silently corrupts every forecast.
2. Parses into the schema above, and validates: every current model has both input and output rates, no rate is zero or absurd, no model silently disappeared.
3. Writes only if validation passes. A failed fetch keeps the last good file and reports its age. Nothing ever blocks on the network: a stale registry is used, and every report footnotes the date it was fetched.
4. Records a dated entry in `registry/history.yml` on any change, so a cost report from three months ago can be re-priced at the rates that applied then.

Air-gapped installs disable fetching and maintain `overrides.yml` by hand; the registry reports itself as `manual`.

### What changes are surfaced

`vibekit tools rates` prints a diff a human can act on, and the tracker raises it as an ask when the impact crosses a threshold:

```
Rates changed since 2026-09-16

  claude-opus-5-5   NEW     $4.00 / $20.00     cheaper than opus-5 on both sides
  claude-sonnet-5   $3→$2   input −33%
  claude-haiku-4    RETIRED  no longer sold · you have no mapping to it

Impact on this project, priced on the last 30 days of real sessions:
  strong = opus-5        R 244  →  R 196   if remapped to opus-5-5   (−20%)
  mid    = sonnet-5      R 168  →  R 112                              (−33%)
  Phase 2 forecast       R 900  →  R 684

  Suggested: remap strong → claude-opus-5-5.
  Same family, cheaper on input and output, cache reads 0.20 vs none.
  Calibration required before size L work: run 3 requirements, watch escalation rate.
```

The impact is always computed against **your own measured token usage** from `sessions.json`, not against a vendor's example workload. A price cut on a model you barely use is not news.

### Choosing, not just pricing

Price alone is the wrong signal, because a cheap model that fails costs the failed session plus the review that caught it plus the re-run. The registry therefore carries a second table, built from your own data in `sessions.json`, never from marketing:

| Per model, per role, per size | Meaning |
| --- | --- |
| Escalation rate | How often work on this model had to be redone one tier up |
| Claim findings per 100 sessions | How often it asserted something untrue (§55) |
| Invented-name findings | How often it reached outside `entities.md` |
| Review round-trips | Median, versus the project's median |
| Effective cost per completed requirement | Total spend including failures, divided by requirements that reached `done` |

That last row is the number that decides. `vibekit tools rates --advise` ranks candidates by effective cost and refuses to recommend a model with fewer than 20 completed requirements of evidence at that size, saying so rather than guessing.

When there is no local evidence — a brand-new model, or a new install — VibeKit does not pretend. It offers a **trial**: route the next N size-S requirements to the candidate, keep the reviewer one tier above, and report the effective cost against the incumbent. A trial is a human decision, it is logged, and it can be stopped at any point. Until a trial completes, the incumbent mapping stands.

### Multi-provider

The same registry holds OpenAI, Google, Mistral, Azure, Bedrock, Vertex and self-hosted endpoints, with self-hosted priced at whatever the team enters as cost per million tokens (or zero). Tier mappings may cross providers — `cheap` on one vendor, `strong` on another — subject to two constraints that always win over price: the `models-allowed` list and `data-residency` (§52), and the rule that a reviewer never uses the same model as the implementer.

### What this means day to day

You map tiers once at setup. After that: a weekly refresh runs quietly; when something changes that would save you real money, it arrives as one line in the build report or one ask on the tracker with the rand figure attached; you accept, and every project follows. You never look up a price, and you are never the last to know that the model you have been paying for has been superseded by a cheaper one in the same family.

## 64. Design principles: asked, recorded, enforced

> **In plain terms.** How code should be shaped — how strict the layers are, how you test, how errors travel — is a decision. If nobody makes it, the assistant makes it from whatever it saw most in training, and it will make it differently in different files. VibeKit asks a short set of questions about this at the same time as the architecture, records the answers, and turns each one into a test that fails when it is broken.

An unstated design rule is a hallucinated design rule. The closed entity vocabulary (§6) solves invented *names*; this section solves invented *structure*.

### The stance, from the template

A template declares its design stance in its manifest, so most of this is answered before anyone is asked anything:

```yaml
design:
  layering: [Domain, Application, Infrastructure, Api, Web]
  references: Domain←Application←Infrastructure; Api→Application; nothing→Web
  file-max-lines: 300
  method-max-params: 4
  complexity-max: 10
  one-handler-per-use-case: true
  repository-per-aggregate: true
  mocks: external boundaries only
  errors: result-types
  nullable: enabled, warnings as errors
```

Stage 2 shows this as one screen — *this is how code will be shaped* — with accept or change, exactly like the architecture record. One approval, not a quiz.

### The three questions always asked

These change how every file looks, cannot be inferred from the stack, and are asked even when the template states them, because a team that disagrees must say so before any code exists:

| Question | Options | What it decides |
| --- | --- | --- |
| How strictly are layer boundaries held? | Enforced by a failing test · reviewed by a person · not enforced | Whether an architecture test suite is generated |
| How do we test? | Behaviour through the public surface · classes in isolation with mocks | Test shape, what the patterns look like, whether mocks are allowed at all |
| How do errors travel? | Exceptions · result types · both, with a stated boundary | Every method signature in the codebase |

Any of the three left unanswered takes the template's default **and is written into `assumptions.md` with an id**, so it appears in the assumption blast radius (§38) rather than vanishing. A design assumption carrying more than three requirements blocks the plan gate like any other.

### Cross-cutting concerns

Some things are not any one requirement's job and so become nobody's. Each is asked once at stage 2, recorded with its enforcing test, and applied to every piece of work after:

| Concern | Asked | Enforced by |
| --- | --- | --- |
| **Authorisation** | Who may do what to which entity | `access.md`, with a generated allowed and denied test per cell |
| **Audit** | Which actions must be recorded, with what, kept how long | An invariant per audited action: the record exists, names the actor, and cannot be written without one |
| **Rate limiting** | Which endpoints are limited, at what rate, per what key, and what a caller sees when limited | A contract test per limited endpoint, and a probe in the security scan (OWASP API4) |
| **Idempotency** | Which operations may be retried safely, and how a repeat is recognised | A test that the same request twice produces one effect |
| **Concurrency** | What happens when two people change the same thing at once | A test per contended entity |
| **Validation** | Where input is validated, and whether it happens once or at every layer | An architecture test that the boundary validates and inner layers assume |
| **Logging** | What must be logged, what must never be | The classified-field grep in `check --security` |
| **Time** | Where "now" comes from, and how timezones are stored and shown | A test that no code calls the system clock directly |

Audit and rate limiting are the two most often missed, and both are expensive to add later. A project touching financial or personal data that answers "none" to audit gets an assumption with `confidence: low` and a note that it will be load-bearing for every requirement, which surfaces at the plan gate rather than in a compliance review a year on.

The pattern is the same as everywhere else in this specification: the cross-cutting concern is a decision, decisions are asked rather than assumed, and an answer without a test is prose that will be ignored.

### Recorded in the architecture record

The answers land in `workflow/architecture.md` under `## Design principles`, each with the check that enforces it. A principle with no check does not go here:

```markdown
## Design principles
- Domain never references Infrastructure        → ArchTests.Domain_NoInfrastructureRef
- One handler per use case, no god services    → ArchTests.Handlers_SingleUseCase
- No class over 300 lines                      → analyser rule VK0301 (build error)
- Repositories only in Infrastructure          → ArchTests.Repositories_LiveInInfrastructure
- Errors as Result<T>; exceptions only at the process boundary → ArchTests.NoThrow_InApplication
- Mocks only for external boundaries           → reviewer instruction (no mechanical check)
```

### Validation is the point

The generator writes an architecture test project (`tests/architecture/`) from this block — NetArchTest, ArchUnit, dependency-cruiser or the equivalent for the stack — with one test per principle, named after it. These run with the unit tests on every commit, so a violation is a red build within seconds, not a review comment three days later.

`vibekit check` enforces the rules about the rules:

- A principle in `## Design principles` with no named check, and not marked `reviewer instruction`, fails the check. Unenforceable prose in a rules file teaches assistants that rules are decorative.
- A generated architecture test that has never failed across 50 requirements is reported as a candidate for removal: it is either redundant or wrong.
- A `reviewer instruction` principle must appear in `workflow/stages/6-test.md`, or it reaches nobody.

### Three levels, and where each belongs

| Level | Example | Home |
| --- | --- | --- |
| Mechanical | File length, parameter count, complexity, forbidden references | An analyser rule or an architecture test. Never prose |
| Structural | One handler per use case, repository per aggregate, module boundaries | A worked example in `skills/lib/patterns/` **and** an architecture test |
| Judgement | Is this the right abstraction? Is this premature generalisation? | The reviewer's prompt, on a stronger model. Nowhere else |

The middle row does the most work. An assistant copying a known-good command handler from the pattern library produces well-structured code without being lectured about SOLID; principles stated as prose are the weakest form of the same instruction.

This is also where VibeKit differs from the template-based approach taken by design-document toolkits that sit beside spec-first tools. Those ship excellent templates for exactly this layer — state machines, error contracts, cross-cutting execution order, guardrails — and a human fills them in. The templates are good and the diagnosis is right: the layer between a plan and a task list is where real systems are won or lost. But a filled-in template is a document, and a document drifts. Here the same four things are generated from the folder, rendered into the LLD, and backed by a test that fails when the code stops agreeing: state machines from requirement transitions, error contracts from the stage 2 answer and the contract tests, cross-cutting order from this section, and guardrails from `guardrails.md` and the data classifications. The difference is not the content; it is that nobody has to remember to update it.

### When a principle is discovered late

The first reviewer finding that says "this class is doing two jobs" is the moment to write the principle down. `vibekit req review --principle "..."` opens a change to `standards/` and the architecture record together, generates the test, and runs it across the existing codebase so you see immediately how much already violates it. Adopting a principle with 40 existing violations is a decision, not a surprise, and the report shows the number before you accept.

## 65. First run and the guided tour

> **In plain terms.** The first time you run VibeKit it explains itself in about thirty seconds, then walks you through your first project one step at a time, saying what each step is for before it does it. The tour uses your real project, not a toy one, so by the end you have something real and you know how it works. You can skip it at any point and it never comes back uninvited.

### First run

On the first `vibekit` command on a machine, before anything else:

```
  VibeKit — next-generation spec-driven development

  Coding assistants are fast, and they guess. Ask for a booking system and you
  get invented table names, rules nobody agreed, and code that looks finished.

  VibeKit puts one folder in your repo that every assistant reads — what the app
  is, what they may and may not do, what your words mean, what has been decided.
  When an assistant does not know something, it writes the question down and
  stops. You answer. It carries on. It never fills the gap with a guess.

  Coming from Spec Kit or similar? Those get you a good spec and a first
  generation, then leave you alone. VibeKit is built for everything after:

    - small changes stay small: a twenty-minute fix takes twenty minutes
    - "tests pass" is a captured exit code, not a sentence an assistant wrote
    - a crashed session resumes from a checkpoint, in any tool
    - every line traces back to the sentence in your brief that asked for it
    - it reads code you already have instead of assuming a blank page

  Everything lives in plain Markdown in git. Delete the folder and nothing breaks.

  Take the tour?  [Y] yes, walk me through it   [n] no, I know what I am doing
```

That text is the whole pitch. It is not repeated, not shown again, and `vibekit tour` brings it back on demand. `--no-tour`, `CI=true` or a non-interactive terminal skips straight past it.

### The tour

The tour is not a demo project. It runs the real stages on the user's real work, pausing before each to say what the step is for and what it will produce. Every pause accepts `enter` to continue, `s` to skip this explanation, `q` to leave the tour and keep going normally, and `?` for more detail on that one step.

Each stop follows the same shape, and none is longer than this:

```
  Step 2 of 7 - Questions                    [enter] go  [?] more  [q] exit tour

  What happens: I read what you wrote and work out what I do not know.
  You get about eight questions, plain language, with options.

  Why it exists: this is the step that stops the guessing. Every question
  here is a thing that would otherwise be invented and found three weeks later.

  Produces: workflow/asks/ (the questions), assumptions.md (smaller gaps I
  filled in myself, for you to check)

  Rule: questions that would change the shape of the app block progress.
  Everything else becomes a written assumption. Nothing is decided silently.
```

The seven stops, each introduced that way:

| Stop | One-line framing shown to the user |
| --- | --- |
| 1 Describe | Tell me what you want, or hand me the document you already have |
| 2 Questions | The step that stops the guessing |
| 3 How it is built | You approve the stack and shape once; everything after follows from it |
| 4 How it looks | Your design, or a restrained default — skip if there is no interface |
| 5 Order of work | Small pieces, in dependency order, with a working empty app first |
| 6 Build | One piece at a time: approach, failing tests, code, checks |
| 7 Check | A second assistant on a different model, then you say done |

After the last stop the tour ends with what to do next, and nothing else:

```
  That is the loop. From here on, `vibekit sprint run` does whatever comes next -
  you rarely need another command.

  Worth knowing:
    vibekit why <file:line>     why does this line exist
    vibekit report             progress, cost, security
    vibekit serve --tracker    the same view on your phone

  Tour finished. It will not interrupt you again.
```

### Rules for the tour

- **Show, then do.** Every explanation is immediately followed by the real step. No screen is purely informational.
- **Never block.** `q` exits permanently, recorded in machine settings, never in the project folder — a colleague cloning the repo gets their own first run.
- **Under sixty seconds of reading in total.** Seven stops, each roughly eighty words. `?` holds the detail for people who want it.
- **No fake data, no sandbox project.** The tour produces a real folder on the user's real repo. A tour that builds a toy teaches nothing transferable.
- **Brownfield has its own path.** `vibekit project import` runs a four-stop tour instead: what I am about to read, what I found, what I could not tell, and what converting will and will not change.
- **The comparison appears once.** First run only. Nothing in the day-to-day output mentions another tool; a product that keeps describing its competitor sounds unsure of itself.
- **Consistent affordances.** `[enter]` `[s]` `[q]` `[?]` mean the same thing at every stop and are always shown.

## 66. Architecture documentation and diagrams

> **In plain terms.** VibeKit keeps a proper set of architecture documents for the software it builds — high level, low level, API reference, data model, and an operations runbook — with real diagrams. They are generated from the same facts the code is checked against, so they cannot quietly go out of date. You put your company's document templates in a folder and the output comes back in your house style.

The rule that makes this work: **nothing is drawn by hand and nothing is written twice.** A diagram is a view of the architecture model; the model is generated from the same files that govern the build. A document that disagrees with the code is a failing check, not a stale artefact somebody should get around to.

### Where it lives

`docs/` sits at the repo root, beside `vibekit/` rather than inside it. The folder is machine context; `docs/` is human output. That separation matters: `docs/` can be published, printed, emailed and handed to an auditor without exposing the working files.

```
<repo>/
├── vibekit/                 the machine's context (Part A)
└── docs/
    ├── brand.yml            YOURS · logo, colours, type, footer · the only file you need
    ├── assets/              YOURS · logo.svg · logo-mono.svg · favicon.png
    ├── model.dsl            GENERATED · Structurizr · the single source for every diagram
    ├── views.dsl            YOURS · which diagrams to render · optional
    ├── diagrams/            GENERATED · svg + png
    ├── hld.md               GENERATED at gates
    ├── lld.md               GENERATED at gates
    ├── api-reference.md     GENERATED from contract tests + OpenAPI
    ├── data-model.md        GENERATED · ERD + field reference
    └── runbook.md           half generated, half yours
```

One level, and one file you have to care about. Three things appear only if you ask for them: `templates/` when you want to take over a document's structure, `decisions/` when ADRs are switched on, and a git-ignored state file.

### The model

One Structurizr DSL file, generated from the folder, from which every diagram is rendered. Structurizr was chosen over hand-drawn diagrams and over per-diagram Mermaid because a single model cannot contradict itself across four levels, and because it exports to SVG, PNG, PlantUML and Mermaid when a viewer needs one.

| Model element | Generated from |
| --- | --- |
| Software systems and people | `product/context.md`, `access.md` roles |
| External systems | `## Dependencies` and trust boundaries in `architecture.md` |
| Containers | The deployables in `map.md` and `system.md` |
| Components | The layers and modules in `map.md`, plus `bindings.json` for what is really there |
| Relationships | Entity relations, API contracts, integration direction |
| Deployment nodes | `delivery/environments.md`, when delivery is enabled |

`views.dsl` is authored, not generated: it says which diagrams to render and how to lay them out, so a team can add a view without touching the model. Styles come from `docs/templates/brand.yml`, so diagrams use your colours and your typeface rather than Structurizr defaults.

### The C4 levels map onto HLD and LLD exactly

| Level | Diagram | Appears in | Answers |
| --- | --- | --- | --- |
| 1 Context | System in its world: users, roles, external systems | HLD | Who uses this and what does it talk to |
| 2 Container | Deployables: api, web, database, queue, jobs | HLD | What are the moving parts and how do they communicate |
| 3 Component | Modules inside a container, with layer boundaries | LLD | How is each part built internally |
| 4 Code | Only for the parts that need it, generated from real types | LLD | What are the actual classes and their relations |

HLD additionally carries: the quality targets from `quality.md`, trust boundaries, the three architecture forbids, and a sequence diagram per flow in `design/flows.md`. LLD additionally carries: the ERD, the access matrix, state machines for every entity with a lifecycle, and the design principles with the tests that enforce them (§64).

### Templates, and your house style

**Most teams never need a template.** VibeKit has a built-in structure for all five documents, and `docs/brand.yml` supplies the letterhead — logo, colours, typefaces, footer, classification banner. That combination is what makes a document look like yours; the section order rarely is.

A template is an override for the case where your organisation mandates a particular structure. `vibekit docs --scaffold-templates hld` writes a single `docs/templates/hld.md` to edit; from then on that file wins for that document and the other four keep the built-in structure. Deleting it reverts. There is no `templates/` folder until you ask for one.

Templates are Markdown with placeholders VibeKit substitutes:

```markdown
# {{project.name}} — High Level Design
{{brand.classification_banner}}

Version {{doc.version}} · {{doc.date}} · generated from commit {{doc.commit}}
Prepared by {{company.name}} · {{company.department}}

## 1. Purpose and scope
{{product.context}}

## 2. System context
{{diagram.c4.context}}
{{narrative.context}}

## 3. Containers
{{diagram.c4.container}}
{{table.containers}}

## 4. Key flows
{{diagram.sequence.*}}

## 5. Quality attributes
{{table.quality}}

## 6. Security and trust boundaries
{{diagram.trust_boundaries}}
{{table.data_classification}}

## 7. Decisions
{{table.adr_index}}

## 8. Assumptions and open questions
{{table.assumptions}}
{{table.open_asks}}
```

`vibekit docs --scaffold-templates` writes a starting set you then edit. A placeholder VibeKit does not recognise is left untouched and reported, so a template with a section VibeKit cannot fill still produces a usable document with an obvious gap rather than silently dropping it. `vibekit check` lists template placeholders that no longer resolve after a spec change.

Outputs: Markdown by default; `--docx` uses `styles.dotx` when present; `--pdf` applies `brand.yml`. Diagrams are embedded as SVG in HTML and Markdown, PNG in Word and PDF.

### No template? Build one from a website

Most teams do not have a document template, and the ones that do often cannot find the file. `vibekit docs --brand <url>` builds one:

```bash
vibekit docs --brand https://acme.co.za
  fetched acme.co.za · 1 logo, 4 colours, 2 typefaces, 1 wordmark
  → docs/brand.yml
  → docs/assets/logo.svg  logo-mono.svg  favicon.png
  preview: docs/brand-preview.pdf
```

Two files and a preview, not a folder of templates. The built-in document structures pick the brand up immediately.

What it takes from the site:

| Asset | Where it looks | Fallback |
| --- | --- | --- |
| Logo | `<link rel=icon>`, `og:image`, an `<img>` or inline `<svg>` in the header, a file named logo or wordmark | The wordmark set in the brand typeface |
| Colours | CSS custom properties first (`--brand`, `--primary`), then the computed palette of the header, buttons and links, ranked by prominence | A neutral palette |
| Typefaces | `font-family` on headings and body, matched to a Google Font or a system stack | The house default |
| Company name and tagline | `og:site_name`, `<title>`, the footer | Asked |
| Legal footer | The footer: company number, registered address, classification wording | Left blank, flagged |

It then writes `brand.yml` and a matching set of document templates, and renders a one-page `preview.pdf` so you can see a cover page, a heading, a table and a diagram in the extracted style before committing to it. Colours are checked for contrast on the way in: a brand colour that fails WCAG AA as body text is kept for accents and a darker derived shade is used for text, which is noted in `brand.yml` rather than done silently.

```yaml
# docs/brand.yml · generated from acme.co.za on 2026-09-23 · edit freely
source: acme.co.za, fetched 2026-09-23
company:
  name: Acme Logistics
  tagline: Freight, simplified
  footer: Acme Logistics (Pty) Ltd · 2019/123456/07 · Durban, South Africa
logo:
  primary: assets/logo.svg
  mono: assets/logo-mono.svg
  favicon: assets/favicon.png
colour:
  brand: "#0B4F6C"
  accent: "#F4A300"
  text: "#14171C"
  text_on_brand: "#FFFFFF"
  note: brand colour darkened to #083D54 for body text (AA contrast)
type:
  heading: Poppins, system-ui, sans-serif
  body: Source Sans 3, system-ui, sans-serif
  mono: JetBrains Mono, monospace
document:
  classification_banner: "Confidential — Acme Logistics"
  page_size: A4
```

Rules that keep this honest:

- **Only public pages, and only on request.** The fetch happens when you run the command with a URL. Nothing crawls anything on its own, `robots.txt` is respected, and one page plus its stylesheet is enough.
- **Assets are downloaded once and committed.** The templates reference local files, never a remote URL, so a document renders the same in five years and offline.
- **The logo belongs to its owner.** On first use VibeKit states that the logo and marks are the customer's property and that you are responsible for having permission to use them. It is a one-line notice, not a dialog, and it is recorded in `brand.yml` as `source: acme.co.za, fetched 2026-09-23`.
- **Everything is editable afterwards.** `brand.yml` and the templates are Authored (§3). Change a colour, swap the logo, rewrite a section: VibeKit never touches them again.
- **`--brand` also works from a file.** A PDF brand guide, a Figma tokens export, or a Word document with the letterhead: `vibekit docs --brand brand-guide.pdf` extracts the same set.

For your own company, run it once against your own site and commit `brand.yml` and `assets/` to a shared repository; `vibekit tools config templates <git url>` points every new project at it, so the house style is a clone rather than a copy-paste. For client work, run it per client and the deliverables come out in their livery.

The full documentation design, including the placeholder reference and the drift checks, is the VibeKit Documentation Feature Spec.

### When it updates

Two speeds, deliberately:

- **The model updates continuously.** Every requirement that reaches `done` updates `model.dsl` as part of the same commit, and `vibekit drift` fails when the model no longer matches `bindings.json` and `map.md`. The model is never more than one merged requirement out of date, and the diff is visible in the pull request — a reviewer sees a new arrow between containers and can question it.
- **The documents regenerate at gates.** Phase completion and every release run `vibekit docs`, producing a dated, commit-stamped set. That way the HLD someone was handed matches a tag and can be reproduced with `vibekit docs --at v0.4.0`.

`vibekit docs --diff v0.3.0 v0.4.0` reports what changed architecturally between two releases, in prose plus highlighted diagrams. That is what a client or an architecture review board actually asks for, and it is the hardest thing to produce by hand.

### Generated documents

| Document | Contents | Source |
| --- | --- | --- |
| **HLD** | Context and container diagrams, flows, quality targets, trust boundaries, decisions index, assumptions | `architecture.md`, `context.md`, `quality.md`, `flows.md`, model |
| **LLD** | Component and code diagrams, layer rules with their enforcing tests, ERD, access matrix, state machines, error and logging conventions | `map.md`, `entities.md`, `access.md`, `invariants.md`, design principles |
| **API reference** | Every endpoint, request and response shape, auth requirement, error shapes, examples | Contract tests and the OpenAPI document they pin |
| **Data model** | ERD, every entity and field with type, classification, relations, retention rule, and the requirements that touch it | `entities.md`, `quality.md`, `bindings.json` |
| **Runbook** | Health endpoints, dependencies, common failures, rollback, on-call notes. Skeleton generated, detail authored | `observability.md`, `environments.md`, incident history |

The runbook is the one document that is deliberately half-generated: VibeKit writes the structure and the facts it knows, and the parts only an operator can write stay Authored and are never overwritten.

### ADRs

Not in the selected set, but the folder has them anyway and they cost nothing: every decision memory and every architecture record change already carries a date, a reason and the ask it came from. `docs/architecture/decisions/` is written from those, in the standard ADR shape, and indexed in the HLD. If you would rather they were not generated, `docs: adr: false` in `profile.md` turns it off.

### What this is not

It is not a diagramming tool. There is no canvas, no dragging boxes, and no way to draw something the model does not contain — because a diagram that can disagree with the code is the problem this section exists to solve. If a diagram is wrong, the fix is in the folder, and the diagram follows.

## 67. The commands

> **In plain terms.** Commands are named after what you are doing, not after how VibeKit works inside. `vibekit project new` starts something. `vibekit plan` decides the order. `vibekit sprint start` starts the next chunk. `vibekit status` tells you where things are. Anyone can read the list and guess right.

This section replaces the earlier command naming. The verbs in Appendix A remain as aliases so nothing breaks, but these are the names shown in help, in the tour, and in the app.

### Everyday

Commands group under the noun they act on, so typing `vibekit project` or `vibekit sprint` with nothing after it lists what you can do with it. You discover the surface rather than memorising it.

**Projects**

| Command | What it does |
| --- | --- |
| `vibekit project new` | Start something: name it, choose where it lives, say what you want, answer the questions, get a spec |
| `vibekit project select` | Your projects with their state; pick one, or start a new one |
| `vibekit project status [--all]` | Where this project is, or every project in one screen |
| `vibekit project import <repo>` | Read an existing codebase and convert it into the selected project |
| `vibekit project assess "<idea>"` | Should this be built at all |
| `vibekit project stop` · `resume` | Stop cleanly; start again, re-checking the ground first |

**Sprints**

| Command | What it does |
| --- | --- |
| `vibekit sprint plan` | Turn the spec into sprints, in dependency order |
| `vibekit sprint start` | Work the current sprint one piece at a time, watching |
| `vibekit sprint run` | Work the current sprint with several agents at once |
| `vibekit sprint status` | This sprint: progress, lanes, what is blocked |
| `vibekit sprint close` | Close the sprint at its gate |

`run` and `start` always mean **the current sprint**, the one the plan says is next. `--sprint 3` names another; `--all-sprints` keeps going through the rest, still stopping at each gate; `--until blocked` stops the moment anything needs a human, which is the overnight setting.

**Action needed**

| Command | What it does |
| --- | --- |
| `vibekit action` | Everything waiting on you across every project, most blocking first: questions, gates, reviews, lessons to accept |
| `vibekit action --project <name>` | Narrow it to one project |

**Work**

| Command | What it does |
| --- | --- |
| `vibekit feature add "<text>"` | Add one feature mid-project |
| `vibekit bug "<text>"` | Log a defect: assess, fix, verify, with a verdict |
| `vibekit hotfix "<text>"` | Production is broken. Branch from the live tag, fix, test, release |
| `vibekit review` | Run the reviewer over anything waiting, out of band |
| `vibekit why <file:line>` | Why does this line of code exist |

**Quality**

**Design**

| Command | What it does |
| --- | --- |
| `vibekit design` | What the app looks like now, and the intent behind it |
| `vibekit design add <url \| image>` | Add a reference; it says what it took and asks what it could not tell |
| `vibekit design preview [screen]` | Render your real screens with the current design |
| `vibekit design feedback "<text>"` | Say what is wrong, against something specific |

| Command | What it does |
| --- | --- |
| `vibekit security scan` | Measure against OWASP, CIS, NIST, POPIA and whatever else applies |
| `vibekit check` | Every mechanical check; this is what CI runs |
| `vibekit docs` | Regenerate the architecture documents and diagrams |
| `vibekit report` | Progress, cost and security as documents |

**Shipping**

| Command | What it does |
| --- | --- |
| `vibekit release <version>` | Verify, test, scan, regenerate documents, write the changelog, tag, bundle the evidence |
| `vibekit rollback <tag>` | Put the previous release back and open a hotfix with the incident note |
| `vibekit undo <id>` | Remove a shipped feature cleanly; dependants go to review |

**Setup**

| Command | What it does |
| --- | --- |
| `vibekit team` | Who may approve what; generates CODEOWNERS; invites people to the tracker |
| `vibekit cost` | Spend against forecast by sprint, model and piece of work, with the escalation rate |
| `vibekit settings` | Model tiers, runners, caps, templates, brand, security frameworks |
| `vibekit ext add <name>` | Install an extension |

On a normal day it is two commands: `vibekit action` in the morning, `vibekit sprint run` once you have cleared it. Or none, and the app.

### Less often

| Command | What it does |
| --- | --- |
| `vibekit project import <repo>` | Read an existing codebase and explain it back, then convert it |
| `vibekit review` | Run the reviewer over anything waiting, out of band |
| `vibekit check` | Every mechanical check; this is what CI runs |
| `vibekit report` | Progress, cost and security as documents |
| `vibekit release <version>` | Tag, changelog, documents, reports |
| `vibekit rollback <tag>` | Put the previous release back |
| `vibekit undo <id>` | Cleanly remove a feature that shipped |
| `vibekit team` | Who approves what; invite people to the tracker |
| `vibekit cost` | Spend, forecast, and whether the model mapping is right |
| `vibekit settings` | Models, tiers, runners, templates, brand |

That is the whole surface. Anything else is a flag.

### `vibekit project new`, step by step

```
$ vibekit project new

  Project name?           teamly-todo
  Where does it live?     [1] this folder   [2] a new local folder
                          [3] GitHub        [4] Azure DevOps
                          [5] GitLab        [6] somewhere else (git url)
```

Choosing a remote creates the repository through the provider's API and sets branch protection, the check names and CODEOWNERS on the way in. Choosing local does the same to a local repo and offers to add a remote later. Either way, git is initialised, the folder is written, and the first commit is made before any question about the software.

```
  What are you building?  Describe it in a sentence or two, or press [u] to
                          upload a requirements document.

  > A todo app for small teams. People sign in, create lists, add tasks with
    a due date, assign them to teammates, mark them done. Admins invite and
    remove members.

  Where does it run?      [x] Web browser    [ ] iOS    [ ] Android
                          [ ] Desktop        [ ] API only
                          [ ] Command line   [ ] Something else
```

Platform is asked here, not later, because it changes the architecture, the test kinds and the whole design stage. A project with no interface skips design entirely.

Then the expansion, which is the part that matters:

```
  Working through what you told me…

  I have enough for 10 pieces of work and 6 questions I cannot answer myself.
  4 of them would change the shape of the app, so I need those before planning.

  Q1 of 6 — Tenancy                                    [enter] answer  [?] more

  Do teams see each other's data?
  This decides whether every record carries a team, and whether the data layer
  filters by it. Changing it later means touching every query.

    [1] Each team sees only its own  [2] People can belong to several teams
    [3] One team only, no separation
```

With a document instead of a sentence, the same thing happens after ingest: the document is split by its own section numbers, requirements are extracted only from explicit shall/must/will statements, and the questions are about what the document left unsaid — which is usually more than its authors realised.

At the end:

```
  Spec ready.  10 pieces of work · 4 assumptions to check · 0 open questions

  What now?
    [1] Save and stop here          I will come back to it
    [2] Review the spec first       open it, edit anything
    [3] Start planning              turn it into sprints
```

Option 1 is a real option and is offered first on purpose. A spec is worth something on its own, and a tool that railroads you into building is a tool people stop trusting.

### `vibekit plan`

Turns the spec into sprints. Each sprint is a phase from §21: small pieces in dependency order, nothing started before what it depends on, a working skeleton first. You approve the order; the board fills in.

```
  Sprint 1 — Foundation      scaffold, sign-in, health check        4 items
  Sprint 2 — People & teams  create, invite, remove, delete account 6 items
  Sprint 3 — Lists & tasks   lists, tasks, assign, complete         5 items
  Deferred                   Google sign-in (you moved it)

  Parallel lanes in sprint 3: 2.  Estimated agent cost: R 1,840.
```

### `vibekit sprint start`

Runs the sprint end to end and stops at exactly two kinds of moment: a question it cannot answer, and the sprint gate at the end. For every piece of work it writes the approach, writes failing tests, writes the code, runs the checks, has a second model review it, and updates the architecture model.

At the end of the sprint, automatically: full test suite, security sweep, documents regenerated, reports produced, memory distilled. Then it stops and shows you the gate.

```
  Sprint 2 finished.
    6 of 6 done · 34 tests · coverage 87% · security clean · docs updated
    2 bugs found in review, both fixed · 1 lesson learned, needs your nod
    Spent R 412 of R 900 forecast

    [1] Close the sprint and start the next
    [2] Look at what changed first
    [3] Stop here
```

### `vibekit project select`

Most people have more than one project and lose track of where each one is. `vibekit project select` lists everything you have made, wherever it lives, with where each one got to, and takes you there.

```
$ vibekit project select

  Your projects                                    [↑↓] pick  [n] new  [/] search

  ●  teamly-todo          sprint 3 of 3 · building        2 decisions waiting
     ~/code/teamly-todo · github.com/you/teamly-todo · 20 min ago

  ●  acme-freight         sprint 1 of 4 · building        on track
     ~/code/acme-freight · dev.azure.com/acme/freight · yesterday

  ○  clinic-booking       spec ready · never planned      waiting on you
     ~/code/clinic-booking · no remote · 3 weeks ago

  ⏸  stock-tracker        stopped · "back after month end"
     ~/code/stock-tracker · github.com/you/stock · 2 months ago

  ✓  invoice-parser       released v1.2.0 · no open work
     ~/code/invoice-parser · github.com/you/invoice-parser · 4 months ago

  [n] Start a new project
```

Choosing one changes to its directory, prints its `status` summary, and tells you the single next thing: a decision to make, a sprint to close, a sprint to start. Choosing `n` runs `vibekit project new`.

**How it knows.** A registry at `~/.vibekit/projects.json` records every project `new project` or `understand --convert` created: name, path, remote, and when VibeKit last ran there. It holds no project content, so it is safe to delete — `vibekit project select --rescan <dir>` rebuilds it by looking for `vibekit/` folders, and a project cloned onto a new machine registers itself the first time any command runs in it.

**Status at a glance**, taken from each project's `status.md` without opening anything:

| Mark | Meaning |
| --- | --- |
| ● | Active — a sprint is running |
| ○ | Waiting on you — a decision, a gate, or a spec that was never planned |
| ⏸ | Stopped, with the reason you gave |
| ✓ | Released, no open work |
| ⚠ | Something needs attention: a high security finding, a stale hold, a failing check on main |

**Flags for people in a hurry.** `vibekit project select teamly` matches on name and goes straight there. `vibekit project select --needs-me` lists only projects waiting on a decision, which on a Monday morning is the list that matters. `vibekit project select --last` returns to wherever you were.

**In the app and the tracker**, the same list is the home screen: every project as a card with its state, its open decisions and its spend, ordered by what needs you most. One tunnel serves all of them, so a single QR code on the wall reaches every project you are running rather than one.

Projects are never deleted by VibeKit. `vibekit project select --forget <name>` removes an entry from the registry and leaves the folder alone.

### Working across projects

Switching is one of four things you might want, and they are different:

**1. Go there.** `vibekit project select` as above: changes directory, prints status, names the next thing.

**2. Look without leaving.** `vibekit project status --all` prints every project's summary in one screen and changes nothing. This is the Monday morning view:

```
$ vibekit project status --all

  teamly-todo      ● sprint 3/3   2 decisions · oldest 2h    R 412 / 900
  acme-freight     ● sprint 1/4   on track                   R 180 / 2,100
  clinic-booking   ○ spec ready   never planned · 3 weeks
  stock-tracker    ⏸ stopped      "back after month end"
  invoice-parser   ✓ v1.2.0       nothing open

  Needs you: 3 decisions across 2 projects · 1 sprint gate
  Running:   2 lanes in teamly-todo, 1 in acme-freight
  This week: R 592 across all projects
```

Every command that reports rather than changes takes `--all`: `status`, `cost`, `report`, `security`. Anything that writes does not, because a command that edits several repositories at once is a command that surprises people.

**3. Answer from anywhere.** Decisions are the thing that blocks work, so they are the one exception worth making. `vibekit action` gathers every open ask across every project into one queue, ordered by how much work each is blocking, and lets you answer them without moving:

```
$ vibekit action

  3 decisions across 2 projects, most blocking first

  1. teamly-todo   blocks 4   When someone leaves a team, what happens to their tasks?
  2. acme-freight  blocks 2   Do drivers see other depots' loads?
  3. teamly-todo   blocks 1   Reminder entity — in scope, or later?
```

Each answer is written and committed in its own project, exactly as if you had gone there. This is the same queue the tracker shows, and for most people it is the only cross-project command they use.

**4. Run several projects at once.** `vibekit sprint run --all` works the ready queue across every project, not just one. The lane rules (§67) still apply, plus two more: a seat is never used by two projects at the same time, and `cap-day` is shared, so ten projects cannot each spend a day's budget. Lanes are allocated to the project with the most work unblocked, then round-robin. `vibekit sprint run --all --until blocked` is the overnight form.

This is genuinely useful for an agency or a consultancy running several client builds, and genuinely dangerous without the caps, which is why the caps are not optional here.

**In the app and the tracker**, the project list is the home screen and a switcher sits in the header, so moving between projects never loses your place. The decision queue is global by default and filterable to one project. One tunnel serves them all: a single QR code on the wall reaches everything you are running.

### `vibekit status`

One screen, the same information the tracker shows:

```
  teamly-todo · sprint 3 of 3 · lists and tasks

  NEEDS YOU        2 decisions (oldest 2h) · 1 sprint gate
  IN PROGRESS      REQ-008 add a task (Claude Code, 22 min, step 3/6)
                   REQ-007 create a list (Cursor, 8 min, step 4/5)
  BLOCKED          REQ-009 assign a task — waiting on Q-012
  DONE             8 of 11 · 2 bugs open (1 medium, 1 low)
  SECURITY         clean · 1 dependency to replace before release
  SPENT            R 412 of R 900 this sprint
  NEXT             REQ-010 mark a task done
```

### `vibekit sprint run`

`new sprint` runs one piece of work at a time, which is right when you are watching. `vibekit sprint run` runs several at once across the runners you have, and is what you start when you want the sprint worked through while you do something else.

```
$ vibekit sprint run

  Sprint 3 of 3 · Lists and tasks · 2 of 5 done

  ▶ Creating a list                              Claude Code · 8 min
    Writing the code · tests written and failing, as expected

  ▶ Marking a task done                          Cursor · 3 min
    Working out the approach

  ⏸ Assigning a task to a teammate
    Waiting on your answer about people who leave a team

  ○ Adding a task with a due date                next
  ○ Seeing my tasks across teams                 after assigning

  Checking behind the scenes · 1 review running on a second model
  Spent R 88 of R 900 this sprint

  [p] pause a lane   [s] stop everything   [d] details   [enter] leave it running
```

### How things are named on screen

Every surface follows one rule: **show the work, not the identifier.** Identifiers exist for branches, commits, filenames and traceability, and a person should never have to read one.

| Never shown first | Shown instead |
| --- | --- |
| `REQ-007` | Creating a list |
| `step 4/5` | Writing the code |
| `blocked on Q-012` | Waiting on your answer about people who leave a team |
| `BUG-006` | Due dates show a day early for people east of London |
| `3 open asks` | 3 things need you |
| `status: tested` | Waiting for a second pair of eyes |

Three parts to it:

1. **Titles are the work, as a gerund.** "Creating a list", because it is happening now. The title comes from the requirement's own title, so it is whatever a human wrote when the work was defined.
2. **Steps are sentences, not fractions.** The build loop's five stages have plain names — working out the approach, writing the tests, writing the code, checking it, second pair of eyes — and the line says which one and whether it is going normally. "Tests written and failing, as expected" is the sentence that stops somebody panicking at a red test.
3. **Blocked says why, not that.** A reason a person can act on, never an ask id.

Identifiers appear in exactly four places: the branch name, the commit trailers, the file name, and a details panel one click or one keypress away. Anybody who wants `REQ-007` can find it in a second; nobody who does not want it ever sees it.

### How work is handed out

The plan decides what is next; `run` decides who does it and how many at once. There is no orchestrator agent making these decisions, because that is where unexplainable behaviour and runaway spend come from. The rules are fixed and readable:

1. **Only what the plan says is ready.** A piece of work whose `after:` dependencies are not `done` is never started, however idle a lane is.
2. **Never two agents on the same entity.** `bindings.json` knows which code each entity touches; two ready items that share one are sequenced, not parallelised. This is the rule that prevents most merge pain.
3. **Seats first, API for the rest.** Attended lanes take the seats you already pay for; reviewers, compliance passes and overnight work go to API runners (§62). A rate-limited seat hands its work on at the next checkpoint, and the log records the move.
4. **Reviewers run alongside, not after.** A piece of work reaching `tested` is reviewed immediately on a different model while the lanes carry on with the next item. Review is rarely the bottleneck; waiting for a lane to free up would make it one.
5. **Lane count has a ceiling.** `--lanes N`, default two, capped by seats available and by `cap-day`. More lanes is not faster past the point where merge conflicts and review queues eat the gain.

### Watching, or not

`vibekit sprint run` in the foreground shows the live view above. Pressing enter detaches and it keeps going; `vibekit sprint status` shows the same information from anywhere, and the tracker shows it on a phone. `--until gate` stops at the sprint gate and waits for you; `--until blocked` stops the moment anything needs a human, which is the setting for an overnight run you want to find finished rather than half-done.

A lane that hits a question stops that lane only. The others carry on. If every lane blocks on the same decision, `run` stops and says so rather than idling.

### What it will not do

- **It will not close a sprint.** Gates stay human (§50).
- **It will not raise severity, accept a lesson, or approve its own review.** Those are decisions.
- **It will not exceed a cap.** Hitting `cap-requirement`, `cap-phase` or `cap-day` stops cleanly at the next checkpoint with everything saved.
- **It will not run unsandboxed on size L or on anything touching secret or financial data**, unless a named human is present (§52).

### Running several agents

"Multi-agent" means two things here and both are on by default.

**Different agents with different jobs**, on every piece of work whether you ask for it or not: an analyst that asks and cannot design, a planner that orders work and cannot write code, an implementer that writes code and cannot change the rules, a reviewer on a different model that cannot write code (so it cannot fix something and then approve its own fix), and compliance that can only block. This is not configuration; it is what makes the output worth trusting.

**Several agents at once**, which is what `sprint run` does. Three shapes, all supported:

| Shape | When | Cost |
| --- | --- | --- |
| Several seats of the same tool — four Claude Code seats, four lanes | You have the seats and someone is around | No marginal cost until rate limits |
| One seat plus API sessions | The common case: your seat implements what you are watching, API models review and do the unattended work | Metered only for the API part |
| All API | Headless overnight runs | Metered throughout, sandboxed |

**Mixing models matters more than mixing tools.** A typical sprint runs a mid-tier model implementing, a stronger one reviewing, and a cheap one on fixtures and compliance passes — all from one provider, different tiers, different jobs. The reviewer being a different model from the implementer is a rule (§49), not a preference, because a model reviewing its own work shares its own blind spots.

**What keeps them from colliding**, restating the rules above in one place: one piece of work per agent, one branch and one worktree each so two agents cannot touch the same files, and never two agents on the same entity. A lane that hits a question stops only that lane.

**The honest ceiling.** Two lanes is the default. Four is about the limit for a single repository before merge conflicts and the review queue eat the gain; past that, two lanes on two projects beats four on one. And for a first sprint on a new template, run a single lane and watch: prompt problems are cheap to find when you are looking and expensive when four agents hit them at once.

### Running headless

`vibekit sprint run --headless` is the CI form: no interactive view, machine-readable progress, exits non-zero if anything blocked or failed. That is how a team runs a sprint overnight, or how a scheduled job picks up the work that arrived during the day. The same rules apply; nothing is relaxed because nobody is watching.

## 69. `vibekit design`

> **In plain terms.** Show VibeKit what you want the app to look like: paste a link to a site you admire, drop in a screenshot, upload your brand guide. It tells you what it took from each one and asks about what a picture cannot tell it. Then it renders your actual screens in that style so you judge the real thing rather than a sample. Inspiration goes in, decisions come out.

Stage 3 settles the look once, at the start. This is the rest of the life of a project: collecting references, saying "more like this", and seeing the result on real screens. It applies to any project with an interface and is skipped entirely for one without.

### The commands

| Command | What it does |
| --- | --- |
| `vibekit design` | What the app looks like now: tokens, components, screens, and the intent behind them |
| `vibekit design add <url \| image \| pdf>` | Add a reference and extract from it |
| `vibekit design refs` | Every reference you have added and what was taken from each |
| `vibekit design preview [screen]` | Render your real screens with the current design |
| `vibekit design apply` | Turn accepted references into tokens and components |
| `vibekit design feedback "<text>"` | Say what is wrong, against something specific |

### Adding a reference

A reference is a URL, a screenshot, a PDF brand guide, a Figma export, or a photo of something physical. Extraction says what it took **and what it could not tell**, because inspiration is vague and vague things become questions here like everywhere else:

```
$ vibekit design add linear.app

  Took from this:
    spacing        4px base rhythm, tight
    palette        muted, low saturation, one accent
    type           13px body, 600 weight headings, system stack
    surfaces       subtle borders instead of shadows
    corners        nothing over 6px
    density        compact — lots of information per screen

  Couldn't tell from this:
    · How dense should data tables be?        [compact] [comfortable] [roomy]
    · Is the sidebar always visible?          [always] [collapsible] [hidden]
    · Empty states: illustrated, or plain?    [illustrated] [plain text]

  3 questions · answer now or later, nothing is applied until you do
```

That is the whole point of the feature. A reference stored as a mood is something a person interprets differently every time; a reference turned into six extracted values and three answered questions is a decision the folder can hold and the reviewer can check against.

### Where it lives

```
vibekit/product/design/
├── inspiration.md      AUTHORED · the intent in words, and every reference with what was taken
├── references/         the images and captured pages, committed so they survive
├── tokens.md           GENERATED · colours, type, spacing, radii, elevation, motion
├── components.md       AUTHORED · the inventory and when to use each
└── flows.md            AUTHORED · screens and how people move between them
```

`inspiration.md` is the file a designer or a founder actually reads:

```markdown
## Intent
Restrained and dense. It should feel like a tool, not a toy. Nothing decorative.
People use this all day; nothing should be tiring at 5pm.

## References
- linear.app          spacing, density, borders-not-shadows      added 2026-09-24
- stripe.com/docs     type scale, code block treatment           added 2026-09-24
- our-old-app.png     the table layout people already know       added 2026-09-20

## Decisions taken from them
- Tables are compact; 32px rows                    from linear.app, confirmed
- Sidebar collapsible, remembers its state         asked, you chose
- Empty states are plain text with one action      asked, you chose
```

The references themselves are committed, not linked, so the project still makes sense in five years when a site has been redesigned.

### Preview on your own screens

```bash
vibekit design preview
vibekit design preview "task list"
```

Renders the screens this project actually has, from `flows.md` and the components, with the current tokens — in light and dark, at phone and desktop width. Not a sample page and not someone else's app: yours, which is the only way to tell whether a look works for your content.

Before `apply`, preview shows the change side by side with what is there now.

### Feedback that can act on something

"It doesn't feel right" cannot drive anything, so `design feedback` asks what it is about:

```
$ vibekit design feedback "too cramped"

  About what?
    [1] Everywhere — the whole app
    [2] One screen — which?
    [3] One component — which?

  > 1

  Cramped usually means one of these. Which is closest?
    [1] Not enough space between things        → spacing scale up one step
    [2] Text too small                         → type scale up one step
    [3] Too much on screen at once             → density: compact → comfortable
    [4] Not sure — show me all three
```

Option 4 renders your screens three ways and you pick. Every answer changes a token, and the change is a normal commit with a before and after, so it can be reverted like anything else.

### How it reaches the build

Nothing changes about how UI work gets done. Tokens and the component inventory already load on any piece of work that touches a screen, and the `ui-conventions` skill carries the rules. What `design` adds is that the reviewer now also checks new screens against `inspiration.md`: a screen that uses a shadow where the intent says borders is a finding, in the same way an invented entity name is a finding.

A design change is a piece of work like any other. Changing the spacing scale touches every screen, so it is sized, reviewed and previewed, not applied silently.

### On borrowing

Taking spacing rhythm, density, type scale and colour relationships from an app you admire is ordinary practice and how design has always worked. Reproducing someone's layout, their logo or their distinctive brand is not. VibeKit extracts the first kind and says so in one line the first time you add a reference; if an extraction would amount to copying a brand, it says that instead and takes only the structural parts.

### In the app

A **Design** screen: your references as cards with what was taken from each, the current tokens as swatches and scales you can nudge, your real screens rendered live beside them, and the open questions from the last reference at the top. Dragging an image onto the window adds a reference. It is the one screen in VibeKit that is meant to be enjoyable to sit in.

## 70. The app

> **In plain terms.** Everything in the previous section can be done by clicking instead of typing. The app is not a viewer for the command line: it is a complete way to use VibeKit, and most people should never need a terminal. The commands still exist, they write the same files, and the two can be used interchangeably by different people on the same project on the same day.

### The parity rule

**Anything a command can do, the app can do.** No feature is terminal-only. Where a command takes a flag, the app offers a control; where a command prints a table, the app shows a view you can sort and filter. This is a rule, not an aspiration: a pull request that adds a command without its screen is incomplete, and `vibekit check --parity` in VibeKit's own CI lists commands with no matching app action.

The reverse is not required. The app may offer things the command line cannot reasonably do — dragging work between sprints, a diff viewer, a diagram you can click through — and does.

### What you actually see

| Screen | Replaces | What you do there |
| --- | --- | --- |
| **Projects** | `goto`, `status --all` | Every project as a card with its state, open decisions and spend. Click to open, or start a new one |
| **Today** | `status`, `decisions` | What needs you, ranked by how much work is waiting behind it. Then progress, safety, schedule |
| **Decide** | `decisions` | One question at a time in plain language, with options as buttons. This is where most people spend their time |
| **Board** | `plan`, `new sprint`, `run` | Sprints as columns, work as cards. Drag to reorder, click to start a sprint, watch lanes run |
| **Work item** | opening a `REQ-*.md` | What it must do, the tests that prove it, live progress, the agent's saved place, cost so far |
| **Bugs** | `bug` | Findings with severity and what caught them; three-step assess, fix, verify with its verdict |
| **Security** | `security scan` | Framework scores, what failed and why, evidence per control, one-click export |
| **Docs** | `docs` | The generated documents and diagrams, with a link to what changed since the last release |
| **Cost** | `cost` | Spend against forecast, by sprint, by model, with the escalation rate |
| **Settings** | `settings`, `team` | Models and tiers, runners, who approves what, brand and templates |

### Starting a project without typing anything

A wizard, one decision per screen, each with a sentence saying why it matters:

1. **Name it**, and choose where it lives: this computer, or a repository on GitHub, Azure DevOps or GitLab. Signing in to the provider happens here, once.
2. **Say what you want**, in a text box, or drag a requirements document onto it.
3. **Tick the platforms**: web, iOS, Android, desktop, API only.
4. **Answer the questions**, one per screen, options as buttons, with a progress bar showing how many are left. "I don't know" is always an option and records an assumption rather than forcing a guess.
5. **Approve three things**: how it is built, how it looks, the order of work. Each is one screen with a plain summary and the technical detail behind a "details" tap.
6. **Press Start.**

At no point is a command shown, a file path mentioned, or a terminal opened. Someone who has never used git can complete this.

### Where the technical detail goes

Every screen leads with plain language and keeps the underlying file one click away, in a panel that shows the actual Markdown with a link to it in the repository. This serves both audiences without two products: a product owner reads the summary and decides; an engineer opens the panel and checks the file. The rule from §12 applies everywhere — plain first, technical behind it, never the other way round.

### Three ways to run it

| Where | For | Notes |
| --- | --- | --- |
| **Desktop app** | Day-to-day work on your own machine | Runs the agents locally, uses your seats, no code leaves your machine except to the models you allowed |
| **Tracker in a browser** | Deciding from anywhere, including a phone | The same screens behind a login, reached through the tunnel (§57). Read and decide, not run |
| **Command line** | Automation, CI, and people who prefer it | Everything, as before |

All three read and write the same files in the same git repository, so two people can use different surfaces on the same project at the same time. The commit trailers record which surface an action came from, so the audit trail is honest about it.

### What the app deliberately does not do

- **It does not hide the folder.** A "show me the files" button is on every screen. A tool that hides its own state is a tool you cannot debug or leave.
- **It does not become a chat window.** Chat is not the primary surface (§53): decisions made in a conversation that is not recorded as a file are decisions nobody can audit. Where a free-text answer is needed, it goes into the ask file and is committed.
- **It does not have a settings page nobody understands.** Anything that changes how agents behave is a decision with a consequence, written in the same plain language as everything else.
- **It does not require an account to use locally.** Sign-in is for the tracker, for teams and for Core features, not for building on your own machine.

### `vibekit security scan`

A security scan is not a list of tool output. It is a measurement of this application against named security frameworks, so the answer to "are we secure?" is a score against a standard a third party recognises, with every finding traced to the control it fails.

**Frameworks, chosen once and then measured every time.** `vibekit settings` records which apply; the data classifications decide the defaults:

| Framework | Applies when | What is measured |
| --- | --- | --- |
| **OWASP ASVS** | Always | Every applicable verification requirement at the chosen level (L1 default, L2 when personal or financial data exists) |
| **OWASP Top 10** | Always | The ten categories, each with the checks that cover it |
| **OWASP API Top 10** | The app exposes an API | Broken object-level authorisation, mass assignment, and the rest |
| **CIS Benchmarks** | Containers or a cloud target | Image and configuration hardening |
| **NIST SSDF** | Asked for, or an enterprise customer | Secure development practices across the whole lifecycle, not just the code |
| **ISO 27001 Annex A** | The organisation is certified or working towards it | The controls a codebase can evidence |
| **PCI DSS** | Any entity classified `financial` | The subset a payment-touching application must meet |
| **POPIA / GDPR** | Any entity classified `personal` | Lawful basis, retention, erasure, cross-border transfer |

**Security skills do the work.** Each framework is a skill in `skills/lib/security/`, one per control family, carrying: what the control requires, what evidence proves it in this stack, how to test it, and what a pass looks like. They are indexed like every other skill and loaded only for the families a scan touches, so a full ASVS L2 pass does not mean loading ASVS L2 into context. A team adds its own control skills for internal standards the same way, and `vibekit ext add security-<framework>` installs published ones.

**What the scan actually does**, in four passes:

1. **Read** — secrets across all history, dependency vulnerabilities and licences, the code against `standards/security.md`, configuration and container definitions against CIS.
2. **Probe** — against the running application: every cell of the access matrix attempted as an attacker rather than as a test, injection against every endpoint in the API reference, auth boundary probes (expired tokens, another tenant's ids, missing roles, privilege escalation), rate limits, enumeration, headers and TLS.
3. **Evidence** — for each control, collect what proves it: a passing test, a configuration value, a generated document section, a code location. A control with no evidence is not a pass.
4. **Score** — per framework: controls met, controls failed, controls not applicable with the reason, and controls that cannot be evidenced automatically and need a human. That last category is reported honestly rather than counted as a pass.

```
$ vibekit security scan

  OWASP ASVS L2        94 of 112 applicable        3 failed · 15 need a human
  OWASP Top 10         10 of 10 covered            0 failed
  OWASP API Top 10      9 of 10 covered            1 failed  (API4 rate limiting)
  POPIA                 7 of 8                     1 failed  (retention on Task)
  CIS Docker           18 of 20                    2 failed

  3 high · 4 medium · 2 low  →  9 bugs created, high ones block the sprint gate
  Report: docs/security-scan-2026-09-24.md   Evidence bundle: 41 items
```

Every finding becomes a bug (§68) with a reproducing test, a severity, and the control id it fails, so the fix is verified against the control rather than against someone's impression of it. High findings block the next sprint gate.

**When it runs.** Automatically at every sprint gate and before any release; `vibekit security scan` on demand; `vibekit security` alone prints the current posture without re-running. Scoring is tracked over time, so the security report shows whether the project is getting safer or is accumulating exceptions.

**What it is not.** It is not a substitute for a human penetration test before going live with real money or real personal data, and it says so in its own output. What it does is make sure the human tester spends their time on what a machine cannot find, rather than on the things that should never have reached them.

### What runs automatically

Nothing in the list above has to be remembered:

| When | What happens |
| --- | --- |
| Every piece of work | Approach, failing tests, code, checks, review on a second model, architecture model updated |
| Every sprint gate | Full test suite, `security scan against every applicable framework, documents regenerated, all three reports, lessons propos`ed, sprint report |
| Every release | Tag, changelog, documents at that tag, evidence bundle |
| Weekly | Model prices refreshed; you are told only if a remap saves real money |

### Naming rules

- A command says what you are doing, never how VibeKit works inside. `new sprint`, not `next`.
- `new <thing>` is the one pattern worth learning: `new project`, `new sprint`, `new feature`.
- Every command works with no arguments and asks for what it needs. Arguments are for people who already know.
- No command has more than three flags in its help; the rest are documented and hidden.
- The same names are slash commands in Claude Code and Cursor: `/vibekit.status`, `/vibekit.new-feature`, `/vibekit.hotfix`.

## 68. Convergence, verdicts and extensions

> **In plain terms.** Three things. First, work is not finished when the code is written, it is finished when a check says it has stopped changing, and VibeKit runs that check in a loop until it agrees. Second, fixing a bug is three separate jobs (work out the cause, repair it, prove the original symptom is gone) and the last one produces a verdict you can trust. Third, VibeKit ships small and you add the parts you need, rather than carrying every feature from day one.

### Convergence

An assistant that says "done" is making a claim. Evidence proves the tests ran. Convergence proves something harder: that the work has stopped changing and nothing else broke.

After each piece of work and at every sprint gate, `vibekit converge` runs and reports one of three states:

| State | Meaning | What happens |
| --- | --- | --- |
| **Converged** | Every criterion has a passing test, checks green, no drift, no open asks, review approved, nothing changed since the last pass | The gate opens |
| **Converging** | Something was fixed this round; the round found fewer problems than the last | Run again, up to the round budget |
| **Not converging** | The same problem reappeared, or each round finds as much as the last | Stop. A human is shown the loop and what keeps recurring |

What it checks each round: acceptance criteria against named tests, the full suite, `vibekit check`, drift between the model, the documents and the code, invariants, the access matrix, dependency policy, and whether the last round's fixes broke anything earlier.

The round budget is three by default. Not converging after three rounds is not a failure to try harder; it is a signal that the requirement is wrong, and the output says which criterion or rule keeps fighting the code. Oscillation is caught explicitly: if round two undoes what round one did, VibeKit stops immediately rather than burning the budget watching an assistant argue with itself.

`vibekit sprint start` runs this loop for you and stops at the gate with the verdict. You never type `converge`; you only see it in the sprint report.

### Bug verdicts

Fixing a bug is three jobs, and collapsing them is why bugs come back:

| Step | Job | Output |
| --- | --- | --- |
| `vibekit bug assess` | Work out the cause without changing anything. Reproduce, narrow, state what is actually wrong and why | A cause statement with evidence, and a reproducing test |
| `vibekit bug fix` | Repair the assessed cause. Not a nearby symptom, not something else noticed on the way | A change on a branch |
| `vibekit bug test` | Prove the original symptom is gone, and nothing near it broke | A verdict |

The verdict is one of three, and never a sentence:

- **Verified** — the original symptom is gone, the reproducing test passes, the suite passes, and nothing near it regressed.
- **Partial** — the reported symptom is gone but something in the assessment was not fully addressed, or a related case still fails. Named explicitly.
- **Failed** — the symptom is still reproducible.

`vibekit bug "<text>"` runs all three in sequence, which is what most people type. The separation matters anyway: the assistant that fixes reads the assessment as a given and cannot quietly redefine the problem to one it finds easier, and the assistant that verifies tests the symptom the human reported rather than the one the fixer decided to solve.

A bug closes only on **Verified**. Partial and Failed return it to the board with the verdict attached, and reports show how many bugs needed more than one attempt, which is a better measure of code health than a count of open bugs.

### Idea assessment

Before `vibekit project new` there is a question VibeKit had no place for: should this be built at all? Assessment answers it, produces evidence rather than opinion, and works in a folder with no code in it.

```bash
vibekit assess "Let people use it offline and sync when they reconnect"
```

Five steps, each a file in `assess/<slug>/`:

| Step | Asks | Produces |
| --- | --- | --- |
| **Intake** | What is the idea, who is it for, what makes you think they want it, what would success look like | The idea in one page, with claims separated from facts |
| **Research** | What already exists, what does it cost, what have others learned, what does the evidence say | A findings file with sources, and what could not be found |
| **Define** | Who exactly, doing what exactly, instead of what | The problem statement and the people it belongs to |
| **Shape** | What is the smallest version that would tell us, what would it take, what could go wrong | Two or three options with effort and risk, not one plan |
| **Decide** | Build, do not build, or find out more first | A recommendation with its reasoning, and what would change it |

The output is a decision record, not a specification. **Build** hands the shaped option to `vibekit project new` as the starting description, and the assessment is kept as the first source, so `vibekit why` can trace a line of code all the way back to the evidence that justified the feature. **Do not build** is a real outcome and is recorded with its reasoning, which is worth as much six months later when somebody proposes it again.

Assessment is deliberately not part of the build flow. It works with no repository, no code and no stack decision, and most ideas that go through it should not reach `new project`.

### Extensions

VibeKit installs small. Assessment, the security frameworks, the documentation feature, tracker integrations and per-stack templates are extensions you add when you need them:

```bash
vibekit ext add assess
vibekit ext add security-frameworks
vibekit ext list
vibekit ext remove assess
```

An extension is a folder with a manifest, adding any of: commands, stage prompts, skills, checks, document types and report sections. It cannot weaken anything: an extension may add a check but never remove one, may narrow a role's write scope but never widen it, and may not touch `standards/` or `guardrails.md`. `vibekit check` lists installed extensions with their versions, so a folder is always explainable.

Core, which is never an extension: the folder format, asks and gates, the build and review loop, evidence, convergence, memory, and `check`. Those are what VibeKit is; everything else is a choice.

Organisations can publish private extensions from a git URL, which is how a team's own compliance checks, house document types or internal tracker integration reach every project without becoming a feature request.

# Appendix

## A. CLI reference

Every command reads and writes the files above; none holds state of its own.

| Command | Does | Writes |
| --- | --- | --- |
| `vibekit init [--adopt] [--from-speckit]` | Creates the folder and pointer files, or rules-only for an existing repo, or imports a Spec Kit repo | Everything generated; authored starters |
| `vibekit ingest <file>` | Converts, sections and redacts a BRS; records it | `product/sources/` |
| `vibekit clarify --dry-run <file>` | Stages 0 and 1 in a temp folder; prints the asks | Nothing in the repo |
| `vibekit add "<text>"` · `vibekit quick "<text>" [--hotfix]` | Adds a requirement mid-build; `quick` sizes it S and starts it | `product/requirements/`, branch, `.state/tasks.json` |
| `vibekit sprint run` | Reads the gate, regenerates status, prints the next prompt; opens the PR when a requirement is done | `workflow/status.md`, `.state/workflow.json` |
| `vibekit start REQ --as <role>` · `vibekit unhold REQ` | Claims a requirement and creates the branch; clears a stale hold | `.state/tasks.json`, REQ status |
| `vibekit check [--ci] [--budget] [--stage N] [--runners] [--done REQ] [--security] [--deps]` | Every mechanical check in this spec | Nothing; reports |
| `vibekit drift` · `vibekit assumptions` · `vibekit why <path[:line]>` · `vibekit trace --matrix` | Spec-to-code drift; assumption blast radius; provenance chain; traceability matrix | Nothing; reports |
| `vibekit serve [--stdio] [--backend …]` | The MCP server and agent runner; enforces allowed commands; records `sessions.json` | Same files an agent would |
| `vibekit distil` | Session notes into memory proposals; automatic on phase completion | `workflow/asks/` |
| `vibekit rescan` · `vibekit reverse` | Rebuilds `.state/`; drafts requirements from an existing test suite | `.state/*`; `product/requirements/` |
| `vibekit plan --cost` | Token forecast per requirement and phase | Nothing; reports |
| `vibekit report build \| budget \| security \| --all [--phase N] [--since d] [--at sha] [--md \| --pdf]` | The three reports | A file outside the folder |
| `vibekit evidence REQ \| --phase N` | Audit bundle | A file outside the folder |
| `vibekit release <version> [--rollback <tag>]` · `vibekit revert REQ` · `vibekit changelog <from> <to>` · `vibekit docs` | Release, rollback, revert, changelog, generated docs | Tags, `.state/`, generated docs |
| `vibekit replay --stage N --project <path>` | Re-runs a changed prompt against a past project and diffs the asks | Nothing; reports |
| `vibekit upgrade-prompts` · `vibekit config team-memory <url>` | Prompt upgrade with diff; export; team memory repo | `workflow/stages/`, export files, app settings |

MCP tools exposed by `vibekit serve`, each a thin wrapper over a file operation: `vibekit_status`, `vibekit_load(requirement)` (returns the scoped set for one requirement), `vibekit_ask(kind, body)`, `vibekit_log(requirement, line)`, `vibekit_remember(line)`, `vibekit_lookup(query)` (grep over skill triggers and memory topics).

## B. Terms

| Term | Meaning |
| --- | --- |
| Ask | A file in `workflow/asks/` an agent writes when it needs a human to decide: a question or a proposal |
| Gate | A line a human writes (or a gate policy rule passes) that lets the workflow advance; never written by VibeKit on its own |
| Gate policy | Rules in `agents/humans.md` that let named gates pass automatically under stated conditions, recorded in the audit trail |
| Phase | A group of requirements in `plan.md` with its own end-to-end check, reports and gate |
| Role | A named load set and write scope in `agents/`; every session runs as one |
| Size | S, M or L on a requirement; decides how much ceremony it gets |
| EARS | The acceptance-criterion notation: one trigger, one response, five allowed forms |
| Invariant | A rule in `product/invariants.md` that holds across every requirement, backed by a property test |
| Scoped | Loaded only when a task names it, as opposed to always loaded |
| Distil | The step that turns session notes into memory proposals |
| Walking skeleton | Phase 0: scaffold, CI, auth and a health endpoint, deployed before any requirement is built |
| Adopt | The brownfield entry: rules-only folder written from an existing repo |
| Drift | Any broken link between source, requirement, criterion, test and code, found by `vibekit drift` |

## C. Stage prompt: 1-clarify.md

The file below is `vibekit/workflow/stages/1-clarify.md` as shipped. Teams edit it; VibeKit warns when the shipped version moves ahead of the repo's.

```markdown
---
stage: 1
name: clarify
role: analyst
prompts: 1.0
loads: [product/sources/index.md, product/sources/*/.abstract, product/sources/*/sections/*.md (on demand), product/context.md, workflow/answers/1-clarify.md (if present), memory:[domain, glossary]]
writes: [workflow/asks/Q-*.md, workflow/assumptions.md, product/context.md, product/glossary.md, product/requirements/REQ-*.md (draft only), memory/sessions/<today>.md]
budget: 10 asks per round, 3 rounds
gate: no open blocking asks, and a human has marked assumptions.md reviewed in workflow/status.md
---

# Stage 1: Clarify

You are the analyst. Your only job in this stage is to work out what the sources do not tell you, and to ask. You do not design, you do not choose a stack, you do not write code, and you do not write requirements beyond drafts.

Read workflow/status.md first. If it does not say stage 1, stop and say so.

## Goal
Leave the folder in a state where an architect could start work without guessing: a final context.md, a glossary.md, a list of every assumption you had to make, and one draft requirement per explicit statement in the sources.

## Before writing anything
1. Read product/sources/index.md. For each source, read its .abstract. Read a section only when the abstract or a checklist item sends you there.
2. If workflow/answers/1-clarify.md exists, read it. Do not ask anything it already answers. This is round two or three.
3. Check memory for topics domain and any glossary terms you see. If this team has answered a question before on a similar project, cite the memory in assumptions.md instead of asking again.
4. Go through the checklist. For every item the sources leave unsettled, you owe either an ask or an assumption.

## The checklist
Users and roles · Tenancy · Core entities and their identifiers · Lifecycle and who moves state · Money · Integrations and data direction · Volume · Compliance and retention · Non-goals · Success measure

## Ask or assume
Write an ask when the answer would change the architecture or the entity model; mark it blocking: true. Write an assumption when the answer changes details but not structure and a reasonable default exists; every assumption goes in workflow/assumptions.md with the checklist item and what you assumed. Never decide silently. If you notice yourself writing a requirement containing a fact the sources did not state, stop: that fact is an ask or an assumption.

## Writing an ask
One file per ask in workflow/asks/, Q-NNN-<slug>.md, fixed shape: front matter (id, kind: question, stage, asked, by, blocking, topic, source, status: open), then ## Question, ## Why it matters, ## Options the agent can see, ## Answer (empty). One question per file. Give options whenever you can see them. "Why it matters" names the consequence; no consequence, no ask. Cite the source section, or source: none. Ten asks per round; past ten, write the most structural ten and add one line to assumptions.md recommending a workshop.

## When the round is answered
You will be run again. Read the answers. Ask the questions the answers raise. Round three is the last; after it, remaining gaps become assumptions with confidence: low.

## When no blocking asks are open
1. product/context.md, final, under 300 tokens, no draft: line. If it does not fit, cut; do not compress.
2. product/glossary.md, one line per term.
3. workflow/assumptions.md: checklist item, source, what was assumed, confidence.
4. Requirement drafts: one REQ-NNN.md per explicit shall/must/will, status: draft, source citation, entities named. Acceptance criteria only where the source states them. Fifteen good drafts beat fifty weak ones.
5. Decision memories: decisions in the source ("payments stay on Stripe") become proposals for kind: decision memories.
6. Session note: one line per thing learned, in memory/sessions/<today>.md.
Then mark stage 1 awaiting assumptions review in status.md and stop.

## Done looks like
Zero open blocking asks · context.md final and under 300 tokens · every assumption names its checklist item · every draft cites a source · nothing written under standards/, workflow/architecture.md or any code path.

## Stop conditions
status.md not at stage 1 · a source missing its .abstract · ten asks written this round · round three with blocking asks remaining (report: workshop needed) · you are deciding an architecture question to make a requirement readable.
```

## D. Stage prompt: 5-build.md

The file below is `vibekit/workflow/stages/5-build.md` as shipped.

```markdown
---
stage: 5
name: build
role: implementer
prompts: 1.0
loads: [pointer file, workflow/status.md, standards/*, product/.abstract, product/context.md, product/glossary.md, product/map.md, product/design/tokens.md (UI only), product/requirements/<REQ>.md, product/entities.md#<named entities>, skills/index.yml (body on trigger), memory/index.md (body on topic), product/sources/<src>/sections/<§> (only if cited)]
writes: [src/** per map.md, tests/**, <REQ>.md sections Approach and Log, workflow/asks/P-*.md, memory/sessions/<today>.md]
never: [vibekit/** otherwise, migrations unless map.md allows, any guardrails.md denied path, plan.md, architecture.md, any other requirement]
budget: 3 proposals on this requirement, then blocked
gate: vibekit check green on the branch, status tested, handed to reviewer
---

# Stage 5: Build

You are the implementer. You hold exactly one requirement and you build exactly that. When the folder does not contain something you need, you ask; you do not invent.

Read workflow/status.md first. It names the requirement you hold and the branch. If you were not started with vibekit start <REQ> --as implementer, stop: you have no requirement.

## What you may rely on
standards/* in full; they are not suggestions. product/map.md for where code goes and the exact build and test commands; do not substitute. product/entities.md, only the sections your requirement names; those are the only valid names. product/glossary.md for what words mean. design/tokens.md and the ui-conventions skill for screens. skills/index.yml: read a body only on a trigger match. memory/index.md: read a body only on a topic match; a memory is a hint, not a rule, and guardrails.md wins on conflict.
Do not read plan.md, other requirements, or the full entities.md.

## The loop
1. Approach, before any code. Write ## Approach into your requirement: files by path and layer, entities and fields (all must exist), tests and which criterion each proves, anything unsure. Read it back against guardrails.md.
2. Build. Follow the approach; if you deviate, update it and say why. Tests in the same commit as the code, per map.md: a named test per acceptance criterion; unit always; integration for database, queue or external system; contract for a new or changed endpoint. Commit small on your branch, messages start with the requirement id. Run the map.md commands as you go.
3. When the folder lacks something. Stop and write a proposal in workflow/asks/: front matter (id, kind: proposal, for, stage, asked, by, blocking, topic, status: waiting), ## Ask, ## Why it matters, ## Options the agent can see, ## Answer. Set status: blocked, log it, stop. Three proposals on one requirement is the limit; at the third, log that the requirement is under-specified and stop.
4. Check. Run vibekit check on your branch and fix everything it reports. If a check is wrong, that is a proposal against guardrails.md or map.md, not an argument in the log.
5. Hand off. Append a ## Log line (date, implementer (runner) → reviewer, branch, files, tests green, asks raised). Set status: tested. Write session notes, prefixed with the requirement id; add remember: to a log line for anything the next implementer should not rediscover. Stop. Do not start another requirement.

## Rules that hold no matter what
One requirement per session. Acceptance criteria are the contract; an untestable one is a proposal, not a reinterpretation. map.md silent means a proposal to update map.md, not a free choice. Never edit standards/, entities.md, plan.md, architecture.md or another requirement. Never set status: done. The walking skeleton is built from map.md and pipeline.spec.md alone and deploys green before phase 1.

## Stop conditions
status.md does not name a requirement you hold, or the branch mismatches · an after: dependency is not done · you need something the folder lacks (write the proposal first) · three proposals written · vibekit check fails on something you cannot fix without a forbidden path · the requirement's source section contradicts its acceptance criteria.
```

The remaining stage prompts (0-intake, adopt, 2-architecture, 3-design-system, 4-plan, 6-test) follow the same shape and are derived from §16 to §23; they are written as files once these two have been run on real material and their shape has settled.

## E. Settings reference (`profile.md`)

Every knob in one place. All have defaults; none is required.

| Setting | Default | Used by |
| --- | --- | --- |
| `vibekit`, `prompts`, `spec` | installed versions | `check` warns on drift |
| `template`, `stack`, `architecture` | from init | stage 2, `map.md` |
| `memory-index-cap` | 40 | memory index archiving |
| `budget-cap` | 5,500 | `check --budget` |
| `hold-timeout` | 4h | stale holds, `unhold` |
| `merge` | squash | PR merge strategy |
| `base` | main | branch model |
| `sign` | optional | commit signing |
| `rebase-before-test` | true | build loop |
| `coverage-min` | 80 (changed lines per requirement) | reviewer |
| `ask-threshold` | 3 days | `check` on waiting asks |
| `proposal-budget` | S:1 M:3 L:3 | build loop |
| `clarify-budget` | 10 per round, 3 rounds | stage 1 |
| `review-rounds` | 2 | stage 6 |
| `reviewer-model-differs` | true | stage 6 |
| `folder` | vibekit/ | pointer files |

App-side settings (never in the folder): provider tokens, `models-allowed`, `data-residency`, `rates.yml`, team-memory URL, redaction mapping, SSO configuration.

## F. Tiers

| Capability | Free | Core |
| --- | --- | --- |
| Folder format, CLI, all stage prompts, MCP server | Yes | Yes |
| Dry-run clarify, build loop, reviewer, memory | Yes | Yes |
| Build report | Yes | Yes |
| Budget and security reports, evidence export, compliance framework filters |  | Yes |
| `humans.md` approvers, gate policy, CODEOWNERS generation | Single approver | Yes |
| SSO, SCIM, audit log to SIEM |  | Yes |
| Sandboxed agent runner, `models-allowed`, `data-residency` | Local only | Yes |
| Team memory repo, multi-repo `system.md` |  | Yes |
| Provider integrations beyond GitHub |  | Yes |
| Managed hosting with DPA |  | Optional |

The line: everything a single developer needs to run the loop honestly is free; everything an organisation needs to prove it ran honestly is Core.
