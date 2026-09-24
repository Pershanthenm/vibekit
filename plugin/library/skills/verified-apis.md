---
name: verified-apis
triggers: [verify apis, does this function exist, hallucinated, no hallucinations, invented method, deprecated api]
source: alirezarezvani/claude-skills · engineering/strict-api/SKILL.md @19392f7 · MIT
---
# Verified APIs

A call to a method that does not exist looks like the shortest line in the file and costs an hour to debug. Before writing any import, method call or constructor, be able to answer one question: does this exist in the version this project runs? "Probably" is a no.

**Inventory the surface first.** List every API the change touches: imports, methods, classes, option names. Check each against the installed version by reading the lockfile, node_modules, site-packages or the package's docs for that version, not from memory. When no version is stated, ask once; do not guess.

**Know the usual counterfeits.** Another language's standard library (`path.combine` is .NET, not Node), twin frameworks (`render_template` is Flask, `render` is Django; React has no built-in `useForm`), and deprecated methods that work today and break on the next upgrade. When a name feels familiar but unplaced, it is usually one of these.

**Mark uncertainty instead of hiding it.** When a check is impossible, write the call and put a one-line comment beside it naming what to verify and from which version. When the uncertainty is too high to write correct code, say so and ask. Prefer the verbose call that is known to exist over the elegant one that might.

The full source, with the anti-pattern list: `vibekit skills reference verified-apis`.
