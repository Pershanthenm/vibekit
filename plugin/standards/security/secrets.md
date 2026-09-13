---
description: "Secrets, API keys, tokens, passwords, certificates and credentials: where they live and how they are supplied"
---

# Secure secret management

* Secrets MUST NEVER be hardcoded in source code.
* Passwords, API keys, tokens, certificates, private keys, connection credentials, encryption keys,
  and signing secrets MUST be externally managed.
* Development, QA, and production secrets MUST remain isolated.
* Production credentials MUST never be copied into development environments or repositories.
