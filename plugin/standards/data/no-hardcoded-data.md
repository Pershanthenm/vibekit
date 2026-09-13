---
description: "Where users, roles, statuses, permissions, URLs, dropdown options, lists and business rules come from; mock and seed data"
---

# No hardcoded business/application data

* Business data MUST NOT be hardcoded into the application.
* Application data such as users, roles, statuses, products, configuration values, dropdown options,
  permissions, URLs, and business rules MUST be sourced dynamically where appropriate.
* Technical constants MAY be hardcoded where genuinely immutable.
* Mock/static data MUST NOT be used as a substitute for a required API, database, or configuration
  source unless explicitly instructed.
