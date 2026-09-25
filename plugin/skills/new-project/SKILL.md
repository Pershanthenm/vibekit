---
name: new-project
description: Start a project. Four questions on one screen, then the folder is written.
argument-hint: ["<name>"]
---

Do not read or explore anything first. Ask four questions in one AskUserQuestion call:

1. **Project name.** Options: the current folder's name (recommended) and, if given, `$ARGUMENTS`. Other for their own.
2. **Where it lives.** Options: "This folder" (recommended), "A new folder in my projects folder" (the `projects-root` from `/vibekit:setup`, or beside this folder if none is set; named after the project), "A repository I already created at my provider" (they paste the URL under Other; `vibekit settings git-org` is where they usually are).
3. **Platforms**, multi-select: Web browser (web), iOS (ios), Android (android), Desktop (desktop), API only (api), Command line (cli).
4. **What is it?** Options: "I'll describe it" and "I have a requirements document (BRS)". Either way the text they give under Other is the answer; if they only picked an option, ask once more for the sentence or the file path.

Then one command: `vibekit new project "<name>" --where here|local --describe "<their words>" --platform <ids> --yes`, or `--from <path>` for a document. It runs `git init` itself when there is no repository. For a remote URL, use `--where here` and then `git remote add origin <url>` in the project folder. If `vibekit` is not on PATH, say so and stop (`npm install -g vibekit`).

Read back its last lines in two sentences: what was written, where, and what comes next. Then offer: "Answer the analyst's first questions" (`/vibekit:run-sprint`, then `/vibekit:answer`) or "Stop here". Nothing else.
