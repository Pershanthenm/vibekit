# Onboarding

From a fresh machine to a working setup. Ten minutes on Windows, macOS or Linux.

## 1. Requirements

- **Node.js 20+** and **Git**.
- One agent: **Claude Code** (plugin), **Cursor**, **Codex**, or any MCP client.
- Optional: **Docker or Podman** for `vibekit serve --sandbox`; **cloudflared** for `--tunnel`.

## 2. Install the CLI

```bash
git clone https://github.com/Pershanthenm/vibekit.git ~/tools/vibekit
npm install -g ~/tools/vibekit/plugin
vibekit version
```

Or from the [Alpha release](https://github.com/Pershanthenm/vibekit/releases/tag/v0.1.0-alpha):

```bash
npm install -g https://github.com/Pershanthenm/vibekit/releases/download/v0.1.0-alpha/vibekit-0.1.0-alpha.tgz
```

On Windows, PowerShell works the same; use `$HOME\tools\vibekit`.

## 3. Install the plugin (Claude Code)

In Claude Code:

```text
/plugin marketplace add Pershanthenm/vibekit
/plugin install vibekit
/reload-plugins
```

Then `/vibekit:setup` once. It asks where your projects live, your name for approvals, your git provider (GitHub, GitLab or Azure DevOps), its organisation URL and a token, and writes them to machine settings so no helper asks again. With those set, `vibekit new repo` creates the repository at the provider, writes its pipeline file and pushes; `vibekit new repo --check` says whose token it is.

The plugin adds the slash commands (`/vibekit:setup`, `/vibekit:new-project`, `/vibekit:new-brs`, `/vibekit:use-project`, `/vibekit:answer`, `/vibekit:show-status`, `/vibekit:run-sprint`, `/vibekit:clarify`, `/vibekit:plan-project`, `/vibekit:plan-sprint`, `/vibekit:new-sprint`, `/vibekit:build`, `/vibekit:run-check`, `/vibekit:run-review`, `/vibekit:new-feature`, `/vibekit:new-bug`, `/vibekit:new-hotfix`, `/vibekit:show-plan`, `/vibekit:show-why`, `/vibekit:analyze`; type `/vibekit:` and Claude Code completes the list, and each one asks with a picker rather than making you type) and three hooks: at session start it hands the agent the load order and `status.md`; before a write it refuses generated files, denied paths and other agents' requirements; at the end of a turn it runs `vibekit check`.

Cursor, Codex and the rest need nothing extra as a plugin: `vibekit new project` writes the pointer files (`.cursorrules`, `AGENTS.md`, `CLAUDE.md`) they read. Attach `vibekit serve --stdio` as an MCP server when you want the runner to enforce what they may read, write and run. For Cursor and the Cursor CLI, that is `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vibekit": {
      "command": "vibekit",
      "args": ["serve", "--stdio"]
    }
  }
}
```

## 4. First project

```bash
mkdir ~/projects/my-app && cd ~/projects/my-app
vibekit new project
```

Or, on a repository you already have: `vibekit new project --import .`.

## 5. Machine settings

```bash
vibekit settings                          # what is set on this machine
vibekit settings tiers map                # which model each tier is (strong · mid · cheap · local)
vibekit tools rates refresh               # first-party prices, weekly
vibekit settings team-memory <git url>    # the team's shared memory repository, if there is one
vibekit settings team-skills <git url>    # the team's shared skills repository
vibekit settings tunnel-token <token>     # a named Cloudflare tunnel for serve --tracker; `vibekit tracker` needs none
vibekit settings server jira <token>      # a credential for an MCP server a project declares in vibekit/agents/servers.yml
vibekit settings trust acme acme.pub      # an extension publisher's public key; `require-signed true` refuses the rest
vibekit ext add <name | https url>        # extensions, once per machine; every project then picks them up
```

Everything here lives in `~/.vibekit/`, owner-only, never in a repository, so a fork cannot inherit a token or a URL:

| File | Holds |
|---|---|
| `config.json` | the settings above and the per-server credentials |
| `projects.json` | the projects this machine knows, for `vibekit show status` and `vibekit tracker <name>` |
| `extensions.json`, `ext/` | which extensions are enabled, pinned to a commit, and their files |
| `trusted-keys.json` | the extension publishers you trust |

Set `VIBEKIT_HOME` to move the directory.

## 6. Check it

```bash
vibekit                          # in a project: what to do next here
vibekit check                    # every mechanical check
vibekit run check --runners          # each runner can reach the folder; which are unsandboxed
vibekit run check --servers          # if the project declares MCP servers: declared well, credential present, reachable
vibekit project select --rescan ~/code   # register the projects you already have, so `vibekit show status` sees them
vibekit skills                   # the 27 skills that ship with VibeKit, plus the project's own; `skills adopt <name>` to take one over
vibekit skills catalogue         # 374 more in 16 domains; `skills enable <name|domain>` indexes the ones this project is about
```

## 7. Your phone

```bash
brew install cloudflared         # macOS · winget install Cloudflare.cloudflared · apt/yum from pkg.cloudflare.com
vibekit tracker <project>        # from anywhere: finds the project by name, opens a tunnel, prints a QR code to scan
vibekit tracker <project> --no-tunnel   # the same page on the local network only
```

The tracker is where you answer questions, approve gates and close reviewed work when you are not at the machine. For a team, `vibekit serve --tracker` puts Cloudflare Access in front and maps logins to `agents/humans.md`.

## Keeping up to date

`git pull` in `~/tools/vibekit`, `npm install -g ~/tools/vibekit/plugin` for the CLI, then `/plugin update vibekit` in Claude Code for the slash commands and hooks (`/reload-plugins` only re-reads what is already installed; it does not fetch new commits). `vibekit upgrade-prompts` shows the diff before a project's stage prompts change, and `vibekit ext update` shows the diff before an extension moves its pin — a project's agents never change behaviour because of an update nobody saw.
