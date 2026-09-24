# Operating guide

How a team uses VibeKit day to day. The [specification](spec/vibekit-specification.md) is the reference; this is the short version, in the order things happen.

## 1. Who does what

| Who | Does | Never does |
|---|---|---|
| **You** (product owner, tech lead, security) | Answer asks, approve gates, set `done`, close sprints, name approvers in `agents/humans.md` | — |
| **Analyst** (stage 1) | Asks about what the sources do not settle; writes assumptions | Design, choose a stack, write code |
| **Planner** (stages 2, 4) | Proposes the architecture with reasons; orders the plan | Write code, edit `standards/` |
| **Implementer** (stage 5) | Holds one requirement; approach, failing tests, code, `verify`, checkpoints | Edit `standards/`, `entities.md`, another requirement; set `done` |
| **Reviewer** (stage 6, a different model) | Maps criteria to tests, runs the suite, writes the verdict | Write application code |

The roles are files in `vibekit/agents/`. `vibekit serve` enforces them over MCP; the git hooks and the Claude Code hooks enforce them for file-only runners.

## 2. Start

```bash
vibekit project new
```

Name it, choose where it lives, describe it or hand over the document, tick the platforms. The folder is written, the hooks installed, and your words kept verbatim as the first source. `--yes --name --describe --platform` answers everything from flags.

Have code already? `vibekit project import .` reads it and explains it back — in plain language, every line with a confidence — before `--convert` writes the folder. Nothing in the existing code is changed. See [docs/BROWNFIELD.md](docs/BROWNFIELD.md).

Not sure it should be built at all? `vibekit ext add assess`, then `vibekit project assess "<idea>"`: five files, a decision record, no code.

## 3. The gates

`vibekit sprint run` reads the gate and prints the stage prompt to run. Each gate is a line you write:

| Stage | The line | Where |
|---|---|---|
| 1 clarify | `reviewed: 2026-09-24 by <name>` | `workflow/assumptions.md` |
| 2 architecture | `approved: 2026-09-24 by <name>` | `workflow/architecture.md` |
| 3 design | `approved: …` below `<!-- local -->` in `tokens.md`, and in `components.md` | `product/design/` |
| 4 plan | `approved: …` | `workflow/plan.md` |

The tracker's approve button writes exactly the same line. Nothing in VibeKit writes one on its own.

## 4. Answering asks

```bash
vibekit action                       # every project, most blocking first
vibekit action answer                # walk through them: each question, the agent's options as a menu, type your own, skip, reject
vibekit action answer 1 "a CSV export uploaded when the take starts" 3 "Stripe"   # one or several, by number or id
vibekit action export --out answers.md   # a file to fill in offline …
vibekit action answer --from answers.md  # … and apply; `reject: <reason>` on a line sends that one back
vibekit tracker stock                # the same inbox on your phone: finds the project by name, opens a tunnel, prints a QR code
```

Ask ids are per project, so when two projects both have a `Q-001` open you say which: `stock/Q-001`. Every answer is written the moment it is given, so stopping a walk halfway loses nothing.

Every ask leads with `## In plain terms`. Blocking asks wait for a person; nobody answers on their behalf. Non-blocking ones let the stage continue with an assumption you review at the gate.

## 5. Sprints

```bash
vibekit sprint plan --cost           # the sprints and the token forecast, before you approve
vibekit sprint run --lanes 2         # hand out independent work: never two agents on one entity
vibekit sprint status                # progress, lanes, what is blocked — as work, not ids
vibekit sprint close --by "<name>"   # the gate, then your name
```

`run` hands out; it does not run a model. A seat (Claude Code, Cursor) opens the branch and runs the prompt `vibekit sprint start` prints; `vibekit serve --stdio` is the MCP server for anything else, `--sandbox` for a container per session. `--until blocked` is the overnight setting.

The sprint gate: every piece of work `done`, nothing held, no open asks, no high-severity bug, `vibekit check` green, the security scan clean of high findings, documents regenerated, all three reports produced, lessons proposed. Then `--by`.

## 6. One piece of work

```bash
vibekit start REQ-014 --as implementer   # hold it; branch req/REQ-014
# approach → failing test per AC-n → code
vibekit req checkpoint REQ-014 --done "…" --in-hand "…" --next "…" --step 2 --of 5
git commit -m "feat(REQ-014): …" -m "VibeKit-Requirement: REQ-014"
vibekit verify                           # exit codes into ## Evidence
vibekit req tested REQ-014 --as implementer
vibekit review REQ-014                   # the mechanical half; a reviewer session does the rest
vibekit req done REQ-014                 # a person
```

A killed session resumes from the checkpoint: `vibekit sprint start` prints it; `vibekit start REQ --as implementer` on an unheld in-progress requirement picks it up and logs the change of hands.

## 7. Bugs

```bash
vibekit bug "due dates show a day early" --test tests/dates.test.js --severity high --found-on REQ-014
vibekit bug assess BUG-001 --cause "UTC date rendered in local time"
vibekit bug fix BUG-001                  # a branch, the same loop as any requirement
vibekit bug test BUG-001                 # verified · partial · failed
```

No reproducing test, no bug. High enters the current sprint and blocks its gate; medium and low go to the backlog. An agent may not set severity above medium and may not close one.

## 8. Design

```bash
vibekit design add https://linear.app    # what it took, and three questions it could not answer
vibekit design apply                     # answered questions and extracted values → tokens
vibekit design preview                   # your screens, light and dark, phone and desktop
vibekit design feedback "too cramped"    # three things it usually means; pick one
```

Spacing, density, type scale and colour relationships are borrowed as design always has; a logo or a layout is not.

## 9. Security

```bash
vibekit security scan [--url https://staging.example.com]
vibekit check --security --deps
```

The scan measures against the frameworks that apply (the classifications decide the defaults; `vibekit settings frameworks` chooses), counts what needs a person honestly, writes `docs/security-scan-<date>.md`, and opens a bug per finding. It is not a penetration test and says so.

## 10. Shipping

```bash
vibekit release                          # refused until every requirement in the sprint is done
vibekit rollback v1.2.0                  # previous release back, hotfix opened with the incident note
vibekit undo REQ-014                     # spec back to ready; dependants to review
vibekit hotfix "refund double-charged"   # S bug on hotfix/*, compliance pass, patch release
```

## 11. Stopping

`vibekit project stop --reason "month end"` checkpoints, releases holds, writes the resume note. `vibekit project resume` re-establishes ground truth before anything restarts: checks, dependencies, prompt versions, sources, open asks.

## 12. Outside knowledge and tools

```bash
vibekit settings server jira <token>          # the credential; the declaration is in vibekit/agents/servers.yml
vibekit check --servers                       # declared well, authenticated, reachable — before a sprint starts
vibekit tools skills import git@github.com:youragency/skills --dry-run
vibekit ext add git@github.com:youragency/kit  # shows what it adds and its budget, asks, pins the commit
vibekit ext update                            # fetch, show the diff, move the pin only when you say so
vibekit check --budget                        # the always-loaded cost by source: repo, each extension, imported, team, vibekit
```

**Publishing your own kit.** An extension is a git repository with an `extension.yml` (name, version, `requires: vibekit >= 1.2`, licence, what it adds, the declared always-loaded budget) and folders of data: `skills/`, `checks/` (declarative, six kinds), `stages/`, `documents/`, `reports/`, `templates/`, `servers.yml`, `always/`, `pipeline.md`. Never code. Before a release:

```bash
vibekit ext verify ./kit                      # the §5 rules, then the three fixture briefs against golden outputs (--quick skips the briefs)
vibekit ext keygen --out ~/.keys              # once: an Ed25519 pair; the private key stays off git
vibekit ext sign ./kit --key ~/.keys/vibekit-ext.key   # writes extension.sig; commit it with the release
```

Installers run `vibekit settings trust acme acme.pub` once, and `vibekit settings require-signed true` on machines that must refuse anything unsigned, tampered or from an unknown key. A team's own kit needs none of this; anything that leaves the organisation does.

A local MCP server is declared with `command:` instead of `url:` and launched on stdio for each call; `token-env:` names the variable its credential arrives in, and nothing else of the host's environment reaches it.

An agent reaches a declared server through `vibekit_call`; the allow-list, the role, the data classification and the budget are enforced there, and what comes back is data, never instructions. Imported skills carry their source, licence and commit in `skills/lib/imported/SOURCES.md`; opinions that read like rules land in `FLAGGED.md` for you to make a rule (with a check), keep as a suggestion, or drop. Extensions are data only and can add a check but never remove one; `check --budget` shows the always-loaded cost by source.

## 13. When something is refused

Every refusal names the file and the fix. The ones you will meet first:

| Refusal | Why |
|---|---|
| `REQ-002 is not ready: AC-2 is not in EARS form` | One trigger, one response, one of five forms |
| `waits on REQ-001, which is not done` | `after:` is enforced |
| `a commit straight onto main is refused` | Work lands by pull request; `--no-verify` if you mean it |
| `evidence is for commit …` | Run `vibekit verify` again on this commit |
| `An agent cannot set REQ-001 to done` | Only a person closes work |
| `Sprint 1 is not at its gate` | Every row is a fact; fix the red ones |
| `a bug nobody can reproduce is a report, not work` | Name the failing test |

## 14. A first project, end to end

A stock-taking app for three warehouses, from nothing to a first release, with the commands in the order you would type them.

```bash
mkdir stock-take && cd stock-take && git init
vibekit project new --name stock-take --describe "Staff count stock on a phone; supervisors review variances" --platform web,api
vibekit ingest brief.md            # if there is a requirements document: redacted, split into sections, obligations extracted
vibekit sprint run                 # prints the clarify prompt; your agent runs it and writes asks
vibekit action answer              # you answer them, one at a time
vibekit sprint run                 # the analyst finishes; assumptions.md waits for `reviewed: … by <you>`
```

Each gate is a line you write, or the approve button on the tracker. Architecture, design and plan follow the same shape: the agent proposes with reasons, you read, you approve.

```bash
vibekit sprint plan --cost         # sprints in dependency order, walking skeleton first, with the token forecast
vibekit sprint run --lanes 2       # two agents, never on the same entity; each holds one requirement on req/REQ-nnn
vibekit sprint status              # where each lane is, in words
vibekit action                     # whenever an agent stops on a question
vibekit review REQ-003             # the mechanical half of the review; the reviewer session writes the verdict
vibekit req done REQ-003           # a person
vibekit sprint close --by "Sam"    # every row of the gate true, then your name
vibekit release 0.1.0              # changelog, tag, evidence bundle
```

From then on: `vibekit feature add` for new work, `vibekit bug … --test` for anything broken, `vibekit hotfix` when production is down, `vibekit tracker stock-take` to carry the whole thing on your phone.
