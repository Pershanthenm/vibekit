---
name: new-sprint
description: Begin the next sprint in the plan; the finished one closes at its gate
argument-hint: [--by "<name>"]
---

Run `vibekit new sprint $ARGUMENTS`. It refuses until the plan is approved and until every row of the previous sprint's gate is true; a person's name goes on the gate. If it refused, read the refusal back verbatim and offer what a person can do about each row as options: "Approve the plan" (`/vibekit:answer`), "Show the plan" (`/vibekit:show-plan`), "Leave it". If it needs a name, offer the git user.name first. If it started a sprint, say which, then offer `/vibekit:run-sprint` to hand out the first work. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
