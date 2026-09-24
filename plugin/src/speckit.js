import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseCriterion } from './folder/ears.js';
import { exists, readText } from './fsutil.js';

/**
 * Importing a Spec Kit repository. Specification §35.
 *
 * "The conversion is conservative. Anything it infers is marked `confidence: low` and becomes an
 * ask rather than a silent fact."
 *
 * The number §35 gives is the useful one: a conversion "typically raises between five and fifteen
 * asks, most of them about things the original spec never settled — which is the point, and
 * usually the first time anyone notices."
 */

export const LAYOUT = Object.freeze([
  { from: 'memory/constitution.md', to: 'standards/rules.md and a first guardrails.md', adds: 'denied paths, allowed commands and required checks: a constitution states principles but rarely names what may not be touched' },
  { from: 'specs/<feature>/spec.md', to: 'product/context.md, glossary.md, and one REQ-*.md per requirement found', adds: 'acceptance criteria rewritten in EARS with ids, so each can be mapped to a test' },
  { from: 'plan.md', to: 'workflow/architecture.md as observed', adds: 'data classifications, trust boundaries, the three forbids, a verified dependency list' },
  { from: 'tasks.md', to: 'the requirement breakdown and workflow/plan.md', adds: 'sizes, after: dependencies, phases, a walking skeleton first' },
  { from: 'research.md or data-model.md', to: 'product/entities.md', adds: 'field types, relations and a classification per entity' },
  { from: 'slash-command definitions', to: 'nothing; VibeKit generates its own', adds: '—' },
]);

export const looksLikeSpecKit = async (root) =>
  (await exists(join(root, 'memory/constitution.md')))
  || (await exists(join(root, '.specify')))
  || (await exists(join(root, 'specs'))) && (await readdir(join(root, 'specs')).catch(() => [])).some((name) => /^\d+[-_]/.test(name));

const section = (text, heading) => String(text ?? '').replace(/\r\n/g, '\n')
  .match(new RegExp(`^#{1,4}[ \\t]+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,4}[ \\t]|(?![\\s\\S]))`, 'im'))?.[1]?.trim() ?? '';

const bullets = (text) => String(text ?? '')
  .split('\n')
  .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line))
  .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/^\[[ x]\]\s*/i, '').trim())
  .filter(Boolean);

/**
 * Read a Spec Kit repository, without writing anything.
 *
 * Every criterion found is run through the EARS parser: one that already parses is carried over,
 * and one that does not becomes an ask. That is the conversion's whole value — a Spec Kit spec
 * usually has acceptance criteria that read well and cannot be turned into a single test, and
 * nothing in that tool ever says so.
 */
export async function readSpecKit(root) {
  const features = [];
  const specsDir = join(root, 'specs');

  for (const name of (await readdir(specsDir).catch(() => [])).sort()) {
    const dir = join(specsDir, name);
    const spec = await readText(join(dir, 'spec.md'));
    if (spec === null) continue;

    // The first heading that has anything under it, not every heading that matches: "Acceptance"
    // also matches "Acceptance Criteria", so collecting from both counted every bullet twice and
    // asked about each unusable criterion two times.
    const criteria = ['Acceptance Criteria', 'Acceptance', 'Requirements']
      .map((heading) => bullets(section(spec, heading)))
      .find((found) => found.length) ?? [];

    features.push({
      name,
      title: String(spec).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name,
      spec,
      plan: await readText(join(dir, 'plan.md')),
      tasks: await readText(join(dir, 'tasks.md')),
      research: (await readText(join(dir, 'research.md'))) ?? (await readText(join(dir, 'data-model.md'))),
      criteria: criteria.map((text) => ({ text, parsed: parseCriterion(`- AC-1 ${text}`) })),
    });
  }

  return {
    constitution: await readText(join(root, 'memory/constitution.md')),
    features,
    // Slash commands become nothing: VibeKit generates its own, so carrying them over would
    // leave two sets of commands that drift.
    commands: (await readdir(join(root, '.claude/commands')).catch(() => [])).filter((name) => name.endsWith('.md')),
  };
}

/**
 * What the conversion would produce, and what it cannot answer.
 *
 * The asks are the output that matters. §35: most of them are "about things the original spec
 * never settled", and a conversion that produced a tidy folder with no questions would have
 * invented the answers.
 */
export function convertPlan(read) {
  const principles = bullets(section(read.constitution, 'Principles') || read.constitution || '');
  const asks = [];

  if (!read.constitution) {
    asks.push({
      ask: 'There is no memory/constitution.md, so no principle was carried into standards/rules.md. What rules do agents have to follow here?',
      plain: 'What rules should every AI assistant follow on this project?',
    });
  } else {
    asks.push({
      ask: `The constitution states ${principles.length} principle(s) and names no denied path, allowed command or required check. Which paths may an agent never touch, and which commands may it run?`,
      plain: 'Which files should an assistant never change, and which commands is it allowed to run?',
    });
  }

  const unparsed = read.features.flatMap((feature) => feature.criteria.filter((criterion) => !criterion.parsed.ok).map((criterion) => ({ feature: feature.name, ...criterion })));
  for (const criterion of unparsed.slice(0, 8)) {
    asks.push({
      ask: `${criterion.feature}: "${criterion.text}" is not in EARS form (${criterion.parsed.reason}). What is the trigger, and what should the system do?`,
      plain: `"${criterion.text}" — what exactly has to happen, and when? As written, two people could build different things and both say they were finished.`,
    });
  }

  if (!read.features.some((feature) => feature.research)) {
    asks.push({
      ask: 'No research.md or data-model.md was found, so product/entities.md would start empty. What are the entities, their fields and their data classifications?',
      plain: 'What are the main things this system stores, and which of them hold personal or financial data?',
    });
  }
  if (!read.features.some((feature) => feature.plan)) {
    asks.push({
      ask: 'No plan.md was found, so workflow/architecture.md has nothing observed to record. What is the stack, and what may reference what?',
      plain: 'How is this built, and are there rules about which parts may use which?',
    });
  }

  const criteria = read.features.flatMap((feature) => feature.criteria);
  return {
    features: read.features.length,
    criteria: criteria.length,
    usable: criteria.filter((criterion) => criterion.parsed.ok).length,
    unparsed: unparsed.length,
    principles: principles.length,
    ignoredCommands: read.commands.length,
    asks,
  };
}

/** The config a converted folder starts from. Everything inferred is low confidence (§35). */
export function configFrom(read, name) {
  const first = read.features[0];
  return {
    name,
    description: first ? String(first.spec).split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim() ?? null : null,
    architecture: 'layered',
    stack: {},
    commands: {},
    entities: [],
  };
}

export const featureTitle = (feature) => feature.title.replace(/^Feature:\s*/i, '').trim() || basename(feature.name);


/**
 * §35 — write the folder from a Spec Kit repository.
 *
 * Conservative on purpose: a criterion that already parses as EARS is carried over as written; one
 * that does not is left out of the requirement and raised as an ask by the caller. Principles
 * become rules under `standards/rules.md`. The description is the first sentence of the first
 * spec. Nothing else is inferred, because §35's whole value is the questions it raises about what
 * the original spec never settled — and a converter that answered them would be inventing.
 */
export async function convertSpecKit(root, read, { folder = 'vibekit' } = {}) {
  const { generateFolder } = await import('./folder/generate.js');
  const { createRequirement, listRequirements, nextRequirementId, writeSection } = await import('./folder/requirements.js');
  const { readText, writeAtomic, writeText } = await import('./fsutil.js');
  const { join } = await import('node:path');

  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
  await generateFolder(root, configFrom(read, name), { folder });
  const notes = [];

  // Principles → rules. A constitution states principles but rarely names what may not be touched;
  // the denied paths and allowed commands stay as asks.
  const principles = bullets(section(read.constitution, 'Principles') || read.constitution || '');
  if (principles.length) {
    const rulesPath = join(root, folder, 'standards/rules.md');
    const existing = (await readText(rulesPath)) ?? '# Rules\n';
    await writeText(rulesPath, `${existing.trimEnd()}\n\n## From the Spec Kit constitution\n\n${principles.map((line) => `- ${line}`).join('\n')}\n`);
    notes.push(`${principles.length} principle(s) from memory/constitution.md → standards/rules.md`);
  }

  const requirements = [];
  for (const feature of read.features) {
    const existing = await listRequirements(root, folder);
    const id = nextRequirementId(existing, 'requirement');
    await createRequirement(root, { id, title: featureTitle(feature), kind: 'requirement', size: null, source: `specs/${feature.name}/spec.md` }, folder);

    const usable = feature.criteria.filter((criterion) => criterion.parsed.ok);
    if (usable.length) {
      await writeSection(root, id, 'Acceptance', usable.map((criterion, index) => `- AC-${index + 1}  ${criterion.text.replace(/\.?$/, '.')}`).join('\n'), folder);
    }
    const skipped = feature.criteria.length - usable.length;
    await writeSection(root, id, 'Log', [
      `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} converted from specs/${feature.name}/spec.md by \`vibekit init --from-speckit\``,
      `- ${usable.length} criterion/criteria carried as written; ${skipped} not in EARS form and raised as asks instead`,
    ].join('\n'), folder);

    // Everything here was inferred from another tool's file; the requirement says so on its face.
    const path = join(root, folder, 'product/requirements', `${id}.md`);
    const text = (await readText(path)) ?? '';
    if (!/^confidence:/m.test(text)) await writeAtomic(path, text.replace(/^status: draft$/m, 'status: draft\nconfidence: low'));
    requirements.push({ id, feature: feature.name, carried: usable.length, skipped });
  }
  if (read.commands.length) notes.push(`${read.commands.length} slash command(s) ignored: VibeKit generates its own`);

  return { requirements, rules: principles.length, notes };
}
