---
name: build
description: Stage 5; implement the requirement you hold
argument-hint: [REQ-id]
---

You hold exactly one requirement. With an id: `vibekit start $ARGUMENTS --as implementer`. Without one, run `vibekit req list` and ask which ready requirement to take, one option each with its title and size, the one `vibekit run` would hand out first. Read vibekit/workflow/stages/5-build.md and follow it: approach first, failing tests per criterion, code, `vibekit verify`, `vibekit req checkpoint` after every step, `vibekit req tested`. When the folder lacks something, write a proposal (`vibekit ask … --plain … --option …`) and stop — never invent an entity, field, package or path. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
