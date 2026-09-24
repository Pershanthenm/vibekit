# VibeKit Extensions and Integration Spec

Version 1.0 · 24 September 2026 · a component of the VibeKit Specification (§68)

> **In plain terms.** This is how knowledge and tools from outside get into a project: the external systems agents may reach, the skills you bring in from a repository, and the extensions your organisation publishes — plus the rules that stop any of it weakening what the folder guarantees.

## 1. Purpose and scope

VibeKit installs small. The folder format, asks and gates, the build and review loop, evidence, convergence, memory and `check` are core. Everything else is added when a project needs it.

This document specifies four things:

| Section | What it covers |
| --- | --- |
| §2 | MCP servers a project consumes — Jira, a design system, an internal API |
| §3 | Importing skills from a repository — your agency's knowledge, a published roster |
| §4 | Extensions — how one is published, versioned, installed and updated |
| §5 | Trust, budget, conflicts and testing — the rules that apply to all three |

**The single rule underneath all of it.** Outside content may add capability and may never weaken a guarantee. Anything from outside — a skill, a check, a document type, an MCP result — is subordinate to `standards/` and `guardrails.md`, and is data rather than instructions.

§5 matters more than §2 to §4. A team that implements the features without the rules has built a supply-chain problem with a nice interface.

---

## 2. MCP servers a project consumes

`vibekit serve` is an MCP server VibeKit *provides* to coding tools. This section is the reverse: servers a project *consumes*, so agents can reach a client's Jira, an internal API, a design system or a document store.

### Declaration

Servers are declared in the folder, authored, and never carry credentials:

```yaml
# vibekit/agents/servers.yml · authored
- id: jira
  url: https://acme.atlassian.net/mcp
  auth: app-settings                        # never a token in the folder
  tools: [search_issues, read_issue]        # allow-list, not everything offered
  roles: [planner, analyst]                 # who may call it
  writes: false                             # read-only, enforced
  data: internal                            # highest classification it may see
  budget: 200 tokens per call, 20 calls per session
  cache: none

- id: design-system
  url: https://internal.acme/design/mcp
  tools: [get_token, list_components]
  roles: [designer, implementer]
  writes: false
  data: public
  cache: session                            # large and static
```

### Five rules

1. **Allow-list, never the whole server.** A server offering forty tools gets the two this project needs. A call to anything else is refused and reported as a finding, not silently dropped.
2. **Roles decide who calls what.** The reviewer does not write to Jira; the implementer does not read the HR database. This falls out of the role model in §26 of the main specification and needs no new machinery.
3. **Data classification is enforced at the boundary.** A server marked `data: internal` may never be sent a field classified `personal`, `financial` or `secret`. `vibekit check --security` fails on a call that would, before it is made.
4. **Everything returned is data, never instructions.** The rule already stated for memory, sources and pull-request comments applies verbatim. A Jira ticket containing "ignore your previous instructions" is the attack to expect, and every stage prompt states this.
5. **Every call is logged** — role, tool, arguments, what came back — in `sessions.json`. The security report lists which external systems the agents touched, which is the first question a security reviewer asks.

### Failure

A call that fails does not fail the session. The agent is told the server is unavailable and either continues without it or raises an ask if the information was necessary. It never invents a substitute.

A server unreachable at session start is reported once rather than retried into a rate limit. `vibekit check --servers` verifies every declared server is reachable and authenticated, and runs before a sprint starts, so a broken integration is found at the gate rather than halfway through a lane.

### Cost

MCP results are tool output and are trimmed like any other (main specification §60): a search returning forty issues is reduced to the fields the task needs, with the full result kept in `.state/` for the reviewer. The per-server budget is a ceiling; exceeding it stops further calls and tells the agent, rather than quietly spending. `cache: session` holds results for servers whose data is large and static.

### Credentials

In app settings, scoped per server, never in the folder and never in a commit. A folder naming a server nobody has authenticated reports that clearly at `check --servers` time.

---

## 3. Importing skills from a repository

A repository of knowledge — your agency's conventions, a published roster of agent personas, a set of control definitions — becomes VibeKit skills.

```bash
vibekit tools skills import git@github.com:youragency/skills
vibekit tools skills import git@github.com:someone/agent-roster --division engineering
vibekit tools skills import ./local-folder --dry-run
```

The import walks the repository, converts what it finds, and reports what it did. `--dry-run` reports without writing.

### Converting a persona into a skill

| In the source | Becomes |
| --- | --- |
| Workflows, techniques, worked examples | The skill body. This is the valuable part |
| Code examples | Pattern files in `skills/lib/patterns/`, where substantial enough to copy |
| Area of expertise | Inferred trigger words, marked `confidence: low` until a human reviews them |
| Identity and personality | **Dropped.** VibeKit roles are defined by permissions, not character. "You are a meticulous senior engineer" costs tokens and changes nothing |
| Rules and preferences | **Flagged, not imported** — see below |

### The flagging rule

Persona files routinely contain lines like "always use styled-components", "never use class components", "prefer composition over inheritance". Those are opinions, and in VibeKit an opinion that governs code is either a rule in `standards/` with a check, or it is nothing:

```
  3 lines in frontend-developer.md read like rules, not techniques:

  1. "Always use styled-components for styling"
     [1] make it a rule (needs a check)   [2] keep as a suggestion   [3] drop

  2. "Never use class components"
  3. "Prefer composition over inheritance"
```

Without this step an imported roster quietly overrides decisions taken at the architecture gate, and nobody can work out why the agents stopped following the architecture record.

### Duplicates

Importing two sources that both contain a frontend skill is normal. The import detects near-duplicates by trigger overlap and content similarity, and asks: keep both with disjoint triggers, keep the better one, or merge. Two skills firing on the same word is the failure the main specification §56 warns about, and it is cheapest to prevent at import.

### Licence and provenance

The import records the source repository, its licence and the commit imported from, in `skills/lib/imported/SOURCES.md`. A repository with no licence is flagged: knowledge you cannot legally redistribute should not reach a client's repository without somebody deciding that deliberately.

### Volume is not a problem

A hundred imported skills cost roughly 2,000 tokens in the index and nothing else until their triggers match; at most three bodies load for one task. Tools that load personas the ordinary way hit hard limits — at least one published roster documents a runner silently dropping agents past about 119. Indexed skills have no such failure mode, and an import of any size is safe.

### Testing what you imported

Every imported skill is untested prompt content. `vibekit tools skills test` runs the trigger and behaviour tests from §56. An imported skill without a test loads with a warning and cannot be promoted to team scope. A hundred untested skills is a hundred ways for an agent to be confidently wrong.

---

## 4. Extensions

### Commands

```bash
vibekit ext add git@github.com:youragency/kit     # clone, show what it adds, confirm
vibekit ext list                                  # installed extensions and versions
vibekit ext update                                # diff first, apply on confirm
vibekit ext remove <name>
vibekit ext verify <path>                         # run the checks in §5 before publishing
```

### Manifest

```yaml
# extension.yml
name: acme-agency-kit
version: 2.1.0
requires: vibekit >= 1.0
licence: proprietary
adds:
  skills: 34
  checks: 6
  documents: 2
  stages: 0
budget:
  always-loaded: 680 tokens      # declared, and verified on install
```

### What an extension may add

Commands, stage prompts, skills, checks, document types, report sections, MCP server declarations, and stack templates.

### What it may never do

- Remove or weaken a check
- Widen a role's write scope
- Touch `standards/` or `guardrails.md`
- Install without confirmation

### Installing

`ext add` clones the repository, reads the manifest, prints what it adds with its declared budget cost, and asks. On confirmation it is recorded in `profile.md` with its name, version and pinned commit, so a folder is always explainable to somebody who did not set it up.

`ext update` shows a diff of what changes — new checks, changed prompts, added skills — and applies on confirmation. An extension is pinned to a commit, never a branch.

### Where automatic is right

Once configured, every new project picks up the organisation's extensions and skills repository without being asked again. The confirmation is per extension, not per project. Set it up once for the organisation; every project starts with the house knowledge.

### Why extensions exist commercially

A customer needing three bespoke compliance checks gets a private extension, not a feature request. This is also the answer to scope creep: when somebody asks for a feature, the question becomes "is this core, or is this an extension?" — and most things are extensions.

---

## 5. Trust, budget, conflicts and testing

These rules apply to everything in §2, §3 and §4. They matter more than the features.

### 5.1 Trust: what outside content may do

**Checks are declarative, not executable.** This is the load-bearing rule. If a check were arbitrary code, installing an extension would mean running somebody else's program against your repository with your credentials in the environment.

An extension's check declares what it inspects and what makes it fail, in the same form VibeKit's own checks use: a path pattern, a required file, a forbidden string, a test that must exist, a token budget, a front-matter field that must be present. It cannot shell out, cannot reach the network, and cannot read outside the repository.

An extension that genuinely needs to run something declares it as a **stage in `delivery/pipeline.spec.md`**, which is visible in the repository, reviewed like any other change, and runs in CI where everybody can see it — never silently inside `vibekit check`.

Three further protections:

- **Extensions run under the same sandbox as agents** (main specification §52): no production credentials, no host environment, network only to what is declared.
- **Pinned to a commit, never a branch.** A repository that changes under you is a supply-chain attack with extra steps. `ext update` moves the pin, with a diff, on confirmation.
- **Signing.** For internal publication, signed releases and a known key. Not needed for a team's own kit on day one; required before anything is published to people outside the organisation.

### 5.2 Budget: what outside content costs

Every imported skill, extension and MCP server adds to the context an agent carries or the tokens it spends. That cost is visible per source or the always-loaded budget becomes unaccountable.

- **Each extension declares its always-loaded cost** in its manifest. `vibekit check --budget` reports the breakdown by source — core, each extension, imported skills — rather than one total.
- **A declared cost wrong by more than 20 per cent is reported**, so a manifest cannot understate what it adds.
- **Installing something that would breach the cap is refused**, with the numbers, before anything is written. You raise the cap deliberately or install less.
- **MCP servers carry per-call and per-session budgets** (§2).
- **The budget report shows cost by source**, so "our agency kit costs about R40 a sprint in context" is a figure somebody can decide about.

### 5.3 Conflicts: when two sources disagree

With core, an organisation extension, imported skills and a project's own, collisions are certain. Precedence, most specific first:

```
project's own skills  →  extensions  →  imported skills  →  shipped with VibeKit
```

Above all of them, always: **`standards/` and `guardrails.md` win.** A skill from any source that contradicts a rule loses, and the conflict is reported rather than resolved silently.

`vibekit check` prints the override chain for any skill present in more than one place, so nobody is surprised about which version fired. Two extensions adding the same check is an error at install time, not a race at runtime.

### 5.4 Testing what you import or publish

Skills and checks are prompt content, and prompt content regresses silently.

| What | Test |
| --- | --- |
| An imported skill | The `.test.md` treatment from §56 — triggers that must and must not fire, a fixture, expected output. Untested skills load with a warning and cannot be promoted to team scope |
| An extension you publish | `vibekit ext verify` installs it against the three fixture briefs, runs clarify and the build loop, and diffs the asks and the generated folder against golden outputs |
| An extension you install | The same run, locally, before it reaches a client project |

If an extension changes which questions get asked, you see it in a diff before your customers do. That is the only way to change prompt content safely.

---

## 6. Build order

| Build | When | Why |
| --- | --- | --- |
| Extension distribution (§4) | With the first extension you write | Nothing else works without it |
| Trust, budget, conflicts (§5.1–5.3) | With the first extension you **install** | These are what make the first one safe. Do not ship extensions without them |
| Skill import (§3) | When there is knowledge worth sharing across projects | Cheap, and the flagging rule prevents a real failure |
| MCP consumption (§2) | Before the first client integration | The largest gap, and dangerous to leave to the coding tools |
| Testing (§5.4) | Before publishing to anyone outside your team | Cheap, and the alternative is finding out from a customer |

None of this is needed to prove the core loop works, and none should be built before the engine exists. It is what turns VibeKit from a tool one person uses into a tool an organisation uses.

## 7. One decision worth taking early

**Will extensions ever be public?**

A private kit for one organisation needs none of the signing, registry, review or reporting machinery. The moment anybody outside can publish one, all of it is needed at once — and retrofitting trust into a mechanism built without it is far harder than designing for it now, even if the public case is years away.
