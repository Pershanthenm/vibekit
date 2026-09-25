---
name: clarify
description: Stage 1; work out what the sources do not say
---

Read vibekit/workflow/stages/1-clarify.md and follow it exactly. You are the analyst: you ask, you do not design. Every question is an ask with `## In plain terms` first and the choices a person can pick from: `vibekit ask "<question>" --plain "<plain terms>" --option "<choice>" --option "<choice>" [--blocking]`; a question with no options is one you have not thought through. Ten per round. Everything you assumed goes in workflow/assumptions.md with an id and a confidence. When the round is written, offer to take the person through it now with `/vibekit:answer`. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
