---
name: sql-performance
triggers: [slow query, add an index, explain analyze, query plan, n+1, query performance]
source: alirezarezvani/claude-skills · engineering/skills/sql-database-assistant/SKILL.md @19392f7 · MIT
---
# SQL performance

Measure before rewriting. Run the query under `EXPLAIN (ANALYZE, BUFFERS)` against production-sized data, because a plan over ten rows tells you nothing.

**Read the plan from the costliest node outward.** A sequential scan on a large filtered table means a missing or unusable index. A nested loop with a large outer row count wants an index on the inner join column or a hash join. Estimated rows more than ten times off from actual means stale statistics; run `ANALYZE` before touching the query. Buffer reads far above hits means the working set no longer fits in memory.

**Make the predicate sargable before adding an index.** `WHERE YEAR(created_at) = 2025` cannot use an index on `created_at`; compare the raw column to a range. An implicit cast (`WHERE id = '123'`), a leading wildcard, `NOT IN` against a nullable subquery and a correlated subquery in the select list each defeat the planner and each has a standard rewrite. Only then add an index: equality columns first, most selective first, then the sort column; partial when the filter is a constant. Build it `CONCURRENTLY` on a live table.

**Find N+1 in the query log, not the code.** Hundreds of identical statements differing only by id means a loop over an ORM relation; fix with eager loading or one `WHERE id IN (...)`. Bound every user-facing list with a `LIMIT`.

Plan operators, index types and dialect differences: `vibekit skills reference sql-performance`.
