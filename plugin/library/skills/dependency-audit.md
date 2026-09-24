---
name: dependency-audit
triggers: [dependency audit, cve, vulnerable package, license compliance, major version bump, npm audit]
source: alirezarezvani/claude-skills · engineering/skills/dependency-auditor/SKILL.md @19392f7 · MIT
---
# Dependency audit

Every dependency is a liability with a version. Audit in three passes, vulnerabilities, licences, then upgrades, and rerun the first after changing anything.

**Vulnerabilities by severity and reachability.** Run the ecosystem's live advisory tool (`npm audit`, `pip-audit`, `cargo audit`); an offline pattern list is a smoke test. Fix critical within a day, high within a week, medium within a month. First check whether the vulnerable function is reachable from your code and whether the package is direct or transitive; a transitive fix is often one override or lockfile bump.

**Licences through the whole tree.** Classify each package: permissive (MIT, Apache 2.0, BSD, ISC), weak copyleft (LGPL, MPL), strong copyleft (GPL, AGPL), or unknown. Copyleft inherits through the chain, so a GPL package three levels down contaminates a permissive project, and AGPL reaches network services without distribution. Send unknowns for review, not a guess.

**Upgrades by risk.** Patch and security bumps apply now. Minors batch into a scheduled update. Majors get their own task with tests and a rollback note, ordered security, bug fixes, features, rewrites. Read the changelog for "deprecated" and "removed" first, and change one thing at a time so a failure has one cause.

**Close the loop.** After upgrading, scan again and confirm zero high findings. Whitelist a false positive only with a written reason.

Full ecosystem tables and licence matrix: `vibekit skills reference dependency-audit`.
