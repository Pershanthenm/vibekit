---
description: "Errors, exceptions and failure handling at boundaries: useful to developers, safe for users"
---

# Error handling

* Applications MUST implement consistent error handling.
* Exceptions MUST be handled at appropriate boundaries.
* Internal implementation details MUST NOT be exposed to users or API consumers.
* API errors SHOULD use a consistent response structure.
* Errors MUST be logged appropriately without exposing sensitive information.
* Error handling MUST give developers useful diagnostics and users safe information.
