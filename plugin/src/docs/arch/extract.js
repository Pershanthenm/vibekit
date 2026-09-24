import { readFile } from 'node:fs/promises';
import { DEFAULT_BRAND, withContrastNotes } from './brand.js';

/**
 * Building a brand from a website. Documentation Feature Spec §5.
 *
 * Most teams do not have a document template, and the ones that do often cannot find the file.
 * This removes the excuse: two files and a preview, not a folder of templates.
 *
 * Four rules, all of them from §5 and all of them load-bearing:
 *   * Only public pages, and only on request. Nothing crawls on its own.
 *   * Assets are downloaded and committed, never referenced remotely, so a document renders
 *     identically offline and in five years.
 *   * The logo belongs to its owner. Provenance is recorded; permission is the caller's problem.
 *   * A failed or partial extraction is reported, not guessed. No logo found means the wordmark
 *     fallback and a line saying so — never a plausible-looking logo from somewhere else.
 */

const attribute = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? null;

const tags = (html, name) => [...String(html ?? '').matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => match[0]);

const meta = (html, key) => {
  for (const tag of tags(html, 'meta')) {
    const property = attribute(tag, 'property') ?? attribute(tag, 'name');
    if (property && property.toLowerCase() === key.toLowerCase()) return attribute(tag, 'content');
  }
  return null;
};

const HEX = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi;

/** Named CSS colours worth recognising; anything else is left alone rather than guessed at. */
const NAMED = { white: '#FFFFFF', black: '#000000' };

const normaliseHex = (value) => {
  const hex = String(value).trim().toLowerCase();
  const full = hex.length === 4 ? `#${hex.slice(1).split('').map((char) => char + char).join('')}` : hex;
  return full.toUpperCase();
};

/**
 * Colours, in the order §5 prefers them: declared custom properties first, because a team that
 * named `--brand` has already told you which colour is the brand; only then the computed palette.
 */
export function coloursFrom(css) {
  const text = String(css ?? '');
  const declared = {};
  for (const match of text.matchAll(/--([\w-]*(?:brand|primary|accent|secondary)[\w-]*)\s*:\s*([^;]+);/gi)) {
    const value = match[2].trim();
    const hex = value.match(HEX)?.[0] ?? NAMED[value.toLowerCase()];
    if (!hex) continue;
    const role = /accent|secondary/i.test(match[1]) ? 'accent' : 'brand';
    declared[role] = declared[role] ?? normaliseHex(hex);
  }

  // Ranked by how often a colour appears, which approximates prominence without a browser.
  const tally = new Map();
  for (const match of text.matchAll(HEX)) {
    const hex = normaliseHex(match[0]);
    if (['#FFFFFF', '#000000'].includes(hex)) continue;
    tally.set(hex, (tally.get(hex) ?? 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([hex]) => hex);

  return {
    brand: declared.brand ?? ranked[0] ?? null,
    accent: declared.accent ?? ranked.find((hex) => hex !== (declared.brand ?? ranked[0])) ?? null,
    ranked,
  };
}

/** Typefaces from the first `font-family` declarations, matched to what a document can actually use. */
export function typefacesFrom(css) {
  const families = [...String(css ?? '').matchAll(/font-family\s*:\s*([^;}]+)/gi)]
    .map((match) => match[1].replace(/["']/g, '').trim())
    .filter((family) => family && !/^(?:inherit|initial|unset)$/i.test(family));
  const heading = families.find((family) => !/mono/i.test(family));
  const mono = families.find((family) => /mono|courier|consolas/i.test(family));
  return {
    heading: heading ?? null,
    body: families.find((family) => family !== heading && !/mono/i.test(family)) ?? heading ?? null,
    mono: mono ?? null,
  };
}

/** The logo, in §5's order of preference. A miss is reported, not substituted. */
export function logoFrom(html, base) {
  const absolute = (href) => {
    if (!href) return null;
    try {
      return new URL(href, base).toString();
    } catch {
      return null;
    }
  };

  for (const tag of tags(html, 'link')) {
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase();
    if (rel.includes('icon')) {
      const href = absolute(attribute(tag, 'href'));
      if (href) return { url: href, from: `<link rel="${rel}">` };
    }
  }
  const og = absolute(meta(html, 'og:image'));
  if (og) return { url: og, from: 'og:image' };

  for (const tag of tags(html, 'img')) {
    const src = attribute(tag, 'src') ?? '';
    const alt = attribute(tag, 'alt') ?? '';
    if (/logo|wordmark|brand/i.test(`${src} ${alt}`)) {
      const href = absolute(src);
      if (href) return { url: href, from: 'an <img> named logo or wordmark' };
    }
  }
  return null;
}

/**
 * Read a page (or a file) and produce a brand.
 *
 * `fetchPage` is injected so the extraction is testable without a network, and so nothing in the
 * default path can reach the internet unless a caller asked for a URL.
 */
export async function extractBrand(source, { allowPrivate = false, fetchPage = (url) => defaultFetch(url, { allowPrivate }), now = () => new Date() } = {}) {
  const isUrl = /^https?:\/\//i.test(source);
  const { html, css, base } = isUrl ? await fetchPage(source) : await readLocal(source);

  const colours = coloursFrom(`${css}\n${html}`);
  const type = typefacesFrom(`${css}\n${html}`);
  const logo = isUrl ? logoFrom(html, base) : null;
  const name = meta(html, 'og:site_name') ?? html.match(/<title[^>]*>([^<]+)</i)?.[1]?.split(/[|·—-]/)[0]?.trim() ?? null;
  const tagline = meta(html, 'og:description') ?? meta(html, 'description') ?? null;

  const missing = [];
  if (!logo) missing.push('no logo found — a wordmark in the brand typeface is used instead');
  if (!colours.brand) missing.push('no brand colour found — a neutral palette is used');
  if (!type.heading) missing.push('no typeface found — the house default is used');
  if (!name) missing.push('no company name found — set it in brand.yml');

  const brand = withContrastNotes({
    company: { name, tagline: tagline ? tagline.slice(0, 120) : null, footer: null },
    logo: { primary: logo ? 'assets/logo.svg' : null, mono: null, favicon: null },
    colour: {
      ...DEFAULT_BRAND.colour,
      ...(colours.brand ? { brand: colours.brand } : {}),
      ...(colours.accent ? { accent: colours.accent } : {}),
    },
    type: {
      heading: type.heading ?? DEFAULT_BRAND.type.heading,
      body: type.body ?? DEFAULT_BRAND.type.body,
      mono: type.mono ?? DEFAULT_BRAND.type.mono,
    },
    document: { ...DEFAULT_BRAND.document, classification_banner: name ? `Confidential — ${name}` : null },
  });

  return {
    brand,
    source: isUrl ? new URL(source).host : source,
    logo,
    missing,
    fetchedAt: now().toISOString().slice(0, 10),
    // §5: the marks belong to their owner, and permission is the caller's responsibility. One
    // line, stated once, recorded in brand.yml rather than buried in a dialog nobody reads.
    notice: logo ? 'The logo and marks are their owner\'s property. You are responsible for having permission to use them.' : null,
  };
}

async function readLocal(path) {
  const text = await readFile(path, 'utf8');
  return { html: text, css: text, base: null };
}

/**
 * One page and its stylesheets, nothing else. `robots.txt` is honoured, and a disallowed path
 * stops the fetch rather than being crawled anyway.
 */
async function defaultFetch(url, { allowPrivate = false } = {}) {
  const target = new URL(url);
  // A brand site is public by definition. An address inside the network is refused unless the
  // caller said so, and every redirect on the way is held to the same rule.
  const { refuseUrl } = await import('../../netguard.js');
  const why = await refuseUrl(target.toString(), { allowPrivate });
  if (why) throw new Error(why);
  const get = (address) => fetchText(address, { allowPrivate });
  const robots = await get(new URL('/robots.txt', target).toString()).catch(() => '');
  if (disallows(robots, target.pathname)) {
    throw new Error(`${target.host}'s robots.txt disallows ${target.pathname}. Nothing was fetched.`);
  }

  const html = await get(target.toString());
  const sheets = [...html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)]
    .map((match) => attribute(match[0], 'href'))
    .filter(Boolean)
    .slice(0, 3);

  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
  for (const href of sheets) {
    try {
      css += `\n${await get(new URL(href, target).toString())}`;
    } catch { /* one unreachable stylesheet is a partial extraction, which is reported, not fatal */ }
  }
  return { html, css, base: target.toString() };
}

export function disallows(robots, path) {
  let applies = false;
  for (const line of String(robots ?? '').split('\n')) {
    const agent = line.match(/^\s*user-agent:\s*(.+)$/i);
    if (agent) applies = agent[1].trim() === '*';
    const rule = line.match(/^\s*disallow:\s*(.*)$/i);
    if (applies && rule) {
      const value = rule[1].trim();
      if (value && path.startsWith(value)) return true;
    }
  }
  return false;
}

async function fetchText(url, { allowPrivate = false } = {}) {
  const { safeFetch } = await import('../../netguard.js');
  const response = await safeFetch(url, { headers: { 'user-agent': 'vibekit-docs/1.0 (+brand extraction, on request)' }, allowPrivate, fetchImpl: fetch });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

/** A wordmark, for when no logo was found. Named so nobody mistakes it for the real thing. */
export const wordmarkSvg = (name, brand) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 72" width="420" height="72" role="img" aria-label="${String(name ?? 'Wordmark')}">
  <text x="0" y="50" font-family="${brand?.type?.heading ?? 'system-ui, sans-serif'}" font-size="44" font-weight="700" fill="${brand?.colour?.brand ?? '#1F5673'}">${String(name ?? 'Wordmark')}</text>
</svg>
`;
