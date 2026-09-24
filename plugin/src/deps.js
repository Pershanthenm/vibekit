import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseGuardrails } from './folder/checks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { section } from './docs/arch/model.js';
import { readText } from './fsutil.js';

/**
 * `vibekit check --deps`. Specification §28 (research), §37, §52.
 *
 * "Wrong-library selection is the most-cited SDD failure and it is a lookup, not a judgement."
 *
 * The planner records every dependency in `architecture.md` — name, version, licence, last
 * release, maintainers — against the registry. This re-runs that lookup, so a dependency that
 * went stale, was yanked, or published a vulnerability *after* it was approved is reported rather
 * than discovered in an incident. Three things it checks, and each is a different failure:
 *
 *   * a dependency in a manifest that the record never mentions — chosen by an agent, verified
 *     by nobody;
 *   * a licence outside the allow-list in `guardrails.md` — a legal decision made by a package
 *     manager;
 *   * a registry that says the package is stale, gone, or vulnerable — the world moved.
 *
 * The network is optional. `--offline` checks the record and the manifests against the policy
 * and says which lookups it did not make. A check that quietly skipped its lookups would report
 * clean on a project whose dependencies it never looked at.
 */

/** §28 — no release in eighteen months is stale. */
export const STALE_MONTHS = 18;

/** First-party registries only, and the OSV database for advisories. Never an aggregator. */
export const REGISTRIES = Object.freeze({
  npm: { url: (name) => `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, ecosystem: 'npm' },
  nuget: { url: (name) => `https://api.nuget.org/v3/registration5-gz-semver2/${name.toLowerCase()}/index.json`, ecosystem: 'NuGet' },
  pypi: { url: (name) => `https://pypi.org/pypi/${name}/json`, ecosystem: 'PyPI' },
});
export const OSV_URL = 'https://api.osv.dev/v1/query';

/**
 * The policy, from `## Locked` in guardrails.md.
 *
 *   - registries: npm, nuget
 *   - licences: MIT, Apache-2.0, BSD-3-Clause, ISC
 *
 * Written as bullets a person reads, parsed tolerantly. No allow-list means no policy, which is
 * reported as such rather than treated as "anything goes".
 */
export function parsePolicy(guardrailsText) {
  const { locked } = parseGuardrails(guardrailsText);
  // The starter writes `Licence allow-list: MIT, …` and `Allowed registries: npm, …`; a person may
  // write `licences:` or `registries:`. All four are one setting each.
  const list = (pattern) => {
    const line = locked.find((entry) => pattern.test(entry));
    return line ? line.replace(/^[^:]*:\s*/, '').split(/[,;]/).map((item) => item.trim()).filter((item) => item && !/^TODO/i.test(item)) : [];
  };
  return {
    registries: list(/^(?:allowed\s+)?registr(?:y|ies)(?:\s+allow-list)?\s*:/i).map((item) => item.toLowerCase()),
    licences: list(/^licen[cs]es?(?:\s+allow-list)?\s*:/i),
  };
}

// ---------------------------------------------------------------- what the record says

/**
 * `## Dependencies` in architecture.md: `name · version · licence · last release · maintainers`.
 */
export function recordedDependencies(architectureText) {
  const body = section(architectureText, 'Dependencies');
  return body
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line && !/^TODO/i.test(line) && !/^name\s*·/i.test(line))
    .map((line) => {
      const [name, version, licence, lastRelease, maintainers] = line.split(/\s*·\s*/).map((part) => part?.trim() ?? '');
      return { name: name.replace(/^`|`$/g, ''), version: version || null, licence: licence || null, lastRelease: lastRelease || null, maintainers: maintainers || null, raw: line };
    })
    .filter((entry) => entry.name);
}

// ---------------------------------------------------------------- what the manifests say

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'bin', 'obj', 'vendor', '.venv', 'venv', 'target']);

async function manifests(root, { maxDepth = 3 } = {}) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > maxDepth) return;
    for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => []))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) await walk(path, depth + 1);
        continue;
      }
      if (entry.name === 'package.json' || /\.(cs|fs)proj$/.test(entry.name) || /^requirements.*\.txt$/.test(entry.name) || entry.name === 'pyproject.toml') {
        found.push(path);
      }
    }
  };
  await walk(root, 0);
  return found;
}

/** Every dependency a manifest declares, with the registry it comes from. */
export async function declaredDependencies(root) {
  const declared = [];
  for (const path of await manifests(root)) {
    const text = (await readText(path)) ?? '';
    const from = path.slice(root.length + 1);

    if (path.endsWith('package.json')) {
      try {
        const parsed = JSON.parse(text);
        for (const key of ['dependencies', 'devDependencies']) {
          for (const [name, version] of Object.entries(parsed[key] ?? {})) declared.push({ name, version: String(version), registry: 'npm', from, dev: key === 'devDependencies' });
        }
      } catch { /* a manifest that does not parse is the build's problem to report */ }
    } else if (/\.(cs|fs)proj$/.test(path)) {
      for (const match of text.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) {
        declared.push({ name: match[1], version: match[2] ?? null, registry: 'nuget', from, dev: false });
      }
    } else if (/requirements.*\.txt$/.test(path)) {
      for (const line of text.split('\n')) {
        const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*(?:[=<>!~]=?\s*([^\s;#]+))?/);
        if (match && !line.trim().startsWith('#') && !line.trim().startsWith('-')) declared.push({ name: match[1], version: match[2] ?? null, registry: 'pypi', from, dev: false });
      }
    } else if (path.endsWith('pyproject.toml')) {
      const block = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
      for (const match of block.matchAll(/"([A-Za-z0-9_.-]+)\s*([^"]*)"/g)) declared.push({ name: match[1], version: match[2].trim() || null, registry: 'pypi', from, dev: false });
    }
  }
  return declared;
}

// ---------------------------------------------------------------- what the registry says

/** One package, looked up at its own registry. Nothing is inferred when the lookup fails. */
export async function lookupPackage(registry, name, { fetchJson }) {
  const spec = REGISTRIES[registry];
  if (!spec) return { ok: false, why: `no first-party registry is known for "${registry}"` };
  try {
    const json = await fetchJson(spec.url(name));
    if (registry === 'npm') {
      const latest = json['dist-tags']?.latest ?? null;
      return {
        ok: true,
        latest,
        licence: typeof json.license === 'string' ? json.license : json.license?.type ?? json.versions?.[latest]?.license ?? null,
        lastRelease: latest ? json.time?.[latest] ?? null : null,
        deprecated: Boolean(json.versions?.[latest]?.deprecated),
        maintainers: (json.maintainers ?? []).length,
      };
    }
    if (registry === 'pypi') {
      const info = json.info ?? {};
      const releases = Object.values(json.releases ?? {}).flat().map((file) => file.upload_time_iso_8601 ?? file.upload_time).filter(Boolean).sort();
      return { ok: true, latest: info.version ?? null, licence: info.license || null, lastRelease: releases[releases.length - 1] ?? null, deprecated: Boolean(info.yanked), maintainers: info.author ? 1 : 0 };
    }
    if (registry === 'nuget') {
      const pages = json.items ?? [];
      const leaves = pages.flatMap((page) => page.items ?? []);
      const entries = leaves.map((leaf) => leaf.catalogEntry ?? {}).filter((entry) => entry.version);
      const last = entries[entries.length - 1] ?? {};
      return { ok: true, latest: last.version ?? null, licence: last.licenseExpression ?? null, lastRelease: last.published ?? null, deprecated: Boolean(last.deprecation), maintainers: last.authors ? 1 : 0 };
    }
  } catch (error) {
    return { ok: false, why: String(error.message).split('\n')[0] };
  }
  return { ok: false, why: 'unrecognised registry response' };
}

/** Known advisories for one package version, from OSV. Empty is a real answer; a failure is not. */
export async function advisories(registry, name, version, { fetchJson }) {
  const ecosystem = REGISTRIES[registry]?.ecosystem;
  if (!ecosystem) return { ok: false, vulns: [] };
  try {
    const json = await fetchJson(OSV_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(version ? { package: { name, ecosystem }, version } : { package: { name, ecosystem } }),
    });
    return { ok: true, vulns: (json.vulns ?? []).map((vuln) => ({ id: vuln.id, summary: vuln.summary ?? '', severity: vuln.database_specific?.severity ?? vuln.severity?.[0]?.score ?? null })) };
  } catch (error) {
    return { ok: false, vulns: [], why: String(error.message).split('\n')[0] };
  }
}

const monthsSince = (iso, now) => {
  const then = new Date(iso);
  return Number.isNaN(then.valueOf()) ? null : (now - then) / (30.44 * 86400000);
};

const licenceAllowed = (licence, allowed) => {
  if (!allowed.length) return true;
  const text = String(licence ?? '').toUpperCase();
  return allowed.some((entry) => text.includes(entry.toUpperCase()));
};

// ---------------------------------------------------------------- the check

const finding = (code, severity, message, fix = null) => ({ code, severity, message, fix });

/**
 * The audit. Everything it cannot decide is returned as `unchecked`, never as clean.
 */
export async function auditDependencies(root, { folder = DEFAULT_FOLDER, offline = false, fetchJson = defaultFetchJson, now = new Date() } = {}) {
  const [architecture, guardrails] = await Promise.all([
    readText(join(root, folder, 'workflow/architecture.md')),
    readText(join(root, folder, 'standards/guardrails.md')),
  ]);
  const policy = parsePolicy(guardrails ?? '');
  const recorded = recordedDependencies(architecture ?? '');
  const declared = await declaredDependencies(root);
  const findings = [];
  const unchecked = [];

  if (!policy.licences.length) {
    findings.push(finding('deps.noPolicy', 'warning',
      `${folder}/standards/guardrails.md names no licence allow-list under ## Locked, so a licence decision is being made by the package manager.`,
      'add `- licences: MIT, Apache-2.0, BSD-3-Clause, ISC` under ## Locked'));
  }

  const byName = new Map(recorded.map((entry) => [entry.name.toLowerCase(), entry]));
  for (const dependency of declared) {
    const record = byName.get(dependency.name.toLowerCase());
    if (!record) {
      // Chosen by an agent, verified by nobody. §28: anything it cannot verify is an ask, not a choice.
      findings.push(finding('deps.unverified', dependency.dev ? 'warning' : 'error',
        `${dependency.name} is in ${dependency.from} and not in ${folder}/workflow/architecture.md ## Dependencies. Nobody verified it.`,
        `record it: \`- ${dependency.name} · ${dependency.version ?? 'version'} · licence · last release · maintainers\`, or raise an ask`));
    }
    if (policy.registries.length && !policy.registries.includes(dependency.registry)) {
      findings.push(finding('deps.registry', 'error', `${dependency.name} comes from ${dependency.registry}, which ## Locked does not allow (${policy.registries.join(', ')}).`));
    }
  }

  for (const record of recorded) {
    if (record.licence && !licenceAllowed(record.licence, policy.licences)) {
      findings.push(finding('deps.licence', 'error',
        `${record.name} is ${record.licence}, outside the allow-list (${policy.licences.join(', ')}).`,
        'a licence outside the list is an ask for the security approver, not a choice'));
    }
    if (record.lastRelease) {
      const months = monthsSince(record.lastRelease, now);
      if (months !== null && months > STALE_MONTHS) {
        findings.push(finding('deps.stale', 'warning', `${record.name} last released ${record.lastRelease} — over ${STALE_MONTHS} months ago, as recorded. Is it still maintained?`));
      }
    }
  }

  if (offline) {
    unchecked.push(`${recorded.length + declared.length ? 'registry and advisory lookups' : 'nothing to look up'} — run without --offline to check for yanked, stale or vulnerable packages`);
    return { policy, recorded, declared, findings, unchecked, online: false };
  }

  // The world may have moved since the record was written.
  const seen = new Set();
  for (const dependency of declared) {
    const key = `${dependency.registry}:${dependency.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const looked = await lookupPackage(dependency.registry, dependency.name, { fetchJson });
    if (!looked.ok) {
      unchecked.push(`${dependency.name}: ${looked.why}`);
      continue;
    }
    if (looked.deprecated) findings.push(finding('deps.yanked', 'error', `${dependency.name} is deprecated or yanked at its registry.`, 'replace it; a package its own registry has withdrawn is a package nobody will fix'));
    if (looked.lastRelease) {
      const months = monthsSince(looked.lastRelease, now);
      if (months !== null && months > STALE_MONTHS) findings.push(finding('deps.stale', 'warning', `${dependency.name} last released ${String(looked.lastRelease).slice(0, 10)} — over ${STALE_MONTHS} months ago.`));
    }
    if (looked.licence && !licenceAllowed(looked.licence, policy.licences)) {
      findings.push(finding('deps.licence', 'error', `${dependency.name} is ${looked.licence} at the registry, outside the allow-list.`));
    }

    const advised = await advisories(dependency.registry, dependency.name, dependency.version?.replace(/^[\^~>=<]+/, '') ?? null, { fetchJson });
    if (!advised.ok) unchecked.push(`${dependency.name}: advisories ${advised.why ?? 'unavailable'}`);
    for (const vuln of advised.vulns) {
      findings.push(finding('deps.vulnerable', 'error',
        `${dependency.name}${dependency.version ? ` ${dependency.version}` : ''}: ${vuln.id}${vuln.summary ? ` — ${vuln.summary.slice(0, 100)}` : ''}`,
        'upgrade past the advisory, or raise an ask of kind security on the requirement that introduced it'));
    }
  }

  return { policy, recorded, declared, findings, unchecked, online: true };
}

async function defaultFetchJson(url, init = {}) {
  const { safeFetch } = await import('./netguard.js');
  const response = await safeFetch(url, { ...init, headers: { 'user-agent': 'vibekit/1.0 (+dependency audit)', ...(init.headers ?? {}) }, fetchImpl: fetch });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}
