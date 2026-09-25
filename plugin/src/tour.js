import { homedir } from 'node:os';
import { join } from 'node:path';
import { readText, writeText } from './fsutil.js';

/**
 * First run and the guided tour. Specification §65.
 *
 * Four rules from §65 shape everything here, and each one rules out the obvious implementation:
 *
 *   * **Show, then do.** Every explanation is immediately followed by the real step. No screen
 *     is purely informational, which is why each stop names the command that performs it.
 *   * **No fake data, no sandbox project.** The tour produces a real folder on the user's real
 *     repo. A tour that builds a toy teaches nothing transferable.
 *   * **Never block.** `q` exits permanently, and that is recorded in machine settings, never in
 *     the project folder — a colleague cloning the repo gets their own first run.
 *   * **Under sixty seconds of reading in total.** Seven stops, roughly eighty words each, with
 *     `?` holding the detail for people who want it.
 *
 * The pitch below appears on first run only. §65: "a product that keeps describing its
 * competitor sounds unsure of itself."
 */

export const PITCH = `  VibeKit — next-generation spec-driven development

  Coding assistants are fast, and they guess. Ask for a booking system and you
  get invented table names, rules nobody agreed, and code that looks finished.

  VibeKit puts one folder in your repo that every assistant reads — what the app
  is, what they may and may not do, what your words mean, what has been decided.
  When an assistant does not know something, it writes the question down and
  stops. You answer. It carries on. It never fills the gap with a guess.

  Coming from Spec Kit or similar? Those get you a good spec and a first
  generation, then leave you alone. VibeKit is built for everything after:

    - small changes stay small: a twenty-minute fix takes twenty minutes
    - "tests pass" is a captured exit code, not a sentence an assistant wrote
    - a crashed session resumes from a checkpoint, in any tool
    - every line traces back to the sentence in your brief that asked for it
    - it reads code you already have instead of assuming a blank page

  Everything lives in plain Markdown in git. Delete the folder and nothing breaks.`;

export const AFFORDANCES = '[enter] go  [?] more  [q] exit tour';

/**
 * The seven stops. One per stage, because the tour runs the real stages on real work rather than
 * describing them: stop N is stage N − 1, and its command is what actually performs it.
 */
export const STOPS = Object.freeze([
  {
    name: 'Describe',
    framing: 'Tell me what you want, or hand me the document you already have',
    happens: 'You describe the app in your own words, or point me at a brief, a BRS or a spec you already have.',
    why: 'Everything downstream cites this. A requirement that cannot point at a sentence you wrote is a requirement somebody invented.',
    produces: 'product/sources/ (what you gave me, sectioned), product/context.md (three sentences: what it is, who uses it, what must not go wrong)',
    rule: 'Context is capped at 300 tokens. If the scope does not fit in three sentences, it is not decided yet.',
    run: 'vibekit run',
    stage: 0,
  },
  {
    name: 'Questions',
    framing: 'The step that stops the guessing',
    happens: 'I read what you wrote and work out what I do not know. You get about eight questions, plain language, with options.',
    why: 'This is the step that stops the guessing. Every question here is a thing that would otherwise be invented and found three weeks later.',
    produces: 'workflow/asks/ (the questions), assumptions.md (smaller gaps I filled in myself, for you to check)',
    rule: 'Questions that would change the shape of the app block progress. Everything else becomes a written assumption. Nothing is decided silently.',
    run: 'vibekit ask list',
    stage: 1,
  },
  {
    name: 'How it is built',
    framing: 'You approve the stack and shape once; everything after follows from it',
    happens: 'I propose the stack, the layers, and what may reference what, with the reason for each choice.',
    why: 'You approve the shape once. After that every requirement inherits it, so nobody re-argues the architecture per feature.',
    produces: 'workflow/architecture.md, product/map.md (where code goes and the exact build and test commands)',
    rule: 'A gate is a line a human writes. Nothing advances until you approve this one.',
    run: 'vibekit run',
    stage: 2,
  },
  {
    name: 'How it looks',
    framing: 'Your design, or a restrained default — skip if there is no interface',
    happens: 'I extract your design tokens from a URL or a file, or use a restrained default, and write the component list.',
    why: 'Agents invent spacing, colour and component names otherwise, and the result looks like four people built it.',
    produces: 'product/design/tokens.md, product/design/components.md',
    rule: 'Skip this entirely if there is no interface. An unused design system is a file that drifts.',
    run: 'vibekit run',
    stage: 3,
  },
  {
    name: 'Order of work',
    framing: 'Small pieces, in dependency order, with a working empty app first',
    happens: 'I cut the work into requirements, size each one, and order them so nothing waits on something unbuilt.',
    why: 'Phase 0 is a walking skeleton: an app that runs, deploys and answers a health check before any feature exists.',
    produces: 'product/requirements/REQ-*.md, workflow/plan.md (a dependency graph, in phases)',
    rule: 'A requirement carries its own acceptance criteria in EARS form. There is no separate task list.',
    run: 'vibekit req list',
    stage: 4,
  },
  {
    name: 'Build',
    framing: 'One piece at a time: approach, failing tests, code, checks',
    happens: 'One requirement per session: the approach first, then a failing test per criterion, then the code, then the checks.',
    why: 'A criterion pinned by a failing test cannot be quietly reinterpreted later.',
    produces: 'src/**, tests/**, and the requirement\'s Approach, Checkpoint, Evidence and Log',
    rule: '"Tests pass" is a captured exit code, never a sentence an assistant wrote. No agent may set a requirement done.',
    run: 'vibekit req start <REQ> --as implementer',
    stage: 5,
  },
  {
    name: 'Check',
    framing: 'A second assistant on a different model, then you say done',
    happens: 'A reviewer reads the diff against the criteria — a fresh session, one tier up, on a different model.',
    why: 'Reviewing with the implementer\'s context is reviewing with its blind spots. Then you close it, because only a human does.',
    produces: 'the requirement\'s Verification and Review, then status: done',
    rule: 'The reviewer cannot touch application code: it cannot fix and then approve its own fix.',
    run: 'vibekit check --done <REQ>',
    stage: 6,
  },
]);

/**
 * Brownfield has its own path (§65): four stops, and they are about what converting will and
 * will not change rather than about the stages.
 */
export const BROWNFIELD_STOPS = Object.freeze([
  {
    name: 'What I am about to read',
    framing: 'The tree, the build files, the schema, the routes, the tests, the CI, and the last 200 commits',
    happens: 'I read structure first, then one representative file per layer, then wherever a question sends me.',
    why: 'Reading everything costs more than it is worth. Reading nothing means guessing.',
    produces: 'nothing yet — this step is read-only',
    rule: 'A first pass is budgeted at 40,000 tokens of reading, and the budget is reported.',
    run: 'vibekit analyze .',
  },
  {
    name: 'What I found',
    framing: 'What the app is, how it is built, what it talks to, and how well tested it is',
    happens: 'I write the understanding report: every section with a confidence and the files it came from.',
    why: 'You correct it. A picture you have not checked is not a picture you can build on.',
    produces: 'vibekit/understanding.md (authored — it is yours to fix)',
    rule: 'Every claim cites the file it came from, so `vibekit why` works on the understanding too.',
    run: 'vibekit analyze .',
  },
  {
    name: 'What I could not tell',
    framing: 'Who uses this, which integrations are live, what the data classifications are',
    happens: 'Only what the code cannot answer becomes a question. Ten at most.',
    why: 'These are exactly the things an agent would otherwise invent from field names.',
    produces: 'workflow/asks/',
    rule: 'Answers correct the report, not only the ask.',
    run: 'vibekit ask list',
  },
  {
    name: 'What converting will and will not change',
    framing: 'It writes the folder. It does not touch your code',
    happens: 'The corrected understanding becomes the folder: context, map, entities, standards, guardrails, memories.',
    why: 'From here the project is worked the VibeKit way, with rules-only mode: no application code is generated.',
    produces: 'the folder and the pointer files',
    rule: 'Existing files are never modified. Your CLAUDE.md is kept below the `<!-- local -->` marker.',
    run: 'vibekit new project --import .',
  },
]);

// ---------------------------------------------------------------- machine settings (§65)

/**
 * §65: "`q` exits permanently, recorded in machine settings, never in the project folder — a
 * colleague cloning the repo gets their own first run." So this lives beside the other per-machine
 * files and nothing about it is committable.
 */
export const settingsPath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'settings.json');

export async function readSettings() {
  try {
    const parsed = JSON.parse((await readText(settingsPath())) ?? '{}');
    return { pitchShown: Boolean(parsed.pitchShown), tourDone: Boolean(parsed.tourDone), tourStop: Number(parsed.tourStop) || 0 };
  } catch {
    return { pitchShown: false, tourDone: false, tourStop: 0 };
  }
}

export async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  await writeText(settingsPath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Whether the pitch should appear at all.
 *
 * `--no-tour`, `CI=true` or a non-interactive terminal skip straight past it (§65). A pitch
 * printed into a build log is noise, and a prompt nobody can answer is a hang.
 */
export const shouldGreet = ({ settings, noTour = false, env = process.env, isTty = Boolean(process.stdout.isTTY) } = {}) => {
  if (noTour || settings.pitchShown || settings.tourDone) return false;
  if (String(env.CI ?? '').toLowerCase() === 'true' || env.VIBEKIT_NO_TOUR) return false;
  return isTty;
};

// ---------------------------------------------------------------- rendering

export function renderStop(stop, index, total) {
  return [
    `  Step ${index + 1} of ${total} - ${stop.name}${' '.repeat(Math.max(1, 36 - stop.name.length))}${AFFORDANCES}`,
    '',
    `  What happens: ${stop.happens}`,
    '',
    `  Why it exists: ${stop.why}`,
    '',
    `  Produces: ${stop.produces}`,
    '',
    `  Rule: ${stop.rule}`,
    '',
    `  Run: ${stop.run}`,
  ].join('\n');
}

export const CLOSING = `  That is the loop. From here on, \`vibekit run\` does whatever comes next -
  you rarely need another command.

  Worth knowing:
    vibekit show why <file:line>   why does this line exist
    vibekit show cost              spend, forecast, waste
    vibekit tracker                the same view on your phone

  Tour finished. It will not interrupt you again.`;

/** The one-line framing table, which is the whole tour at a glance. */
export const framings = (stops = STOPS) => stops.map((stop, index) => `  ${index + 1} ${stop.name.padEnd(18)} ${stop.framing}`);
