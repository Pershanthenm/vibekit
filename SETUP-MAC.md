# Setting up VibeKit on a Mac, all inside Cursor

Everything runs from **Cursor**: the Claude Code panel is your lead, and Cursor's built-in terminal handles the few commands. The only other app is **Docker Desktop**, which runs quietly in the background. Plan on about an hour the first time.

**You'll need**
- macOS 14 (Sonoma) or newer
- A Claude account that can use Claude Code (a paid plan or API access)
- A Cursor account
- An admin account on the Mac, and about 15 GB free

**Your Cursor layout**

| Where in Cursor | What it's for |
|---|---|
| Claude Code panel (Spark icon in the sidebar) | Talking to the lead: every `/vibekit:` command |
| Terminal (View → Terminal, or ⌃`) | The one-time bootstrap and the odd command that needs your password |
| Cursor's own Agent chat and Agents window | Cursor agents, when you choose to open lanes yourself |

---

## Part 1 — Two apps (once)

1. **Cursor:** download it from cursor.com, drag it to Applications, open it and sign in.
2. **Docker Desktop:** download it from docker.com (pick Apple silicon or Intel), open it once, accept the terms, and wait until the whale icon in the menu bar says it's running.

Everything from here on happens in Cursor.

---

## Part 2 — Claude Code in Cursor (once)

1. In Cursor, open Extensions (⌘⇧X), search **Claude Code**, and install Anthropic's extension.
2. Click the Spark icon in the sidebar to open the Claude Code panel, and sign in when it asks.

The extension brings its own copy of Claude Code, and it shares settings, plugins and hooks with the command-line version, which is what the next step installs.

---

## Part 3 — Bootstrap from Cursor's terminal (once)

Open Cursor's terminal (View → Terminal, or ⌃`) and run these blocks one at a time.

**Apple's developer tools** (this gives you git; accept the window that pops up and wait for it to finish):

```bash
xcode-select --install
```

**Put VibeKit somewhere permanent** (don't move it later: the plugin is installed from here):

```bash
mkdir -p ~/tools && unzip ~/Downloads/vibekit.zip -d ~/tools
```

**Install the essentials:**

```bash
bash ~/tools/vibekit/plugin/scripts/bootstrap.sh --minimal
```

This installs Node.js if needed, then the `vibekit` command, then offers exactly two installs. Say yes to both:
- **Claude Code's command-line version**, which the plugin commands and background Claude agents use.
- **The VibeKit plugin.**

**Load the plugin:** in the Claude panel type `/reload-plugins`, or reload Cursor (⌘⇧P → **Developer: Reload Window**).

---

## Doing it all from Claude

Already in a Claude Code session, with the zip unzipped to `~/tools/vibekit`? Paste this as your message:

```text
Set up VibeKit for me: run `bash ~/tools/vibekit/plugin/scripts/bootstrap.sh --minimal --yes` (it can take a few minutes; allow a long timeout) and tell me what happened.
```

Approve the command when Claude asks. Then type `/reload-plugins`, and continue with `/vibekit:setup` and `vibekit health --live`. The only steps Claude can't do for you are the ones that need a password or a browser sign-in; it tells you which, and you run those in a terminal.

Use this rather than typing `/plugin marketplace add` with a local folder: a known Claude Code issue can install local-folder plugins without their commands.

---

## Part 4 — The rest, from the Claude panel

In the Claude Code panel:

```text
/vibekit:setup
```

Claude checks what's missing and shows a menu of what it will install. Tick what you want (everything is recommended):

| Item | What it is | Required? |
|---|---|---|
| Docker | Container scans and Testcontainers | Yes |
| Cursor CLI | Lets Claude start background Cursor agents | Yes |
| agentmemory | Memory shared by Claude and Cursor, started in the background | Yes |
| agentmemory hooks | Captures sessions automatically in Claude Code and Cursor | Yes |
| OpenContext | Your cross-project knowledge library | If enabled |

Docker, the Cursor CLI and agentmemory are **installation requirements**, not
per-project extras. They used to be installed only when a project selected the matching engine or
memory provider, which meant picking one engine silently left you without the others until the
day you switched.

Claude runs each install and tells you how it went. If one stops to ask for your Mac password, Claude says so: paste that one command into Cursor's terminal instead.

**One sign-in only you can do.** In Cursor's terminal:

```bash
agent login
```

(This signs in Cursor's command-line agent, which is separate from the Cursor app.)

**Check everything.** In the panel:

```text
vibekit health --live
```

Claude runs the full check, including a few one-line test prompts to Claude and Cursor, and explains anything that isn't green, with the fix.

---

## Part 5 — Your preferences (recommended)

Just ask in the panel:

```text
Make dotnet-vue my preferred stack.
```

Claude runs `vibekit advise prefer dotnet-vue`. For your playbook, ask Claude to create a `playbook` folder in OpenContext with your `enterprise-dotnet-architect` standards; new projects read it first.

---

## Part 6 — Your first project

1. In Cursor: **File → Open Folder**, click **New Folder**, name it `laptop-tracker` (for example, inside a `projects` folder in your home), and open it.
2. In the Claude Code panel:

```text
/vibekit:new-project laptop asset management for our IT team
```

Claude sets up git, then asks its questions as menus in the panel: platform, constraints, architecture and security, the stack layer by layer, then security controls. At the end it commits the specs for you.

**Already have a codebase?** Skip the menus and run this in the terminal instead, inside the
repository:

```bash
vibekit adopt
```

It detects the stack from the manifests, writes `specs/project.json` marked `"origin": "adopted"`,
and produces as-is architecture and data-model docs plus `assessment/adopt.md`. Read that report's
**"Not determined"** section first: adopt never guesses, so anything it could not detect is listed
there rather than filled in with a plausible default. `vibekit check` will fail until you supply
a test command, which is deliberate.

---

## Part 7 — What your stack needs to build and test

These ask for your password or open installers, so use Cursor's terminal.

For .NET + MAUI (`brew` needs Homebrew; if you don't have it, install it first from brew.sh):

```bash
brew install --cask dotnet-sdk
dotnet workload install maui
```

- **Playwright browsers:** once the web app exists, ask Claude in the panel to "install the Playwright browsers".
- **iOS simulator:** install Xcode from the App Store, open it once, then `sudo xcodebuild -runFirstLaunch`.
- **Android emulator:** install Android Studio and create a device in its Device Manager.

The `foundation` feature wires these into the `test`, `smoke` and `ui` commands.

---

## Part 8 — Go

In the panel:

```text
/vibekit:run
```

Approve the foundation spec and plan when Claude asks. From then on it's always the same loop, inside Cursor:
1. Claude builds the shared groundwork.
2. Cursor and Claude agents take the parallel work, one lane each. Watch them on the live console.
3. Claude merges it, runs tests, smoke and UI, and moves the feature to In review.
4. You try it, then `vibekit status <id> done`.

---

## Every day, in Cursor

1. Check Docker is running (menu bar whale).
2. Open Cursor and your project. The Claude panel starts with the project's state and anything you signed off on the board.
3. `/vibekit:run` in the panel.

---

## Subagents in both Claude and Cursor

The same four specialists exist on both sides: **architect** (plans), **test-engineer** (tests first), **implementer** (one task at a time) and **reviewer** (read-only audit).

- **Claude Code:** they come with the plugin. Check with `claude plugin details vibekit@vibekit` ("Agents (4)").
- **Cursor:** the bootstrap puts them in your Cursor user folder (`~/.cursor/agents/`), and every project gets its own copy in `.cursor/agents/`. Cursor's Agent picks them automatically, or ask directly, e.g. "use the reviewer subagent to review feature 003". Reinstall any time with `vibekit cursor-agents`.

Both read your project's `AGENTS.md` first, so they follow the same architecture, standards, tests and security rules.

---

## Starting over

To remove every trace of VibeKit and install it fresh, download the latest `vibekit.zip` to **Downloads**, then paste into the Claude panel:

```text
Reset and reinstall VibeKit: run `rm -rf /tmp/vibekit-fresh && unzip -q ~/Downloads/vibekit.zip -d /tmp/vibekit-fresh && bash /tmp/vibekit-fresh/vibekit/plugin/scripts/reset.sh` with a long timeout (up to 10 minutes). Show me the "What Claude Code now has" part at the end.
```

It removes the plugin, its cached copy, the `vibekit` command, `~/tools/vibekit` and your saved preferences, then installs fresh. It leaves Claude Code, your sign-in, Cursor, your other plugins and your projects alone. Afterwards: `/reload-plugins`, then `/vibekit:setup`.

---

## If something's wrong

Ask in the panel first:

```text
vibekit health --live
```

| Symptom | Fix |
|---|---|
| `Unknown command: /vibekit:…` | Run `claude plugin list` in the terminal. Not listed: `claude plugin marketplace add "$HOME/tools/vibekit"` then `claude plugin install vibekit@vibekit`. Listed: type `/reload-plugins` (or restart Claude Code) |
| An install stops asking for a password | Run that one command in Cursor's terminal |
| `command not found` in Cursor's terminal | Close the terminal tab and open a new one |
| Docker won't start | Open Docker from Applications and wait for "running"; macOS 14+ is required |
| A feature bounced back from Done | Read the comment on the issue: it lists what's missing |

More detail: `GUIDE.md`
