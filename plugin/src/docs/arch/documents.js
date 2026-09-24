import { join } from 'node:path';
import { readText } from '../../fsutil.js';
import { withHeader } from '../../folder/header.js';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { listAsks, isOpen } from '../../folder/asks.js';
import { readAssumptions } from '../../folder/workflow.js';
import { diagramName, templatesDir } from './paths.js';
import { section } from './model.js';

/**
 * The documents, and the placeholder system behind them. Documentation Feature Spec §4 and §6.
 *
 * Most teams never need a template: the built-in structure plus `brand.yml` is what makes a
 * document look like theirs. A template is an override for an organisation that mandates a
 * particular structure, and it wins for that one document only.
 *
 * An unrecognised placeholder is left in place and reported by name, so a template asking for
 * something this project has nothing to fill still produces a usable document with an obvious
 * gap — rather than silently dropping the section, which is how a document quietly loses a
 * chapter nobody notices for a year.
 */

const escapePipe = (text) => String(text ?? '').replace(/\|/g, '\\|');
const table = (header, rows) => [
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(escapePipe).join(' | ')} |`),
].join('\n');

const image = (docs, view, alt) => `![${alt}](diagrams/${diagramName(view)})`;

const CLASS_WORDS = { public: 'Public', internal: 'Internal', personal: 'Personal', financial: 'Financial', secret: 'Secret' };

/** Two to four paragraphs, generated from the model — never a sentence the model cannot support. */
function narrative(model, kind) {
  if (kind === 'context') {
    const users = model.people.length ? model.people.map((person) => person.name).join(', ') : 'no roles recorded yet';
    const externals = model.externals.length
      ? `It depends on ${model.externals.map((external) => external.name).join(', ')}, and every one of those is an outbound call.`
      : 'It calls no external system.';
    // The description is a sentence somebody wrote, so it usually ends in a full stop. Naming
    // the system instead of splicing the sentence keeps this readable either way.
    const opening = model.description ? `${model.description.replace(/\s*$/, '')}${/[.!?]$/.test(model.description.trim()) ? '' : '.'}\n\n` : '';
    return `${opening}${model.name} is used by ${users}. ${externals}`;
  }
  if (kind === 'containers') {
    if (!model.containers.length) return 'No deployables are recorded yet; the stack has not been decided.';
    const parts = model.containers.map((container) => `**${container.name}** (${container.technology || 'technology not recorded'}) ${container.description.toLowerCase()}`);
    return `The system deploys as ${model.containers.length} part${model.containers.length === 1 ? '' : 's'}: ${parts.join('; ')}.`;
  }
  if (kind === 'security') {
    const classified = model.entities.filter((entity) => ['personal', 'financial', 'secret'].includes(entity.class));
    if (!classified.length) return 'Nothing in the entity vocabulary is classified above internal, so no data crosses a boundary that needs a control.';
    return `${classified.length} entit${classified.length === 1 ? 'y carries' : 'ies carry'} classified data: ${classified.map((entity) => `${entity.name} (${entity.class})`).join(', ')}. Every requirement touching one of these carries a security note, and the trust boundaries below say where that data crosses an auth or network boundary.`;
  }
  return '';
}

/**
 * Every placeholder the built-in structures and any template may use. §4's reference table.
 *
 * A value of `undefined` means "this project has nothing to fill it", which the caller reports
 * rather than substituting an empty string — the difference between an obvious gap and a section
 * that vanished.
 */
export async function placeholderValues(root, model, brand, { docs, commit = null, date = null, folder = DEFAULT_FOLDER } = {}) {
  const asks = (await listAsks(root, folder)).filter(isOpen);
  const assumptions = await readAssumptions(root, folder);
  const context = await readText(join(root, folder, 'product/context.md'));
  const quality = await readText(join(root, folder, 'product/quality.md'));
  const access = await readText(join(root, folder, 'product/access.md'));
  const architecture = await readText(join(root, folder, 'workflow/architecture.md'));

  const bearing = (id) => model.requirements.filter((requirement) => requirement.status !== 'done' && (requirement.assumes ?? []).includes(id)).length;

  const values = {
    'project.name': model.name,
    'project.description': model.description,
    'project.version': null,
    'company.name': brand.company?.name ?? null,
    'company.tagline': brand.company?.tagline ?? null,
    'company.footer': brand.company?.footer ?? null,
    'brand.classification_banner': brand.document?.classification_banner ?? null,
    'doc.date': date ?? new Date().toISOString().slice(0, 10),
    'doc.commit': commit ?? null,
    'doc.kind': null,
    // The starter carries its own instructions ("Hard ceiling: 300 tokens…"). Those are guidance
    // for whoever fills the file in, not text to hand a client.
    'product.context': String(context ?? '')
      .replace(/^#.*\n/, '')
      .split('\n')
      .filter((line) => !/^(?:Hard ceiling|TODO)\b/i.test(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || null,
    'product.out_of_scope': String(context ?? '').match(/\*\*Out of scope\.\*\*[^\S\n]*(.+)/i)?.[1] ?? null,

    'diagram.c4.context': image(docs, 'context', `${model.name} system context`),
    'diagram.c4.container': image(docs, 'container', `${model.name} containers`),
    'diagram.erd': model.entities.length ? image(docs, 'erd', `${model.name} entities`) : undefined,
    'diagram.trust_boundaries': model.entities.some((entity) => entity.class !== 'internal')
      ? table(['Entity', 'Classification', 'Crosses'], model.entities
        .filter((entity) => entity.class !== 'internal')
        .map((entity) => [entity.name, CLASS_WORDS[entity.class] ?? entity.class, model.externals.length ? 'the service boundary to an external call' : 'the auth boundary']))
      : undefined,

    'narrative.context': narrative(model, 'context'),
    'narrative.containers': narrative(model, 'containers'),
    'narrative.security': narrative(model, 'security'),

    'table.containers': model.containers.length
      ? table(['Container', 'Technology', 'Responsibility'], model.containers.map((container) => [container.name, container.technology || '—', container.description]))
      : undefined,
    'table.components': model.components.length
      ? table(['Component', 'Path', 'Responsibility'], model.components.map((component) => [component.name + (component.unplanned ? ' ⚠' : ''), component.path, component.description]))
      : undefined,
    'table.entities': model.entities.length
      ? table(['Entity', 'Classification', 'Fields'], model.entities.map((entity) => [entity.name, CLASS_WORDS[entity.class] ?? entity.class, String(entity.fields.length)]))
      : undefined,
    'table.data_classification': model.entities.length
      ? table(['Entity', 'Classification'], model.entities.map((entity) => [entity.name, CLASS_WORDS[entity.class] ?? entity.class]))
      : undefined,
    'table.access_matrix': access && !/TODO/.test(access) ? String(access).split('\n').filter((line) => line.startsWith('|')).join('\n') : undefined,
    'table.quality': quality && !/TODO/.test(quality)
      ? section(quality, 'Targets') || String(quality).replace(/^#.*\n/, '').trim()
      : undefined,
    'table.dependencies': (() => {
      const body = section(architecture, 'Dependencies');
      return body && !/TODO/i.test(body) ? body : undefined;
    })(),
    'table.assumptions': assumptions.length
      ? table(['Id', 'Assumption', 'Confidence', 'Requirements standing on it'], assumptions.map((assumption) => [
        assumption.id,
        assumption.text.replace(/·?\s*confidence:\s*\w+/i, '').trim(),
        assumption.confidence,
        String(bearing(assumption.id)),
      ]))
      : undefined,
    'table.open_asks': asks.length
      ? table(['Id', 'Waiting on', 'Days', 'Blocking'], asks.map((ask) => [ask.id, ask.plain.split('\n')[0] || ask.ask.split('\n')[0], String(ask.waitingDays), ask.blocking ? 'yes' : 'no']))
      : undefined,
    'table.requirements': model.requirements.length
      ? table(['Id', 'Title', 'Status'], model.requirements.map((requirement) => [requirement.id, requirement.title, requirement.status]))
      : undefined,
  };

  values['diagram.sequence.*'] = model.flows.length
    ? model.flows.map((flow) => `- ${flow}`).join('\n')
    : undefined;

  return values;
}

/** Fill a template. Returns the text and the placeholders that had nothing behind them. */
export function fill(template, values, { authored = {} } = {}) {
  const empty = [];
  const unknown = [];
  const text = String(template).replace(/\{\{([\w.*-]+)\}\}/g, (whole, key) => {
    if (key.startsWith('authored.')) return authored[key] ?? whole;
    if (!(key in values)) {
      unknown.push(key);
      return whole;
    }
    const value = values[key];
    if (value === undefined || value === null || value === '') {
      empty.push(key);
      return '';
    }
    return value;
  });
  return { text, empty, unknown, missing: [...empty, ...unknown] };
}

/**
 * A section a human wrote inside a generated document survives every regeneration. This is how an
 * executive summary or a commercial section lives in a file VibeKit otherwise owns.
 */
export function readAuthoredSections(previous) {
  const found = {};
  for (const match of String(previous ?? '').matchAll(/<!--\s*authored:([\w.-]+)\s*-->\n([\s\S]*?)<!--\s*\/authored\s*-->/g)) {
    found[`authored.${match[1]}`] = `<!-- authored:${match[1]} -->\n${match[2]}<!-- /authored -->`;
  }
  return found;
}

/** §6 — the built-in High Level Design. Readable by a technical person who has never seen the code. */
export const HLD_TEMPLATE = `# {{project.name}} — High Level Design

{{brand.classification_banner}}

{{doc.date}} · generated from commit {{doc.commit}}

## 1. Purpose and scope

{{product.context}}

## 2. System context

{{diagram.c4.context}}

{{narrative.context}}

## 3. Containers

{{diagram.c4.container}}

{{narrative.containers}}

{{table.containers}}

## 4. Key flows

{{diagram.sequence.*}}

## 5. Quality attributes

{{table.quality}}

## 6. Security and trust boundaries

{{narrative.security}}

{{diagram.trust_boundaries}}

## 7. Assumptions and open questions

Which parts of this design are standing on a guess, and what nobody has answered yet.

{{table.assumptions}}

{{table.open_asks}}
`;

export async function renderHld(root, model, brand, { docs, commit = null, folder = DEFAULT_FOLDER } = {}) {
  const override = await readText(join(templatesDir(root, docs), 'hld.md'));
  const previous = await readText(join(root, docs, 'hld.md'));
  const values = await placeholderValues(root, model, brand, { docs, commit, folder });
  const { text, empty, unknown } = fill(override ?? HLD_TEMPLATE, values, { authored: readAuthoredSections(previous) });

  const notes = [
    empty.length ? `nothing to fill: ${empty.join(', ')}` : '',
    unknown.length ? `not recognised, left in place: ${unknown.join(', ')}` : '',
  ].filter(Boolean);
  const body = notes.length ? `${text}\n<!-- vibekit · ${notes.join(' · ')} -->\n` : text;

  // Blank lines left by an unfilled optional section are collapsed so the document reads cleanly
  // without the structure changing — determinism matters more than prettiness here.
  return withHeader('hld.md', 'docs', body.replace(/\n{3,}/g, '\n\n'));
}

export { table, narrative };
