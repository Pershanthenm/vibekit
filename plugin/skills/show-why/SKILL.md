---
name: show-why
description: Why does this line of code exist
argument-hint: <file[:line]>
---

`vibekit show why $ARGUMENTS` walks the chain: requirement → criterion → source section → answer → assumption. With no argument, offer the file open in the editor and the files touched in the last commit as options. Quote the chain to the user as it is, and point out any line that rests on an unconfirmed assumption before they build on it. Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
