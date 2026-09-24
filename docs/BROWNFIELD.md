# Existing codebases

> Point VibeKit at a project you already have and it reads the code and tells you, in plain language, what the app is, how it is built, what it talks to, where the risks are, and how well tested it is. It asks about anything it cannot tell. When the picture is right, one command turns it into a VibeKit folder. Nothing in the existing code is changed.

Specification §18, §41 and §58.

## 1. Understand

```bash
vibekit project import .            # or a path, or a git url
```

Reads the tree, the build and dependency files, migrations and schema, routes, tests, CI, Dockerfiles, any existing `CLAUDE.md`/`.cursorrules`/`AGENTS.md`, and the last 200 commits — manifests first, then one representative file per layer, then whatever a question sends it to. Budget: 40,000 tokens of reading, reported.

It writes `vibekit/understanding.md`, every line with a confidence and the file it came from:

- **In plain terms** — what this is, for a person who did not build it
- **How it is built** — layers, patterns actually in use, the commands that build and test it
- **Entities and data** — with classifications guessed from field names, to confirm
- **What it talks to** — integrations, including the undocumented ones
- **Quality** — tests, coverage, which test kinds are missing
- **Risks** — secrets in config, stale dependencies, string-built SQL, missing tenant filters; also written as security findings
- **Conventions nobody wrote down** — candidate rules and skills
- **What I could not tell** — asks, ten at most

Read-only. Correct anything wrong in the file; answer the asks.

## 2. Convert

```bash
vibekit project import . --convert
```

Writes only the pointer files and the folder, from the corrected understanding: `context.md` and a glossary, `architecture.md` as observed, `map.md` with the real commands, `entities.md` with classifications, `access.md` skeleton, `guardrails.md` with the risky areas denied, `standards/rules.md` from the conventions, decision memories from the ten most-referenced decisions in commit history. Existing `CLAUDE.md`-style files are kept below the `<!-- local -->` marker. `vibekit check` must be green before any agent starts.

Then `vibekit reverse` drafts one requirement per existing test class — acceptance criteria inferred from test names, entities from the types touched — all `confidence: low` and `status: draft`. A legacy codebase gets a spec it never had, and every change after goes through the same loop as new work.

## 3. Carry on

The workflow continues at the plan stage in rules-only mode: no application code is generated, and the first requirements are usually the gaps the report found — a smoke test, the string-built SQL, the missing tenant filter. Independent slices of a migration are `MIG-*` requirements, one agent each on its own branch.

```bash
vibekit project import . --refresh  # months later: what changed against the last understanding
vibekit init --from-speckit --yes   # a Spec Kit repository: constitution → rules, specs → requirements, the rest as asks
```

## What it will not do

It will not guess. A command it cannot detect is left empty rather than filled with a plausible default; a classification it inferred says so; an integration it cannot tell is live becomes a question. That list is the to-do, and it is the useful part.
