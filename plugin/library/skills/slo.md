---
name: slo
triggers: [error budget, burn rate, service level objective, reliability target, slos]
source: alirezarezvani/claude-skills · engineering/slo-architect/skills/slo-architect/SKILL.md @19392f7 · MIT
---
# SLOs and error budgets

An SLO is a promise about user experience, not a number copied from a template. Set one only where a user would notice the signal going red.

**Pick the SLI from the user's question.** "Did it succeed" is a success rate, `good / total`, with 4xx excluded except 429. "Was it fast" is `count(latency < threshold) / total`, with the threshold at the p95 of typical good weeks. Freshness and correctness take the same ratio shape. CPU, memory and pod restarts are never SLIs, because a system can be green on all of them while users suffer.

**Set the target from history.** Measure 30 days of the SLI and set the target near the p50 the system already sustains, over a 28-day window. Below 99% the SLI is probably wrong; at 99.99% or above every blip is a violation and alerts become noise. Keep the SLO tighter than any SLA, and in a separate document.

**Alert on burn rate with two windows.** Budget is `1 - target` times the window: 99.9% over 30 days is 43 minutes. Page when the 1h and 5m burn rates both exceed 14.4x (2% of budget in an hour), page at 6x on 6h and 30m, and ticket at 1x on 3d and 6h. Two windows filter blips and still catch a slow burn.

**Write the policy before the first alert.** Under 25% budget remaining, risky deploys freeze until reliability work ships; an exhausted budget means a postmortem and an SLO revision. Give every SLO a named owner and review it quarterly.

Full math, review checks and templates: `vibekit skills reference slo`.
