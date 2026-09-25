---
name: secrets-hygiene
triggers: [committed secret, leaked secret, .env, rotate credentials, hardcoded api key, secret scanning]
source: alirezarezvani/claude-skills · engineering/skills/env-secrets-manager/SKILL.md @19392f7 · MIT
---
# Secrets hygiene

A secret in a repository is compromised the moment it is pushed, and the fix is rotation, not deletion.

**Scan before you commit.** Check staged additions for the known shapes: `AKIA` keys, `sk_live_`, `ghp_`, `xox` Slack tokens, `AIza`, `-----BEGIN PRIVATE KEY`, connection strings with `user:pass@`, and any assignment to `secret`, `token`, `password` or `api_key` with a literal over eight characters. Skip `.env.example` and fixtures, but reread the exclusion list periodically; it hides real leaks over time. Run the same scan in CI so a bypassed hook still fails the merge.

**Treat severity as urgency.** Provider and cloud access keys are an incident: rotate now. Generic assignments and PEM blocks need investigation, JWT-like strings need context. Do not downgrade a suspected leak until it is proven fake.

**Rotate in this order.** Generate the new credential, deploy it to every consumer in parallel, verify each one authenticates, then revoke the old one. Revoking first causes an outage; missing a downstream consumer is the common miss. Then audit access logs over the exposure window, and scan git history, CI logs and artifact registries for the value; a history rewrite does not make it unseen.

**Keep `.env` local.** Commit only `.env.example` with placeholders, gitignore the rest, validate required variables at startup and fail fast, and never echo a secret in logs or pipeline output.

Full patterns, CI recipes and store choices: `vibekit skills reference secrets-hygiene`.
