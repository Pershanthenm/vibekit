---
name: adversarial-review
triggers: [adversarial review, critical review, review before merge, find what is wrong, hostile review, poke holes]
source: alirezarezvani/claude-skills · engineering-team/skills/adversarial-reviewer/SKILL.md @19392f7 · MIT
---
# Adversarial review

A reviewer who just read the code shares the author's mental model and will call it fine. Break that by reviewing the same diff three times, each from a stance that fears something different, and each stance must find at least one thing. "Nothing found" means "did not look".

1. **The saboteur** wants it to break in production. For every function: what is the worst input? For every external call: what if it fails, hangs or returns garbage? For every state change: what if it runs twice, or never?
2. **The new hire** must change this in six months with no author to ask. Can each function be understood from its name, parameters and body alone? How many files does one code path cross? Which constant is magic?
3. **The auditor** assumes it will be attacked. Name every trust boundary the change crosses, then ask whether input is validated, output is bounded, and a user can reach another user's data.

Read the whole file, not the changed lines; defects live where new code meets old. Merge duplicate findings, and promote anything two stances caught by one severity. End with one verdict: block, concerns, or clean, and the single most important fix.

Full stances and the report shape: `vibekit skills reference adversarial-review`.
