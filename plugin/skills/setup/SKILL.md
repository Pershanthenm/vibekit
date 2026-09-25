---
name: setup
description: One-time setup after installing the plugin; where your projects live, who you are, where the repositories are
---

Run this once after installing the plugin. Do not read or explore anything first. Ask four questions in one AskUserQuestion call:

1. **Where do your projects live?** Options: the parent of the current folder (recommended; give its full path as the label), `~/Projects`. Other for another path. New projects are created here and existing ones are found here.
2. **Your name**, as it goes on approvals and gates. Options: the git user.name (run `git config user.name` first; recommended). Other for another.
3. **Where are your repositories?** Options: GitHub, Azure DevOps, GitLab, None yet.
4. **Organisation or account URL at that provider.** Options: "Skip for now". Other for the URL, such as `https://dev.azure.com/acme` or `https://github.com/acme`.

Then write them, one command each, skipping what they skipped:

```
vibekit settings projects-root "<absolute path>"
vibekit settings name "<name>"
vibekit settings git-provider github|azure-devops|gitlab|none
vibekit settings git-org "<url>"
vibekit project select --rescan "<projects-root>"
```

If they chose a provider, ask one more question: **the token**. Options: "I'll paste it here" (Other: the token; a personal access token with repository create and write, and on Azure DevOps also project create and build) and "I'll set it in a terminal myself" (`vibekit settings git-token "<token>"`). Write it with `vibekit settings git-token "<token>"`; never repeat it back. Then `vibekit new repo --check` and read back whose account it is.

Read back `vibekit settings` in three lines: where projects go, who approves, where the repositories are, and how many projects the rescan found. Then offer: "Start a project" (`/vibekit:new-project`), "Pick one I already have" (`/vibekit:use-project`), or "Done". If `vibekit` is not on PATH, say so and stop (`npm install -g vibekit`).
