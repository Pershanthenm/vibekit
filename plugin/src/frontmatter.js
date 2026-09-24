/**
 * The front matter every file in the folder carries, read and written the same way everywhere.
 *
 * Values are strings and nothing else: `size: M` is "M", `entities: [Booking]` is "[Booking]" for
 * the caller to split. A YAML parser would be a dependency, and a stricter one would refuse files
 * a person wrote by hand — which is the only kind there is.
 */

export function readFrontMatter(text) {
  const match = String(text ?? '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const pairs = match[1].split('\n').map((line) => line.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean);
  return Object.fromEntries(pairs.map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')]));
}

/** Replace one `key:` line in place. The key must already be there; a missing key is a template bug. */
export const setFrontMatterValue = (text, key, value) => text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`);

/** Add a `key: value` line at the end of the front matter, or replace it when it is already there. */
export function upsertFrontMatter(text, key, value) {
  if (new RegExp(`^${key}:`, 'm').test(text)) return setFrontMatterValue(text, key, value);
  return String(text).replace(/^---\n([\s\S]*?)\n---/, (whole, body) => `---\n${body}\n${key}: ${value}\n---`);
}

export const slugify = (text) => String(text ?? '')
  .toLowerCase()
  .replaceAll('#', 'sharp')
  .replaceAll('+', 'plus')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
