---
name: vibekit.new-hotfix
description: Production is broken
---

`vibekit new hotfix "<text>"` opens an S requirement on hotfix/*. Write its criterion as the absence of the defect, name the failing test that exposes it (`--test`), then `vibekit bug fix`, the repair, `vibekit verify`, `vibekit bug test`. The verdict is one word and a person closes it.
