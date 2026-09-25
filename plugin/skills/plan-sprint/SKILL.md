---
name: plan-sprint
description: Order the open sprint's work; what runs in which lane and why
---

Run `vibekit plan sprint`. It prints the open sprint's requirements, their sizes, dependencies and lanes. Read it back in plain words: what runs first, what is blocked on what, what a person still owes. If no sprint is open it says so; offer `/vibekit:new-sprint` to open the next one once the plan is approved. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
