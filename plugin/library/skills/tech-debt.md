---
name: tech-debt
triggers: [tech debt, technical debt, cleanup sprint, refactoring priority, code health, debt backlog]
source: alirezarezvani/claude-skills · engineering/skills/tech-debt-tracker/SKILL.md @19392f7 · MIT
---
# Tech debt

Debt is a loan with interest: each item costs developer hours every time someone works near it. Track it like one, with a scan, a score and a trend, so a cleanup sprint can prove it moved something.

**Scan for signals, with thresholds.** Functions over 50 lines or cyclomatic complexity over 10, nesting deeper than 4, files over 500 lines, blocks of 3 or more duplicated lines, TODO/FIXME/HACK comments, empty catch blocks, hardcoded paths and secrets, string-built SQL, and outdated or vulnerable dependencies. Record location, type and severity: critical for security or data loss, high for functions over 100 lines or complexity over 20, low for style.

**Score by interest, not by annoyance.** Estimate effort in hours with a risk multiplier (near 2x for architecture and security work). Estimate the interest: velocity and quality cost per day, doubled when the file sits in core, auth or API paths, halved for tests and config, and compounding fastest for architecture debt and duplication. Priority is business value plus urgency plus risk reduction, divided by risk-adjusted effort. Anything under 4 hours is a quick win.

**Allocate and re-measure.** Reserve about 20% of sprint capacity for the top of the backlog. After the sprint, re-scan and compare counts by category with the previous snapshot; a cleanup that does not move the numbers was rework, not paydown. Some debt is worth keeping; write down why.

The full source, with WSJF and RICE variants: `vibekit skills reference tech-debt`.
