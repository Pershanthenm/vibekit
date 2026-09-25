---
name: new-feature
description: Add one feature mid-project, sized and slotted, without a new planning pile
argument-hint: "<what it should do>"
---

Take the user's words verbatim as the title: `vibekit new feature "$ARGUMENTS"`; with no words, ask for one sentence. Then open the new requirement file it names and write EARS acceptance criteria (one trigger, one response, each with an id), size, source and entities — the entities must already be in product/entities.md; if one is missing, write an ask with `vibekit ask … --plain … --option …` rather than inventing it. Where the criteria could go two ways, ask with the alternatives as options before writing them. Finish with `vibekit req ready <id>` and report what it refused, if anything. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
