---
name: vibekit.new-feature
description: Add one feature mid-project
---

Take the user's words verbatim as the title: `vibekit new feature "<text>"`. Then open the new requirement file it names and write EARS acceptance criteria (one trigger, one response, each with an id), size, source and entities — the entities must already be in product/entities.md; if one is missing, write an ask with `vibekit ask … --plain …` rather than inventing it. Finish with `vibekit req ready <id>` and report what it refused, if anything.
