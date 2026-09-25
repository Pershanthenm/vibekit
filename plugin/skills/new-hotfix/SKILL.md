---
name: new-hotfix
description: Production is broken; an S requirement on hotfix/*, compliance pass, patch release
argument-hint: "<what is broken>"
---

`vibekit new hotfix "$ARGUMENTS"` opens an S requirement on hotfix/*; with no words, ask for one sentence on what is broken. Write its criterion as the absence of the defect, name the failing test that exposes it (`vibekit bug assess <id> --test <path> --cause "…"`; offer the likely test files as options or write one), then `vibekit bug fix <id>`, the repair, `vibekit verify`, `vibekit bug test <id>`. The verdict is one word and a person closes it; offer "Set done" and "Send it back" as the two choices. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
