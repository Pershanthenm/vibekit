import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readFrontMatter } from './frontmatter.js';
import { exists, readText } from './fsutil.js';
import { estimateProseTokens } from './tokens.js';
import { parseBlocks } from './yamlish.js';

/**
 * Declarative checks. Extensions and Integration Spec §5.1.
 *
 * "Checks are declarative, not executable. This is the load-bearing rule. If a check were arbitrary
 * code, installing an extension would mean running somebody else's program against your repository
 * with your credentials in the environment."
 *
 * A check declares what it inspects and what makes it fail, in six forms. It cannot shell out,
 * cannot reach the network, and cannot read outside the repository — the evaluator has no way to.
 */

export const KINDS = Object.freeze(['path-forbidden', 'file-required', 'string-forbidden', 'test-required', 'front-matter-required', 'budget']);
export const SEVERITIES = Object.freeze(['error', 'warning']);

/** Validate one declaration. Returns the problems; an empty list means it can be evaluated. */
export function validateCheck(check, { source = 'checks' } = {}) {
  const problems = [];
  if (!/^[a-z][a-z0-9.-]{1,60}$/.test(String(check?.id ?? ''))) problems.push(`${source}: a check needs an id (lowercase slug)`);
  if (!KINDS.includes(check?.kind)) problems.push(`${source}/${check?.id ?? '?'}: kind must be one of ${KINDS.join(', ')}`);
  if (check?.severity && !SEVERITIES.includes(check.severity)) problems.push(`${source}/${check.id}: severity must be error or warning`);
  const need = (field) => { if (!check?.[field]) problems.push(`${source}/${check?.id ?? '?'}: ${check?.kind} needs ${field}`); };
  if (check?.kind === 'path-forbidden') need('path');
  if (check?.kind === 'file-required') need('path');
  if (check?.kind === 'string-forbidden') { need('string'); need('glob'); }
  if (check?.kind === 'test-required') need('pattern');
  if (check?.kind === 'front-matter-required') { need('field'); need('glob'); }
  if (check?.kind === 'budget') { need('path'); if (!(Number(check?.max) > 0)) problems.push(`${source}/${check?.id}: budget needs max (tokens)`); }
  for (const key of ['path', 'glob', 'pattern']) {
    const value = String(check?.[key] ?? '');
    if (value && (value.startsWith('/') || value.split('/').includes('..') || /^[A-Za-z]:/.test(value))) problems.push(`${source}/${check.id}: ${key} must stay inside the repository`);
  }
  return problems;
}

/** A glob with `*` and `**`, matched against a repository-relative path. */
export const globToRegExp = (glob) => new RegExp(`^${String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`);

const SKIP = new Set(['node_modules', '.git', '.state', 'dist', 'build', 'out', 'bin', 'obj', 'vendor', 'coverage', '.next', 'target', '.venv', 'venv']);

export async function walkRepo(root, { max = 4000 } = {}) {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= max) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) await walk(path); continue; }
      out.push(relative(root, path).split('\\').join('/'));
    }
  };
  await walk(root);
  return out;
}

/**
 * Evaluate declared checks against a repository. Returns findings in the same shape `runChecks`
 * uses, coded `ext.<source>.<id>` so a report says where a rule came from.
 */
export async function evaluateChecks(root, checks, { files = null } = {}) {
  const findings = [];
  const listed = files ?? (await walkRepo(root));
  const contentCache = new Map();
  const content = async (path) => {
    if (!contentCache.has(path)) contentCache.set(path, await readText(join(root, path)).catch(() => null));
    return contentCache.get(path);
  };
  const finding = (check, message) => ({ code: `ext.${check.source ?? 'checks'}.${check.id}`, message: check.message ? `${check.message} (${message})` : message, fix: check.fix ?? null, severity: check.severity ?? 'error', source: check.source ?? null });

  for (const check of checks) {
    if (validateCheck(check, { source: check.source }).length) continue;
    if (check.kind === 'path-forbidden') {
      const matcher = globToRegExp(check.path.replace(/\/$/, '') + (check.path.endsWith('/') ? '/**' : ''));
      const hit = listed.find((path) => matcher.test(path) || path.startsWith(check.path));
      if (hit) findings.push(finding(check, `${hit} exists and ${check.path} is forbidden`));
    }
    if (check.kind === 'file-required') {
      if (!(await exists(join(root, check.path)))) findings.push(finding(check, `${check.path} is required and missing`));
    }
    if (check.kind === 'string-forbidden') {
      const matcher = globToRegExp(check.glob);
      const needle = check.regex ? new RegExp(check.string, 'i') : null;
      for (const path of listed.filter((entry) => matcher.test(entry)).slice(0, 2000)) {
        const text = await content(path);
        if (!text) continue;
        const at = needle ? text.search(needle) : text.indexOf(check.string);
        if (at !== -1) { findings.push(finding(check, `${path} contains "${check.string}"`)); break; }
      }
    }
    if (check.kind === 'test-required') {
      const matcher = globToRegExp(check.pattern);
      if (!listed.some((path) => matcher.test(path))) findings.push(finding(check, `no test matches ${check.pattern}`));
    }
    if (check.kind === 'front-matter-required') {
      const matcher = globToRegExp(check.glob);
      for (const path of listed.filter((entry) => matcher.test(entry)).slice(0, 500)) {
        const meta = readFrontMatter((await content(path)) ?? '');
        if (!meta[check.field]) { findings.push(finding(check, `${path} has no ${check.field}: in its front matter`)); break; }
      }
    }
    if (check.kind === 'budget') {
      const text = await content(check.path);
      if (text !== null) {
        const tokens = estimateProseTokens(text);
        if (tokens > Number(check.max)) findings.push(finding(check, `${check.path} is ${tokens} tokens against a ceiling of ${check.max}`));
      }
    }
  }
  return findings;
}

/** Read every `checks/*.yml` in an extension folder, tagged with the extension's name. */
export async function readChecks(dir, source) {
  const checks = [];
  for (const name of (await readdir(join(dir, 'checks')).catch(() => [])).filter((entry) => /\.ya?ml$/.test(entry)).sort()) {
    const text = (await readText(join(dir, 'checks', name))) ?? '';
    let blocks = [];
    try { blocks = parseBlocks(text); } catch (error) { checks.push({ id: name, kind: 'invalid', source, problems: [`${source}/checks/${name}: ${error.message}`] }); continue; }
    for (const block of blocks) checks.push({ ...block, source, problems: validateCheck(block, { source: `${source}/checks/${name}` }) });
  }
  return checks;
}

export { stat };
