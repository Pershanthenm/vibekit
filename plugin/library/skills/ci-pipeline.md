---
name: ci-pipeline
triggers: [ci pipeline, github actions, gitlab ci, ci/cd, deploy pipeline, github workflow]
source: alirezarezvani/claude-skills · engineering/skills/ci-cd-pipeline-builder/SKILL.md @19392f7 · MIT
---
# CI pipelines

Most broken pipelines were copied from a repo with a different stack. Start from what the repository proves about itself: the lockfile names the package manager, the manifest names the runtime, and the scripts name the lint, test and build commands. Reference only commands that exist; where one is missing, leave a visible placeholder rather than inventing one.

**Build the minimal baseline before anything clever.** Checkout, set up the runtime, install with a cache keyed on the lockfile, then lint, test and build as separate steps so the failing one is obvious. Publish artefacts only after everything is green. Commit this, then add one improvement at a time (cache, split jobs, matrix), because two changes in one run cannot be blamed apart.

**Gate deploys in order.** Lint before test, test before build, and a deploy job consumes the build artefact rather than rebuilding. The develop branch deploys to staging automatically; main promotes to production behind a manual approval and a protected environment. Secrets live in the CI secret store, never in YAML. Every deploy job states its rollback command next to its deploy command.

**Scale when the numbers say so.** Split a job that runs past ten minutes. Add a matrix only when a real compatibility requirement exists. Keep deploy jobs out of the CI feedback loop, and track duration and flakiness as metrics a person owns.

The full source, with GitHub Actions and GitLab templates: `vibekit skills reference ci-pipeline`.
