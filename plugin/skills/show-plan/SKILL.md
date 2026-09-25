---
name: show-plan
description: The plan; sprints, pieces of work, pace and what is not yet approved
---

Run `vibekit show plan` (add `--cost` if the user asks about spend). Read it back in plain words: which sprints exist, what is in each, what is done, and whether the plan is approved. Change nothing; if it is not approved, offer `/vibekit:answer` to approve it. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
