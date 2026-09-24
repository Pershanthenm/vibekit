/**
 * The small subset of YAML the folder's declarative files use: maps, lists, `[a, b]`, scalars.
 *
 * `servers.yml`, `extension.yml` and an extension's `checks/*.yml` are written by people and read
 * by a check. A full YAML parser would be a dependency and would accept anchors, tags and multi-line
 * scalars nobody here needs; this accepts exactly the shapes the specification shows and refuses
 * the rest with a line number, which is the better error for a hand-written file.
 */

const scalar = (raw) => {
  const text = String(raw).trim().replace(/\s+#.*$/, '');
  if (text === '') return null;
  if (/^\[.*\]$/.test(text)) return text.slice(1, -1).split(',').map((item) => scalar(item)).filter((item) => item !== null);
  if (/^(['"]).*\1$/.test(text)) return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
};

const indentOf = (line) => line.match(/^ */)[0].length;

export function parseYamlish(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
    .map((line, index) => ({ line: line.replace(/\t/g, '  '), number: index + 1 }))
    .filter(({ line }) => line.trim() && !/^\s*#/.test(line));
  let at = 0;

  const fail = (why, number) => { throw new Error(`line ${number}: ${why}`); };

  function block(indent) {
    if (at >= lines.length) return null;
    const first = lines[at];
    if (indentOf(first.line) < indent) return null;
    return /^\s*-(\s|$)/.test(first.line) ? list(indentOf(first.line)) : map(indentOf(first.line));
  }

  function list(indent) {
    const items = [];
    while (at < lines.length && indentOf(lines[at].line) === indent && /^\s*-(\s|$)/.test(lines[at].line)) {
      const { line, number } = lines[at];
      const rest = line.trim().slice(1).trim();
      at += 1;
      if (!rest) { items.push(block(indent + 2)); continue; }
      const pair = rest.match(/^([\w][\w.-]*):(?:\s+(.*))?$/);
      if (pair) {
        // `- key: value` starts a map whose remaining keys are indented under the dash.
        const item = {};
        item[pair[1]] = pair[2] === undefined ? block(indent + 2) : scalar(pair[2]);
        const more = at < lines.length && indentOf(lines[at].line) > indent && !/^\s*-(\s|$)/.test(lines[at].line) ? map(indentOf(lines[at].line)) : null;
        items.push(more ? { ...item, ...more } : item);
      } else if (/^[\w][\w.-]*:/.test(rest)) {
        fail('a key needs a space after the colon', number);
      } else {
        items.push(scalar(rest));
      }
    }
    return items;
  }

  function map(indent) {
    const out = {};
    while (at < lines.length && indentOf(lines[at].line) === indent && !/^\s*-(\s|$)/.test(lines[at].line)) {
      const { line, number } = lines[at];
      const pair = line.trim().match(/^([\w][\w.-]*):(?:\s+(.*))?$/);
      if (!pair) fail(`expected "key: value", got "${line.trim()}"`, number);
      at += 1;
      if (pair[2] === undefined || pair[2] === '') {
        out[pair[1]] = at < lines.length && indentOf(lines[at].line) > indent ? block(indentOf(lines[at].line)) : null;
      } else {
        out[pair[1]] = scalar(pair[2]);
      }
    }
    if (at < lines.length && indentOf(lines[at].line) > indent) fail(`unexpected indentation before "${lines[at].line.trim()}"`, lines[at].number);
    return out;
  }

  const value = block(0);
  if (at < lines.length) fail(`could not read "${lines[at].line.trim()}"`, lines[at].number);
  return value;
}

/** A list of maps, whatever the file's top level is: a bare list, or a map with one list in it. */
export function parseBlocks(text) {
  const value = parseYamlish(text);
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (value && typeof value === 'object') {
    const lists = Object.values(value).filter(Array.isArray);
    if (lists.length === 1) return lists[0].filter((item) => item && typeof item === 'object');
  }
  return [];
}
