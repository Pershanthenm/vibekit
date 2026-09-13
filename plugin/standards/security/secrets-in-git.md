---
description: "Keeping secrets out of git and source control, and what to do when one is committed"
---

# No secrets in source control

* Secrets MUST NOT be committed to Git or other source-control systems.
* `.env`, configuration, credential, certificate, and secret files MUST be appropriately excluded
  where applicable.
* Secret scanning SHOULD be included in the CI/CD quality process.
* A secret accidentally committed MUST be treated as compromised and rotated.
