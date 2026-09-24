---
name: performance-profiling
triggers: [slow endpoint, memory leak, flamegraph, p99 latency, heap snapshot, load test]
source: alirezarezvani/claude-skills · engineering/skills/performance-profiler/SKILL.md @19392f7 · MIT
---
# Performance profiling

Measure first, or you will optimise the wrong thing. Record p50, p95, p99, throughput, error rate and memory before touching code, against production-sized data; ten rows in dev hide the bottleneck millions show.

**Profile, then confirm.** Take a CPU flamegraph under load (clinic or `--prof` for Node, py-spy for Python, pprof for Go) and look for the widest bars. Treat a guess like "the N+1 is slow" as a hypothesis the profile must confirm. Watch p99, not p50; a fine median can hide a catastrophic tail.

**Check the quick wins first.** Per request: query count (N+1), missing indexes on WHERE and ORDER BY columns, `SELECT *`, unbounded queries with no LIMIT, no connection pool. In the hot path: sync I/O, large JSON parse or stringify, serial awaits that could run in parallel, dependencies loaded inside handlers. On the wire: no pagination, no cache headers, no compression. In the bundle: whole-library imports and static imports of heavy components.

**Leaks.** Take two heap snapshots five minutes of load apart and compare. If heap after a forced GC sits more than 10% above baseline, you have a leak. An event loop blocked over 100ms is a sync call to find.

**One change, then re-measure.** Apply a single fix, rerun the same load, and put before and after numbers in the PR. Turn the goal into a CI threshold such as `p(95) < 200ms` so the win survives.

Full tooling recipes and the write-up template: `vibekit skills reference performance-profiling`.
