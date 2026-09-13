---
description: "Async and await for I/O, database, network and file calls; cancellation tokens; blocking calls to avoid"
---

# Asynchronous implementation

* I/O-bound operations MUST use asynchronous implementations where supported.
* Database, HTTP, file, messaging, and other I/O operations SHOULD use async APIs.
* Blocking calls such as `.Result` and `.Wait()` MUST NOT be used for asynchronous operations.
* `CancellationToken` SHOULD be propagated through operations where appropriate.
* `async` MUST NOT be added unnecessarily to CPU-bound code simply to satisfy a rule.
