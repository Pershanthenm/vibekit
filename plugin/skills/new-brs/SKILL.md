---
name: new-brs
description: No requirements document? Five questions with suggested answers to pick from become one, and the analyst starts from it
---

For a project that has no requirements document. Do not read or explore anything first. Run `vibekit new brs --suggest --json`: for each of the five questions it gives the suggestions to offer, half drawn from the project's own description. Choices go through the AskUserQuestion tool: the person picks, and types only what no suggestion covered. Add two or three suggestions of your own to each list when the description makes them obvious, in the same plain words; keep the person's description as the first answer to question 1.

**Screen 1**, one AskUserQuestion call, three questions:

1. **What is it, and who is it for?** First option: the project description. Other for a better sentence.
2. **What should people be able to do with it?** Multi-select from the suggestions. Other adds their own, separated by ";".
3. **What must never happen?** Multi-select from the suggestions; Other adds their own.

**Screen 2**, one call, two questions:

4. **Any hard limits, or things it must connect to?** Multi-select from the suggestions; Other adds their own.
5. **What is in the first version?** Multi-select over what they picked in question 2; the rest can wait. Other for anything else.

A skipped question is fine: the analyst asks about it first. Then one command, each list joined with ";", and question 5 written as `first: …` for what they picked and `later: …` for the rest:

```
vibekit new brs --answer what="…" --answer does="…; …" --answer never="…; …" --answer limits="…; …" --answer first="first: …; later: …"
```

It writes docs/brs.md in five numbered sections, one requirement sentence per pick, ingests it as BRS-001, and lists what is still thin. Read that back in two sentences: what was written, and what the analyst will ask about first. Then offer: "Start the analyst's questions" (`/vibekit:run-sprint`, then `/vibekit:answer`), "Let me edit docs/brs.md first" (then `vibekit ingest docs/brs.md`), or "Stop here".
