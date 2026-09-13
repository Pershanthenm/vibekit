---
description: "Environments and configuration: development, QA, staging and production differing by config rather than code"
---

# Environment separation

* Applications MUST support separate configuration for development, QA and production.
* Environment-specific configuration MUST NOT require changing application source code.
* Environment variables, secret stores, or appropriate configuration providers SHOULD be used for
  deployment-specific values.
* Production configuration MUST NOT be committed to source control.
