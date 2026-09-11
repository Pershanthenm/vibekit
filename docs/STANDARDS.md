# Standards — a library, injected only where relevant

- **Product:** Vibe-check-cli
- **Status:** `list`, `index` and `inject` implemented. `discover` not built.
- **Date:** 2026-09-11

## 1. Problem

`AGENTS.md` is loaded into every session in full — roughly 2,200 tokens — no matter what the task
is. That is fine for a spine of stack, workflow and security. It is the wrong shape for *coding
standards*, which grow without limit: API response envelopes, migration safety, naming, error
handling, logging, one per topic per domain.

Put all of that in `AGENTS.md` and two things go wrong. Context fills with rules irrelevant to the
task, and the rules that *do* matter get buried among the ones that don't.

The fix, borrowed from [Agent OS](https://buildermethods.com/agent-os): keep standards as a
library with a tiny index, and load only what the current task needs.

## 2. Shape

```
standards/
├── api/
│   ├── response-format.md
│   └── error-handling.md
├── database/
│   └── migrations.md
├── naming-conventions.md
└── index.yml
```

Each standard is a Markdown file with front matter:

```markdown
---
description: "Error code conventions, exception handling"
globs: "src/**/*Controller*"
---

- Errors return RFC 7807 ProblemDetails.
- Never leak a stack trace or SQL text to a caller.
```

`description` is what injection matches on, so it is the load-bearing field. `globs` is optional:
a standard scoped to files always applies when you touch one of them, whatever the wording of the
task.

The index is generated, never hand-written:

```yaml
api:
  error-handling:
    description: "Error code conventions, exception handling"
    globs: "src/**/*Controller*"

root:
  naming-conventions:
    description: "File, class and variable naming conventions"
```

`root` is reserved for standards in the top of `standards/` rather than a domain folder. Domains
are listed first so the file reads top-down.

## 3. Commands

| Command | What it does |
|---|---|
| `vibecheck standards list` | Every standard in the index, grouped by domain |
| `vibecheck standards index` | Rebuilds `standards/index.yml` from the files on disk |
| `vibecheck standards inject "<task>"` | The standards relevant to that task, and nothing else |
| `vibecheck standards inject "<task>" --paths a,b` | Also matches standards whose globs cover those files |

Add `--json` to any of them for machine-readable output.

**The behaviour that matters:** when nothing matches, injection returns nothing and says so.

```
No standard matches "kubernetes autoscaling".
That is an answer, not a failure: nothing recorded covers this yet.
```

Returning the whole library on a miss would defeat the purpose, and inventing a convention would
be worse. This is the same rule the evidence section of `AGENTS.md` sets for agents.

## 4. How agents use it

`AGENTS.md` gains a short **Standards** section — five lines, not the library — telling every
agent to read `standards/index.yml` first and open only what matches. The Cursor, Antigravity and
Windsurf adapters carry the same instruction, so the behaviour is identical whichever editor a
developer opens the project in.

The cost is one small file in context instead of an unbounded rule set.

## 5. Acceptance criteria

- **AC-1** ✅ Given standards in domain folders and in the root, when indexed, then each appears
  under its domain, with top-level files under the reserved `root` key.
- **AC-2** ✅ Given an index, when parsed, then it round-trips: the same paths, descriptions and
  globs come back out.
- **AC-3** ✅ Given the task "add an error response to the orders API", when injected, then the API
  standards are returned and an unrelated database standard is not.
- **AC-4** ✅ Given a standard scoped by globs and a touched file matching them, when injected,
  then that standard is returned first, regardless of the task wording.
- **AC-5** ✅ Given a task nothing covers, when injected, then nothing is returned and the output
  says so.
- **AC-6** ✅ Given an empty `standards/` folder, when indexed, then no index is written and the
  command explains what to add.
- **AC-7** ✅ Given a standard with no `description`, when indexed, then it is listed as a warning,
  because injection matches on the description and it will rarely be selected.
- **AC-8** ⬜ Given an existing codebase, when `vibecheck standards discover` runs, then recurring
  conventions are extracted into draft standards for review. *(Not built.)*

## 6. Discover — not built

Agent OS's `/discover-standards` reads a codebase and writes its conventions down. That is the
half of this that genuinely needs a model: extracting "this team returns errors as ProblemDetails
and names tests after the criterion" is judgement, not pattern matching, and a deterministic
implementation would produce confident nonsense.

The right shape is a skill that drives the extraction and writes files through
`vibecheck standards index`, in the same way the existing workflow skills drive the CLI. It pairs
naturally with `vibecheck adopt`: adopt the repository, then discover its standards.

Until then, standards are written by hand. `index` and `inject` work exactly the same either way.

## 7. Relationship to the rest

Standards are **conventions** — how this team writes code. They are not:

- **`specs/project.json`** — the stack, architecture and commands. Structured data, generated from, not prose.
- **`specs/03-standards.md`** — the generated review checklist, derived from `project.json`.
- **`specs/security.md`** — the security baseline, enforced by acceptance criteria and CI rather than injected.
- **Feature specs** — what to build, not how to write it.

A standard should be something you would otherwise repeat in code review.
