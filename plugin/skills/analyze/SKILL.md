---
name: analyze
description: Explain a codebase back in plain language; changes nothing
argument-hint: [path or git url] [--depth quick|standard|deep] [--focus security|cost|migration|quality]
---

Run `vibekit analyze $ARGUMENTS` (default: `.` at standard depth; if no depth was given, ask: Quick, Standard (recommended), Deep). It reads the code and writes nothing. Read the report back with its confidences intact: a line below `high` is an inference, and say so. Then ask: "Start a VibeKit project from this reading" (`/vibekit:new-project --import .`, which touches no existing file), "Focus on one area" (security, cost, migration, quality), "That is all". Choices go through the AskUserQuestion tool: list the options, the person picks one. Never make them type what you could have listed; free text is only for what nobody can list.
