---
name: finance-skills
domain: finance
triggers: [finance skills, analyze these financials, my saas metrics, right one e]
description: Router/index for the 2 finance skills bundled in this plugin: financial-analyst (ratio analysis, DCF valuation, budget variance, rolling forecasts) and saas-metrics-coach (ARR/MRR, churn, CAC/LTV, NRR, quick ratio).
source: alirezarezvani/claude-skills · finance/skills/finance-skills/SKILL.md @19392f7 · MIT
---
<!-- catalogue skill: Copyright (c) 2025 Alireza Rezvani, MIT. Identity phrasing removed; nothing else edited. The source bundled scripts, which are not shipped: do by hand what the script checked. -->

# Finance Skills — Router

This plugin bundles **2 finance skills** (this router is the 3rd folder under `finance/skills/`). Each skill is self-contained.

## Routing table

| Request signals | Skill | Path |
|---|---|---|
| Ratio analysis, DCF valuation, budget variance, driver-based forecasts | financial-analyst | `skills/financial-analyst/` |
| ARR/MRR, churn, CAC/LTV, NRR, quick ratio, SaaS benchmarks | saas-metrics-coach | `skills/saas-metrics-coach/` |

If both match (e.g., "value my SaaS company"), ask whether the user wants statement-level analysis (financial-analyst) or SaaS operating metrics (saas-metrics-coach).

## Quick start

```bash
# Example: route a statement-analysis request
cat finance/skills/financial-analyst/SKILL.md
python3 finance/skills/financial-analyst/scripts/ratio_calculator.py --help

# Or a SaaS metrics request
python3 finance/skills/saas-metrics-coach/scripts/metrics_calculator.py --help
```

## Related (packaged separately, not in this bundle)

- `finance/business-investment-advisor/` — investment thesis evaluation, ROI modeling (prompt-only skill, separate nested plugin)
- Root commands `/financial-health` and `/saas-health` wrap these skills' scripts.

## Rules

- Route to exactly one skill, then follow that skill's workflow. This router ships no tools of its own.
- Always validate financial outputs against the user's source data; outputs are analysis support, not investment advice.
