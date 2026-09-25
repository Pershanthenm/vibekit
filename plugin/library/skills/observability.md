---
name: observability
triggers: [golden signals, alert fatigue, noisy alerts, add observability, instrument the service, alerting rules]
source: alirezarezvani/claude-skills · engineering/skills/observability-designer/SKILL.md @19392f7 · MIT
---
# Observability

Instrument what a user would notice, then make each alert earn its page. Metrics, logs and traces answer different questions, and a service needs all three joined by one request id.

**Start with the four golden signals.** For every request-driven service, emit latency (p50, p95, p99), traffic, error rate and saturation before any custom metric. When a dashboard or alert set lacks one of these, close that gap first, because most incidents show up there before anywhere else.

**Alert on symptoms, not causes.** Page on what users feel: error rate, latency, availability. CPU at 80% is a warning at most, because it often affects nobody. An alert with no `for` clause flaps; one that fires more than ten times a day or is wrong a third of the time is noise, so raise its threshold from historical data or delete it. Fire and resolve at different thresholds, and suppress dependent alerts while the upstream one is firing.

**Every alert names its action.** Attach a runbook link, the user impact and the first step. If nobody would do anything at 3 AM, make it a ticket or drop it.

**Logs and traces.** Emit structured JSON with a correlation id on every line and propagate that id through spans. Sample traces at the tail so the slow and failed ones are kept.

**Dashboards.** Overview, then service, then instance; at most nine panels per screen, with status and SLO at the top.

Full patterns and dashboard archetypes: `vibekit skills reference observability`.
