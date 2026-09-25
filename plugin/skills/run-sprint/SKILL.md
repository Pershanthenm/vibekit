---
name: run-sprint
description: Do whatever comes next; the gate decides, nothing advances itself
---

Run `vibekit run`. It reads the gate, regenerates status.md and prints the stage prompt for the work it hands out — open that file and follow it. If it says a decision is waiting on a person, stop and offer to take them through it with `/vibekit:answer`; nothing advances itself. When the stage prompt has you write asks, give each one options (`vibekit ask "<question>" --plain "<plain terms>" --option "<choice>" --option "<choice>"`) so the person picks instead of types. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
