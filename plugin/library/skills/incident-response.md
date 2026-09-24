---
name: incident-response
triggers: [production incident, outage, sev1, sev2, postmortem, post-mortem]
source: alirezarezvani/claude-skills · engineering-team/skills/incident-commander/SKILL.md @19392f7 · MIT
---
# Incident response

For outages, degradations and failed deploys, not security events. Classify first, because severity decides who is paged, how often anyone hears from you, and how much risk a fix may carry.

**Classify by users affected, then adjust.** Over 75% of users, revenue systems down or data loss is SEV1; 25 to 75% is SEV2; 5 to 25% with a workaround is SEV3; less is SEV4. Add a level for revenue loss, SLA breach or public exposure, two for a security angle. When in doubt, go higher; downgrading is cheap, a late escalation is not.

**One commander, fixed cadence.** SEV1 gets a commander within 5 minutes, executive and status page updates within 15, then an update every 15 minutes even when nothing changed. SEV2 is 30 minutes for each. The commander decides and communicates; responders investigate and are shielded from stakeholders. Decide on incomplete information and write each decision down as it happens.

**Rollback over clever.** Check recent deploys before anything else. Under pressure, prefer reverting to a risky forward fix, validate before declaring resolved, and expect secondary failures.

**Postmortem from the timeline.** Rebuild events in order, mark detection, mitigation and resolution, and flag gaps: over 30 minutes without a communication, over 60 without an action. Ask why five times with evidence at each step. Every action item gets an owner and a date. Name system failures, not people.

The full source, with templates: `vibekit skills reference incident-response`.
