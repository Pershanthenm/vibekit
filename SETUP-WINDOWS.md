# Setting up VibeKit on Windows, all inside Cursor

Everything runs from **Cursor**: the Claude Code panel is your lead, and Cursor's built-in terminal handles the few commands. Two things sit outside Cursor: **Docker Desktop**, which runs quietly in the background, and a one-time Windows feature install with a restart. Plan on about an hour and a half.

**How it fits together.** Cursor runs on Windows but connects into **WSL2**, a Linux environment built into Windows. Claude Code, the VibeKit plugin, Cursor's command-line agent, agentmemory and your projects all live in there. Once connected, Cursor's terminal *is* Linux, and it feels like one machine. This is the setup the tools work best in (agentmemory needs it). A Windows-only option is at the end.

**You'll need**
- Windows 11, or Windows 10 22H2, with virtualization enabled (usually already on)
- A Claude account that can use Claude Code (a paid plan or API access)
- A Cursor account
- Admin rights, and about 20 GB free

**Your Cursor layout**

| Where in Cursor | What it's for |
|---|---|
| Claude Code panel (Spark icon in the sidebar) | Talking to the lead: every `/vibekit:` command |
| Terminal (View → Terminal, or Ctrl+`) | The one-time bootstrap and the odd command that needs your password |
| Bottom-left corner | Shows **WSL: Ubuntu** when you're connected; always check it's there |

---

## Part 1 — Windows side (once)

### 1. Cursor and Docker Desktop

1. **Cursor:** download it from cursor.com, install it, open it and sign in.
2. **Docker Desktop:** download it from docker.com and install it. Open it and accept the terms. Then:
   - **Settings → General:** make sure **Use the WSL 2 based engine** is on.
   - After step 2 below, come back to **Settings → Resources → WSL integration**, switch on **Ubuntu**, and click **Apply & restart**.

### 2. Turn on WSL2, from Cursor's terminal

In Cursor, open the terminal (View → Terminal). It's PowerShell for now. Run:

```powershell
wsl --install -d Ubuntu
```

Windows asks for administrator permission; allow it. When it finishes, **restart your PC**.

After the restart, an Ubuntu window opens once to create your Linux username and password. This is the only time you'll use it. Remember the password: installs ask for it. Then close the window.

Now finish the Docker step above (**WSL integration → Ubuntu**).

---

## Part 2 — Connect Cursor to Linux (once)

1. In Cursor, open Extensions (Ctrl+Shift+X), search **WSL**, and install it.
2. Click the **><** button in the bottom-left corner and choose **Connect to WSL** (or **Connect to WSL using Distro… → Ubuntu**). Cursor reopens with **WSL: Ubuntu** in the bottom-left.
3. In this connected window, open Extensions again, search **Claude Code**, and install Anthropic's extension. If it offers **Install in WSL: Ubuntu**, choose that: the extension has to live on the Linux side, next to the plugin.
4. Click the Spark icon to open the Claude Code panel, and sign in when it asks.

From now on, always work in a window that shows **WSL: Ubuntu**. **File → Open Recent** remembers connected projects.

---

## Part 3 — Bootstrap from Cursor's terminal (once)

Open Cursor's terminal (Ctrl+`). In the connected window it's an Ubuntu terminal. Run these blocks one at a time.

**Basics** (asks for your Linux password):

```bash
sudo apt update && sudo apt install -y git curl unzip build-essential
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**Put VibeKit somewhere permanent, on the Linux side.** Your C: drive appears as `/mnt/c`. Replace `YourWindowsName` with your Windows user folder name:

```bash
mkdir -p ~/tools && unzip /mnt/c/Users/YourWindowsName/Downloads/vibekit.zip -d ~/tools
```

Keep tools and projects in your Linux home (`~`), never under `/mnt/c`: it's slow, and git thinks every file changed. Don't move this folder later, because the plugin is installed from it.

**Install the essentials:**

```bash
bash ~/tools/vibekit/plugin/scripts/bootstrap.sh --minimal
```

This installs Node.js if needed, then the `vibekit` command, then offers exactly two installs. Say yes to both:
- **Claude Code's command-line version**, which the plugin commands and background Claude agents use.
- **The VibeKit plugin.**

**Load the plugin:** in the Claude panel type `/reload-plugins`, or reload Cursor (Ctrl+Shift+P → **Developer: Reload Window**). Check the bottom-left still says **WSL: Ubuntu**.

---

## Doing it all from Claude

Already in a Claude Code session, with the zip unzipped to `~/tools/vibekit`? Paste this as your message:

```text
Set up VibeKit for me: run `bash ~/tools/vibekit/plugin/scripts/bootstrap.sh --minimal --yes` (it can take a few minutes; allow a long timeout) and tell me what happened.
```

Approve the command when Claude asks. Then type `/reload-plugins`, and continue with `/vibekit:setup` and `/vibekit:health live`. The only steps Claude can't do for you are the ones that need a password or a browser sign-in; it tells you which, and you run those in a terminal.

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

If an install stops to ask for your Linux password, Claude says so: paste that one command into Cursor's terminal instead.

**One sign-in only you can do.** In Cursor's terminal:

```bash
agent login
```

(This signs in Cursor's command-line agent, which is separate from the Cursor app. If it prints a link, open it in your Windows browser.)

**Check everything.** In the panel:

```text
/vibekit:health live
```

Claude runs the full check, including a few one-line test prompts to Claude and Cursor, and explains anything that isn't green, with the fix.

---

## Part 5 — Your preferences (recommended)

Just ask in the panel:

```text
Make dotnet-vue my preferred stack.
```

For your playbook, ask Claude to create a `playbook` folder in OpenContext with your `enterprise-dotnet-architect` standards; new projects read it first.

---

## Part 6 — Your first project

1. In the connected Cursor window: **File → Open Folder**. The dialog shows the Linux file system: go to `/home/<your-linux-name>/`, create a `projects` folder and inside it `laptop-tracker`, and open that.
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

In Cursor's terminal (asks for your Linux password):

```bash
sudo add-apt-repository -y ppa:dotnet/backports
sudo apt update && sudo apt install -y dotnet-sdk-9.0
```

- **Playwright browsers:** once the web app exists, ask Claude in the panel to "install the Playwright browsers with their Linux dependencies".
- **Mobile (.NET MAUI) is the exception.** MAUI builds and emulators don't run inside WSL. Build and run the mobile app's UI tests on the Windows side, in Visual Studio 2022 with the **.NET Multi-platform App UI** workload (it includes the Android emulator); iOS builds need a Mac. Ask Claude to route lanes touching the mobile project to `"engine": "manual"`, so you handle them from Windows.

The `foundation` feature wires the rest into the `test`, `smoke` and `ui` commands.

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

1. Check Docker Desktop is running (system tray).
2. Open Cursor → **File → Open Recent** → your project (it reconnects to **WSL: Ubuntu**).
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
Reset and reinstall VibeKit. In PowerShell: Expand-Archive "$HOME\Downloads\vibekit.zip" -DestinationPath "$env:TEMP\vibekit-fresh" -Force, then run powershell -ExecutionPolicy Bypass -File "$env:TEMP\vibekit-fresh\vibekit\plugin\scripts\reset.ps1" with a long timeout (up to 10 minutes). Show me the "What Claude Code now has" part at the end.
```

It removes the plugin, its cached copy, the `vibekit` command, `~\tools\vibekit` and your saved preferences, then installs fresh. It leaves Claude Code, your sign-in, Cursor, your other plugins and your projects alone. Afterwards: `/reload-plugins` (or fully restart Cursor), then `/vibekit:setup`.

---

## If something's wrong

Ask in the panel first:

```text
/vibekit:health live
```

| Symptom | Fix |
|---|---|
| Bottom-left doesn't say **WSL: Ubuntu** | Click **><** → **Connect to WSL**, then reopen your project |
| `Unknown command: /vibekit:…` | Run `claude plugin list` in the terminal. Not listed: `claude plugin marketplace add "$HOME/tools/vibekit"` then `claude plugin install vibekit@vibekit`. Listed: type `/reload-plugins` (or reload the WSL-connected Cursor window) |
| `wsl --install` fails or mentions virtualization | Enable virtualization (Intel VT-x / AMD-V) in your BIOS, then retry |
| `docker: command not found` in Cursor's terminal | Docker Desktop → Settings → Resources → WSL integration → Ubuntu on → Apply & restart |
| An install stops asking for a password | Run that one command in Cursor's terminal |
| Git shows every file as changed | The project is under `/mnt/c`; move it into `~/projects` |
| A feature bounced back from Done | Read the comment on the issue: it lists what's missing |

---

## Claude extension in Cursor on Windows, without WSL

If Claude in your Cursor panel runs commands in **PowerShell**, this is your setup. It works fully except shared memory: agentmemory needs WSL2, so memory stays off.

1. Download `vibekit.zip` to your **Downloads** folder.
2. In the Claude Code panel in Cursor, paste:

```text
Set up VibeKit on this Windows machine. In PowerShell: Expand-Archive "$HOME\Downloads\vibekit.zip" -DestinationPath "$HOME\tools" -Force, then run powershell -ExecutionPolicy Bypass -File "$HOME\tools\vibekit\plugin\scripts\bootstrap.ps1" --minimal --yes with a long timeout (up to 10 minutes). Tell me what happened.
```

3. Approve the commands when Claude asks. If Windows asks for permission to install Node.js, allow it.
4. Load the plugin: type `/reload-plugins` in the panel. If the panel doesn't know that command, or Node.js was installed in step 3, **close Cursor completely and reopen it**.
5. Type `/vibekit:` in the panel: you should see 14 commands. Run `/vibekit:setup`, then `/vibekit:health live`.

**Where your projects live:** create them under `C:\Users\<you>\projects\`, one folder each. Ask Claude "list my projects" (it runs `vibekit projects`) to see every VibeKit project on this machine, where it is and what's next.

**Same setup for the whole team:** see [TEAM.md](TEAM.md).

When you create a project, choose **no agentmemory** in the context tools question, or ask Claude afterwards to set `"memory": { "provider": "none" }` and run `vibekit sync`. Everything else in Parts 5 to 9 works the same, with PowerShell instead of the Ubuntu terminal.

More detail: `GUIDE.md`
