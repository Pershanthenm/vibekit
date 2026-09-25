---
name: new-bug
description: Log a defect as a requirement with its failing test; assess, fix, verify
argument-hint: "<what is wrong>" [--test <path>] [--severity high|medium|low]
---

A bug is a requirement whose criterion is the absence of the defect. Words: `$ARGUMENTS`. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.

1. **Severity**, if not given: ask with High ("enters the sprint now and blocks its gate"), Medium, Low.
2. **The failing test**, if not given: look at the test folders and offer the likely files as options, plus "Write one for me" (you write a failing test that exposes the defect, then use its path).
3. `vibekit new bug "<words>" --test <path> --severity <level>`, then follow the three steps it prints: `vibekit bug assess <id> --cause "…"` once you have read the code and can name the cause, `vibekit bug fix <id>` to start the repair on its branch, the repair, `vibekit verify`, `vibekit bug test <id>`. The verdict is one word and a person closes it with `vibekit req done`; offer that as a choice at the end.
