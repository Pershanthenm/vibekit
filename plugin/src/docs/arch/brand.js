import { readText } from '../../fsutil.js';
import { contrast } from './svg.js';
import { brandPath } from './paths.js';

/**
 * The letterhead. Documentation Feature Spec §5.
 *
 * One file, `brand.yml`, is the only thing most teams need: the built-in document structures pick
 * it up and the output comes back in the house style. A template is an override for the case
 * where an organisation mandates a particular document *structure*, which is rarer than people
 * expect — the letterhead is what makes a document look like yours, not the section order.
 */

export const DEFAULT_BRAND = Object.freeze({
  company: { name: null, tagline: null, footer: null },
  logo: { primary: null, mono: null, favicon: null },
  colour: { brand: '#1F5673', accent: '#C77B30', text: '#14171C', text_on_brand: '#FFFFFF' },
  type: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' },
  document: { classification_banner: null, page_size: 'A4' },
});

/**
 * A very small YAML reader for the two-level shape `brand.yml` is written in.
 *
 * Deliberately not a YAML library: this file has one documented shape, and anything else is
 * ignored rather than guessed at — the same discipline the standards index already uses.
 */
export function parseBrand(text) {
  if (!text) return null;
  const brand = { company: {}, logo: {}, colour: {}, type: {}, document: {} };
  let group = null;
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const top = raw.match(/^([\w-]+):\s*(.*)$/);
    if (top) {
      group = top[1];
      if (top[2].trim()) {
        brand[group] = unquote(top[2]);
        group = null;
      } else if (!brand[group] || typeof brand[group] !== 'object') {
        brand[group] = {};
      }
      continue;
    }
    const nested = raw.match(/^\s+([\w-]+):\s*(.*)$/);
    if (nested && group && typeof brand[group] === 'object') brand[group][nested[1]] = unquote(nested[2]);
  }
  return brand;
}

const unquote = (value) => String(value ?? '').trim().replace(/^["']|["']$/g, '');

/**
 * Contrast is checked on the way in, not silently corrected.
 *
 * A brand colour that fails WCAG AA as body text is kept for accents and a darker shade is
 * derived for text — recorded as a note so nobody is surprised that the document text is not
 * exactly the brand hex. §5 requires the note; a silent substitution is how a team discovers the
 * change in a printed document.
 */
export function withContrastNotes(brand) {
  const colour = { ...DEFAULT_BRAND.colour, ...(brand?.colour ?? {}) };
  const notes = [];

  if (contrast(colour.brand, '#FFFFFF') < 4.5 && contrast(colour.brand, colour.text_on_brand ?? '#FFFFFF') < 4.5) {
    colour.text_on_brand = '#14171C';
    notes.push(`white text fails AA on ${colour.brand}; dark text used on brand fills instead`);
  }
  if (contrast(colour.brand, '#FFFFFF') < 4.5) {
    colour.diagram_text = darken(colour.brand, 0.45);
    notes.push(`brand colour darkened to ${colour.diagram_text} for body and label text (AA contrast)`);
  }

  return { ...DEFAULT_BRAND, ...brand, colour, notes };
}

/** Multiply toward black, which keeps the hue and is reproducible. */
export function darken(hex, amount) {
  const value = String(hex ?? '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#14171C';
  const parts = [0, 2, 4].map((offset) => Math.round(Number.parseInt(full.slice(offset, offset + 2), 16) * (1 - amount)));
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export async function loadBrand(root, docs) {
  return withContrastNotes(parseBrand(await readText(brandPath(root, docs))) ?? {});
}

export function renderBrandYaml(brand, source = null) {
  const lines = ['# docs/brand.yml · edit freely — VibeKit never overwrites this file'];
  if (source) lines.push(`source: ${source}, fetched ${new Date().toISOString().slice(0, 10)}`);
  lines.push('company:');
  for (const key of ['name', 'tagline', 'footer']) lines.push(`  ${key}: ${brand.company?.[key] ?? ''}`);
  lines.push('logo:');
  for (const key of ['primary', 'mono', 'favicon']) lines.push(`  ${key}: ${brand.logo?.[key] ?? ''}`);
  lines.push('colour:');
  for (const [key, value] of Object.entries(brand.colour ?? {})) {
    if (key === 'diagram_text' || key === 'notes') continue;
    lines.push(`  ${key}: "${value}"`);
  }
  for (const note of brand.notes ?? []) lines.push(`  note: ${note}`);
  lines.push('type:');
  for (const key of ['heading', 'body', 'mono']) lines.push(`  ${key}: ${brand.type?.[key] ?? ''}`);
  lines.push('document:');
  lines.push(`  classification_banner: ${brand.document?.classification_banner ?? ''}`);
  lines.push(`  page_size: ${brand.document?.page_size ?? 'A4'}`);
  return `${lines.join('\n')}\n`;
}
