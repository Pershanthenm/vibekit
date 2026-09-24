---
skill: secrets-hygiene
triggers-on: ["someone committed secret keys to the config repo, clean it up", "a leaked secret from the mobile app is on GitHub", "set up secret scanning in CI before merge", "rotate credentials for the payments gateway", "the .env got pushed to main last night"]
must-not-trigger-on: ["audit our npm dependencies for a CVE", "write the failing test for AC-2", "add burn rate alerts for the search service"]
---
