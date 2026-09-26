---
name: new-project
description: Start a project. Say what you are building; pick the answers that shape it; then the repository.
argument-hint: ["<name>"]
---

Do not read or explore anything first. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed. The CLI does the asking; you relay its questions as pickers and pass back the number.

**Screen 1**, one AskUserQuestion call, three questions:

1. **What are you building?** Options: "I'll say it in a sentence" (Other: the sentence), "Build a requirements document with me" (recommended when they have nothing written; ask for one line anyway so the folder has a description), "I have a requirements document" (Other: the file path).
2. **Project name.** Options: the current folder's name (recommended) and, if given, `$ARGUMENTS`. Other for their own.
3. **Where does the folder go?** Options: "This folder" (recommended), "A new folder in my projects folder" (the `projects-root` from `/vibekit:setup`, or beside this folder if none is set; named after the project).

Then start it. Run, in the current folder:

```
vibekit "<their sentence>" --name "<name>" --where here|local
```

or `vibekit --from "<path>" --name "<name>" --where here|local` for a document. Inside Claude Code the CLI is in agent mode: it sets up every coding tool it finds, reports that in a few lines, and prints **one question at a time** as Markdown, each with numbered options and "I don't know". If `vibekit` is not on PATH, say so and stop (`npm install -g vibekit`).

**The shape questions.** For each question the CLI prints, ask it with AskUserQuestion: the question as the question, its consequence as the description, its options as the options, and "I don't know" as the last option. Pass the pick back as its number: `vibekit <number>` (run it in the project folder: `--dir` if the folder is not the current one). Other is their own words: `vibekit "<their words>"`. Do not answer for them, do not skip one, do not batch them: one question, one pick, one command, until the CLI says it has everything it needs.

**If they chose "build a requirements document with me"**, now run the `/vibekit:new-spec` flow in the project folder.

**The repository**, one question. Run `vibekit settings git-provider` first to know whether a provider is set. Ask: "Create one at <provider> and push" (recommended; only when a provider is set; `vibekit new repo`), "Link a repository I already have" (Other: the URL; `vibekit new repo --link <url>`, then say `git push -u origin main` pushes it), "Set up my provider first" (only when none is set; `/vibekit:setup`), "Not now" (`vibekit new repo` works any time).

Finish in two sentences: what was written and where, the repository if there is one, and that the analyst continues from their answers. Offer: "Answer what's waiting" (`/vibekit:answer`), "Start the first work" (`/vibekit:run-sprint`), or "Stop here". Nothing else.
