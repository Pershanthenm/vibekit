---
name: new-project
description: Start a project. Name, platforms, what it is; then the repository; then the analyst's first questions.
argument-hint: ["<name>"]
---

Do not read or explore anything first. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed.

**Screen 1**, one AskUserQuestion call, four questions:

1. **Project name.** Options: the current folder's name (recommended) and, if given, `$ARGUMENTS`. Other for their own.
2. **Where does it run?** Multi-select: Web browser (web), iOS (ios), Android (android), Desktop (desktop), API only (api), Command line (cli).
3. **What is it?** Options: "I'll describe it in a sentence" (Other: the sentence), "Build a requirements document with me" (recommended when they have nothing written: five plain questions after the folder exists), "I have a requirements document (BRS)" (Other: the file path). If they picked the first or last without text, ask once more for the sentence or the path.
4. **Where does the folder go?** Options: "This folder" (recommended), "A new folder in my projects folder" (the `projects-root` from `/vibekit:setup`, or beside this folder if none is set).

Run `vibekit new project "<name>" --where here|local --describe "<their words>" --platform <ids> --yes` (or `--from <path>`; for "build with me", pass `--describe "<one line from what they said>"` and, after this screen, run the `/vibekit:new-brs` flow in the project folder before screen 2). If `vibekit` is not on PATH, say so and stop (`npm install -g vibekit`).

**Screen 2**, one question, after the folder is written. Run `vibekit settings git-provider` first to know whether a provider is set.

- **Link it to a remote repository?** Options, in this order: "Create one at <provider> and push" (recommended; only when a provider is set; runs `vibekit new repo` in the project folder, which creates it, writes the pipeline file, pushes, and on Azure DevOps registers the pipeline), "Link a repository I already have" (Other: the URL; run `vibekit new repo --link <url>` in the project folder, which sets origin and writes the pipeline file for its host; say that `git push -u origin main` pushes it), "Set up my provider first" (only when none is set; `/vibekit:setup`, then `vibekit new repo`), "Not now" (`vibekit new repo` works any time).

Read back two sentences: what was written and where, and the repository URL if there is one.

**Screen 3**, one question: "Answer the analyst's first questions" (recommended: `/vibekit:run-sprint`, then `/vibekit:answer`) or "Stop here". Nothing else.
