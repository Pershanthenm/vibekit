---
name: use-project
description: Pick the project to work on from the ones on this machine
argument-hint: [name]
---

Run `vibekit show --all --json`: every project on this machine with its mark, name, where it is and what needs a person. If the words `$ARGUMENTS` name one, use it. Otherwise ask, one option per project, labelled by name with the "line" as the description; the current one first; if there are none, the projects folder from `/vibekit:setup` has already been scanned, so offer `/vibekit:setup` if it was never run and `/vibekit:new-project` otherwise. Then `vibekit use project "<name>"`. Everything after applies to that project until they switch again. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
