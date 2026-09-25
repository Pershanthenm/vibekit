---
name: zero-downtime-migration
triggers: [zero downtime, expand contract, backfill, rename a column, drop a column, cutover]
source: alirezarezvani/claude-skills · engineering/skills/migration-architect/SKILL.md @19392f7 · MIT
---
# Zero-downtime migration

Old code and new schema run side by side during every deploy, so a migration must be safe for both the version leaving and the one arriving. A change that is not gets split into steps that are.

**Classify each change before writing it.** Adding a nullable column, a table or an index built online is additive and safe. Dropping or renaming a column, changing a type, adding `NOT NULL` or a unique constraint over existing rows, or touching a primary key breaks the running version and gets expand-contract.

**Expand-contract, in five deploys, never fewer.** Add the new column nullable. Deploy code that writes both. Backfill in batches of a few thousand rows until an update touches none. Deploy code that reads the new column and stops writing the old. Only then, in a later release once reconciliation is clean, drop the old column; that step cannot be undone, so it ships alone.

**Reconcile before you cut over, and decide the rollback triggers first.** Compare row counts, then checksums of a sample, then the aggregate results of the two or three business queries that matter. Every step up to the contract has a rollback rehearsed in staging before the expand ships. Agree in advance what backs the change out (error rate at several times baseline for five minutes, or availability under 95 percent for two) so nobody debates it live.

Service patterns (strangler fig, parallel run, canary) and reconciliation queries: `vibekit skills reference zero-downtime-migration`.
