---
description: "Never inventing requirements, APIs, endpoints, schemas, config or test results; what to do when the spec is silent"
---

# Anti-hallucination / specification-first development

* Requirements, business rules, workflows, API contracts, database structures, permissions,
  integrations, configuration values, and user behaviour MUST NOT be invented.
* The project specification, requirements, design system, architecture decisions, existing code, and
  project rules are the source of truth.
* Ambiguity MUST NOT be resolved by silently inventing behaviour that could materially affect the
  application. Either make the smallest safe assumption and document it clearly, or ask when the
  decision materially affects functionality, security, data, or architecture.
* Assumptions MUST NOT be presented as confirmed requirements.
* APIs, database tables, fields, endpoints, libraries, configuration values, test results, and
  implementation details MUST NOT be fabricated.
* Existing code MUST be inspected before modifying or replacing functionality.
* Existing functionality MUST be preserved unless the requirements explicitly call for a change.
* Generated code MUST be validated against the requirements before being considered complete.
  Compilation is not proof of correctness. Passing tests is not proof that the implementation
  satisfies the requirements.
