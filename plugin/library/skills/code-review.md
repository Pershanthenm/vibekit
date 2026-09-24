---
name: code-review
triggers: [code review, review my changes, review this diff, code smells, code quality, long functions]
source: alirezarezvani/claude-skills · engineering-team/skills/code-reviewer/SKILL.md @19392f7 · MIT
---
# Code review

Rank the files by risk before reading any of them: anything touching auth, payments, migrations, or SQL and shell construction first, then the largest change, then the rest. Read whole files, not hunks, because the defect is usually where new code meets old.

**Scan for the patterns that are almost always defects before judging style.** Strings concatenated into SQL, shell or LDAP; credentials or tokens in source; a resource acquired with no guaranteed release; an empty catch or a catch of the broadest type; a network or I/O call with no timeout; a query inside a loop; a list fetched with no limit. Each is a finding on its own, however clean the rest reads.

**Treat structural thresholds as questions, not verdicts.** A function over 50 lines, a file over 500, a class with more than 20 methods, more than five parameters, nesting deeper than four, or more than ten branches each ask "why", and the answer can be fine. Say which one you saw and what you would split.

**Size the verdict to the worst finding, not the count.** One injection or leaked secret blocks the merge whatever else is true. Otherwise approve, approve with suggestions when only a couple of high findings remain, or request changes when more do. Lead with the single fix that matters most.

Language-specific rules and the full checklist: `vibekit skills reference code-review`.
