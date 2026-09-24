import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { slugify } from './frontmatter.js';
import { exists, readText, writeText } from './fsutil.js';

/**
 * Idea assessment. Specification §68.
 *
 * "Before `vibekit project new` there is a question VibeKit had no place for: should this be built
 * at all?" Five steps, each a file in `assess/<slug>/`, and the output is a decision record, not a
 * specification. It works in a folder with no code in it.
 *
 * Without a model in the loop, the files are structured for a person or an analyst session to
 * fill: each names its questions, and `--decide` records the verdict with its reasoning.
 */

export const STEPS = Object.freeze([
  { file: '1-intake.md', title: 'Intake', asks: ['What is the idea, in one paragraph?', 'Who is it for?', 'What makes you think they want it — a fact, or a hunch?', 'What would success look like, measured how?'], produces: 'The idea in one page, with claims separated from facts' },
  { file: '2-research.md', title: 'Research', asks: ['What already exists that does this?', 'What does it cost, and what do people say about it?', 'What have others learned building it?', 'What could not be found?'], produces: 'Findings with sources, and what could not be found' },
  { file: '3-define.md', title: 'Define', asks: ['Who exactly?', 'Doing what exactly?', 'Instead of what?'], produces: 'The problem statement and the people it belongs to' },
  { file: '4-shape.md', title: 'Shape', asks: ['What is the smallest version that would tell us?', 'What would it take?', 'What could go wrong?'], produces: 'Two or three options with effort and risk, not one plan' },
  { file: '5-decide.md', title: 'Decide', asks: ['Build, do not build, or find out more first?', 'What would change this decision?'], produces: 'A recommendation with its reasoning' },
]);

export const DECISIONS = Object.freeze(['build', 'no-build', 'more']);

export const assessDir = (root, idea) => join(root, 'assess', slugify(idea).slice(0, 60) || 'idea');

const stepBody = (step, idea, index) => [
  `# ${index + 1}. ${step.title} — ${idea}`,
  '',
  `Produces: ${step.produces}.`,
  '',
  ...step.asks.flatMap((question) => [`## ${question}`, '', 'TODO', '']),
  index === 0 ? '## Claims and facts\n\n| Statement | Claim or fact | Source |\n| --- | --- | --- |\n| TODO | claim | — |\n' : '',
  index === 3 ? '## Options\n\n| Option | Smallest version | Effort | Risk |\n| --- | --- | --- | --- |\n| A | TODO | S/M/L | TODO |\n| B | TODO | S/M/L | TODO |\n' : '',
].join('\n');

/** Create the five files. Idempotent: existing files are left alone. */
export async function startAssessment(root, idea) {
  const dir = assessDir(root, idea);
  await mkdir(dir, { recursive: true });
  const written = [];
  for (const [index, step] of STEPS.entries()) {
    const path = join(dir, step.file);
    if (await exists(path)) continue;
    await writeText(path, stepBody(step, idea, index));
    written.push(path);
  }
  const index = join(dir, 'README.md');
  if (!(await exists(index))) {
    await writeText(index, [
      `# Assessment · ${idea}`, '',
      'Should this be built at all? Five steps, each a file. The output is a decision record, not a specification.', '',
      ...STEPS.map((step, i) => `${i + 1}. [${step.title}](${step.file}) — ${step.produces}`),
      '', 'Decision: not yet. `vibekit project assess "<idea>" --decide build|no-build|more --why "…"` records it.', '',
    ].join('\n'));
  }
  return { dir, written };
}

/** Which steps still carry a TODO — the honest measure of how far the assessment got. */
export async function progress(root, idea) {
  const dir = assessDir(root, idea);
  const rows = [];
  for (const step of STEPS) {
    const text = await readText(join(dir, step.file));
    rows.push({ step: step.title, exists: text !== null, open: text ? (text.match(/\bTODO\b/g) ?? []).length : step.asks.length });
  }
  return rows;
}

/**
 * Record the decision. **Build** hands the shaped option to `project new` as the description and
 * keeps the assessment as the first source; **no-build** is a real outcome, kept with its reasoning.
 */
export async function decide(root, idea, { decision, why, by = null, now = () => new Date() }) {
  if (!DECISIONS.includes(decision)) throw new Error(`--decide takes one of ${DECISIONS.join(', ')}.`);
  if (!String(why ?? '').trim()) throw new Error('A decision carries its reasoning: --why "<what decided it, and what would change it>".');
  const dir = assessDir(root, idea);
  const path = join(dir, '5-decide.md');
  const existing = (await readText(path)) ?? `# 5. Decide — ${idea}\n`;
  const record = [
    '', '## Decision', '',
    `**${decision === 'build' ? 'Build' : decision === 'no-build' ? 'Do not build' : 'Find out more first'}** · ${now().toISOString().slice(0, 10)}${by ? ` · ${by}` : ''}`,
    '', String(why).trim(), '',
    decision === 'build' ? 'Next: `vibekit project new --describe "<the shaped option>"` — this assessment becomes the first source.' : decision === 'more' ? 'Next: the research file names what could not be found; find it, then decide again.' : 'Kept as a record. When somebody proposes this again, this file is worth as much as it is now.', '',
  ].join('\n');
  await writeText(path, `${existing.replace(/\n## Decision[\s\S]*$/, '').trimEnd()}\n${record}`);
  const readme = join(dir, 'README.md');
  const text = await readText(readme);
  if (text) await writeText(readme, text.replace(/^Decision:.*$/m, `Decision: **${decision}** on ${now().toISOString().slice(0, 10)} — see 5-decide.md`));
  return { dir, decision, why: String(why).trim() };
}

/** The command behind `vibekit project assess`. */
export async function assessIdea(options) {
  const { root, args, json } = options;
  const idea = args.join(' ').trim();
  if (!idea) throw new Error('Usage: vibekit project assess "<idea>" [--decide build|no-build|more --why "…"]');

  if (options.decide) {
    const result = await decide(root, idea, { decision: options.decide, why: options.why, by: options.by ?? null });
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ ${result.decision} recorded in ${result.dir}/5-decide.md`);
    return;
  }

  const started = await startAssessment(root, idea);
  const rows = await progress(root, idea);
  if (json) return void console.log(JSON.stringify({ ...started, progress: rows }, null, 2));
  console.log(`${started.written.length ? '✔' : '·'} ${started.dir}/ ${started.written.length ? `— ${started.written.length} file(s) written` : '— already started'}`);
  for (const row of rows) console.log(`  ${row.open ? '○' : '✔'} ${row.step.padEnd(10)} ${row.open ? `${row.open} question(s) still TODO` : 'answered'}`);
  console.log('');
  console.log('  Each file names its questions; answer them with evidence, then record the verdict:');
  console.log(`  vibekit project assess "${idea}" --decide build|no-build|more --why "…"`);
}
