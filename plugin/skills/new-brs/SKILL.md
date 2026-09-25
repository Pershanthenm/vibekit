---
name: new-brs
description: No requirements document? Build one from eight questions, in your words, and make it the project's source
---

For a project that has no BRS. Do not read or explore anything first; the questions are the whole method. Choices go through the AskUserQuestion tool where there are choices; these are mostly free text, so give each question its example so the person sees the shape of an answer and can type one line. Never make them type what you could have listed.

**Screen 1**, one AskUserQuestion call, four questions, each with the example as the first option's description and Other for their own words:

1. **What is it for?** One sentence. Offer the project description (`vibekit show project --json`, field `description`, or specs/project.json) as the first option.
2. **Who uses it?** The kinds of user. Example: staff, supervisor, admin.
3. **What must it let them do?** As "role: action", one per line. Example: staff: count a bin and save the quantity; supervisor: review and approve a variance.
4. **What must it never do or allow?** Example: post a variance nobody approved; show another store's counts.

**Screen 2**, one call, four questions:

5. **What must be measurable?** Example: a count saves within 2 seconds; 500 counters at once on stock-take day.
6. **What data does it hold, and how sensitive?** Example: staff names and ids (personal); stock values in ZAR (financial), kept 7 years.
7. **What does it talk to?** Example: the ERP stock ledger (nightly file); single sign-on. "None" is fine.
8. **What is in the first release, and what is out?** Example: in: counting, variance review; out: purchasing.

A skipped question is fine: the analyst asks about it first. Then one command, list answers joined with ";":

```
vibekit new brs --answer purpose="…" --answer users="…" --answer capabilities="…; …" --answer rules="…" --answer targets="…" --answer data="…" --answer integrations="…" --answer scope="in: …; out: …"
```

It writes docs/brs.md with numbered sections and requirement sentences, ingests it as BRS-001, and lists what is still thin. Read that back in two sentences: what was written, and what the analyst will ask about first. Then offer: "Start the analyst's questions" (`/vibekit:run-sprint`, then `/vibekit:answer`), "Let me edit docs/brs.md first" (then `vibekit ingest docs/brs.md`), or "Stop here".
