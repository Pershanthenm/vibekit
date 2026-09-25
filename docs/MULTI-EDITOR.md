# One project, every agent

Specification §4, §25 and §56.

Three pointer files send every agent to the same folder, so one rulebook reaches Claude Code, Cursor, Codex and OpenCode without four copies of it. Each is under 150 tokens and contains no rules of its own.

```
CLAUDE.md          Claude Code        read status.md first; the load order; the folder path
AGENTS.md          Codex, OpenCode    the same
.cursorrules       Cursor             the same, in Cursor's form
.gitattributes     git, GitHub        generated paths collapse in diffs; memory/ never does
.env.example       developers         variable names only
.claude/commands/  Claude Code        one-liners that run vibekit run
.githooks/         git                the §50 commit rules, via core.hooksPath
```

All are generated and carry the header. A team's own extras go below a `<!-- local -->` marker, which regeneration preserves.

## The load order every agent follows

1. `vibekit/workflow/status.md` — which stage and which prompt file apply
2. `vibekit/standards/*` in full
3. `vibekit/product/context.md`, `glossary.md`, `map.md` in full
4. The one requirement and the entities the task names
5. `vibekit/skills/index.yml` and `vibekit/memory/index.md`, then a body only when a trigger or topic matches

## How each tool reaches the rules

| Runner | Reaches the folder via | Enforcement |
|---|---|---|
| Claude Code | `CLAUDE.md`, the plugin's hooks, `vibekit serve --stdio` (MCP) | Hooks refuse generated files, denied paths and other agents' requirements; the turn ends on `vibekit check`; MCP re-sends rules after compaction |
| Cursor | `.cursorrules` + MCP | Instruction and git hooks; MCP where attached |
| Codex, OpenCode | `AGENTS.md` + MCP | Instruction and git hooks |
| Anything else | `AGENTS.md` | Instruction only; `vibekit run check --runners` reports it as unsandboxed |

`vibekit serve --stdio` is the runner that enforces the stage's loads manifest, the writes list and the allowed commands mechanically; `--sandbox` adds a container per session. It also exposes `vibekit_call`, the one door to the MCP servers a project declares in `agents/servers.yml`: the allow-list of tools, the role, read-only, the budget and the data classification are enforced there, for remote servers over HTTP and local ones launched on stdio alike. `agents/runners.md` says which runner takes which role, and `vibekit run check --runners` verifies each can reach the folder.

## Slash commands

The plugin ships `/vibekit:setup`, `/vibekit:new-project`, `/vibekit:new-brs`, `/vibekit:use-project`, `/vibekit:answer`, `/vibekit:show-status`, `/vibekit:run-sprint`, `/vibekit:clarify`, `/vibekit:plan-project`, `/vibekit:plan-sprint`, `/vibekit:new-sprint`, `/vibekit:build`, `/vibekit:run-check`, `/vibekit:run-review`, `/vibekit:new-feature`, `/vibekit:new-bug`, `/vibekit:new-hotfix`, `/vibekit:show-plan`, `/vibekit:show-why`, `/vibekit:analyze`: one per CLI verb, namespaced `vibekit:` the way Claude Code names every plugin's commands, so `/vibekit:` completes the list. Each runs the CLI and points the agent at the stage prompt in `vibekit/workflow/stages/`; the prompts are the product's actual prompts, versioned in the repository, and a team can edit them.

## Switching mid-task

Start in Claude Code, resume in Cursor: same files, same checkpoint. `vibekit start REQ --as implementer` on an unheld in-progress requirement picks up from `## Checkpoint` and logs the change of runner. This is the case the file-driven design exists for, and the recovery fixture (`npm run recovery`) tests it on every CI run.
