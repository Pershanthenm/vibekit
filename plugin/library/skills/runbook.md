---
name: runbook
triggers: [runbook, on-call procedure, operational procedure, rollback plan, deployment checklist]
source: alirezarezvani/claude-skills · engineering/skills/runbook-generator/SKILL.md @19392f7 · MIT
---
# Runbook

A runbook is read at three in the morning by someone who did not write it. Every line must work under that condition: copy-pasteable commands, an expected output after each one, and no step that assumes context the reader does not have.

**Cover the six operations.** Start, stop, health check, deploy, rollback and escalation. Deploy ends with a smoke test and a 10 to 15 minute watch on error rate and latency. Rollback names the last known good release, the exact command and the health check that proves it worked; a runbook without a rollback section documents only the happy path.

**Write triggers, not just steps.** Say when to roll back (error rate above a threshold for a set number of minutes, a failed smoke check) and when to escalate (SLA at risk, no progress in 30 minutes). The reader should never have to decide whether a situation counts.

**Keep it next to the code, dated.** Store it in the service's repository with an owner and a "last verified" date. Re-verify when deployment config, CI pipelines, migrations or environment configuration change, because those are what the commands depend on. Dry-run the whole thing in staging so the first real run is not during an incident.

**Feed it from incidents.** After every postmortem, add the step that was missing and remove the one that was wrong. A runbook nobody has executed since it was written is a guess.

The full source, with templates: `vibekit skills reference runbook`.
