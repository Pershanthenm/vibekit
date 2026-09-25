---
name: new-project
description: Start a project here. Name it, describe it, say where it runs; the analyst's questions follow.
argument-hint: ["<name>"] [--import .]
---

Start a VibeKit project: `$ARGUMENTS`. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.

1. **Where.** Look at the folder first. If it already holds code and the words do not say `--import`, ask: "Read the code that is here" (recommended), "Start a new spec beside it", or "A new folder". For `--import` or "read the code": `vibekit new project --import . --yes`, then skip to step 5.
2. **Name.** Offer the folder name as the first option (recommended) and the words the user typed, if any, as the second. Other is free text.
3. **Where it runs.** One multi-select question: Web browser, iOS, Android, Desktop, API only, Command line, Something else. Ids: web, ios, android, desktop, api, cli, other.
4. **What it is.** Ask for a sentence or two, or the path to a requirements document; if the folder has a README or a docs/ file that describes the product, offer that file as the first option so the person does not have to type. Run `vibekit new project "<name>" --describe "<their words>" --platform <ids> --yes` (or `--from <file>`). If `vibekit` is not on PATH, say so and stop: the CLI is installed separately (`npm install -g vibekit`).
5. Read back what it printed in plain words: what was written and the Next line. Then ask one question: "Answer the analyst's first questions now" (recommended, runs `/vibekit:run-sprint` then `/vibekit:answer`), "Show me the folder first", or "Stop here".
