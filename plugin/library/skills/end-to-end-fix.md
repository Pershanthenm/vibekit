---
name: end-to-end-fix
triggers: [make it work, feature is broken, module is broken, work properly, whole feature, broken feature]
source: alirezarezvani/claude-skills · engineering/skills/focused-fix/SKILL.md @19392f7 · MIT
---
# End-to-end fix

"Make the feature work" is not "fix this bug". A broken feature usually has several faults, and the visible one is rarely the root. Do not change code until scope, trace and diagnosis are done.

**Scope, then trace both directions.** Read every file in the feature's folder and note which ones other code imports. For each import, confirm the source exists and exports what is expected; for each consumer elsewhere, confirm it uses the real interface. Include the environment variables, config files, schemas and endpoints the feature reads; many "code bugs" are configuration.

**Diagnose everything before fixing anything.** Run every test that imports from the feature and note each failure. For each critical issue, state the root cause and trace the flow backward to confirm it; when it spans layers, log at each boundary to find the one that fails. Rank issues by blast radius: public interfaces, schemas, auth and modules with over three callers first.

**Fix in order, one at a time.** Dependencies, then types at boundaries, then logic, then tests, then integration. Run the related test after each fix. When a fix breaks something else, return to diagnosis. When three fixes have created new issues, stop: that is an architecture problem, and the user should choose between patching and restructuring.

**Verify the consumers.** Tests inside the feature passing while its callers break is not fixed.

The full source, with report formats: `vibekit skills reference end-to-end-fix`.
