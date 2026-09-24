/**
 * Diagrams as SVG. Documentation Feature Spec §3 (Rendering) and §8 acceptance 7.
 *
 * The layout is computed here rather than handed to a layout engine, for one reason: acceptance 7
 * requires that regenerating after an unrelated change produces byte-identical output, and
 * general graph layout is not naturally deterministic. A document that reshuffles itself on every
 * run produces a diff nobody reads, which is the same failure as a document nobody trusts.
 *
 * So: a fixed left-to-right column layout, positions derived arithmetically from a sorted model.
 * It is less pretty than a force-directed graph and it is the same every time. It also renders
 * offline and in five years, with no binary to install.
 */

const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const BOX = { width: 200, height: 92, gapX: 110, gapY: 28 };
const PAD = 28;
const LANE_LABEL = 22;

/** Relative luminance, for the contrast check §3 requires on every diagram label. */
function luminance(hex) {
  const value = String(hex ?? '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const parts = [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  const [r, g, b] = parts.map((part) => (part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/**
 * A label colour that actually reads. A diagram whose text fails WCAG AA against its fill is
 * re-rendered with a legible shade rather than shipped unreadable — §3's rule, applied here
 * rather than trusted to whoever picked the brand colour.
 */
export function labelColour(fill, preferred) {
  if (preferred && contrast(fill, preferred) >= 4.5) return preferred;
  return contrast(fill, '#FFFFFF') >= contrast(fill, '#14171C') ? '#FFFFFF' : '#14171C';
}

const wrap = (text, limit = 24) => {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= limit) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

function box(node, x, y, palette) {
  const fill = node.fill ?? palette.brand;
  const ink = labelColour(fill, palette.textOnBrand);
  const lines = wrap(node.name);
  const subtitle = node.technology || node.subtitle || '';
  const startY = y + BOX.height / 2 - ((lines.length - 1) * 9) - (subtitle ? 8 : 0);
  const shape = node.shape === 'person'
    ? `<rect x="${x}" y="${y}" width="${BOX.width}" height="${BOX.height}" rx="46" fill="${fill}" stroke="${palette.border}"/>`
    : `<rect x="${x}" y="${y}" width="${BOX.width}" height="${BOX.height}" rx="${node.shape === 'cylinder' ? 24 : 8}" fill="${fill}" stroke="${palette.border}"${node.dashed ? ' stroke-dasharray="6 4" stroke-width="2"' : ''}/>`;

  return [
    shape,
    ...lines.map((line, index) => `<text x="${x + BOX.width / 2}" y="${startY + index * 18}" fill="${ink}" font-size="14" font-weight="600" text-anchor="middle">${escape(line)}</text>`),
    subtitle ? `<text x="${x + BOX.width / 2}" y="${startY + lines.length * 18 + 4}" fill="${ink}" font-size="11" opacity="0.85" text-anchor="middle">${escape(subtitle)}</text>` : '',
  ].filter(Boolean).join('\n  ');
}

function arrow(from, to, label, palette) {
  const x1 = from.x + BOX.width;
  const y1 = from.y + BOX.height / 2;
  const x2 = to.x;
  const y2 = to.y + BOX.height / 2;
  const midX = (x1 + x2) / 2;
  const path = y1 === y2
    ? `M ${x1} ${y1} L ${x2 - 8} ${y2}`
    : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2 - 8} ${y2}`;
  return [
    `<path d="${path}" fill="none" stroke="${palette.line}" stroke-width="1.6" marker-end="url(#arrow)"/>`,
    label ? `<text x="${midX}" y="${(y1 + y2) / 2 - 6}" fill="${palette.line}" font-size="11" text-anchor="middle">${escape(label)}</text>` : '',
  ].filter(Boolean).join('\n  ');
}

const paletteFrom = (brand) => ({
  brand: brand?.colour?.brand ?? '#1F5673',
  accent: brand?.colour?.accent ?? '#C77B30',
  textOnBrand: brand?.colour?.text_on_brand ?? '#FFFFFF',
  external: '#6E7781',
  unplanned: '#B4462F',
  border: 'rgba(0,0,0,0.18)',
  line: brand?.colour?.diagram_text ?? '#44505C',
  heading: brand?.type?.heading ?? 'system-ui, sans-serif',
});

/** Lay columns out left to right; every position is arithmetic on a sorted list. */
function layout(columns) {
  const tallest = Math.max(1, ...columns.map((column) => column.nodes.length));
  const height = PAD * 2 + LANE_LABEL + tallest * BOX.height + (tallest - 1) * BOX.gapY;
  const width = PAD * 2 + columns.length * BOX.width + (columns.length - 1) * BOX.gapX;
  const placed = new Map();

  columns.forEach((column, columnIndex) => {
    const x = PAD + columnIndex * (BOX.width + BOX.gapX);
    const total = column.nodes.length;
    const blockHeight = total * BOX.height + (total - 1) * BOX.gapY;
    const top = PAD + LANE_LABEL + (height - PAD * 2 - LANE_LABEL - blockHeight) / 2;
    column.nodes.forEach((node, nodeIndex) => {
      placed.set(node.id, { ...node, x, y: top + nodeIndex * (BOX.height + BOX.gapY) });
    });
  });

  return { width, height, placed };
}

function svg({ width, height, columns, placed, edges, palette, title }) {
  const body = [];
  columns.forEach((column, index) => {
    if (!column.label) return;
    const x = PAD + index * (BOX.width + BOX.gapX) + BOX.width / 2;
    body.push(`<text x="${x}" y="${PAD}" fill="${palette.line}" font-size="11" letter-spacing="0.08em" text-anchor="middle">${escape(column.label.toUpperCase())}</text>`);
  });
  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (from && to && from.x !== to.x) body.push(arrow(from, to, edge.description, palette));
  }
  for (const node of placed.values()) body.push(box(node, node.x, node.y, palette));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(title)}" font-family="${escape(palette.heading)}">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.line}"/></marker></defs>
  <rect width="${width}" height="${height}" fill="none"/>
  ${body.join('\n  ')}
</svg>
`;
}

/** C4 level 1: the system in its world. */
export function renderContextSvg(model, brand) {
  const palette = paletteFrom(brand);
  const inside = new Set(model.containers.map((container) => container.id));
  const columns = [
    { label: 'People', nodes: model.people.map((person) => ({ ...person, shape: 'person', fill: palette.accent })) },
    { label: 'System', nodes: [{ id: model.system.id, name: model.system.name, subtitle: model.architecture ?? '' }] },
    { label: 'External', nodes: model.externals.map((external) => ({ ...external, fill: palette.external })) },
  ].filter((column) => column.nodes.length);

  const { width, height, placed } = layout(columns);
  const edges = model.relationships
    .map((relationship) => ({
      from: inside.has(relationship.from) ? model.system.id : relationship.from,
      to: inside.has(relationship.to) ? model.system.id : relationship.to,
      description: relationship.description,
    }))
    .filter((edge) => edge.from !== edge.to && placed.has(edge.from) && placed.has(edge.to));

  return svg({ width, height, columns, placed, edges: dedupe(edges), palette, title: `${model.name} — system context` });
}

/** C4 level 2: the deployables and how they talk. */
export function renderContainerSvg(model, brand) {
  const palette = paletteFrom(brand);
  const ui = model.containers.filter((container) => ['spa', 'mobile', 'desktop'].includes(container.tag));
  const services = model.containers.filter((container) => container.tag === 'service' || container.tag === 'queue');
  const stores = model.containers.filter((container) => container.tag === 'database');

  const shapeFor = (container) => (container.tag === 'database' ? 'cylinder' : 'box');
  const columns = [
    { label: 'People', nodes: model.people.map((person) => ({ ...person, shape: 'person', fill: palette.accent })) },
    { label: 'Clients', nodes: ui.map((container) => ({ ...container, shape: shapeFor(container) })) },
    { label: 'Services', nodes: services.map((container) => ({ ...container, shape: shapeFor(container) })) },
    { label: 'Data and external', nodes: [...stores.map((container) => ({ ...container, shape: 'cylinder' })), ...model.externals.map((external) => ({ ...external, fill: palette.external }))] },
  ].filter((column) => column.nodes.length);

  const { width, height, placed } = layout(columns);
  const edges = model.relationships.filter((relationship) => placed.has(relationship.from) && placed.has(relationship.to));
  return svg({ width, height, columns, placed, edges: dedupe(edges), palette, title: `${model.name} — containers` });
}

/** C4 level 3: the layers inside one container, with the unplanned ones marked. */
export function renderComponentSvg(model, container, brand) {
  const palette = paletteFrom(brand);
  const components = container.components ?? [];
  const columns = [{
    label: `${container.name} components`,
    nodes: components.map((component) => ({
      ...component,
      subtitle: component.unplanned ? 'not in the intended structure' : component.path,
      fill: component.unplanned ? palette.unplanned : palette.brand,
      dashed: component.unplanned,
    })),
  }].filter((column) => column.nodes.length);
  if (!columns.length) return null;

  const { width, height, placed } = layout(columns);
  return svg({ width, height, columns, placed, edges: [], palette, title: `${model.name} — ${container.name} components` });
}

/**
 * The entity relationship diagram.
 *
 * Laid out in a fixed grid rather than by a graph engine, for the same reason as every other
 * diagram here: the same model must produce the same bytes. Entities are already sorted by name,
 * so the grid is stable as the vocabulary grows.
 */
export function renderErdSvg(model, brand) {
  const palette = paletteFrom(brand);
  if (!model.entities.length) return null;

  const CLASS_FILL = { personal: '#8A5A9B', financial: '#9B6B2E', secret: '#B4462F' };
  const width = 250;
  const columns = Math.min(3, model.entities.length);
  const rowHeightFor = (entity) => 44 + Math.max(1, entity.fields.length) * 18 + 10;

  const rows = [];
  for (let index = 0; index < model.entities.length; index += columns) rows.push(model.entities.slice(index, index + columns));

  let y = PAD;
  const placed = new Map();
  const body = [];
  for (const row of rows) {
    const tallest = Math.max(...row.map(rowHeightFor));
    row.forEach((entity, column) => {
      const x = PAD + column * (width + 60);
      placed.set(entity.id, { x, y, width, height: rowHeightFor(entity) });
      const fill = CLASS_FILL[entity.class] ?? palette.brand;
      const ink = labelColour(fill, palette.textOnBrand);
      body.push(`<rect x="${x}" y="${y}" width="${width}" height="${rowHeightFor(entity)}" rx="8" fill="#FFFFFF" stroke="${fill}" stroke-width="1.5"/>`);
      body.push(`<rect x="${x}" y="${y}" width="${width}" height="30" rx="8" fill="${fill}"/>`);
      body.push(`<rect x="${x}" y="${y + 22}" width="${width}" height="8" fill="${fill}"/>`);
      body.push(`<text x="${x + 12}" y="${y + 20}" fill="${ink}" font-size="13" font-weight="700">${escape(entity.name)}</text>`);
      body.push(`<text x="${x + width - 12}" y="${y + 20}" fill="${ink}" font-size="10" text-anchor="end" opacity="0.9">${escape(entity.class)}</text>`);
      entity.fields.slice(0, 12).forEach((field, fieldIndex) => {
        body.push(`<text x="${x + 12}" y="${y + 50 + fieldIndex * 18}" fill="${palette.line}" font-size="11">${escape(field.name)}</text>`);
        body.push(`<text x="${x + width - 12}" y="${y + 50 + fieldIndex * 18}" fill="${palette.line}" font-size="10" text-anchor="end" opacity="0.75">${escape(field.type || '')}</text>`);
      });
      if (!entity.fields.length) body.push(`<text x="${x + 12}" y="${y + 50}" fill="${palette.line}" font-size="11" opacity="0.6">no fields recorded</text>`);
    });
    y += tallest + 34;
  }

  // Relations as straight connectors between box edges; a crossing is acceptable, a different
  // layout on every run is not.
  for (const entity of model.entities) {
    for (const relation of entity.relations) {
      const target = model.entities.find((other) => other.name !== entity.name && relation.includes(other.name));
      if (!target) continue;
      const a = placed.get(entity.id);
      const b = placed.get(target.id);
      if (!a || !b) continue;
      body.unshift(`<path d="M ${a.x + a.width / 2} ${a.y + a.height} L ${b.x + b.width / 2} ${b.y}" stroke="${palette.line}" stroke-width="1.2" fill="none" stroke-dasharray="4 3"/>`);
    }
  }

  const totalWidth = PAD * 2 + columns * width + (columns - 1) * 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${y}" width="${totalWidth}" height="${y}" role="img" aria-label="${escape(`${model.name} entities`)}" font-family="${escape(palette.heading)}">
  <rect width="${totalWidth}" height="${y}" fill="none"/>
  ${body.join('\n  ')}
</svg>
`;
}

const dedupe = (edges) => {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}→${edge.to}→${edge.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export { BOX, escape };
