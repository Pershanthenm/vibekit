# Third-party notices

VibeKit has no runtime dependencies. It ships one body of third-party-derived content: the skills library in `library/`.

## The shipped skills library (`library/`)

The skills in `library/skills/` are VibeKit's own short versions (100 to 400 tokens each) of techniques described at greater length in **claude-skills** by Alireza Rezvani, <https://github.com/alirezarezvani/claude-skills>, used under the MIT License. The full source text of each, with identity phrasing removed and nothing else edited, is kept in `library/references/` and printed by `vibekit skills reference <name>`. `library/SOURCES.md` lists every skill with its source file, the commit it was taken from and the licence. `library/catalogue/` holds the rest of that repository's skills (374, in 16 domains) converted to data in the same way, identity phrasing removed and nothing else edited, listed in `library/CATALOGUE.md`; a project indexes them only when it enables them. None of the source repository's scripts, commands or agents are shipped; a VibeKit skill is data.

The MIT License requires this notice to accompany copies and substantial portions of the work:

```text
MIT License

Copyright (c) 2025 Alireza Rezvani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The library is written into a project as generated files under `<folder>/skills/lib/vibekit/`; this notice travels with the VibeKit package rather than with each project.

## Everything else

An earlier version bundled a curated selection from Everything Claude Code (MIT). That kit was removed with the 1.2 specification; nothing derived from it remains. The Atlas design system stylesheet (`plugin/src/atlas.css`) is VibeKit's own.
