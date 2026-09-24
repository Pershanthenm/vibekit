---
name: backend-service
triggers: [rest api, api endpoint, backend service, pagination, rate limiting, microservices]
source: alirezarezvani/claude-skills · engineering-team/skills/senior-backend/SKILL.md @19392f7 · MIT
---
# Backend service

Most backend mistakes are made before the first file: a pattern chosen without numbers. Before picking a database, a queue or a service boundary, write down the read/write ratio and the p99 requests per second expected in a year, the tenancy model, the highest data sensitivity tier (public, internal, PII, PHI, PCI) and the SLO with a named owner. When one is unknown, that is the next question, not a reason to guess. Under about thirty engineers a modular monolith on one database wins; keep requests synchronous and add an async lane only for work that is genuinely async, like email and webhooks.

**Shape the API for its readers.** Plural nouns for collections, one error envelope everywhere (code, message, field details, request id), and cursor pagination when the list can change under the reader, because offsets skip or repeat rows. Make any POST that moves money or sends mail idempotent with a client key.

**Measure the query before indexing it.** Run EXPLAIN ANALYZE; a Seq Scan on a large table is the missing index, and a composite index lists the equality columns first. A query inside a loop is an N+1: replace it with a join or a batch load.

**Validate at the boundary.** Parse every body and query with a schema, use parameterised queries only, rate-limit login and reset endpoints, and read secrets from the environment.

The full source, with the forcing questions and profiles: `vibekit skills reference backend-service`.
