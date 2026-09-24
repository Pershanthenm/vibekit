import { join } from 'node:path';
import { readText } from '../../fsutil.js';
import { withHeader } from '../../folder/header.js';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { contractEndpoints, endpointDetails } from './drift.js';
import { fill, placeholderValues, readAuthoredSections, table } from './documents.js';
import { section } from './model.js';
import { diagramName, templatesDir } from './paths.js';

/**
 * The other four documents. Documentation Feature Spec §6.
 *
 * Each one has a built-in structure and each one may be overridden by a template. None of them
 * says anything the model cannot support: where a project has not decided something, the document
 * says so rather than filling the gap with plausible prose, which is the failure that makes
 * architecture documents untrustworthy in the first place.
 */

const CLASS_WORDS = { public: 'Public', internal: 'Internal', personal: 'Personal', financial: 'Financial', secret: 'Secret' };
const image = (view, alt) => `![${alt}](diagrams/${diagramName(view)})`;
const none = (text) => `_${text}_`;

// ---------------------------------------------------------------- Low Level Design

export const LLD_TEMPLATE = `# {{project.name}} — Low Level Design

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

For an engineer joining the project or picking up a module.

## 1. Component structure

{{diagram.c4.components}}

{{table.components}}

## 2. Design principles

Each principle names the check that enforces it. A principle with no check is not in this table.

{{table.design_principles}}

## 3. Data model

{{diagram.erd}}

{{table.entities}}

## 4. Access control

{{table.access_matrix}}

## 5. Invariants

{{table.invariants}}

## 6. Conventions

{{table.conventions}}

## 7. Dependencies

{{table.dependencies}}
`;

/** §64 — a principle with no named check does not belong in the record, so it does not appear here. */
function designPrinciples(architecture) {
  const body = section(architecture, 'Design principles');
  // Bullets only. Every one of these sections opens with a sentence explaining what belongs in
  // it, and reading the whole body turned that instruction into a design principle of the
  // system — printed, in the LLD, as something the code is held to.
  const rows = body
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line && !/^TODO/i.test(line))
    .map((line) => {
      const [rule, check] = line.split(/\s*(?:→|->)\s*/);
      return [rule.trim(), (check ?? '').trim() || '_no check named_'];
    });
  return rows.length ? table(['Principle', 'Enforced by'], rows) : undefined;
}

function invariants(text) {
  const rows = String(text ?? '')
    .split('\n')
    .map((line) => line.match(/^[-*]\s*(INV-\d+)\s*(\[[^\]]*\])?\s*(.+)$/))
    .filter(Boolean)
    .filter((match) => !/TODO/i.test(match[3]))
    .map((match) => [match[1], (match[2] ?? '').replace(/[[\]]/g, '') || '—', match[3].trim()]);
  return rows.length ? table(['Id', 'Entities', 'Rule'], rows) : undefined;
}

function conventions(standards) {
  const rows = [];
  for (const [heading, body] of Object.entries(standards)) {
    const items = String(body ?? '')
      .split('\n')
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter((line) => line && !/^TODO/i.test(line) && !line.startsWith('#') && !line.startsWith('##'));
    for (const item of items.slice(0, 4)) rows.push([heading, item]);
  }
  return rows.length ? table(['Area', 'Convention'], rows) : undefined;
}

// ---------------------------------------------------------------- API reference

export const API_TEMPLATE = `# {{project.name}} — API reference

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

Generated from the contract tests, never from annotations. An annotation drifts from the code; a
contract test fails when it does — so every example below is one that provably runs.

{{table.endpoints}}

{{narrative.endpoints}}
`;

// ---------------------------------------------------------------- Data model

export const DATA_TEMPLATE = `# {{project.name}} — Data model

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

{{diagram.erd}}

{{narrative.entities}}

{{table.retention}}
`;

/** Per entity: fields with classification, relations, and the requirements that touch it. */
function entityDetail(model) {
  if (!model.entities.length) return none('No entities are recorded yet.');
  return model.entities.map((entity) => {
    const fields = entity.fields.length
      ? table(['Field', 'Type', 'Classification', 'Notes'], entity.fields.map((field) => [
        field.name, field.type || '—', CLASS_WORDS[field.class] ?? (field.class ?? 'inherits'), field.notes ?? '',
      ]))
      : none('No fields recorded.');
    const relations = entity.relations.length ? entity.relations.map((relation) => `- ${relation}`).join('\n') : none('No relations recorded.');
    // The reverse index nobody usually has: which work touches this entity.
    const touching = model.requirements.filter((requirement) => requirement.entities.includes(entity.name));
    const used = touching.length
      ? table(['Requirement', 'Title', 'Status'], touching.map((requirement) => [requirement.id, requirement.title, requirement.status]))
      : none('No requirement names this entity yet.');

    return [
      `## ${entity.name}`,
      '',
      `Classification: **${CLASS_WORDS[entity.class] ?? entity.class}**`,
      '',
      fields,
      '',
      '**Relations**',
      '',
      relations,
      '',
      '**Touched by**',
      '',
      used,
    ].join('\n');
  }).join('\n\n');
}

/** §52 — every data class holding personal data needs a retention line, or the planner owes an ask. */
function retention(model, quality) {
  const lines = String(quality ?? '')
    .split('\n')
    .map((line) => line.match(/^[-*]\s*(personal|financial|secret|internal|public)\s*[—-]\s*(.+)$/i))
    .filter(Boolean)
    .map((match) => [match[1].toLowerCase(), match[2].trim()]);
  const declared = new Map(lines.filter(([, rule]) => !/^TODO/i.test(rule)));

  const classes = [...new Set(model.entities.map((entity) => entity.class))].filter((name) => name !== 'internal' && name !== 'public');
  if (!classes.length) return undefined;

  return table(['Data class', 'Retention and erasure', 'Entities'], classes.map((name) => [
    CLASS_WORDS[name] ?? name,
    declared.get(name) ?? '**not decided** — a requirement creating this data without a rule is an ask',
    model.entities.filter((entity) => entity.class === name).map((entity) => entity.name).join(', '),
  ]));
}

// ---------------------------------------------------------------- Runbook

export const RUNBOOK_TEMPLATE = `# {{project.name}} — Runbook

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

Half of this file is generated and half is yours. Anything between the authored markers survives
every regeneration — a runbook VibeKit could write entirely would not be worth reading.

## 1. Health and readiness

{{table.health}}

## 2. Dependencies, and what fails if each is down

{{table.dependency_failures}}

## 3. Environments and rollback

{{table.environments}}

## 4. Configuration and secret names

{{table.secrets}}

## 5. Who to call

{{authored.oncall}}

## 6. Known failure modes

{{authored.failure_modes}}

## 7. Recovery steps that need judgement

{{authored.recovery}}
`;

const AUTHORED_DEFAULTS = {
  'authored.oncall': '<!-- authored:oncall -->\n_Not written yet. Who is called, when, and how to reach them._\n<!-- /authored -->',
  'authored.failure_modes': '<!-- authored:failure_modes -->\n_Not written yet. The symptoms an operator actually sees, and what they mean._\n<!-- /authored -->',
  'authored.recovery': '<!-- authored:recovery -->\n_Not written yet. The steps that need a person to decide something._\n<!-- /authored -->',
};

// ---------------------------------------------------------------- values and rendering

/** The placeholders only these four documents use, on top of the shared set. */
export async function libraryValues(root, model, brand, { docs, commit, folder = DEFAULT_FOLDER }) {
  const [architecture, invariantsText, quality, environments, observability, envExample, ...standards] = await Promise.all([
    readText(join(root, folder, 'workflow/architecture.md')),
    readText(join(root, folder, 'product/invariants.md')),
    readText(join(root, folder, 'product/quality.md')),
    readText(join(root, folder, 'delivery/environments.md')),
    readText(join(root, folder, 'delivery/observability.md')),
    readText(join(root, '.env.example')),
    readText(join(root, folder, 'standards/code-style.md')),
    readText(join(root, folder, 'standards/rules.md')),
    readText(join(root, folder, 'standards/security.md')),
  ]);

  const endpoints = await endpointDetails(root);
  const componentDiagrams = model.containers
    .filter((container) => container.components?.length)
    .map((container) => image(`component-${container.id}`, `${container.name} components`))
    .join('\n\n');

  const secretNames = [...String(envExample ?? '').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => [match[1]]);

  return {
    'diagram.c4.components': componentDiagrams || undefined,
    'table.design_principles': designPrinciples(architecture),
    'table.invariants': invariants(invariantsText),
    'table.conventions': conventions({ Style: section(standards[0], 'Naming'), Rules: section(standards[1], 'Always'), Security: section(standards[2], 'Authorisation') }),
    'table.endpoints': endpoints.length
      ? table(['Method', 'Path', 'Proved by'], endpoints.map((endpoint) => [endpoint.method, endpoint.path, endpoint.test]))
      : undefined,
    'narrative.endpoints': endpoints.length
      ? `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} are pinned by contract tests. An endpoint that is not in this table has no contract test, and nothing stops its shape changing.`
      : 'No contract tests exist yet, so no endpoint is pinned. Until one is, this reference has nothing it can honestly list.',
    'narrative.entities': entityDetail(model),
    'table.retention': retention(model, quality),
    'table.health': observability
      ? (section(observability, 'Endpoints the walking skeleton must answer') || undefined)
      : table(['Endpoint', 'Means'], [['`/health`', 'the process is up'], ['`/ready`', 'dependencies are reachable']]),
    'table.dependency_failures': model.externals.length
      ? table(['Depends on', 'If it is down'], model.externals.map((external) => [external.name, 'the calls that use it fail; see the requirement that introduced it']))
      : undefined,
    'table.environments': environments
      ? String(environments).split('\n').filter((line) => line.startsWith('|')).join('\n') || undefined
      : undefined,
    'table.secrets': secretNames.length ? table(['Name'], secretNames) : undefined,
  };
}

/**
 * One document: the template (or the project's own), filled from the model, with what could not
 * be filled recorded in a trailing comment rather than left as a gap the reader must notice.
 *
 * Exported because the SRS and the technical specification are built the same way; two copies of
 * this would be two places for the authored-section rule to drift.
 */
export async function renderOne(root, model, brand, { docs, commit, folder, name, builtIn, extra }) {
  const override = await readText(join(templatesDir(root, docs), `${name.replace('.md', '')}.md`));
  const previous = await readText(join(root, docs, name));
  const shared = await placeholderValues(root, model, brand, { docs, commit, folder });
  const values = { ...shared, ...extra };

  const authored = { ...AUTHORED_DEFAULTS, ...readAuthoredSections(previous) };
  const { text, empty, unknown } = fill(override ?? builtIn, values, { authored });

  const notes = [
    empty.length ? `nothing to fill: ${empty.join(', ')}` : '',
    unknown.length ? `not recognised, left in place: ${unknown.join(', ')}` : '',
  ].filter(Boolean);
  const body = notes.length ? `${text}\n<!-- vibekit · ${notes.join(' · ')} -->\n` : text;
  return withHeader(name, 'docs', body.replace(/\n{3,}/g, '\n\n'));
}

export async function renderLld(root, model, brand, options) {
  const extra = await libraryValues(root, model, brand, options);
  return renderOne(root, model, brand, { ...options, name: 'lld.md', builtIn: LLD_TEMPLATE, extra });
}

export async function renderApi(root, model, brand, options) {
  const extra = await libraryValues(root, model, brand, options);
  return renderOne(root, model, brand, { ...options, name: 'api-reference.md', builtIn: API_TEMPLATE, extra });
}

export async function renderData(root, model, brand, options) {
  const extra = await libraryValues(root, model, brand, options);
  return renderOne(root, model, brand, { ...options, name: 'data-model.md', builtIn: DATA_TEMPLATE, extra });
}

export async function renderRunbook(root, model, brand, options) {
  const extra = await libraryValues(root, model, brand, options);
  return renderOne(root, model, brand, { ...options, name: 'runbook.md', builtIn: RUNBOOK_TEMPLATE, extra });
}

export { contractEndpoints, entityDetail, retention };
