# Setting up the GitHub repository

Everything to paste into GitHub when you publish the team kit, and the settings worth turning on. On Azure DevOps, see the note at the end.

## 1. Create the repository

- **Name:** `vibe-check-cli`
- **Visibility:** **Private** is the safe default. The kit holds your team's skills and runs on every developer's machine.
- Push the folder:
  ```text
  Make ~/tools/vibe-check-cli a git repository on branch main, commit everything, add https://github.com/YOUR-ORG/vibe-check-cli as origin, and push.
  ```
- Then replace `TEAM-REPO-URL` in `README.md` and `ONBOARDING.md` with the repository's address, and push again.

## 2. The "About" box

On the repository page, click the gear next to **About**.

**Description** (under GitHub's 350-character limit):

> Spec-driven, multi-agent development for Claude Code and Cursor. Claude leads, Claude and Cursor subagents build in parallel, and every change is traced to a spec and proven by tests, smoke and UI checks. One team kit: same skills, subagents and guardrails on every machine.

Shorter alternative:

> A Claude Code plugin and team kit: specs first, parallel Claude and Cursor subagents, and proof-before-done quality gates.

**Website:** the onboarding guide, `https://github.com/YOUR-ORG/vibe-check-cli/blob/main/ONBOARDING.md`

**Topics:**

```text
claude-code  claude-code-plugin  cursor  ai-agents  multi-agent  subagents  agentic-coding
spec-driven-development  developer-tools  developer-experience  tdd  code-quality  devsecops
```

**Social preview** (Settings → General → Social preview, 1280 × 640): a plain card with the name **Vibe-check-cli** and the line "Specs first. Agents in parallel. Proof before done."

## 3. Settings worth turning on

Every change to this repository reaches every developer's machine on their next update, so protect it like production code.

1. **Protect `main`** (Settings → Rules → Rulesets → New branch ruleset, target `main`):
   - Require a pull request before merging, with at least **1 approval**.
   - Require status checks to pass, and pick **tests** (from the workflow below).
   - Block force pushes and deletions.
2. **Code owners for the kit.** Create `.github/CODEOWNERS` so changes to the team kit and the plugin need a lead's review. Replace the team name with a real GitHub team or usernames:
   ```text
   /team/     @YOUR-ORG/leads
   /plugin/   @YOUR-ORG/leads
   ```
   Then tick **Require review from Code Owners** in the ruleset.
3. **Security** (Settings → Code security): turn on **Secret scanning** and **Push protection**.
4. **Access** (Settings → Collaborators and teams): give developers **Read**, and leads **Write** or **Maintain**. Developers only need to clone and pull.

## 4. Continuous integration

`.github/workflows/tests.yml` is already in the kit. On every pull request and every push to `main`, it runs the 323 integration tests and Claude Code's own plugin validator. If you use the ruleset above, pick the **tests** check as required.

## 5. First release

Releases → **Draft a new release**, tag `v0.2.0-beta`, target `main`, and tick **Set as a pre-release**.

**Title:** Vibe-check-cli 0.2.0-beta

**Notes:**

```markdown
First team release.

- Spec-driven workflow for Claude Code: menus for new projects, specs with acceptance criteria, plans, parallel builds, review, sign-off.
- Four built-in subagents (architect, test-engineer, implementer, reviewer) for Claude Code and Cursor, plus the team's own.
- Team kit with a curated Everything Claude Code selection (17 skills, 2 agents, 4 commands as skills); about 2,200 tokens of always-on context.
- Quality gates: acceptance criteria traced to tests; tests, smoke and UI evidence per commit; living docs; security baseline.
- One-command onboarding for Windows (PowerShell), macOS and Linux; `/vibe-check-cli:setup` and `/vibe-check-cli:health`.

Setup: see ONBOARDING.md.
```

Developers don't need to download anything from the release page: they install by cloning, as ONBOARDING.md describes. The release marks a known-good version you can point back to.

## 6. Choose a licence

The kit has no licence yet, and choosing one is your organisation's decision. Common choices:
- **Private, internal only:** leave it unlicensed (all rights reserved), or add your company's standard internal notice.
- **Open source:** MIT or Apache-2.0 are the usual picks.

Whatever you choose, keep `team/THIRD_PARTY_NOTICES.md`: the Everything Claude Code pieces are MIT-licensed, and that licence requires its notice to stay with them.

## Azure DevOps instead of GitHub

- The repository address looks like `https://dev.azure.com/YOUR-ORG/YOUR-PROJECT/_git/vibe-check-cli` (no `.git` at the end). Use that for `TEAM-REPO-URL`.
- Protect `main` with **branch policies**: minimum reviewers 1, a build validation that runs `cd plugin && npm test`, and required reviewers for `/team` and `/plugin` paths.
- Git for Windows includes Git Credential Manager, so developers sign in through the browser on first clone.
