---
name: new-project
description: Start a project here. Three questions, then the folder is written.
argument-hint: ["<name>"]
---

Do not read or explore anything first. Ask three questions in one AskUserQuestion call:

1. **Project name.** Options: the current folder's name (recommended) and, if given, `$ARGUMENTS`. Other for their own.
2. **Platforms**, multi-select: Web browser (web), iOS (ios), Android (android), Desktop (desktop), API only (api), Command line (cli).
3. **What is it?** Options: "I'll describe it" and "I have a requirements document (BRS)". Either way the text they give under Other is the answer; if they only picked an option, ask once more for the sentence or the file path.

Then one command, in the current folder: `vibekit new project "<name>" --describe "<their words>" --platform <ids> --yes`, or `--from <path>` for a document. If `vibekit` is not on PATH, say so and stop (`npm install -g vibekit`).

Read back its last lines in two sentences: what was written and what comes next. Then offer: "Answer the analyst's first questions" (`/vibekit:run-sprint`, then `/vibekit:answer`) or "Stop here". Nothing else.
