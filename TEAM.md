# Sharing one setup with your whole team

Every developer gets the same VibeKit plugin, the same skills and subagents (in Claude Code and in Cursor), and the same extra plugins, from one git repository.

## You, once: put your kit into the plugin

1. Install what you want everyone to have: your skills in `~/.claude/skills/`, your subagents in `~/.claude/agents/`, and plugins such as draw-io, ecc or ui-ux-pro-max.
2. In the Claude panel, ask:
   ```text
   Run vibekit team capture and show me what it captured.
   ```
   It copies your skills (with their supporting files) and subagents into `~/tools/vibekit/team/`, records your other plugins as dependencies, rebuilds the plugin and bumps its version.
   - Leave something out: `vibekit team capture --skip name1,name2`.
   - Plugins installed from a folder on your machine can't be shared; capture tells you which. Plugins from GitHub or another git host can.
   - Names VibeKit already uses (`run`, `reviewer` and so on) are skipped, so your copies never replace the built-in ones.
3. Put the folder in your team repository (GitHub, GitLab or Azure DevOps):
   ```text
   Make ~/tools/vibekit a git repository, commit everything, and push it to <your repository URL>.
   ```
   Check the result any time with `vibekit team status`.

## Everything Claude Code (ECC) skills

Import just the ECC pieces you want, fetched from ECC's official npm package, instead of the whole ECC plugin:

```text
Run vibekit team import-ecc api-design,tdd-workflow,security-reviewer,code-review and show me the result.
```

It sorts each name (skill, agent or command), imports what works on its own (commands become skills), and explains everything it skips: pieces that need ECC's own scripts or hooks, deprecated ones, and ones that clash with VibeKit's names. ECC's MIT licence notice ships with the plugin (`THIRD_PARTY_NOTICES.md`). To move to a newer ECC later, run `vibekit team import-ecc` with no names: it re-imports your recorded list.

This kit already contains the selection from your list: 17 skills, the `database-reviewer` and `security-reviewer` agents, and the `code-review`, `resume-session`, `save-session` and `skill-create` commands as skills. Measured with Claude Code, it adds about 2,200 tokens to each session; the full ECC plugin adds about 29,000, plus seven hooks of its own. If you also install the full ECC plugin, you'd have these twice, so uninstall it (`claude plugin uninstall ecc@ecc`), or keep it only if you need its hook-based pieces (continuous-learning-v2, strategic-compact, quality-gate, sessions) and accept the cost. When you run `vibekit team capture`, add `--skip ecc` so the full plugin isn't made a team dependency.

## Every developer: install from the repository

Send new developers [ONBOARDING.md](ONBOARDING.md), after replacing `TEAM-REPO-URL` in it with your repository's address. It covers Windows, Mac and Linux from a fresh machine. The short version for someone already set up with Cursor and Claude Code:

In the Claude panel in Cursor (Windows):

```text
Clone <your repository URL> to $HOME\tools\vibekit (replace it if it exists), then run powershell -ExecutionPolicy Bypass -File "$HOME\tools\vibekit\plugin\scripts\bootstrap.ps1" --minimal --yes with a long timeout. Show me the end of the output.
```

On a Mac, or in WSL/Linux, clone to `~/tools/vibekit` and run `bash ~/tools/vibekit/plugin/scripts/bootstrap.sh --minimal --yes` instead.

Setup adds the marketplaces your team's plugins come from, installs VibeKit (which pulls in those plugins automatically), and puts the same subagents and skills into Cursor. Then type `/reload-plugins` in Cursor (not from your phone: Remote Control can't reload plugins), and check with `/vibekit:health`.

## Changing the kit later

You: add or change skills, subagents or plugins, run `vibekit team capture` again, commit and push.

Everyone else:
```text
In $HOME\tools\vibekit run git pull, then run vibekit setup --yes, then tell me what changed.
```
The health check flags an out-of-date plugin, and setup updates it. Then `/reload-plugins`.

## What lives where

| What | Where |
|---|---|
| The shared kit (you edit this) | `~/tools/vibekit/team/` |
| Claude Code's copy of the plugin | managed by Claude Code (`claude plugin details vibekit@vibekit`) |
| Cursor's subagents and skills | `~/.cursor/agents/` and `~/.cursor/skills/vibekit/` |
| Your projects | `~/projects/<name>` (on Windows `C:\Users\<you>\projects\<name>`); list them with `vibekit projects` |
