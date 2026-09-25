---
name: minimal-code
triggers: [minimal code, less code, yagni, over-engineering, overengineer, unnecessary abstractions]
source: alirezarezvani/claude-skills · engineering/minimalist/SKILL.md @19392f7 · MIT
---
# Minimal code

The best code is the code never written. Before adding anything, walk a ladder and stop at the first rung that holds.

1. Was it asked for? If not, do not build it; a helper for a future need is a guess with a maintenance bill.
2. Does the codebase already do it? Find the helper or pattern and reuse it.
3. Does the standard library or the platform do it? Use that rather than installing a package for one line.
4. Does an installed dependency do it? Use it before adding a new one.

Only when every rung fails, write the least code that works, and say which rung decided it: "using stdlib pathlib instead of a file helper" is a decision a reviewer can check in one line.

**Extract on the second use, not the first.** A class for a single function, a config file for one value, a utility module nothing imports yet: each is an abstraction paid for before it earns anything. Write it inline and pull it out when a second caller appears.

**Do not add what was not requested.** Comments, logging, error handling for errors that cannot happen, and docstrings on private helpers are volume, not value. Ship the working code first.

**Smallest diff, in the right place.** A tiny change that patches the symptom where it surfaces rather than the cause is a second bug. Understand the problem, then make the shortest change that fixes it there.

The full source, with the anti-pattern table: `vibekit skills reference minimal-code`.
