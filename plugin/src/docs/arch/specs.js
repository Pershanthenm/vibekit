import { join } from 'node:path';
import { readText } from '../../fsutil.js';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { listRequirements, sectionOf } from '../../folder/requirements.js';
import { readAssumptions } from '../../folder/workflow.js';
import { isOpen, listAsks } from '../../folder/asks.js';
import { table } from './documents.js';
import { libraryValues, renderOne } from './library.js';
import { section } from './model.js';
import { diagramName } from './paths.js';

/**
 * The two documents somebody outside the team asks for. Specification §59.
 *
 * A requirements specification and a technical specification are the documents a client, an
 * auditor or a new supplier expects, and they are normally written once, by hand, from the same
 * facts that are already in the folder — then never updated. Generating them removes the copy:
 * every sentence below is a view of the requirements, the model or the standards, so a document
 * that disagrees with the repository is not possible.
 *
 * What they deliberately do not do is invent the parts nobody has decided. An SRS whose quality
 * section is filled with plausible-sounding targets is worse than one that says the targets are
 * not set, because the first is agreed to and the second is noticed.
 */

const image = (view, alt) => `![${alt}](diagrams/${diagramName(view)})`;
const none = (text) => `_${text}_`;

const listDir = async (dir) => {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.md')).sort();
};

/** The contents of a ``` block, which is how map.md writes paths and commands. */
const fenced = (text) => String(text ?? '').match(/```[^\n]*\n([\s\S]*?)```/)?.[1]?.trimEnd() ?? '';

/** Bullets as a one-column table, minus the ones nobody has written yet. */
const rows = (text, header) => {
  const lines = String(text ?? '')
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => [line.replace(/^\s*[-*]\s+/, '').trim()])
    .filter(([line]) => line && !/TODO/i.test(line));
  return lines.length ? table(header, lines) : undefined;
};

/** `skills/index.yml` is name plus triggers; the specification lists what fetches each skill. */
const skillNames = (text) => {
  const found = [];
  let current = null;
  for (const line of String(text ?? '').split('\n')) {
    const name = line.match(/^\s*-\s*name:\s*(.+)$/);
    if (name) {
      current = [name[1].trim(), ''];
      found.push(current);
      continue;
    }
    const triggers = line.match(/^\s*triggers:\s*(.+)$/);
    if (triggers && current) current[1] = triggers[1].replace(/^\[|\]$/g, '').trim();
  }
  return found.filter(([name]) => name && !/TODO/i.test(name));
};

const STATUS_WORDS = {
  draft: 'drafted', ready: 'agreed, not started', 'in-progress': 'being built', blocked: 'blocked',
  paused: 'paused', tested: 'built and tested', review: 'in review', done: 'delivered',
};

// ---------------------------------------------------------------- requirements specification

export const SRS_TEMPLATE = `# {{project.name}} — Software Requirements Specification

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

Generated from the folder. Every statement below traces to a file; a statement that cannot be
traced is not written. Each section opens in plain language, then gives the detail.

## 1. Introduction

### 1.1 Purpose and scope

{{product.context}}

### 1.2 Definitions

{{table.glossary}}

### 1.3 References

{{table.sources}}

## 2. Overall description

### 2.1 Product perspective

{{narrative.context}}

### 2.2 User classes

{{table.access_matrix}}

### 2.3 Operating environment

{{table.environments}}

### 2.4 Constraints

{{table.invariants}}

### 2.5 Assumptions

Each carries the confidence it was recorded with, because an assumption nobody marked as a guess
is read as a decision.

{{table.assumptions}}

## 3. Functional requirements

In plain language: this is the list of things the system does, one entry per piece of work, each
with the conditions that decide whether it is finished.

{{narrative.functional_requirements}}

## 4. External interfaces

### 4.1 User interfaces

{{narrative.flows}}

### 4.2 Software interfaces

{{table.dependencies}}

### 4.3 Communications

{{table.endpoints}}

{{narrative.endpoints}}

## 5. Non-functional requirements

In plain language: how well it has to work, not what it does. A target nobody set is listed as
not set, because agreeing to a number somebody invented is worse than agreeing to none.

{{table.quality}}

{{narrative.security}}

{{table.data_classification}}

## 6. Data requirements

{{diagram.erd}}

{{table.entities}}

{{table.retention}}

## 7. Open questions and deferred scope

In plain language: what nobody has decided yet, and what was deliberately left out.

{{table.open_asks}}

{{product.out_of_scope}}

## Appendix A. Traceability matrix

Source section → requirement → criterion → test. A criterion with no test is listed as unproved
rather than left out: a specification that hides its gaps is the reason nobody trusts one.

{{table.traceability}}
`;

// ---------------------------------------------------------------- technical specification

export const TECHSPEC_TEMPLATE = `# {{project.name}} — Technical specification

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

Technical throughout. The requirements specification is the document to read first.

## 1. Architecture overview

{{diagram.c4.container}}

{{narrative.containers}}

{{table.design_principles}}

{{table.architecture_rules}}

## 2. Component and module map

{{diagram.c4.components}}

{{code.layout}}

{{table.components}}

## 3. Data model

{{diagram.erd}}

{{table.entities}}

{{narrative.entities}}

{{table.migrations}}

## 4. API contracts

Generated from the contract tests, never from annotations. An annotation drifts from the code; a
contract test fails when it does.

{{table.endpoints}}

{{narrative.endpoints}}

{{table.access_matrix}}

## 5. Security design

{{narrative.security}}

{{diagram.trust_boundaries}}

{{table.data_classification}}

{{table.secrets}}

## 6. Integrations

{{table.dependencies}}

{{table.dependency_failures}}

## 7. Build, test and deployment

{{table.stack}}

{{table.commands}}

{{table.environments}}

## 8. Operations

{{table.health}}

{{table.retention}}

## 9. Decisions

{{table.decisions}}

{{table.assumptions}}

## 10. Conventions and standards

{{table.conventions}}

{{table.skills}}
`;

// ---------------------------------------------------------------- the values these two need

/** `AC-1 → tests/x.test.js`, read from each requirement's `## Verification`. */
export function traceability(requirements) {
  const rows = [];
  for (const requirement of requirements) {
    for (const criterion of requirement.acceptance) {
      const line = requirement.verification
        .split('\n')
        .find((entry) => new RegExp(`\\b${criterion.id}\\b`, 'i').test(entry));
      const proof = line ? line.replace(/^[-*|]\s*/, '').replace(new RegExp(`^.*?\\b${criterion.id}\\b[\\s:|—-]*`, 'i'), '').trim() : '';
      rows.push([requirement.id, criterion.id, criterion.text, proof || '**not proved yet**']);
    }
  }
  return rows.length ? table(['Requirement', 'Criterion', 'Behaviour', 'Proved by'], rows) : undefined;
}

/**
 * Each requirement as a section, with its criteria.
 *
 * Malformed criteria are printed as malformed rather than silently dropped: a specification that
 * quietly omits the sentence somebody wrote is how a requirement gets built to the wrong shape.
 */
export function functionalRequirements(requirements) {
  if (!requirements.length) return none('No requirements have been written yet.');
  const blocks = [];
  for (const requirement of requirements) {
    const head = [`### ${requirement.id} — ${requirement.title}`, ''];
    const facts = [
      requirement.size ? `size ${requirement.size}` : null,
      STATUS_WORDS[requirement.status] ?? requirement.status,
      requirement.source ? `from ${requirement.source}` : 'no source cited',
      requirement.entities.length ? `touches ${requirement.entities.join(', ')}` : null,
    ].filter(Boolean);
    head.push(`_${facts.join(' · ')}_`, '');

    if (requirement.acceptance.length) {
      head.push(table(['Criterion', 'Form', 'Behaviour'], requirement.acceptance.map((criterion) => [criterion.id, criterion.pattern, criterion.text])));
    } else {
      head.push(none('No acceptance criteria yet, so nothing here can be built or tested.'));
    }
    for (const bad of requirement.malformed) {
      head.push('', `> ${bad.id ?? 'A criterion'} ${bad.reason}`);
    }
    if (requirement.outOfScope.length) {
      head.push('', `**Out of scope.** ${requirement.outOfScope.join('; ')}`);
    }
    blocks.push(head.join('\n'));
  }
  return blocks.join('\n\n');
}

export function glossary(text) {
  const rows = [...String(text ?? '').matchAll(/^[-*]\s*\*\*([^*]+)\*\*\s*[—:-]\s*(.+)$/gm)]
    .map((match) => [match[1].trim(), match[2].trim()])
    .filter(([term, meaning]) => !/TODO/i.test(term) && !/^TODO/i.test(meaning));
  return rows.length ? table(['Term', 'Means'], rows) : undefined;
}

export function risks(model, assumptions) {
  const rows = [
    ...assumptions
      .filter((assumption) => assumption.confidence === 'low' && !/TODO/i.test(assumption.text))
      .map((assumption) => [assumption.id, assumption.text, 'A low-confidence assumption that has not been confirmed']),
    ...model.components
      .filter((component) => component.unplanned)
      .map((component) => [component.name, `${component.path} is in the code but not in the intended structure`, 'Every diagram of this area is already wrong']),
    ...model.entities
      .filter((entity) => ['personal', 'financial', 'secret'].includes(entity.class))
      .map((entity) => [entity.name, `carries ${entity.class} data`, 'Erasure, retention and access are decided per requirement; see the data section']),
  ];
  return rows.length ? table(['Risk', 'What it is', 'Why it matters'], rows) : undefined;
}

export async function specValues(root, model, brand, { docs, commit, folder = DEFAULT_FOLDER }) {
  const read = (path) => readText(join(root, folder, path));
  const [requirements, assumptions, asks, glossaryText, mapText, architecture, sources, memories, skills] = await Promise.all([
    listRequirements(root, folder),
    readAssumptions(root, folder),
    listAsks(root, folder),
    read('product/glossary.md'),
    read('product/map.md'),
    read('workflow/architecture.md'),
    read('product/sources/index.md'),
    listDir(join(root, folder, 'memory/repo')),
    read('skills/index.yml'),
  ]);

  const layout = fenced(sectionOf(mapText, 'Where code goes'));
  const commands = fenced(sectionOf(mapText, 'Commands'));
  // map.md writes the stack as a fenced `name  value` block, not a table, because those values
  // must be copied exactly.
  const stackRows = (String(sectionOf(mapText, 'Stack') ?? '').match(/```[^\n]*\n([\s\S]*?)```/)?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^TODO/i.test(line))
    .map((line) => line.split(/\s{2,}/))
    .filter((parts) => parts.length > 1);
  const stack = stackRows.length ? table(['Layer', 'Choice'], stackRows) : '';

  return {
    'doc.folder': folder,
    'narrative.functional_requirements': functionalRequirements(requirements),
    'table.traceability': traceability(requirements),
    'table.glossary': glossary(glossaryText),
    'table.risks': risks(model, assumptions),
    'table.stack': stack || undefined,
    'code.layout': layout ? `\`\`\`\n${layout}\n\`\`\`` : undefined,
    'table.commands': commands ? `\`\`\`\n${commands}\n\`\`\`` : undefined,
    'table.architecture_rules': rows(sectionOf(architecture, 'Layers and what may reference what'), ['Rule']),
    // §59 §1.3 — the documents this specification is derived from, which is what makes a
    // requirement checkable against what was actually asked for.
    'table.sources': rows(sources, ['Source']),
    'narrative.flows': model.flows.length ? model.flows.map((flow) => `- ${flow}`).join('\n') : undefined,
    'table.migrations': requirements.filter((entry) => entry.kind === 'migration').length
      ? table(['Migration', 'Title', 'Status'], requirements.filter((entry) => entry.kind === 'migration').map((entry) => [entry.id, entry.title, entry.status]))
      : undefined,
    'table.decisions': memories.length
      ? table(['Decision', 'Recorded in'], memories.map((name) => [name.replace(/\.md$/, ''), `${folder}/memory/repo/${name}`]))
      : undefined,
    'table.skills': skillNames(skills).length
      ? table(['Skill', 'Fetched when'], skillNames(skills))
      : undefined,
    'diagram.c4.container': model.containers.length ? image('container', `${model.name} containers`) : undefined,
    // Unused here, but the open-ask table is shared with the HLD and must mean the same thing.
    openAsks: asks.filter(isOpen).length,
  };
}

const forSpec = async (root, model, brand, options, name, builtIn) => {
  const extra = { ...(await libraryValues(root, model, brand, options)), ...(await specValues(root, model, brand, options)) };
  return renderOne(root, model, brand, { ...options, name, builtIn, extra });
};

export const renderSrs = (root, model, brand, options) => forSpec(root, model, brand, options, 'srs.md', SRS_TEMPLATE);
export const renderTechspec = (root, model, brand, options) => forSpec(root, model, brand, options, 'tech-spec.md', TECHSPEC_TEMPLATE);

export { section };
