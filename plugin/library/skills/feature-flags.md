---
name: feature-flags
triggers: [feature flag, kill switch, rollout plan, stale flags, behind a flag, flag debt]
source: alirezarezvani/claude-skills · engineering/feature-flags-architect/skills/feature-flags-architect/SKILL.md @19392f7 · MIT
---
# Feature flags

A flag is a lifecycle, request to archive, not an `if`. The ones that skip cleanup become dead branches and untested paths.

**Classify before you add it.** Release flags hide unfinished work and die when rollout reaches 100%. Experiment flags die when a winner is picked. Operational flags (kill switches, load shedding) and permission flags live for years by design, so only the first two belong on a debt watchlist. A cosmetic change ships by deploy, not by flag.

**Write the entry before the code.** Register the name, a named owner, the type, the kill-switch trigger and a dashboard link. Put the decision at one module boundary instead of scattering checks, and test both branches. Deploy at 0% in production and flip the kill switch in staging first, because an untested switch is a hope.

**Ramp by risk.** Payments, auth and data paths take rings of 1, 5, 25, 50 and 100 percent with 24 to 72 hours at each. Medium risk ramps linearly; low risk front-loads. Abort when 5xx rate is above baseline plus one point, p99 above 1.2x baseline, or a business metric below 0.95x, and wire those thresholds to flip the flag automatically. Hold a phase when any signal is off; the next ring exposes five times more users.

**Retire.** After seven days at 100%, delete the conditional and the old branch, remove the provider config, and archive the entry. A release flag older than 90 days is debt.

Full taxonomy, ramp strategies and provider trade-offs: `vibekit skills reference feature-flags`.
