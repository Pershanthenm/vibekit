---
description: "Securing an API, endpoint, route or controller: server-side enforcement, DTOs rather than entities, what a response may contain"
---

# Secure APIs

* APIs MUST follow secure-by-default principles.
* Authentication and authorisation MUST be enforced server-side.
* All external input MUST be validated.
* APIs MUST use appropriate DTOs/contracts rather than unnecessarily exposing database entities.
* Sensitive information MUST NOT be returned in API responses.
* Endpoints MUST follow appropriate security, rate-limiting, CORS, validation, and error-handling
  practices.
