---
name: tdd
triggers: [write tests, failing test, red green refactor, test coverage, unit tests, test first]
source: alirezarezvani/claude-skills · engineering-team/skills/tdd-guide/SKILL.md @19392f7 · MIT
---
# Test-driven development

One acceptance criterion, one failing test, then the least code that passes it, then tidy with the suite green. Never write the code first and the test after: a test written after passes by construction and proves nothing.

**The loop.** Name the test after the behaviour and the criterion (`AC-2: locks after five failed attempts`). Run it and watch it fail for the right reason. Implement only what that test needs. Run the whole suite, not just the new test. Refactor with everything green, then commit.

**What a good test looks like.** It asserts behaviour through the public surface, not implementation details. It builds its own data through a fixture or factory; hardcoded ids break in the next environment. It covers the happy path, one error path and one boundary (empty, zero, max plus one). It does not share state with its neighbours.

**Coverage.** Read gaps by risk, not by percentage: an uncovered error path in payments matters, an uncovered formatter does not. Test the error paths first; most defects live there.

The full source, with framework examples: `vibekit skills reference tdd`.
