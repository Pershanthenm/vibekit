---
name: answer
description: Answer what is waiting on you, one question at a time, by picking not typing
---

Run `vibekit show status --json`: everything waiting on a person, across projects, most blocking first. Each item carries its project, root, kind, id, plain-terms text and the command that settles it. If it is empty, say nothing needs them and stop. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.

Take the items in order. For each:

- **ask**: run `vibekit ask show <id> --dir <root>` and read the question, why it matters, and "Options the agent can see" if present. Ask the person with the plain-terms line as the question, those options first, then two or three sensible answers you can see in the folder (the sources, the glossary, the entities), each with a one-line consequence. Other stays available. Then `vibekit ask answer <id> "<their choice>" --dir <root>`; "send it back" is `vibekit ask reject <id> "<reason>" --dir <root>`.
- **gate**: the stage is finished and needs an approval. Offer: "Approve" (recommended when `vibekit run check` is green), "Show me what I am approving first" (open the file the gate names and summarise it, then ask again), "Not yet". On approve, run the item's command with their name: `vibekit action approve <stage> --by "<name>" --dir <root>`. The name comes from `vibekit settings name` (set by `/vibekit:setup`), so pass no `--by`; only if it is not set, ask once, offering the git user.name first.
- **close**: a reviewed requirement waiting for a person to set done. Offer "Set done", "Show me the review first", "Send it back". Done is `vibekit req done <id> --by "<name>" --dir <root>`.

Group by project when there is more than one, and say which project each question belongs to. After the last one, run `vibekit show project` and read back what is now unblocked; if work can start, offer `/vibekit:run-sprint`.
