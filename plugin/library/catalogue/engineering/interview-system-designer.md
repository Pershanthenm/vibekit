---
name: interview-system-designer
domain: engineering
triggers: [interview system designer, design interview processes, create hiring pipelines, calibrate interview loops, generate interview questions, design competency matrices]
description: This skill should be used when the user asks to "design interview processes", "create hiring pipelines", "calibrate interview loops", "generate interview questions", "design competency matrices", "analyze interviewer bias", "create scoring rubrics", "build…
source: alirezarezvani/claude-skills · engineering/skills/interview-system-designer/SKILL.md @19392f7 · MIT
---
<!-- catalogue skill: Copyright (c) 2025 Alireza Rezvani, MIT. Identity phrasing removed; nothing else edited. The source bundled scripts, which are not shipped: do by hand what the script checked. -->

# Interview System Designer

Comprehensive interview loop planning and calibration support for role-based hiring systems.

## Overview

Use this skill to create structured interview loops, standardize question quality, and keep hiring signal consistent across interviewers.

## Core Capabilities

- Interview loop planning by role and level
- Round-by-round focus and timing recommendations
- Suggested question sets by round type
- Framework support for scoring and calibration
- Bias-reduction and process consistency guidance

## Quick Start

```bash
# Generate a loop plan for a role and level
python3 scripts/interview_planner.py --role "Senior Software Engineer" --level senior

# JSON output for integration with internal tooling
python3 scripts/interview_planner.py --role "Product Manager" --level mid --json
```

## Recommended Workflow

1. Run `scripts/interview_planner.py` to generate a baseline loop.
2. Align rounds to role-specific competencies.
3. Validate scoring rubric consistency with interview panel leads.
4. Review for bias controls before rollout.
5. Recalibrate quarterly using hiring outcome data.

## References

- `references/interview-frameworks.md`
- `references/bias_mitigation_checklist.md`
- `references/competency_matrix_templates.md`
- `references/debrief_facilitation_guide.md`

## Common Pitfalls

- Overweighting one round while ignoring other competency signals
- Using unstructured interviews without standardized scoring
- Skipping calibration sessions for interviewers
- Changing hiring bar without documenting rationale

## Best Practices

1. Keep round objectives explicit and non-overlapping.
2. Require evidence for each score recommendation.
3. Use the same baseline rubric across comparable roles.
4. Revisit loop design based on quality-of-hire outcomes.
