---
skill: dependency-audit
triggers-on: ["run a dependency audit before the release", "is CVE-2024-3094 reachable from our build", "npm audit reports a vulnerable package in lodash", "do a license compliance check for GPL contamination", "plan the major version bump to React 19"]
must-not-trigger-on: ["rotate credentials for the payments gateway", "profile the slow endpoint in the reports API", "poke holes in the new payment handler"]
---
