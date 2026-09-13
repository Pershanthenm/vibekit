import { commandIn } from './menu.js';

export { MENU, isMenuSkill } from './menu.js';

export const PLUGIN_CONTEXT = {
  menus: 'claude',
  input: '$ARGUMENTS',
  example: '[project.example.json](project.example.json)',
  cmd: commandIn('vibekit:'),
};
export const PROJECT_CONTEXT = { ...PLUGIN_CONTEXT, example: '`.claude/skills/new-project/project.example.json`', cmd: commandIn('') };
export const CURSOR_CONTEXT = { ...PROJECT_CONTEXT, input: 'the text typed after the command', menus: 'terminal' };

export const contextFor = (project) => (project?.workflow.skills === 'project' ? PROJECT_CONTEXT : PLUGIN_CONTEXT);

const MENU_FLOWS = {
  claude: (cmd) => `## 2. Pin down what you are actually building

Do this **before** any question about platforms or frameworks. "A stock management app" is not
a brief, and neither is "a recipe app": until you know what the thing tracks and how one of
them behaves, a stack is a guess.

1. Run \`vibekit advise domain "<their exact words>" --json\`. It returns the dimensions still to
   settle — subject, identity, lifecycle, actors, proof — each with \`why\` it matters and \`guidance\`
   on how to ask it. These are the same for every app; only the options differ.
2. **Generate the options yourself, in their words.** The \`options\` in the response are bland
   fallbacks. Replace them with the concrete kinds of thing this idea might mean:
   - "a stock management app" → IT equipment and devices · stationery and consumables · parts
     and raw materials · goods for sale
   - "a recipe app" → recipes · ingredients and pantry stock · meal plans · shopping lists
   - "something for my band" → gigs and bookings · songs and setlists · gear · fans and mailing list
   Never offer "items" or "records": a label that fits any app tells you nothing.
3. Ask with **AskUserQuestion**, at most 4 at a time. Put the option you would recommend first
   with \" (Recommended)\" and one line saying why. Anything unlisted goes under Other.
4. Merge answers into \`specs/requirements.json\` and run it again until it reports complete. Phrase
   each later question in terms of what they already said — once the subject is laptops, ask
   about serials and assignment, not "items".
5. **Say the subject back in one sentence** and let them correct it: "an internal register for
   serialised IT equipment assigned to staff, with a warranty view". Every later menu rests on it.

A vague idea is the signal to ask, not to guess. If you cannot picture the main screen from
their answer, keep asking.

## 3. Requirements and stack by menu
 no typing
Works for any developer: web, mobile, desktop or backend, any stack, any licensing policy.
1. Run \`vibekit advise next --json\`. It returns the next round (up to 4 questions, each with up to 4 options) based on the answers so far, or \`{ "complete": true }\`. Rounds adapt: platform first, then constraints, architecture and security, then one question per stack layer the app needs (backend, web, mobile, desktop) with scored options and licences, then the starting point (a boilerplate that fits the chosen stack — ABP, ASP.NET Zero, JHipster, Cookiecutter Django and the like — or from scratch), then data and delivery (database; hosting only when there is a server), then the agent workflow.
2. Ask the round with **AskUserQuestion** (question, header, options with label and description, \`multiSelect\` for multi). Stack-layer options already carry "(Recommended)"; for other questions put the option you'd recommend first with " (Recommended)". Any stack not listed can be typed under Other.
3. If a round comes back empty (a known glitch right after a skill starts), ask it again.
4. Merge the answers into \`specs/requirements.json\` (\`{ "<question id>": "<option id>" }\`, arrays for multi, \`{ "other": "<text>" }\` for Other) and go back to step 1 until complete.
5. Run \`vibekit advise recommend\` and summarise the chosen stack per layer with its licence and main reasons, plus exclusions and warnings. If a boilerplate was chosen, say what it brings, what it costs (licence, conventions you inherit) and the exact command that scaffolds it — the user runs that themselves in the terminal before any feature work, because it writes the whole project layout.
6. Run \`vibekit advise apply\`. It writes \`specs/project.json\`, the final \`specs/requirements.json\` and a technology-selection ADR with per-layer scores, licences and alternatives. For layers typed under Other, fill in their \`commands\` in \`specs/project.json\`, then \`vibekit sync\`.
7. **Security, by menu.** Run \`vibekit security questions --json\`: rounds tailored to the chosen stack, targets, sign-in, licensing and hosting (server questions are skipped for device-only apps; client-app protections appear for mobile and desktop). Each question lists \`defaults\` (the secure choice) and \`required\` (from the compliance level). Ask each round with **AskUserQuestion**, appending " (Recommended)" to every default and keeping "(required)" visible.
8. Write \`specs/security-answers.json\` the same way, then run \`vibekit security apply\`. It stores the baseline in \`specs/project.json\`, generates \`specs/security.md\` and AGENTS.md rules, adds one acceptance criterion per control to the foundation feature, creates \`.github/workflows/security.yml\`, and saves a summary to memory and your knowledge library.
9. If it reports accepted risks, ask with **AskUserQuestion** whether to keep each risk or add the control back; re-apply if anything changes.`,
  terminal: () => `## 2. Requirements by menu — no typing
1. Ask the user to run \`vibekit advise\` in the integrated terminal (\`vibekit init\` if the project doesn't exist yet). It shows arrow-key menus that adapt to the platform (web, mobile, desktop or backend), a scored choice per stack layer with licences, then the security baseline tailored to that stack (secure defaults pre-selected).
2. When it finishes, read \`specs/requirements.json\`, the new technology-selection ADR in \`specs/decisions/\` and \`specs/security.md\`, so you know what was chosen and why.`,
};

const requirementsByMenu = (menus, cmd) => MENU_FLOWS[menus](cmd);

const newProject = ({ input, example, cmd, menus }) => `# New project

Turn this idea into a complete, reviewable specification before any code exists: ${input}

## 0. Scaffold
If the folder isn't a git repository yet, run \`git init\`. If \`specs/project.json\` doesn't exist, run \`vibekit init --yes\` (the menus below fill it in). Code edits stay blocked until a feature is in progress, so nothing gets built before the spec.

## 1. Load your playbook
If knowledge is on, run \`vibekit knowledge manifest\` and read the listed documents: your preferred stacks, standards and known pitfalls from earlier projects. Use them as the recommended defaults below, and say which document each default came from.

${requirementsByMenu(menus, cmd)}

## 4. What menus can't capture
In plain conversation, briefly: the problem in the user's words, primary users, the 3–7 capabilities that make v1, explicit non-goals and success measures. Offer a draft they can correct rather than asking open questions one by one.

## 5. Confirm
Show a compact summary (stack, architecture, targets, sign-in, security and compliance, v1 capabilities) and wait for explicit approval before writing docs.

## 6. Write the spec
1. Review \`specs/project.json\` (written by \`vibekit advise apply\`, shaped like ${example}). Adjust only what the menus couldn't express — for example an exact framework the user typed under Other — and keep \`commands\` runnable.
2. Run \`vibekit sync\` to regenerate AGENTS.md, CLAUDE.md, subagents and Cursor rules.
3. Fill \`specs/00-product.md\` (vision, users, capabilities, non-goals, success metrics) and \`specs/01-architecture.md\` (Mermaid component diagram, modules and responsibilities, data flow, cross-cutting concerns).
4. Record each key choice as an ADR in \`specs/decisions/\` (context, decision, consequences).
5. Draw the living docs with ${cmd('docs')}: \`docs/architecture.md\` (context and container diagrams), plus data model, deployment and design system when they apply. Stamp each one — planning is blocked until the architecture doc is fresh.
6. **Design the screens, then stop.** If any target is web, mobile or desktop, run ${cmd('design')}:
   it produces artboards with Claude Design, hands the user the canvas link and **waits**. Do not
   scaffold features while the canvas is open. When the user approves one it is recorded in the
   feature's design doc, and a feature with screens cannot start until that record exists.
7. Run \`vibekit feature "foundation"\` first: repository skeleton matching the architecture, tooling that makes every command in project.json work (including the \`smoke\` and \`ui\` suites: Playwright for web, Maestro or integration tests for mobile, UI-category tests for desktop), and CI running those commands plus \`vibekit check\`.
8. Run \`vibekit feature "<name>"\` for each v1 capability and fill its \`spec.md\` the way ${cmd('spec-feature')} does. Leave them in \`draft\`.
9. Run \`vibekit check\`, commit everything (\`chore(specs): initial specification\`), and show \`vibekit list\`. If knowledge is on, run \`vibekit knowledge publish\` so the architecture and ADRs are reusable from other projects.
10. Ask the user to approve the foundation spec, then continue with ${cmd('run')}.
`;

const run = ({ input, cmd }) => `# Run the workflow

Scope: ${input} (empty = whole project)

Loop until you reach a human gate or nothing is left:
1. Run \`vibekit next --json\`. It returns \`step\`, \`feature\`, \`command\`, \`gate\` and \`reason\`.
2. If \`gate\` is \`spec-approval\`: complete the spec with ${cmd('spec-feature')} if it still has TODOs, summarise it (stories, acceptance criteria, open questions) and ask the user to approve. Stop.
3. If \`gate\` is \`plan-approval\`: summarise the plan and task lanes and ask to proceed. Stop — unless the user already approved this plan in this conversation.
4. Otherwise execute the step by invoking its skill (${cmd('plan-feature')}, ${cmd('implement-feature')}, ${cmd('review-feature')}) and let it finish.
7. After each step run \`vibekit check\`, fix what it reports, commit with a Conventional Commit message, and post one progress line: feature · step · result.

Restrict the loop to the scope above when one is given. If verification keeps failing after two focused attempts, stop and report the blocker instead of guessing.
`;

const specFeature = ({ input }) => `# Spec a feature

Feature: ${input}

1. Read \`AGENTS.md\` and \`specs/00-product.md\` so the feature fits the product and respects its non-goals.
2. Find the folder in \`specs/features/\`; if none exists, run \`vibekit feature "<short name>"\`. Bugs get a small spec too (1–3 acceptance criteria).
3. Fill \`spec.md\`, replacing every TODO:
   - **Problem** — who has it and why it matters now.
   - **User stories** — "As a <user>, I want <goal> so that <benefit>."
   - **Acceptance criteria** — \`- [ ] AC-n: Given … when … then …\`, each independently testable. Note per-target differences for the targets in the front matter.
   - **Edge cases** — empty, invalid, offline, slow, concurrent, unauthorised.
   - **Out of scope** and **Open questions**.
4. Describe what and why only — no frameworks, files or class names; those belong in the plan.
5. Ask the user the open questions. Only after they explicitly approve, run \`vibekit status <id> approved\`.
`;

const planFeature = ({ input, cmd }) => `# Plan a feature

Feature: ${input}

1. Open \`specs/features/<id>/spec.md\`. If its status is not \`approved\`, stop and say so.
2. Run \`vibekit context <id>\`: one brief with past-session memories (agentmemory) and documents from your knowledge library (OpenContext). Read any documents it points to that bear on the design, and fold earlier decisions, API contracts and pitfalls into the plan. Where they conflict with the spec or ADRs, the files win — flag it.
3. Delegate to the **architect** subagent and write \`plan.md\`:
   - Modules and layers touched, and why that placement follows \`specs/01-architecture.md\`.
   - Data model and migration changes; contracts (requests, responses, errors, events).
   - UI states per target (loading, empty, error, success) when there is UI.
   - Test strategy: map every AC to at least one test and its level (unit, integration, UI). Every AC a user can see gets a **UI test** (browser, mobile or desktop, with an accessibility check). The feature's critical path gets at least one **smoke** test, tagged \`@smoke\` (or \`Category=Smoke\` / \`pytest.mark.smoke\`), fast enough to run on every build.
   - How the NFRs in \`specs/04-nfr.md\` are met; risks and rollback.
   If the feature cannot fit the current architecture, draft an ADR in \`specs/decisions/\` and stop for approval.
4. Fill the plan's \`## Documentation\` section: which docs this feature creates or changes (its feature doc, a design doc when there is UI, and architecture, data model or deployment diagrams if it touches them). Changing architecture means an ADR plus ${cmd('rearchitect')}, not a quiet edit.
5. Write \`tasks.md\` as an ordered checklist: \`- [ ] T-n [test|impl|docs] <what> (AC-n) — <files>\`. Keep each task to one focused change, and end with a \`[docs]\` task covering the Documentation section.
7. Design for parallelism: shared groundwork (contracts, types, schema) first as sequential tasks, then a block of consecutive \`[P]\` tasks that touch disjoint files (e.g. API, web UI, mobile UI), then integration and e2e tasks. Tag \`[P]\` only when files don't overlap.
8. Run \`vibekit status <id> planned\`, then \`vibekit lanes <id>\` and summarise the plan and lanes in a few lines.
`;

const implementFeature = ({ input, cmd }) => `# Implement a feature

Feature: ${input}

1. Read the feature's \`spec.md\`, \`plan.md\` and \`tasks.md\`. Its status must be \`planned\` or \`in-progress\`; run \`vibekit status <id> in-progress\` and commit \`specs/\`.
2. Work through open tasks in order:
   - \`[test]\` tasks → **test-engineer** agent: unit, UI and smoke tests from the acceptance criteria that fail for the right reason, each named \`<feature number>:AC-<n> …\` (e.g. \`003:AC-2 rejects a retired laptop\`); smoke tests also carry the smoke tag.
   - \`[impl]\` tasks → **implementer** agent: the smallest change that makes those tests pass, following AGENTS.md.
   - \`[docs]\` tasks → ${cmd('docs')}: update documents and diagrams from the code as built, then stamp them.
   - When the next open tasks form a block of \`[P]\` tasks, hand them to ${cmd('dispatch')} (parallel agents in git worktrees). For a block of two small tasks, parallel implementer subagents in this session are fine.
3. After each task run the lint, typecheck and test commands from AGENTS.md and fix failures before moving on. The Stop hook runs the test command itself once a task is ticked, so a failure ends the turn either way. Then tick the task, tick any AC now proven by a passing test (\`vibekit verify <id>\` shows which are traced), and commit. Code touching auth, data access or configuration must follow \`specs/security.md\`.
4. If a task shows the spec or plan is wrong, stop and propose the change instead of improvising.
5. When every task is ticked, run ${cmd('review-feature')}.
`;

const dispatch = ({ input, cmd }) => `# Dispatch parallel lanes

Feature: ${input}

1. Run \`vibekit lanes <id>\`. It shows each ready lane and who will build it: \`workflow.routes\` sends lanes to Cursor or Claude by the files they touch, and everything else goes to \`workflow.engine\`. If no \`[P]\` tasks are ready, continue sequentially with ${cmd('implement-feature')}.
2. Commit everything first — worktrees start from HEAD, so uncommitted specs or code are invisible to the lanes.
3. Run \`vibekit dispatch <id>\` **as a background command**. Engine comes from \`workflow.engine\` (override with \`--engine cursor|claude|manual\`). It creates a git worktree and branch per lane, installs dependencies and starts one headless agent per lane. With \`manual\` it only prepares worktrees and prompt files for the user to open as Cursor agents.
4. While lanes run, do work that doesn't touch their files, or check progress with \`vibekit lanes <id>\`.
5. When every lane has finished, run ${cmd('merge-lanes')}.
`;

const mergeLanes = ({ input, cmd }) => `# Merge parallel lanes

Feature: ${input}

1. Make sure the working tree is clean (commit or stash).
2. Run \`vibekit merge <id>\`. It merges each finished lane branch with \`--no-ff\`, removes its worktree and prints the tasks each lane covered.
3. On a conflict: resolve it preserving both lanes' intent, commit, and run \`vibekit merge <id>\` again.
4. Run lint, typecheck and test on the merged result; fix failures with the implementer agent. Run \`vibekit docs status\` — lane changes often make diagrams stale.
5. Tick the merged tasks in \`tasks.md\` and any acceptance criteria now proven by passing tests, then commit.
7. If a conflict or failure taught something reusable (e.g. two lanes both touched a shared file), save it: \`vibekit memory remember "<lesson and why>"\`.
8. Continue with ${cmd('run')}.
`;

const reviewFeature = ({ input }) => `# Review a feature

Feature: ${input}

Delegate to the read-only **reviewer** subagent, and write \`specs/features/<id>/review.md\`:
1. **Spec coverage** — run \`vibekit verify <id> --run\`: every AC traced to a passing test, or ❌ missing.
2. **Architecture** — dependency direction and module boundaries per \`specs/01-architecture.md\`.
3. **Standards** — violations of \`specs/03-standards.md\` with file:line.
4. **Security & NFRs** — every control in \`specs/security.md\` the change touches, plus input validation, authorisation, secrets, accessibility and performance budgets.
5. **Docs** — do the feature doc, design doc and any touched diagrams match the code? \`vibekit docs status\` must be clean for this feature.
7. **Verdict** — blocking issues first, then suggestions.

Record the outcome in \`specs/features/<id>/review.md\`, which is scaffolded with every feature. The
done gate reads it, so it has to be accurate rather than tidy:
- Front matter needs \`verdict: approved\` or \`verdict: changes-requested\`, \`commit: <sha of the commit you
  actually read>\` (\`git rev-parse HEAD\`), and \`reviewer:\`.
- Write each finding as \`- [ ] BLOCKER: <what>\`, \`MAJOR\` or \`MINOR\`. An unticked BLOCKER or MAJOR
  blocks \`done\`, so tick one only once it is genuinely resolved.
- Leave the verdict at \`changes-requested\` until it is honestly approved. Approving to unblock the
  gate defeats the point of having it.

Present the findings and ask before fixing anything. When nothing blocking remains:
1. Commit everything (review, docs, ticks) — evidence is tied to a clean commit. A commit that only touches \`review.md\` does not invalidate evidence or the review itself.
2. Run \`vibekit verify <id> --run\`: tests, smoke and UI suites run, criteria are traced, and the result is recorded as evidence for that commit. Each suite runs \`standards.testing.runs\` times (\`--repeat <n>\` to override). A suite that passes on some runs and not others is reported as **flaky** and does not count as evidence — fix the flake rather than re-running until it comes out green.
3. Run \`vibekit status <id> done\`. It refuses while criteria, tasks, docs or evidence fall short. Save any non-obvious lesson from the review with \`vibekit memory remember\`; if it applies beyond this project, add it to your playbook with /opencontext-iterate. Finishing publishes the feature record to OpenContext automatically.
`;

const specCheck = () => `# Spec check

1. Run \`vibekit check\` and \`vibekit list\`.
2. Summarise problems grouped by feature, then drift in generated files.
3. Propose fixes and ask before applying them. Generated files are fixed by editing \`specs/project.json\` and running \`vibekit sync\`, never by hand.
`;

const clarifySkill = ({ input, cmd }) => `# Clarify a spec before it is planned

Scope: ${input} (empty = the feature the workflow is on)

A spec that reads well can still be undecided. This finds what is not settled **before** a plan
is written, because an assumption baked into a plan is far more expensive to unpick later.

1. Run \`vibekit analyze [feature] --json\`. Anything under \`vague\` is already flagged: read those criteria first.
2. Read the feature's \`spec.md\` and look for what it does **not** say:
   - acceptance criteria that cannot be turned into a passing test as written (no observable outcome, no threshold, no actor);
   - nouns used but never defined, and states no criterion covers (empty, expired, duplicate, offline, unauthorised);
   - limits nobody has set: how many, how large, how long, how old;
   - error paths: what the user sees, and what the system does, when each step fails;
   - anything that reads as a decision but names no alternative that was rejected.
3. Ask the user **only** about the gaps that would change what gets built. Use **AskUserQuestion**,
   at most 4 at a time, each option a concrete choice rather than a restatement of the question.
   Put the option you would pick first, with \" (Recommended)\" and one line saying why.
4. Write the answers into \`spec.md\` as acceptance criteria or explicit non-goals. Do not leave them in chat.
5. For anything the user cannot answer yet, write \`TODO(unknown): <question>\` in the spec and say so plainly.
   An open question that is written down is cheap; one that is guessed at is not.
7. Re-run \`vibekit analyze [feature]\` — add \`--fix\` to append criteria with no task or no test to \`tasks.md\` as work, then name the files each one touches — and continue with ${cmd('plan-feature')}.
`;
const checklistSkill = ({ input, cmd }) => `# Quality checklist for a feature

Scope: ${input} (empty = the feature the workflow is on)

Acceptance criteria say what the feature must do. A checklist covers what it must not get wrong:
the states, limits and failures that criteria routinely miss. Treat it as unit tests for the spec.

1. Run \`vibekit analyze [feature]\` and read the feature's \`spec.md\`, the project's security baseline
   (\`specs/security.md\`) and its non-functional requirements (\`specs/04-nfr.md\`).
2. Generate a checklist under \`## Checklist\` in the feature's \`spec.md\`, as \`- [ ] CL-n: <check>\`,
   drawn from what this feature actually touches:
   - **States**: empty, one, many, maximum; loading, error, partial, offline.
   - **Boundaries**: the smallest and largest allowed value, and the first one rejected.
   - **Permissions**: every role that must be refused, not only the one that is allowed.
   - **Data**: what is written, what is audited, what is exported, what must never leave.
   - **Failure**: what the user sees, what is logged, what is rolled back.
   - **Accessibility and NFRs**: only the targets this project has actually set.
3. Keep each item checkable by a person in under a minute. Delete anything generic enough to
   apply to any feature: a checklist nobody reads is worse than none.
4. Anything that turns out to be a missing requirement belongs in the spec as an acceptance
   criterion instead, so a test can prove it. Say which items you promoted.
5. Review the checklist with the user before ${cmd('implement-feature')}.
`;
const designSkill = ({ input, cmd }) => `# Design the screens, then wait

Scope: ${input} (empty = the feature the workflow is on)

A layout settled after the code is written means building it twice. This produces the screens,
**stops for you**, and only resumes once you have approved one.

## 1. Produce artboards

Prefer the Claude Design MCP server. Check it is connected with \`claude mcp list\`; if it is missing
or unauthenticated, say so and give the user these two steps rather than working around it:

\`\`\`
claude mcp add --scope user --transport http claude-design https://api.anthropic.com/v1/design/mcp
/design-login
\`\`\`

If the project already has a design system, run \`/design-sync\` first so the artboards start from your
real components rather than generic ones. Where the MCP server is unavailable, fall back to the
built-in \`/design\` canvas and say which route you used — never imply a design system was applied
when it was not.

Generate **several options** per screen the feature needs, taken from its acceptance criteria:
every state those criteria imply (empty, loading, error, full), not only the happy path.

## 2. Stop

Give the user the canvas link and a one-line description of each artboard, then **wait**. Do not
scaffold, plan or write code while the design is open. This is a human gate like spec approval:
summarise, ask which artboard they want, and wait for an explicit answer. They will often edit the
canvas themselves, and the version you hand over is rarely the version they approve.

## 4. Record what was approved

Once they choose, create the design doc with \`vibekit docs new design <feature>\` and fill in the
front matter so the decision is recorded rather than remembered:

\`\`\`
artboard: <the approved artboard name or id>
canvas: <the canvas URL>
approved_by: <who approved it>
\`\`\`

In the body, describe the user flow as a Mermaid \`flowchart\` or \`journey\`, and the states each
acceptance criterion requires. Then run \`vibekit docs stamp <path>\`.

## 5. Resume

A feature targeting web, mobile or desktop cannot move to \`in-progress\` until its design doc names
an approved artboard, so recording it is what unblocks the build. Continue with ${cmd('run')}.

Features with no screens — an API, a migration, CI — are not gated and need no design.
`;

const docsSkill = ({ input, cmd }) => `# Update living docs

Scope: ${input} (empty = everything flagged)

1. Run \`vibekit docs status\`. Create missing required docs with \`vibekit docs new <kind> [feature]\` (kinds: architecture, data-model, deployment, design-system, feature, design).
2. For each flagged doc, read every file in its \`sources\` front matter — specs, plans and code — and rewrite it to describe how the system works **now**. Specs describe intent, docs describe reality; where they differ, flag it to the user.
3. Diagrams are Mermaid, drawn from the code rather than from memory, small and labelled:
   - architecture → context + container flowcharts (or C4); data model → \`erDiagram\` from the actual schema; deployment → flowchart of environments and services;
   - feature → sequence diagram of the main flow (state diagram when lifecycle matters); design → user-flow flowchart plus screen and state tables per target.
4. Keep \`sources\` honest: add files the doc now covers, drop ones it no longer describes.
5. Run \`vibekit docs stamp <path>\`. It refuses TODOs, invalid Mermaid and unchanged docs whose sources moved; use \`--still-accurate\` only after checking the doc against every changed source.
7. Repeat until \`vibekit docs status\` is clean for the scope, then commit (\`docs: …\`).
`;

const rearchitect = ({ input, cmd }) => `# Re-architect

Change: ${input}

1. Capture the current state: \`specs/01-architecture.md\`, \`docs/architecture.md\`, the ADRs in \`specs/decisions/\`, \`vibekit docs status\` and \`vibekit context "<change>"\`.
2. Draft the next ADR (\`specs/decisions/NNNN-<slug>.md\`, status **proposed**): context, options considered with trade-offs, decision, consequences, migration steps. Present it and stop until the user approves.
3. On approval: set the ADR to **accepted**, update \`specs/01-architecture.md\` and \`specs/project.json\` (stack, architecture notes), then \`vibekit sync\`.
4. In the same turn, update every document \`vibekit docs status\` flags — architecture diagrams first, then deployment, data model and design system — using ${cmd('docs')}. The stop hook will not let the turn end with stale architecture docs.
5. Impact: list in-flight and done features affected. Append a note to affected plans; for code that must move, create a migration feature (\`vibekit feature "migrate: <change>"\`) whose acceptance criteria describe the end state.
7. Save the reasoning to memory (\`vibekit memory remember\`) and, if knowledge is on, run \`vibekit knowledge publish\`.
`;

const securitySkill = ({ input, cmd }) => `# Security baseline

Change: ${input} (empty = review the whole baseline)

1. Run \`vibekit security status\` to see current controls, how each is implemented on this stack, accepted risks and test traceability.
2. Run \`vibekit security questions --json\` and ask the relevant rounds with **AskUserQuestion**, marking the current selections and secure defaults " (Recommended)" and keeping "(required)" visible.
3. Write \`specs/security-answers.json\` and run \`vibekit security apply\`. New controls become acceptance criteria in the foundation or security-baseline feature; existing ones are not duplicated.
4. Confirm any accepted risks with the user. Update \`docs/security/threat-model.md\` with ${cmd('docs')} if data flows or trust boundaries changed.
`;

const setupSkill = ({ input, cmd }) => `# Set up this machine from Claude

Scope: ${input} (empty = everything this machine and project need)

1. Run \`vibekit setup --json\`. It lists what is already working (\`ready\`) and the steps still needed (\`steps\`: install, configure or start), each with its exact command.
2. If \`steps\` is empty, say everything is installed and continue with ${cmd('health')}.
3. Ask which steps to run with **AskUserQuestion**: multi-select questions of up to 4 options each (split into several questions if needed). Label = the tool's name plus " (Recommended)", description = what it's for and the command it runs. Don't offer steps marked \`manual\`; list them afterwards with their instructions. Steps marked \`interactive\` need a browser sign-in or prompts: mention that the user will run those in Cursor's terminal (View → Terminal).
4. Run the chosen steps with \`vibekit setup --yes --only "<id>,<id>"\` (quote the id list: PowerShell mangles an unquoted one). In this mode it never runs \`interactive\` steps: it prints them instead, for the user to run in Cursor's terminal. Installers print a lot; summarise what happened rather than repeating it. If a step waits for a password (\`sudo\`) or another prompt you can't answer, stop and ask the user to run that one command in Cursor's terminal (View → Terminal).
5. Tell the user about sign-ins you can't do for them: Cursor's CLI (\`agent login\` in Cursor's terminal).
6. Finish with ${cmd('health')}.
`;

const scanSkill = ({ input }) => `# What is actually wrong with this project

Scope: ${input} (empty = the whole project)

1. Run \`vibekit scan --json\`. It reports \`score\`, \`findings\` (each with \`id\`, \`severity\`, \`category\`, \`title\`, \`why\`, \`action\`) and \`notScanned\`.
2. Lead with what is worst. **critical** means a feature claims to be finished with nothing supporting the claim; that is the one to say out loud first.
3. Say what was **not** scanned, in the same breath and with the same weight as what was. \`notScanned\` carries the reason for each. There is no vulnerability, dependency or secret scanner wired up, so a clean scan is not a statement about security and must never be reported as one.
4. Findings with an \`action\` can be fixed by a command; the rest need a person and a decision. Offer the fixable ones as a batch, say what each command will do, and get a yes before running anything.
5. Run agreed fixes with the command the finding names (\`vibekit sync\`, \`vibekit analyze --fix\`, \`vibekit verify --all --run\`), then rescan and report what actually changed — not what was supposed to change.
6. To pick and run fixes in a browser, or to watch them from a phone: \`vibekit dashboard --serve --tunnel\`, then the Scan pages.
`;

// Written as single-quoted lines rather than a template literal: every line here is thick with
// backticks, and escaping each one is how a command in a skill quietly turns into nonsense.
const standardsDiscoverSkill = ({ input }) => [
  '# Write down the conventions this codebase already has',
  '',
  `Scope: ${input} (empty = wherever nothing is written down yet)`,
  '',
  '1. Run `vibekit standards discover --json`. It reports each area of the codebase, how many',
  '   files are in it, a handful of examples, and which standards already speak for it. It',
  '   deliberately does **not** say what the conventions are: that is the part that needs reading',
  '   and judgement, and a command that guessed would write confident nonsense into a file people',
  '   then trust.',
  '2. Take the uncovered areas, worst first. For each, read the example files it names — and enough',
  '   neighbours to tell a convention from one file\'s habit. Three files agreeing is a convention;',
  '   one file is an anecdote.',
  '3. Write what you find as `standards/<domain>/<topic>.md`, with front matter: `description` (a',
  '   sentence in the words someone would use asking about it — injection matches on this, so it is',
  '   the load-bearing field) and optional `globs` for rules that belong to a kind of file. Keep',
  '   each one short and specific, in the imperative, and **only include rules the code actually',
  '   follows**. A rule the codebase does not follow is a proposal, not a standard: put those to the',
  '   user separately.',
  '4. Quote where you saw each convention, so the user can check you. Say which ones you were unsure',
  '   about rather than dropping them silently.',
  '5. Run `vibekit standards index` to rebuild the index, then show the user what you wrote and ask',
  '   them to approve, edit or delete each one. These are their rules, not yours.',
  '6. This pairs with adoption: `vibekit adopt` describes the stack, this describes the habits.',
  '',
].join('\n');

const memorySkill = ({ input }) => `# Manage what the agents remember

Scope: ${input}

1. \`vibekit memory list\` shows what is held for this project, newest first, with an id on every row. \`vibekit memory search "<text>"\` finds a particular one, also with ids.
2. A wrong memory is repeated into every brief until someone removes it. Read the ones that matter back to the user in their own words and ask whether each is still true.
3. Correct one with \`vibekit memory correct <id> "<the right version>"\` — it deletes the old one and saves the replacement. Delete one outright with \`vibekit memory forget <id>\`. **Both are irreversible.** Show exactly what will go and get an explicit yes first; never act on silence or a vague "sure".
4. Report what actually happened. The count that comes back is what was found and removed, which is not always what was asked for.
5. \`vibekit memory capture\` shows what vibekit records without being asked (spec, done, lanes, health, security); pass the kinds to keep, or \`none\`. What the user saves themselves is always kept, whatever this is set to.
6. If nothing comes back at all, check \`vibekit memory status\` before concluding the project has no memories.
`;

const healthSkill = ({ input, cmd }) => `# Check this machine and project

Scope: ${input}

1. Run \`vibekit health --json\`. Add \`--live\` before a first real run, or when the user asks for a full check (it sends a few one-line prompts to Claude and Cursor).
2. Summarise briefly: what works, then each problem with its fix. Group by tools, project and live checks.
3. For problems whose fix is a command, offer to run it through ${cmd('setup')}. Explain the ones only the user can do: signing in, and starting Docker Desktop if this project uses containers.
`;

export const SKILLS = [
  {
    name: 'new-project',
    description: 'Interview the user and produce a complete project specification: specs/project.json, product and architecture docs, ADRs and first feature specs. Use when starting a new project.',
    argumentHint: '[idea]',
    userOnly: true,
    body: newProject,
  },
  {
    name: 'run',
    description: 'Autopilot for the spec-driven workflow: repeatedly executes the next step (spec, plan, implement, dispatch, review) until a human gate. Use when the user says continue, build it, next, or keep going.',
    argumentHint: '[feature id or goal]',
    body: run,
  },
  {
    name: 'spec-feature',
    description: 'Write or refine a feature spec with user stories and testable acceptance criteria. Use when the user describes a new feature, a behaviour change or a bug.',
    argumentHint: '<feature description>',
    body: specFeature,
  },
  {
    name: 'plan-feature',
    description: 'Turn an approved feature spec into a technical plan and a task list designed for parallel lanes.',
    argumentHint: '<feature id>',
    body: planFeature,
  },
  {
    name: 'implement-feature',
    description: 'Implement a planned feature task by task with tests first, dispatching [P] blocks to parallel agents.',
    argumentHint: '<feature id>',
    body: implementFeature,
  },
  {
    name: 'dispatch',
    description: 'Run a ready block of [P] tasks in parallel: one git worktree and one Cursor or headless Claude agent per lane.',
    argumentHint: '<feature id>',
    body: dispatch,
  },
  {
    name: 'merge-lanes',
    description: 'Merge finished parallel lanes back, verify, and tick their tasks.',
    argumentHint: '<feature id>',
    body: mergeLanes,
  },
  {
    name: 'review-feature',
    description: 'Review a feature against its spec, the architecture and the coding standards.',
    argumentHint: '<feature id>',
    body: reviewFeature,
  },
  {
    name: 'docs',
    description: 'Create or update living documentation and Mermaid diagrams (architecture, data model, deployment, design system, feature and design docs) from the code as built, then stamp them fresh. Use after building, merging lanes, or when docs are flagged stale.',
    argumentHint: '[doc path, feature id or "all"]',
    body: docsSkill,
  },
  {
    name: 'rearchitect',
    description: 'Change the architecture safely: ADR for approval, spec and project.json updates, then every affected diagram and document in the same turn, plus a migration feature. Use when the user wants to restructure, swap technology or change boundaries.',
    argumentHint: '<architecture change>',
    body: rearchitect,
  },
  {
    name: 'security',
    description: 'Review or change the security baseline by menu: controls tailored to the stack, required controls by compliance level, accepted risks, and test traceability. Use when the user asks about security, auth, secrets or compliance.',
    argumentHint: '[change]',
    body: securitySkill,
  },
  {
    name: 'setup',
    description: 'Install, configure and start everything this machine and project need, chosen from a menu. Use when setting up a new machine, after changing the project\'s engine or tools, or when the health check reports missing pieces.',
    argumentHint: '[tool ids, e.g. cursor-agent]',
    userOnly: true,
    body: setupSkill,
  },
  {
    name: 'health',
    description: 'Check that every tool this project needs is installed and working (Claude Code, Cursor CLI, memory, knowledge, hooks), and explain fixes. Use when something seems broken or before a first run.',
    argumentHint: '[live]',
    body: healthSkill,
  },
  {
    name: 'scan',
    description: 'Report what is actually wrong with this project - drift, untraced criteria, missing evidence, stale docs - worst first, with the fixes that can be run and an honest account of what was not scanned. Use when asked how the project is doing, before a release, or when picking up work after a break.',
    argumentHint: '[area]',
    body: scanSkill,
  },
  {
    name: 'memory',
    description: 'Show what the agents remember about this project, correct or delete what is wrong, and choose what gets recorded automatically. Use when a memory is out of date, when the user asks what it knows, or before relying on recalled context.',
    argumentHint: '[what to look for]',
    body: memorySkill,
  },
  {
    name: 'standards-discover',
    description: 'Read an existing codebase and write its recurring conventions down as draft standards for review. Use after adopting a repository, or when code review keeps repeating the same comment.',
    argumentHint: '[area]',
    body: standardsDiscoverSkill,
  },
  {
    name: 'design',
    description: 'Produce screen artboards with Claude Design, wait for the user to approve one, and record it so the build can start. Use before implementing any feature with a UI.',
    argumentHint: '[feature]',
    body: designSkill,
  },
  {
    name: 'clarify',
    description: 'Find what a feature spec has not decided yet and ask the user, before a plan is written. Use after writing a spec and before planning.',
    argumentHint: '[feature]',
    body: clarifySkill,
  },
  {
    name: 'checklist',
    description: 'Generate a quality checklist for a feature: the states, limits and failures acceptance criteria usually miss.',
    argumentHint: '[feature]',
    body: checklistSkill,
  },
  {
    name: 'spec-check',
    description: 'Validate specs and detect drift in generated agent files.',
    body: specCheck,
  },
];
