---
name: plan-project
description: Stage 4; the sprints in dependency order and the gate that approves them
---

Run `vibekit plan project`. If it says the project is at an earlier stage, read that back and offer the one thing that moves it: `/vibekit:answer` for a waiting approval, `/vibekit:run-sprint` for work an agent can do. Otherwise read vibekit/workflow/stages/4-plan.md and follow it: every requirement into a sprint, dependencies before dependants, sprint 0 the walking skeleton, and workflow/plan.md written for a person to approve. When the plan is written, show it and ask: "Approve it" (`vibekit plan project --approve --by "<name>"`, offer git user.name first), "Change the order" (ask which requirement moves where, as options), "Later". You do not approve it yourself. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
