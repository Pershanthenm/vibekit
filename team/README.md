# Team kit

Everything in this folder ships inside the VibeKit plugin, so every developer who installs it gets the same set.

- `skills/<name>/SKILL.md` (plus any supporting files): your team's skills. In Claude Code they appear as `/vibekit:<name>`; in Cursor under `~/.cursor/skills/vibekit/`.
- `agents/<name>.md`: your team's subagents, for Claude Code and (converted) for Cursor.
- `plugins.json`: plugins from other marketplaces that install automatically as dependencies (referenced, not copied).

Fill it from your own machine with `vibekit team capture`, or edit it by hand and run `npm run build` in `plugin/`. Then bump the version (capture does this for you), commit and push. See TEAM.md.
