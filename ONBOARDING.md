# Welcome: setting up your machine

This gets a new developer from a fresh machine to a working setup: Cursor with Claude Code, our team's VibeKit workflow, and the same skills and subagents as everyone else. It takes about 30 minutes, mostly waiting for downloads.

> **Lead:** replace `TEAM-REPO-URL` everywhere in this file with your team repository's address (for example `https://github.com/your-org/vibekit`, or for Azure DevOps `https://dev.azure.com/your-org/your-project/_git/vibekit`). The quickest way is to ask Claude: "In ONBOARDING.md, replace TEAM-REPO-URL with <address>, then commit and push."

**What you'll have at the end**

| Where | What |
|---|---|
| Cursor | Your editor, with the **Claude Code** panel as your lead developer |
| Claude Code | The VibeKit workflow (`/vibekit:run`, `/vibekit:new-project`, …), our team's skills and subagents, and hooks that keep every change tied to a spec |
| Cursor's own agent | The same subagents and team skills, in Cursor's format |

**Before you start, make sure you have:**
- A **Claude** account that can use Claude Code (your lead will tell you which).
- A **Cursor** account.
- **Access to the team repository** at `TEAM-REPO-URL` (your lead can add you).
- Admin rights on your machine.

Now follow the section for your operating system, then **Finish in Cursor**.

---

## Windows

### 1. Install Cursor

Download it from **cursor.com**, install, open it and sign in. (Or in PowerShell: `winget install Anysphere.Cursor`.)

Install **Docker Desktop** from docker.com. Docker is proposed on every machine by `vibekit setup`: container scans and Testcontainers need it.

### 2. Add Claude Code to Cursor

In Cursor, open **Extensions** (Ctrl+Shift+X), search **Claude Code**, and install the extension by **Anthropic**. Click the spark icon in the sidebar to open its panel, and sign in.

### 3. Get the team kit

Open Cursor's terminal (**View → Terminal**); on Windows it's PowerShell. First, Git (skip this if `git --version` already works):

```powershell
winget install --id Git.Git -e
```

**Close the terminal tab and open a new one** so it can see Git. Then:

```powershell
git clone TEAM-REPO-URL "$HOME\tools\vibekit"
powershell -ExecutionPolicy Bypass -File "$HOME\tools\vibekit\plugin\scripts\onboard.ps1" TEAM-REPO-URL
```

The first line downloads the kit. If Git asks you to sign in, a browser window opens for GitHub or Azure DevOps. The second line installs Node.js if needed, the `vibekit` command, the VibeKit plugin with our team's plugins, and the subagents and skills for Cursor. Windows may ask for permission to install Node.js; allow it.

`-ExecutionPolicy Bypass` lets that one script run without changing your computer's settings. Windows blocks scripts by default, so without it you'd see "running scripts is disabled on this system".

**If Node.js or Git were installed just now, close Cursor completely and reopen it.**

**Shared memory:** agentmemory needs WSL2, so on plain Windows it has no automatic install. `vibekit setup` lists it as a manual step and `vibekit health` keeps reporting it until you move to WSL2 or accept a standing red line. Everything else works the same. See `SETUP-WINDOWS.md`.

---

## Mac

### 1. Install Cursor

Download it from **cursor.com**, drag it to Applications, open it and sign in.

Install **Docker Desktop** from docker.com (macOS 14 or newer). Docker is proposed on every machine by `vibekit setup`: container scans and Testcontainers need it.

### 2. Add Claude Code to Cursor

In Cursor, open **Extensions** (⌘⇧X), search **Claude Code**, and install the extension by **Anthropic**. Click the spark icon in the sidebar to open its panel, and sign in.

### 3. Get the team kit

Open Cursor's terminal (**View → Terminal**). If `git --version` asks you to install Apple's developer tools, accept, wait for them to finish, then continue:

```bash
git clone TEAM-REPO-URL ~/tools/vibekit
bash ~/tools/vibekit/plugin/scripts/onboard.sh TEAM-REPO-URL
```

The first line downloads the kit (if Git asks you to sign in, follow the prompt). The second installs Node.js if needed, the `vibekit` command, the VibeKit plugin with our team's plugins, and the subagents and skills for Cursor.

---

## Linux

These steps are for Ubuntu and Debian; other distributions work the same with their own package manager.

### 1. Install the basics and Cursor

```bash
sudo apt update && sudo apt install -y git curl unzip build-essential
```

Download **Cursor** for Linux from **cursor.com**, install it, open it and sign in. Install Docker Engine (`curl -fsSL https://get.docker.com | sh`). Docker is proposed on every machine: container scans and Testcontainers need it.

### 2. Add Claude Code to Cursor

In Cursor, open **Extensions** (Ctrl+Shift+X), search **Claude Code**, and install the extension by **Anthropic**. Click the spark icon in the sidebar to open its panel, and sign in.

### 3. Get the team kit

In Cursor's terminal (**View → Terminal**):

```bash
git clone TEAM-REPO-URL ~/tools/vibekit
bash ~/tools/vibekit/plugin/scripts/onboard.sh TEAM-REPO-URL
```

If Node.js isn't installed, the script installs it with nvm, so it doesn't need your password.

---

## Finish in Cursor (every operating system)

1. **Load the plugin.** In the Claude Code panel, type:
   ```text
   /reload-plugins
   ```
   Type it in Cursor itself, not from the Claude app on your phone (Remote Control can't reload plugins). If the panel doesn't recognise it, reload Cursor: Command Palette → **Developer: Reload Window**.
2. **Install the rest from a menu:**
   ```text
   /vibekit:setup
   ```
   Tick what's offered. If a step needs your password or a browser sign-in, Claude hands it to you to run in Cursor's terminal.
3. **Sign in Cursor's command-line agent** (it's separate from the Cursor app), in Cursor's terminal:
   ```text
   agent login
   ```
4. **Check everything:**
   ```text
   vibekit health --live
   ```
   Every line should be ✔. Anything else comes with the exact fix.

### How to tell it worked

- Typing `/vibekit:` in the Claude panel lists the workflow commands and our team skills (for example `/vibekit:api-design`).
- In Cursor, **Customize → Skills** lists the team skills, and Cursor's agent can use the **architect**, **test-engineer**, **implementer** and **reviewer** subagents, plus the team's own.

---

## Your first project

1. Create a folder for it under **projects** in your home folder (`C:\Users\<you>\projects\<name>` on Windows, `~/projects/<name>` on Mac and Linux), and open it in Cursor (**File → Open Folder**).
2. In the Claude panel:
   ```text
   /vibekit:new-project <one line about what you're building>
   ```
   Claude sets up git and asks its questions as menus: platform, constraints, architecture, stack and security.

   Already have a codebase? Run `vibekit adopt` in it instead: it detects the stack from
   the manifests and writes as-is docs, leaving anything it cannot detect empty and listed
   under "Not determined" in `assessment/adopt.md` rather than guessing.
3. Then:
   ```text
   /vibekit:run
   ```
   Claude writes the spec and plan, and stops for your approval. After that it builds with the subagents, runs the tests, smoke tests and UI tests, and reviews the work.

Ask Claude "list my projects" at any time to see every VibeKit project on your machine, where it is and what's next.

---

## Keeping up to date

When the team kit changes, your lead will tell you. Then, in Cursor's terminal:

**Windows**
```powershell
git -C "$HOME\tools\vibekit" pull
powershell -ExecutionPolicy Bypass -File "$HOME\tools\vibekit\plugin\scripts\bootstrap.ps1" --minimal --yes
```

**Mac and Linux**
```bash
git -C ~/tools/vibekit pull
bash ~/tools/vibekit/plugin/scripts/bootstrap.sh --minimal --yes
```

Then `/reload-plugins` in the Claude panel. `vibekit health` also tells you when your copy is behind.

### If you develop the plugin itself

The commands above assume the usual team setup: a clone at `~/tools/vibekit` that you pull
from. If you are *working on* VibeKit, your marketplace probably points straight at your
working copy instead — check with:

```bash
claude plugin marketplace list
```

A source of `directory` means the plugin is installed **from that folder on disk**, so there is
nothing to pull; uninstalling and reinstalling picks up whatever is in the folder at that moment,
committed or not. Two things still matter:

1. **Run `npm run build` in `plugin/` first.** Skills and subagents under `plugin/skills/` and
   `plugin/agents/` are generated from `plugin/src/generators/`. A reinstall copies the generated
   files, not the generators, so an unbuilt change does not reach Claude Code.
2. **Bump `version` in `.claude-plugin/marketplace.json`** when the capabilities change. Claude
   Code caches the installed plugin per version, under
   `~/.claude/plugins/cache/vibekit/vibekit/<version>/`. Reusing a version number is
   how you end up staring at old behaviour and doubting a change that really did land.

## Starting over

If something gets tangled, this removes every trace of VibeKit and reinstalls it. It keeps Claude Code, your sign-ins, Cursor, your other plugins, and your projects.

**Windows**
```powershell
git -C "$HOME\tools\vibekit" pull
powershell -ExecutionPolicy Bypass -File "$HOME\tools\vibekit\plugin\scripts\reset.ps1"
```

**Mac and Linux**
```bash
git -C ~/tools/vibekit pull
bash ~/tools/vibekit/plugin/scripts/reset.sh
```

Then `/reload-plugins` and `/vibekit:setup`.

---

## Where things live

| What | Windows | Mac and Linux |
|---|---|---|
| The team kit | `C:\Users\<you>\tools\vibekit` | `~/tools/vibekit` |
| Your projects | `C:\Users\<you>\projects\` | `~/projects/` |
| Cursor's subagents | `C:\Users\<you>\.cursor\agents` | `~/.cursor/agents` |
| Cursor's team skills | `C:\Users\<you>\.cursor\skills\vibekit` | `~/.cursor/skills/vibekit` |
| Claude Code's copy of the plugin | managed by Claude Code (`claude plugin details vibekit@vibekit`) | same |

## If something's wrong

| What you see | What to do |
|---|---|
| "running scripts is disabled on this system" (Windows) | Run the script with `powershell -ExecutionPolicy Bypass -File "…"`, exactly as written above |
| `winget` isn't recognised (Windows) | Install **App Installer** from the Microsoft Store, or install Git and Node.js LTS from git-scm.com and nodejs.org |
| `git clone` asks for a password or says "not found" | You need access to `TEAM-REPO-URL`: ask your lead. On Windows, Git opens a browser to sign in |
| `git` or `node` not found right after installing | Close the terminal tab and open a new one; if Claude can't find them either, close Cursor completely and reopen it |
| `Unknown command: /vibekit:…` | Type `/reload-plugins` in Cursor itself (not from your phone). Still missing: in Cursor's terminal run `claude plugin list`; if VibeKit isn't there, rerun step 3 of your OS |
| A step needs your password (Mac, Linux) | Claude hands it to you: run that one command in Cursor's terminal |
| Anything else | `vibekit health --live` names the problem and the fix. Then ask your lead |

Maintaining the kit itself (adding skills, subagents, plugins or ECC pieces) is covered in `TEAM.md`.
