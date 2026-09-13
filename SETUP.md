# Setting up VibeKit

**Joining a team?** Follow [ONBOARDING.md](ONBOARDING.md): Windows, Mac and Linux, from a fresh machine.

Everything runs inside **Cursor**, with the **Claude Code extension** as your lead: a short bootstrap in Cursor's built-in terminal, then `/vibekit:setup` from the Claude panel does the rest.

- **Mac:** [SETUP-MAC.md](SETUP-MAC.md). About an hour.
- **Windows:** [SETUP-WINDOWS.md](SETUP-WINDOWS.md). Cursor connected to WSL2 (Ubuntu). About an hour and a half, with one restart. A Windows-only option is at the end.
- **Linux:** follow the Windows guide from Part 2 (skip WSL), with Docker Engine (`curl -fsSL https://get.docker.com | sh`) instead of Docker Desktop.

Both end in the same place: `/vibekit:health live` all green.
