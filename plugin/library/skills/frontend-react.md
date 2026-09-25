---
name: frontend-react
triggers: [react component, next.js, tailwind, server components, react hook, web vitals]
source: alirezarezvani/claude-skills · engineering-team/skills/senior-frontend/SKILL.md @19392f7 · MIT
---
# React and Next.js frontend

"Fast" is not a target. Before choosing how a page renders, name the primary device and network (mobile on 4G is the honest default), an LCP target in milliseconds at p75, and a JavaScript budget per route in KB gzipped. Whether the page is SEO-dependent or behind a login decides server rendering versus a client app; nothing else does.

**Server first.** Render on the server by default and add `'use client'` only where a component needs event handlers, state, effects or browser APIs. Push that boundary to the leaf: a client button inside a server page, not a client page around a server button. Fetch independent data in parallel and stream the slow part under Suspense with a skeleton, so the shell paints first.

**Measure the bundle before shrinking it.** The usual offenders are a date library where the platform Intl API would do, a utility library imported for one function, and a component kit loaded on every route. Import heavy below-the-fold components (charts, maps, editors) dynamically. Mark the one above-the-fold image as priority.

**Components.** Keep state where it is used; lift it only when two siblings need it. Key lists by a stable id, never an index, because reorders then rerender wrongly. Reach for memo only after profiling shows a cost. Test through roles and labels.

The full source, with patterns and profiles: `vibekit skills reference frontend-react`.
