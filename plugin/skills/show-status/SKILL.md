---
name: show-status
description: Where the project is and what needs you
---

Run `vibekit show project` and, if anything is waiting on a person, `vibekit show status`. Read the output back in plain words: what is in progress, what is blocked and on whom, what is next. Then ask one question with only the options that apply: "Answer what is waiting" (`/vibekit:answer`), "Start the next work" (`/vibekit:run-sprint`), "Switch project" (`/vibekit:use-project`, when more than one project is listed), "Just looking". Do not start work from here. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
