/**
 * The model as Structurizr DSL. Documentation Feature Spec §3.
 *
 * Structurizr rather than a Mermaid block per diagram, because one model cannot contradict itself
 * across four levels, and because the DSL exports to SVG, PNG, PlantUML and Mermaid when a viewer
 * needs one. This file writes the model; it never decides what is in it.
 *
 * Pure and ordered: the same model produces the same bytes, so a diff on `model.dsl` in a pull
 * request is a real architecture change and nothing else. That diff is the review moment the
 * feature exists to create — a reviewer sees a new arrow between containers and can question it
 * before it lands.
 */

const quote = (text) => `"${String(text ?? '').replace(/"/g, '\\"').replace(/\n/g, ' ').trim()}"`;
const indent = (depth) => '  '.repeat(depth);

const TAG_FOR = { spa: 'spa', mobile: 'mobile', desktop: 'desktop', service: 'service', database: 'database', queue: 'queue' };

function renderContainer(container, depth) {
  const head = `${indent(depth)}${container.id} = container ${quote(container.name)} ${quote(container.technology ?? '')} ${quote(TAG_FOR[container.tag] ?? '')}`;
  if (!container.components?.length) return `${head}`;
  const body = container.components.map((component) => {
    const tags = component.unplanned ? ' "unplanned"' : '';
    return `${indent(depth + 1)}${component.id} = component ${quote(component.name)} ${quote(component.description ?? '')}${tags}`;
  });
  return [`${head} {`, ...body, `${indent(depth)}}`].join('\n');
}

/**
 * Styles come from the brand, so a diagram is in the customer's livery without anything being
 * drawn twice. A brand colour that fails contrast against its own fill is not used for label
 * text — `brand.js` derives a darker shade and records why.
 */
function renderStyles(brand) {
  const colour = brand?.colour ?? {};
  const fill = colour.brand ?? '#1F5673';
  const text = colour.text_on_brand ?? '#FFFFFF';
  const accent = colour.accent ?? '#C77B30';
  const ink = colour.diagram_text ?? colour.text ?? '#14171C';
  return [
    '    styles {',
    `      element "Element" {\n        background ${fill}\n        color ${text}\n        fontSize 22\n      }`,
    `      element "Person" {\n        shape Person\n        background ${accent}\n        color ${ink}\n      }`,
    '      element "Software System" {\n        shape RoundedBox\n      }',
    `      element "external" {\n        background #7A7A7A\n        color #FFFFFF\n      }`,
    '      element "database" {\n        shape Cylinder\n      }',
    '      element "queue" {\n        shape Pipe\n      }',
    `      element "unplanned" {\n        background #B4462F\n        color #FFFFFF\n        border dashed\n      }`,
    '    }',
  ].join('\n');
}

export function renderDsl(model, { brand = null } = {}) {
  const lines = [];
  lines.push(`workspace ${quote(model.name)} ${quote(model.description)} {`, '');
  lines.push('  model {');

  for (const person of model.people) {
    lines.push(`    ${person.id} = person ${quote(person.name)} ${quote(person.description)}`);
  }
  for (const external of model.externals) {
    lines.push(`    ${external.id} = softwareSystem ${quote(external.name)} ${quote(external.description)} "external"`);
  }
  if (model.people.length || model.externals.length) lines.push('');

  lines.push(`    ${model.system.id} = softwareSystem ${quote(model.system.name)} {`);
  for (const container of model.containers) lines.push(renderContainer(container, 3));
  lines.push('    }');

  if (model.relationships.length) {
    lines.push('');
    for (const relationship of model.relationships) {
      const technology = relationship.technology ? ` ${quote(relationship.technology)}` : '';
      lines.push(`    ${relationship.from} -> ${relationship.to} ${quote(relationship.description)}${technology}`);
    }
  }

  if (model.deployment.length) {
    lines.push('');
    for (const environment of model.deployment) {
      lines.push(`    deploymentEnvironment ${quote(environment.name)} {`);
      lines.push(`      deploymentNode ${quote(environment.name)} {`);
      for (const container of model.containers) lines.push(`        containerInstance ${container.id}`);
      lines.push('      }', '    }');
    }
  }

  lines.push('  }', '');
  lines.push('  views {');
  lines.push(`    systemContext ${model.system.id} "context" {\n      include *\n      autolayout lr\n    }`);
  lines.push(`    container ${model.system.id} "container" {\n      include *\n      autolayout lr\n    }`);
  for (const container of model.containers.filter((entry) => entry.components?.length)) {
    lines.push(`    component ${container.id} "component_${container.id}" {\n      include *\n      autolayout lr\n    }`);
  }
  lines.push(renderStyles(brand));
  lines.push('  }', '}', '');
  return lines.join('\n');
}

/**
 * The same model as Mermaid, for a viewer that renders Markdown and nothing else.
 *
 * This is a second *view*, not a second source: it is generated from the model like every other
 * diagram, so it cannot disagree with the DSL.
 */
export function renderMermaid(model, view = 'container') {
  const lines = ['flowchart LR'];
  const label = (text) => `"${String(text).replace(/"/g, "'")}"`;

  if (view === 'context') {
    for (const person of model.people) lines.push(`  ${person.id}(${label(person.name)})`);
    lines.push(`  ${model.system.id}[${label(model.system.name)}]`);
    for (const external of model.externals) lines.push(`  ${external.id}[${label(external.name)}]`);
    const inside = new Set(model.containers.map((container) => container.id));
    for (const relationship of model.relationships) {
      const from = inside.has(relationship.from) ? model.system.id : relationship.from;
      const to = inside.has(relationship.to) ? model.system.id : relationship.to;
      if (from === to) continue;
      lines.push(`  ${from} -->|${label(relationship.description)}| ${to}`);
    }
    return [...new Set(lines)].join('\n');
  }

  for (const person of model.people) lines.push(`  ${person.id}(${label(person.name)})`);
  lines.push(`  subgraph ${model.system.id}[${label(model.system.name)}]`);
  for (const container of model.containers) {
    const shape = container.tag === 'database' ? `[(${label(container.name)})]` : `[${label(`${container.name}\n${container.technology ?? ''}`.trim())}]`;
    lines.push(`    ${container.id}${shape}`);
  }
  lines.push('  end');
  for (const external of model.externals) lines.push(`  ${external.id}[${label(external.name)}]`);
  for (const relationship of model.relationships) {
    if (model.components.some((component) => component.id === relationship.from || component.id === relationship.to)) continue;
    lines.push(`  ${relationship.from} -->|${label(relationship.description)}| ${relationship.to}`);
  }
  return [...new Set(lines)].join('\n');
}

/** The entity relationship diagram, from the closed vocabulary. */
export function renderErd(model) {
  const lines = ['erDiagram'];
  for (const entity of model.entities) {
    lines.push(`  ${entity.name} {`);
    for (const field of entity.fields) {
      const type = (field.type || 'string').replace(/[^\w]/g, '') || 'string';
      lines.push(`    ${type} ${field.name}${field.class ? ` "${field.class}"` : ''}`);
    }
    lines.push('  }');
  }
  for (const entity of model.entities) {
    for (const relation of entity.relations) {
      const target = model.entities.find((other) => other.name !== entity.name && relation.includes(other.name));
      if (!target) continue;
      const many = /has many/i.test(relation);
      lines.push(`  ${entity.name} ${many ? '||--o{' : '}o--||'} ${target.name} : ${many ? 'has' : 'belongs to'}`);
    }
  }
  return [...new Set(lines)].join('\n');
}
