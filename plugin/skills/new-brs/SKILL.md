---
name: new-brs
description: No requirements document? Five plain questions become one, and the analyst starts from it
---

For a project that has no requirements document. Do not read or explore anything first. Five questions, in plain words, each with an example so the person sees what an answer looks like and types one line. Choices go through the AskUserQuestion tool; here the example is the first option and Other is their own words. Never make them type what you could have listed: offer the project description as the answer to the first question.

**Screen 1**, one AskUserQuestion call, three questions:

1. **What is it, and who is it for?** First option: the project description (`specs/project.json`, or what they said at new-project). Example: an app where store staff count stock on their phones and supervisors approve the differences.
2. **What should people be able to do with it?** The main things, one per line. Example: count a shelf and save it; approve or reject a difference; see which shelves are still uncounted.
3. **What must never happen?** Example: a difference gets posted without approval; one store sees another store's numbers.

**Screen 2**, one call, two questions:

4. **Any hard limits, or things it must connect to?** Speed, how many people, sensitive data, other systems. Example: saving a count must feel instant on store wifi; 500 people counting at once; sends the final counts to the ERP every night.
5. **What is in the first version, and what can wait?** Example: first: counting and approvals; later: purchasing.

A skipped question is fine: the analyst asks about it first. Then one command, items joined with ";":

```
vibekit new brs --answer what="…" --answer does="…; …" --answer never="…" --answer limits="…; …" --answer first="first: …; later: …"
```

It writes docs/brs.md in five numbered sections, one requirement sentence per line they gave, ingests it as BRS-001, and lists what is still thin. Read that back in two sentences: what was written, and what the analyst will ask about first. Then offer: "Start the analyst's questions" (`/vibekit:run-sprint`, then `/vibekit:answer`), "Let me edit docs/brs.md first" (then `vibekit ingest docs/brs.md`), or "Stop here".
