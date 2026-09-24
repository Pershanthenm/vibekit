import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { auditDependencies } from '../deps.js';
import { detectorHits } from '../folder/checks.js';
import { DEFAULT_FOLDER } from '../folder/layout.js';
import { listRequirements } from '../folder/requirements.js';
import { readFrontMatter } from '../frontmatter.js';
import { exists, readText, writeText } from '../fsutil.js';
import { loadProject, saveProject } from '../project.js';

/**
 * `vibekit security scan`. Specification §70.
 *
 * "A security scan is not a list of tool output. It is a measurement of this application against
 * named security frameworks, so the answer to 'are we secure?' is a score against a standard a
 * third party recognises, with every finding traced to the control it fails."
 *
 * Four passes — read, probe, evidence, score — and one honesty rule: a control with no evidence is
 * not a pass, and a control only a person can evidence is counted as needing a person, never as
 * met. The scan also says what it is not: a substitute for a human penetration test before real
 * money or real personal data goes live.
 */

export const FRAMEWORKS = Object.freeze([
  { id: 'owasp-asvs', name: 'OWASP ASVS', always: true, level: (classes) => (classes.has('personal') || classes.has('financial') ? 'L2' : 'L1') },
  { id: 'owasp-top10', name: 'OWASP Top 10', always: true },
  { id: 'owasp-api-top10', name: 'OWASP API Top 10', when: (context) => context.api !== 'none', why: 'the app exposes an API' },
  { id: 'cis-docker', name: 'CIS Docker', when: (context) => context.hasDockerfile, why: 'containers or a cloud target' },
  { id: 'nist-ssdf', name: 'NIST SSDF', requested: true, why: 'asked for, or an enterprise customer' },
  { id: 'iso-27001', name: 'ISO 27001 Annex A', requested: true, why: 'the organisation is certified or working towards it' },
  { id: 'pci-dss', name: 'PCI DSS', when: (context) => context.classes.has('financial'), why: 'an entity is classified financial' },
  { id: 'popia-gdpr', name: 'POPIA / GDPR', when: (context) => context.classes.has('personal'), why: 'an entity is classified personal' },
]);

/**
 * The controls a codebase can evidence, per framework. Each names how it is checked:
 * `read` runs here against files; `probe` needs a running application (`--url`); `human` cannot be
 * evidenced by a machine and says so. Skills in `skills/lib/security/` may add to this list; they
 * are data, and a control they add is `human` unless it names one of the checks below.
 */
export const CONTROLS = Object.freeze([
  // ASVS (a representative slice of L1/L2; the ids are ASVS 4.x)
  { framework: 'owasp-asvs', id: 'V1.1.1', title: 'Secure development lifecycle: requirements, review, evidence', check: 'workflow' },
  { framework: 'owasp-asvs', id: 'V2.1', title: 'Password and credential rules stated', check: 'security-md' },
  { framework: 'owasp-asvs', id: 'V4.1.1', title: 'Access control matrix defined and tested', check: 'access-matrix' },
  { framework: 'owasp-asvs', id: 'V6.2', title: 'No secrets in the repository', check: 'secrets' },
  { framework: 'owasp-asvs', id: 'V7.1.1', title: 'Classified data never logged', check: 'logging' },
  { framework: 'owasp-asvs', id: 'V8.3', title: 'Personal data has retention and erasure', check: 'retention', when: (context) => context.classes.has('personal') },
  { framework: 'owasp-asvs', id: 'V14.2', title: 'Dependencies verified and free of known vulnerabilities', check: 'deps' },
  { framework: 'owasp-asvs', id: 'V14.4', title: 'Security headers on every response', check: 'headers', probe: true },
  { framework: 'owasp-asvs', id: 'V9.1', title: 'TLS on every connection', check: 'tls', probe: true },
  { framework: 'owasp-asvs', id: 'V1.14', title: 'Threat model for high-risk work', check: 'threat-model' },
  { framework: 'owasp-asvs', id: 'V2.2.1', title: 'Anti-automation on authentication', check: 'rate-limit', probe: true },
  { framework: 'owasp-asvs', id: 'V3.7', title: 'Session handling reviewed by a person', check: 'human' },
  // Top 10 (2021)
  { framework: 'owasp-top10', id: 'A01', title: 'Broken access control', check: 'access-matrix' },
  { framework: 'owasp-top10', id: 'A02', title: 'Cryptographic failures', check: 'tls', probe: true },
  { framework: 'owasp-top10', id: 'A03', title: 'Injection', check: 'security-md' },
  { framework: 'owasp-top10', id: 'A04', title: 'Insecure design', check: 'threat-model' },
  { framework: 'owasp-top10', id: 'A05', title: 'Security misconfiguration', check: 'headers', probe: true },
  { framework: 'owasp-top10', id: 'A06', title: 'Vulnerable and outdated components', check: 'deps' },
  { framework: 'owasp-top10', id: 'A07', title: 'Identification and authentication failures', check: 'rate-limit', probe: true },
  { framework: 'owasp-top10', id: 'A08', title: 'Software and data integrity failures', check: 'pipeline' },
  { framework: 'owasp-top10', id: 'A09', title: 'Security logging and monitoring failures', check: 'logging' },
  { framework: 'owasp-top10', id: 'A10', title: 'Server-side request forgery', check: 'ssrf' },
  // API Top 10 (2023)
  { framework: 'owasp-api-top10', id: 'API1', title: 'Broken object level authorisation', check: 'access-matrix' },
  { framework: 'owasp-api-top10', id: 'API2', title: 'Broken authentication', check: 'auth-probe', probe: true },
  { framework: 'owasp-api-top10', id: 'API3', title: 'Broken object property level authorisation', check: 'human' },
  { framework: 'owasp-api-top10', id: 'API4', title: 'Unrestricted resource consumption (rate limiting)', check: 'rate-limit', probe: true },
  { framework: 'owasp-api-top10', id: 'API5', title: 'Broken function level authorisation', check: 'access-matrix' },
  { framework: 'owasp-api-top10', id: 'API7', title: 'Server side request forgery', check: 'ssrf' },
  { framework: 'owasp-api-top10', id: 'API8', title: 'Security misconfiguration', check: 'headers', probe: true },
  { framework: 'owasp-api-top10', id: 'API9', title: 'Improper inventory management (documented endpoints)', check: 'api-reference' },
  { framework: 'owasp-api-top10', id: 'API10', title: 'Unsafe consumption of APIs', check: 'deps' },
  // CIS Docker
  { framework: 'cis-docker', id: '4.1', title: 'Container runs as a non-root user', check: 'docker-user' },
  { framework: 'cis-docker', id: '4.2', title: 'Base image pinned, not :latest', check: 'docker-pin' },
  { framework: 'cis-docker', id: '4.6', title: 'HEALTHCHECK defined', check: 'docker-health' },
  { framework: 'cis-docker', id: '4.7', title: 'No ADD from a URL; no curl | sh', check: 'docker-add' },
  { framework: 'cis-docker', id: '4.10', title: 'No secrets in the image', check: 'docker-secrets' },
  // PCI DSS (subset)
  { framework: 'pci-dss', id: '3.4', title: 'Card data never logged or stored in clear', check: 'logging' },
  { framework: 'pci-dss', id: '6.3', title: 'Secure development with review', check: 'workflow' },
  { framework: 'pci-dss', id: '7.1', title: 'Access limited by role', check: 'access-matrix' },
  { framework: 'pci-dss', id: '8.2', title: 'Authentication controls reviewed by a person', check: 'human' },
  // POPIA / GDPR
  { framework: 'popia-gdpr', id: 'retention', title: 'Retention period per personal data class', check: 'retention' },
  { framework: 'popia-gdpr', id: 'erasure', title: 'Right to erasure: an erasure path exists before the data does', check: 'erasure' },
  { framework: 'popia-gdpr', id: 'minimisation', title: 'Personal data classified and touched only where required', check: 'classification' },
  { framework: 'popia-gdpr', id: 'lawful-basis', title: 'Lawful basis recorded for each processing purpose', check: 'human' },
  { framework: 'popia-gdpr', id: 'transfer', title: 'Cross-border transfer decided', check: 'residency' },
  // NIST SSDF / ISO (process controls; evidence is the workflow itself)
  { framework: 'nist-ssdf', id: 'PO.3', title: 'Toolchain and checks defined', check: 'pipeline' },
  { framework: 'nist-ssdf', id: 'PS.1', title: 'Code protected from unauthorised change', check: 'hooks' },
  { framework: 'nist-ssdf', id: 'PW.7', title: 'Code reviewed', check: 'workflow' },
  { framework: 'nist-ssdf', id: 'RV.1', title: 'Vulnerabilities identified continuously', check: 'deps' },
  { framework: 'iso-27001', id: 'A.8.28', title: 'Secure coding', check: 'security-md' },
  { framework: 'iso-27001', id: 'A.8.32', title: 'Change management', check: 'hooks' },
  { framework: 'iso-27001', id: 'A.5.15', title: 'Access control', check: 'access-matrix' },
  { framework: 'iso-27001', id: 'A.8.15', title: 'Logging', check: 'logging' },
]);

// `.state/` is machine bookkeeping that never reaches git; scanning it would report the scan's own
// last report path as a finding.
const SKIP_DIRS = new Set(['node_modules', '.git', '.state', '.vibekit-worktrees', 'dist', 'build', 'out', 'bin', 'obj', 'vendor', 'coverage', '.next', 'target', '.venv', 'venv']);
const CODE = /\.(?:cs|fs|ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rb|php|swift|rs)$/i;

async function walkFiles(root, { max = 3000 } = {}) {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= max) return;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name)); continue; }
      out.push(join(dir, entry.name));
    }
  };
  await walk(root);
  return out;
}

/** What the scan needs to know about this project before choosing frameworks and controls. */
export async function scanContext(root, { folder = DEFAULT_FOLDER } = {}) {
  const entitiesText = (await readText(join(root, folder, 'product/entities.md'))) ?? '';
  const classes = new Set([...entitiesText.matchAll(/^class:\s*(\w+)/gm)].map((match) => match[1].toLowerCase()));
  const architecture = readFrontMatter((await readText(join(root, folder, 'workflow/architecture.md'))) ?? '');
  const files = await walkFiles(root);
  const dockerfiles = files.filter((path) => /(?:^|\/)Dockerfile(?:\.\w+)?$/.test(path));
  return { classes, api: architecture.api ?? 'rest', hasDockerfile: dockerfiles.length > 0, dockerfiles, files, folder };
}

/** Which frameworks apply: chosen once in settings, else decided by the classifications. */
export async function frameworksFor(root, { folder = DEFAULT_FOLDER, requested = null, context = null } = {}) {
  const project = await loadProject(root).catch(() => null);
  const wanted = requested ?? project?.security?.frameworks ?? null;
  const ctx = context ?? (await scanContext(root, { folder }));
  if (requested) await saveProject(root, { ...(project ?? {}), security: { ...(project?.security ?? {}), frameworks: requested } }).catch(() => {});
  return FRAMEWORKS.map((framework) => {
    const asked = Array.isArray(wanted) && wanted.includes(framework.id);
    const applies = asked || Boolean(framework.always) || Boolean(framework.when?.(ctx));
    const why = asked ? 'chosen in settings' : framework.always ? 'always' : framework.when?.(ctx) ? framework.why : framework.requested ? framework.why : `not applicable: ${framework.why}`;
    return { id: framework.id, name: framework.name, applies, why, level: framework.level?.(ctx.classes) ?? null };
  });
}

// ---------------------------------------------------------------- the read pass

const LOG_CALL = /\b(?:console\.(?:log|info|warn|error)|logger?\.\w+|_logger\.\w+|log\.(?:info|warn|error|debug)|print(?:ln)?|Log(?:Information|Warning|Error|Debug))\s*\(/;

/**
 * Evidence for every `read` control, from the folder and the code. Each entry: met · failed ·
 * n/a, with the fact that decided it. Findings carry a severity and the control they fail.
 */
export async function securityRead(root, { folder = DEFAULT_FOLDER, offline = true, context = null } = {}) {
  const ctx = context ?? (await scanContext(root, { folder }));
  const requirements = await listRequirements(root, folder).catch(() => []);
  const read = async (path) => (await readText(join(root, folder, path))) ?? '';
  const [securityMd, accessMd, qualityMd, pipeline, guardrails, apiRef] = await Promise.all([
    read('standards/security.md'), read('product/access.md'), read('product/quality.md'), read('delivery/pipeline.spec.md'), read('standards/guardrails.md'),
    readText(join(root, 'docs/api-reference.md')),
  ]);
  const entitiesText = await read('product/entities.md');
  const classified = [...entitiesText.matchAll(/^##\s+(\S+)\n(?:[^\n]*\n)*?class:\s*(personal|financial|secret)/gm)].map((match) => ({ entity: match[1], class: match[2] }));
  const classifiedFields = [...entitiesText.matchAll(/^- `(\w+)`[^\n]*\b(?:personal|financial|secret|email|password|card|token|ssn|iban)\b/gim)].map((match) => match[1]);

  const findings = [];
  const evidence = {};
  const fail = (check, severity, message, where = null) => { findings.push({ check, severity, message, where }); evidence[check] = { met: false, why: message }; };
  const met = (check, why) => { evidence[check] = { met: true, why }; };

  // secrets — detector over the folder's own text (memory, workflow) and over tracked code
  const hits = await detectorHits(root, folder).catch(() => []);
  const secretHits = hits.filter((hit) => /SECRET|KEY|TOKEN/i.test(hit.kind ?? hit.message ?? ''));
  const { detect } = await import('../sources.js');
  let codeSecrets = 0;
  for (const path of ctx.files.filter((file) => CODE.test(file) || /\.(?:json|ya?ml|env|config|toml|ini)$/i.test(file)).slice(0, 1500)) {
    if (/\.example$|package(?:-lock)?\.json$|\.lock$/.test(path)) continue;
    const text = await readText(path).catch(() => null);
    if (!text || text.length > 400_000) continue;
    const found = detect(text).filter((entry) => entry.kind === 'SECRET');
    if (found.length || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk_live_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}/.test(text)) {
      codeSecrets += 1;
      if (codeSecrets <= 5) fail('secrets', 'high', `${relative(root, path)} carries something shaped like a secret`, relative(root, path));
    }
  }
  if (!codeSecrets && !secretHits.length) met('secrets', 'no secret-shaped token in code, config, memory or workflow');
  else if (secretHits.length) fail('secrets', 'high', `${secretHits.length} detector hit(s) in memory/ or workflow/: ${secretHits[0].message ?? ''}`);

  // logging — classified field names inside log calls
  let logged = 0;
  if (classifiedFields.length) {
    const pattern = new RegExp(`\\b(?:${classifiedFields.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    for (const path of ctx.files.filter((file) => CODE.test(file)).slice(0, 1500)) {
      const text = await readText(path).catch(() => null);
      if (!text) continue;
      for (const [index, line] of text.split('\n').entries()) {
        if (LOG_CALL.test(line) && pattern.test(line)) { logged += 1; if (logged <= 5) fail('logging', 'high', `${relative(root, path)}:${index + 1} logs a classified field`, `${relative(root, path)}:${index + 1}`); }
      }
    }
  }
  if (!logged) met('logging', classifiedFields.length ? `no classified field (${classifiedFields.slice(0, 4).join(', ')}) appears in a log call` : 'no classified fields to log');

  // security.md present and non-empty; injection rules stated
  if (/\bTODO\b/.test(securityMd) || securityMd.trim().length < 200) fail('security-md', 'medium', 'standards/security.md is a stub; the stack\'s OWASP-aligned rules are not written');
  else met('security-md', 'standards/security.md states the rules agents load on every task');

  // access matrix + tests
  const matrixRows = [...accessMd.matchAll(/^\|\s*(?!Role|---)[^|]+\|/gm)].length;
  const accessTests = ctx.files.some((file) => /(?:^|\/)tests?\/access\//.test(file));
  if (!matrixRows) fail('access-matrix', 'high', 'product/access.md has no role × entity rows: an action not in the matrix cannot be denied by default');
  else if (!accessTests) fail('access-matrix', 'medium', `access.md has ${matrixRows} row(s) but tests/access/ has nothing: the matrix is prose until each cell has an allowed and a denied test`);
  else met('access-matrix', `${matrixRows} matrix row(s), tests/access/ present`);

  // retention & erasure for personal data
  const personal = classified.filter((entry) => entry.class === 'personal');
  if (personal.length) {
    // A rule, not a heading: the quality template ships a "Retention and erasure" section with a
    // TODO under it, and a heading with nothing decided beneath it is not a retention period.
    const retention = qualityMd.split('\n').some((line) => !/^#/.test(line) && !/\bTODO\b/i.test(line) && /\b(?:retention|retain(?:ed)?|kept for|delete[ds]? after|erased? after)\b/i.test(line));
    if (!retention) fail('retention', 'medium', `${personal.map((entry) => entry.entity).join(', ')} hold personal data and product/quality.md states no retention rule`);
    else met('retention', 'quality.md states retention');
    const erasure = requirements.some((entry) => /^REQ-ERASE|erasure|right to be forgotten|erase/i.test(`${entry.id} ${entry.title}`));
    if (!erasure) fail('erasure', 'medium', 'no erasure requirement exists for the personal data the entities carry');
    else met('erasure', 'an erasure requirement exists');
    met('classification', `${personal.length} personal entit${personal.length === 1 ? 'y' : 'ies'} classified`);
  } else {
    evidence.retention = { met: null, why: 'no personal data classified' };
    evidence.erasure = { met: null, why: 'no personal data classified' };
    if (entitiesText.includes('## ')) met('classification', 'entities classified; none personal'); else fail('classification', 'low', 'no entities recorded, so nothing is classified yet');
  }

  // residency
  const residency = /residency|region|eu-west|af-south|data-residency/i.test(`${(await read('workflow/architecture.md'))}\n${qualityMd}`);
  if (personal.length && !residency) fail('residency', 'low', 'personal data with no residency or transfer decision recorded'); else met('residency', personal.length ? 'residency recorded' : 'no personal data');

  // threat model on L / secret / financial
  const needThreat = requirements.filter((entry) => entry.size === 'L' || entry.entities.some((name) => classified.some((c) => c.entity === name && ['secret', 'financial'].includes(c.class))));
  const missingThreat = needThreat.filter((entry) => !/## Threat model|threat/i.test(entry.text));
  if (missingThreat.length) fail('threat-model', 'medium', `${missingThreat.map((entry) => entry.id).join(', ')} need a threat model (size L, or secret/financial data) and have none`);
  else met('threat-model', needThreat.length ? 'every high-risk requirement carries a threat model' : 'no requirement is high-risk yet');

  // deps
  const deps = await auditDependencies(root, { folder, offline }).catch((error) => ({ findings: [{ severity: 'error', message: error.message }] }));
  const depErrors = (deps.findings ?? []).filter((entry) => entry.severity === 'error');
  if (depErrors.length) fail('deps', 'high', `${depErrors.length} dependency finding(s): ${depErrors[0].message}`);
  else met('deps', `dependencies audited${offline ? ' (offline: policy and staleness only; run without --offline for advisories)' : ''}`);

  // pipeline / hooks / workflow
  if (!pipeline.trim()) fail('pipeline', 'low', 'delivery/pipeline.spec.md absent: no defined check stages'); else met('pipeline', 'pipeline.spec.md defines the check stages');
  const hooksInstalled = await exists(join(root, '.githooks/pre-commit'));
  if (!hooksInstalled) fail('hooks', 'low', '.githooks/ not installed: commit rules are convention, not enforced'); else met('hooks', 'commit rules enforced by hooks');
  const reviewed = requirements.filter((entry) => entry.status === 'done');
  const unreviewed = reviewed.filter((entry) => !entry.review.trim() || !entry.evidence.trim());
  if (unreviewed.length) fail('workflow', 'medium', `${unreviewed.map((entry) => entry.id).join(', ')} reached done without review or evidence`);
  else met('workflow', reviewed.length ? `every done requirement carries review and evidence` : 'no requirement done yet; the gates are in place');

  // SSRF — anything that fetches goes through the guard (this codebase's own rule, applied to the app's: a fetch of a user-supplied URL)
  let rawFetch = 0;
  for (const path of ctx.files.filter((file) => CODE.test(file)).slice(0, 1500)) {
    const text = await readText(path).catch(() => null);
    if (text && /\b(?:fetch|axios\.\w+|http\.get|HttpClient|requests\.get|urllib)\s*\(\s*(?:req|request|body|params|query|input|url)\b/.test(text)) { rawFetch += 1; if (rawFetch <= 3) fail('ssrf', 'medium', `${relative(root, path)} fetches an address from the request without an allow-list`, relative(root, path)); }
  }
  if (!rawFetch) met('ssrf', 'no fetch of a request-supplied address found');

  // API inventory
  if (ctx.api !== 'none') { if (apiRef) met('api-reference', 'docs/api-reference.md documents the endpoints'); else fail('api-reference', 'low', 'no docs/api-reference.md: endpoints undocumented (vibekit docs writes it from contract tests)'); }

  // Docker
  for (const dockerfile of ctx.dockerfiles) {
    const text = (await readText(dockerfile)) ?? '';
    const rel = relative(root, dockerfile);
    if (!/^USER\s+(?!root\b)\S+/m.test(text)) fail('docker-user', 'high', `${rel} has no USER: the container runs as root`, rel); else met('docker-user', `${rel} sets USER`);
    if (/^FROM\s+\S+:latest\b|^FROM\s+[^:\s@]+\s*$/m.test(text)) fail('docker-pin', 'medium', `${rel} base image is not pinned`, rel); else met('docker-pin', 'base image pinned');
    if (!/^HEALTHCHECK\b/m.test(text)) fail('docker-health', 'low', `${rel} has no HEALTHCHECK`, rel); else met('docker-health', 'HEALTHCHECK defined');
    if (/^ADD\s+https?:\/\//m.test(text) || /curl[^\n|]*\|\s*(?:ba)?sh/.test(text)) fail('docker-add', 'high', `${rel} downloads and runs code at build time`, rel); else met('docker-add', 'no remote ADD, no curl | sh');
    if (/^(?:ENV|ARG)\s+\w*(?:SECRET|PASSWORD|TOKEN|KEY)\w*\s*=\s*\S+/im.test(text)) fail('docker-secrets', 'high', `${rel} bakes a secret into the image`, rel); else met('docker-secrets', 'no secret in ENV or ARG');
  }

  const bySeverity = (severity) => findings.filter((entry) => entry.severity === severity);
  return { findings, evidence, high: bySeverity('high'), medium: bySeverity('medium'), low: bySeverity('low'), context: { classes: [...ctx.classes], api: ctx.api, dockerfiles: ctx.dockerfiles.map((path) => relative(root, path)) } };
}

// ---------------------------------------------------------------- the probe pass

/**
 * Against the running application, as an attacker would: headers, TLS, rate limiting, an
 * unauthenticated request to a documented endpoint. Every request goes through the SSRF guard —
 * the scan is not itself a way to reach an internal address.
 */
export async function securityProbe(root, url, { allowPrivate = false, fetchImpl = fetch, folder = DEFAULT_FOLDER } = {}) {
  const { refuseUrl, safeFetch } = await import('../netguard.js');
  const why = await refuseUrl(url, { allowPrivate });
  if (why) throw new Error(why);
  const findings = [];
  const evidence = {};
  const fail = (check, severity, message) => { findings.push({ check, severity, message, where: url }); evidence[check] = { met: false, why: message }; };
  const met = (check, whyMet) => { evidence[check] = { met: true, why: whyMet }; };

  if (!/^https:/i.test(url)) fail('tls', 'high', `${url} is not https`); else met('tls', 'https');

  const response = await safeFetch(url, { allowPrivate, fetchImpl, headers: { 'user-agent': 'vibekit-security/1.0 (+scan, on request)' } });
  const header = (name) => response.headers.get(name);
  const missing = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options'].filter((name) => !header(name));
  if (missing.length) fail('headers', missing.includes('content-security-policy') ? 'medium' : 'low', `missing ${missing.join(', ')}`); else met('headers', 'HSTS, CSP, nosniff and frame options present');

  // Rate limiting: a burst of small requests; a 429 anywhere in it is the control working.
  let limited = false;
  for (let index = 0; index < 25 && !limited; index += 1) {
    const burst = await safeFetch(url, { allowPrivate, fetchImpl, headers: { 'user-agent': 'vibekit-security/1.0 (+rate probe)' } }).catch(() => null);
    if (burst?.status === 429) limited = true;
  }
  if (!limited) fail('rate-limit', 'medium', '25 requests in a burst and no 429: no rate limiting on this address (OWASP API4)'); else met('rate-limit', 'a 429 arrived during the burst');

  // Auth: the first documented endpoint, unauthenticated, must not answer 200.
  const apiRef = await readText(join(root, 'docs/api-reference.md'));
  const endpoint = apiRef?.match(/^\|?\s*`?(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s`|]*)/m);
  if (endpoint) {
    const target = new URL(endpoint[2], url).toString();
    const probe = await safeFetch(target, { allowPrivate, fetchImpl, method: endpoint[1] === 'GET' ? 'GET' : 'OPTIONS' }).catch(() => null);
    if (probe && probe.status === 200 && !/health|ready|public/i.test(endpoint[2])) fail('auth-probe', 'high', `${endpoint[1]} ${endpoint[2]} answered 200 with no credentials`); else met('auth-probe', `${endpoint[1]} ${endpoint[2]} refuses an unauthenticated request${probe ? ` (${probe.status})` : ''}`);
  } else {
    evidence['auth-probe'] = { met: null, why: 'no documented endpoint to probe (docs/api-reference.md)' };
  }
  return { findings, evidence, high: findings.filter((entry) => entry.severity === 'high'), medium: findings.filter((entry) => entry.severity === 'medium'), low: findings.filter((entry) => entry.severity === 'low') };
}

// ---------------------------------------------------------------- scoring

/** Per framework: met, failed, needs a person, not applicable — never counting a gap as a pass. */
export function score(frameworks, evidence, { probed = false, context } = {}) {
  return frameworks.filter((framework) => framework.applies).map((framework) => {
    const controls = CONTROLS.filter((control) => control.framework === framework.id && (!control.when || control.when(context)));
    const rows = controls.map((control) => {
      if (control.check === 'human') return { ...control, state: 'human', why: 'cannot be evidenced by a machine' };
      if (control.probe && !probed) return { ...control, state: 'human', why: 'needs a running application: --url' };
      const fact = evidence[control.check];
      if (!fact || fact.met === null) return { ...control, state: fact?.met === null ? 'n/a' : 'human', why: fact?.why ?? 'no check ran for this control' };
      return { ...control, state: fact.met ? 'met' : 'failed', why: fact.why };
    });
    const count = (state) => rows.filter((row) => row.state === state).length;
    return { ...framework, controls: rows, met: count('met'), failed: count('failed'), human: count('human'), notApplicable: count('n/a'), applicable: rows.length - count('n/a') };
  });
}

export const scanReportPath = (root, date = new Date()) => join(root, 'docs', `security-scan-${date.toISOString().slice(0, 10)}.md`);
export const postureStatePath = (root, folder = DEFAULT_FOLDER) => join(root, folder, '.state/security.json');

export function renderScan(result) {
  const lines = [`# Security scan · ${result.date}`, '', `Frameworks measured: ${result.frameworks.map((framework) => framework.name).join(', ')}.`, ''];
  for (const framework of result.frameworks) {
    lines.push(`## ${framework.name}${framework.level ? ` ${framework.level}` : ''} — ${framework.met} of ${framework.applicable} applicable met · ${framework.failed} failed · ${framework.human} need a person`, '');
    lines.push('| Control | State | Evidence |', '| --- | --- | --- |');
    for (const control of framework.controls) lines.push(`| ${control.id} ${control.title} | ${control.state} | ${control.why} |`);
    lines.push('');
  }
  lines.push('## Findings', '');
  if (!result.findings.length) lines.push('None.');
  for (const finding of result.findings) lines.push(`- **${finding.severity}** ${finding.check} — ${finding.message}${finding.bug ? ` → ${finding.bug}` : ''}`);
  lines.push('', '---', '', 'This is not a substitute for a human penetration test before going live with real money or real personal data. It makes sure the tester spends their time on what a machine cannot find.', '');
  return lines.join('\n');
}

export async function savePosture(root, result, folder = DEFAULT_FOLDER) {
  const path = postureStatePath(root, folder);
  const previous = JSON.parse((await readText(path)) ?? '{"history":[]}');
  const entry = { date: result.date, frameworks: result.frameworks.map(({ id, met, failed, human, applicable }) => ({ id, met, failed, human, applicable })), high: result.high.length, medium: result.medium.length, low: result.low.length, report: result.report ?? null };
  const history = [...(previous.history ?? []), entry].slice(-50);
  await writeText(path, `${JSON.stringify({ last: entry, history }, null, 2)}\n`);
  return { last: entry, history };
}

export const readPosture = async (root, folder = DEFAULT_FOLDER) => JSON.parse((await readText(postureStatePath(root, folder))) ?? 'null');

export { stat };
