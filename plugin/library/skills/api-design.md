---
name: api-design
triggers: [api design, openapi, breaking change, endpoint naming, api versioning, api conventions]
source: alirezarezvani/claude-skills · engineering/skills/api-design-reviewer/SKILL.md @19392f7 · MIT
---
# API design review

Review the contract, not the handler. Read the spec or route table as a client would and check three things in this order: will existing clients keep working, is the surface consistent, and does each response tell the client what to do next.

**Classify every change against the previous version first.** Removing or renaming a field or endpoint, changing a type, making an optional field required, adding a required request field, or tightening auth breaks clients and needs a version bump or a deprecation window. Adding an optional request field, a response field, an endpoint or an enum value is safe, provided clients already tolerate unknown values. Say which list each change sits on before any comment on style.

**Check consistency across the whole API, not the new endpoint alone.** One convention for paths (kebab-case nouns, no verbs), one for fields (camelCase), one error envelope with a stable machine-readable code, one pagination shape. An endpoint that is correct on its own but shaped unlike its neighbours is the finding.

**Look for the shapes that fail later.** A list endpoint with no pagination, a POST that creates money or messages without an idempotency key, a 200 carrying an error body, resources nested more than two deep, a GET with a request body. Each has a standard fix; name it rather than describing the smell.

Versioning options, error and pagination shapes, and the anti-pattern catalogue: `vibekit skills reference api-design`.
