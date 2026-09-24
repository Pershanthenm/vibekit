---
name: api-tests
triggers: [api tests, api testing, endpoint tests, contract tests, test the endpoints, test the api]
source: alirezarezvani/claude-skills · engineering/skills/api-test-suite-builder/SKILL.md @19392f7 · MIT
---
# API test suite

Start from the route table, not the feature list. Enumerate every method and path from the framework's route definitions, then read each handler for its body schema, its auth middleware, its ownership and role checks, and the status codes it can return. A suite built from the product spec misses the routes nobody remembered.

**Give every authenticated route the same six cases**: no header, malformed token, expired token, token for a deleted user (all 401), a valid token with the wrong role or another user's resource (403), and the valid call. Keep "missing header" and "invalid token" as separate tests; they exercise different code and fail differently.

**For every route with a body, walk the boundaries**: empty body, each required field missing one at a time, wrong type, null in a required field, and the value at min minus one, min, max and max plus one. Off-by-one in limits is the commonest defect in this class, so also test the first, last, empty and oversized page of every list.

**Assert the shape, not only the status.** Check the error code and the field it names, check that password hashes and secrets never appear in any response, and check that a wrong content type is rejected. Build data through factories, keep one describe block per endpoint, and run rate-limit tests last because they poison their neighbours.

Example Vitest and pytest files: `vibekit skills reference api-tests`.
