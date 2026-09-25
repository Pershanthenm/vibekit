---
name: docker
triggers: [dockerfile, docker compose, docker-compose, container image, multi-stage build, containerize]
source: alirezarezvani/claude-skills · engineering/docker-development/skills/docker-development/SKILL.md @19392f7 · MIT
---
# Containers that are small, cached and locked down

A slow build is usually a cache miss, and a large image is usually a build tool shipped to production.

**Order layers by how often they change.** Copy the dependency manifest and lockfile first, install, then copy the source, so a code edit does not reinstall dependencies. Chain related `RUN` steps with `&&` and delete the package cache in the same layer, because a later `rm` cannot shrink an earlier layer. Add a `.dockerignore` with at least `.git`, `node_modules` and `.env`.

**Build in one stage, run in another.** The build stage has the SDK and dev dependencies; the runtime stage copies only the artefacts with `COPY --from`, so the final image has no compiler, no source, no dev dependencies. A static binary runs from distroless or scratch; something that needs glibc uses a slim variant; otherwise alpine. Pin the tag, never `:latest`.

**Assume the container will be breached.** Add a `USER` after the root-only steps. Pass secrets as BuildKit secret mounts, never `ENV` or `ARG`, which stay in the layer history. Declare a `HEALTHCHECK`.

**Compose.** Give every service a healthcheck and use `depends_on` with `condition: service_healthy`, since a running database is not a ready one. Put backend services on an `internal: true` network, load secrets from `env_file`, set resource limits, and keep dev bind mounts and debug ports in an override file.

The full source, with base image tables and compose patterns: `vibekit skills reference docker`.
