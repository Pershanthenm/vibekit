---
description: "Validating input, requests, forms, parameters and payloads on the server, whatever the frontend already does"
---

# Input validation

* All external input MUST be treated as untrusted.
* Input MUST be validated at appropriate application boundaries.
* Validation MUST exist on the server even when client-side validation is implemented.
* Validation MUST cover format, length, range, required values, allowed values, and business
  constraints where applicable.
* Validation MUST NOT be bypassed because the frontend already validates the input.
