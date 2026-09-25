---
name: run-check
description: Check the folder; every rule the standards state, mechanically
---

Run `vibekit run check`. Read every finding back grouped by file, worst first, and say which are yours to fix and which need a person (a missing approval, an unanswered ask). Ask one question: "Fix mine now" (recommended), "Show me each one first", "Leave it". Fix the ones that are yours, run it again, and report the count before and after; hand the rest to `/vibekit:answer`. Do not silence a check by deleting the rule it enforces. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
