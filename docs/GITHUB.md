# Setting up the GitHub repository

Everything to paste into GitHub when you publish the team kit, and the settings worth turning on. On Azure DevOps, see the note at the end.

## 1. Create the repository

- **Name:** `vibekit`
- **Visibility:** **Private** is the safe default. The kit holds your team's skills and runs on every developer's machine.
- Push the folder:
  ```text
  Make ~/tools/vibekit a git repository on branch main, commit everything, add https://github.com/YOUR-ORG/vibekit as origin, and push.
  ```
- Then replace `<this repository>` in `ONBOARDING.md` with the repository's address, and push again.

## 2. The "About" box

On the repository page, click the gear next to **About**.

**Description** (under GitHub's 350-character limit):

> Spec-driven development for coding agents, with a person deciding every question that matters. One folder in the repo that every agent reads; asks instead of guesses; gates a human closes; evidence from exit codes, not claims. A Claude Code plugin and a CLI with no runtime dependencies, for Claude Code, Cursor, Codex and any MCP client.

Shorter alternative:

> Requirements as the unit of work, an asks inbox for every human decision, sprints with human gates, and an MCP runner that enforces what agents may read, write and run.

**Website:** `https://pershanthenm.github.io/vibekit/`

**Topics:**

```text
claude-code  claude-code-plugin  cursor  ai-agents  multi-agent  subagents  agentic-coding
spec-driven-development  developer-tools  developer-experience  tdd  code-quality  devsecops
```

**Social preview** (Settings → General → Social preview, 1280 × 640): a plain card with the name **VibeKit** and the line "Specs first. Agents in parallel. Proof before done."

## 3. Settings worth turning on

Every change to this repository reaches every developer's machine on their next update, so protect it like production code.

1. **Protect `main`** (Settings → Rules → Rulesets → New branch ruleset, target `main`):
   - Require a pull request before merging, with at least **1 approval**.
   - Require status checks to pass, and pick **tests** (from the workflow below).
   - Block force pushes and deletions.
2. **Code owners for the kit.** Create `.github/CODEOWNERS` so changes to the team kit and the plugin need a lead's review. Replace the team name with a real GitHub team or usernames:
   ```text
   /plugin/   @YOUR-ORG/leads
   ```
   Then tick **Require review from Code Owners** in the ruleset.
3. **Security** (Settings → Code security): turn on **Secret scanning** and **Push protection**.
4. **Access** (Settings → Collaborators and teams): give developers **Read**, and leads **Write** or **Maintain**. Developers only need to clone and pull.

## 4. Continuous integration

`.github/workflows/tests.yml` is already in the kit. On every pull request and every push to `main`, it runs the suite on Windows, macOS and Linux, then the end-to-end simulation, the recovery fixture and the golden fixtures; runs the suite three more times on Windows and Ubuntu to catch flakes; and runs Claude Code's own plugin validator. If you use the ruleset above, pick the **tests** check as required.

## 5. First release

Releases → **Draft a new release**, tag `v0.1.0-alpha`, target `main`, and tick **Set as a pre-release**.

**Title:** VibeKit Alpha

**Notes:**

```markdown
First version. Alpha.

- Spec-driven development for coding agents: requirements with EARS criteria as the unit of work, an asks inbox for every human decision, sprints with human gates.
- Roles enforced mechanically: an MCP runner (`vibekit serve`) that enforces what agents may read, write and run, git hooks, a reviewer on a second model, evidence captured from exit codes.
- Bugs as requirements with verdicts, convergence at every gate, a security scan measured against named frameworks.
- A live tracker for the phone (`vibekit tracker <project>`: tunnel and QR code), behind Cloudflare Access for a team, where every decision is a commit.
- Outside knowledge that never weakens a guarantee: MCP servers consumed through an allow-list, skills imported with provenance, extensions that are data only, pinned, budgeted and signed.
- One CLI, no runtime dependencies, tested end to end on Windows, macOS and Linux.

Setup: see ONBOARDING.md.
```

Developers don't need to download anything from the release page: they install by cloning, as ONBOARDING.md describes. The release marks a known-good version you can point back to.

## 6. Choose a licence

The kit has no licence yet, and choosing one is your organisation's decision. Common choices:
- **Private, internal only:** leave it unlicensed (all rights reserved), or add your company's standard internal notice.
- **Open source:** MIT or Apache-2.0 are the usual picks.

`plugin/THIRD_PARTY_NOTICES.md` records what third-party content ships (currently none).

## Azure DevOps instead of GitHub

- The repository address looks like `https://dev.azure.com/YOUR-ORG/YOUR-PROJECT/_git/vibekit` (no `.git` at the end). Use that for `TEAM-REPO-URL`.
- Protect `main` with **branch policies**: minimum reviewers 1, a build validation that runs `cd plugin && npm test && npm run simulate && npm run recovery && npm run golden:check`, and required reviewers for the `/plugin` and `/spec` paths.
- Git for Windows includes Git Credential Manager, so developers sign in through the browser on first clone.
