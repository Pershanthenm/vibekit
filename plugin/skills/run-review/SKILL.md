---
name: run-review
description: Stage 6; review as a second pair of eyes
argument-hint: [REQ-id]
---

Run `vibekit run review $ARGUMENTS` for the mechanical half. With no id and more than one requirement waiting, ask which to review, one option each with its title. Then read vibekit/workflow/stages/6-test.md for the judgement half. Map every criterion to a named test in ## Verification, run the suite, read the diff against standards/, write the verdict in ## Review. You cannot write application code; a finding goes back to the implementer. At the end, offer the person: "Set done" (`vibekit req done <id> --by "<name>"`), "Send it back", "Show me the review". Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
