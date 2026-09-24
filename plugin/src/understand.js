import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe as describeStack } from './brownfield/assemble.js';
import { inspect, languageShare } from './brownfield/detect.js';
import { estimateCodeTokens } from './tokens.js';
import { exists, readText } from './fsutil.js';

/**
 * `vibekit project import`. Specification §58.
 *
 * The brownfield front door: point it at a repository you already have and it reads the code and
 * says, in plain language, what the app is, how it is built, what it talks to, where the risks
 * are and how well tested it is. It asks about anything the code cannot answer. `--convert` turns
 * the corrected picture into a folder.
 *
 * Three rules from §58 shape all of it:
 *
 *   * **Read-only until `--convert`.** Nothing in the existing repository is modified, ever.
 *   * **Every claim cites the file it came from**, so `vibekit why` works on the understanding as
 *     well as on new code, and so a wrong line can be argued with rather than just disbelieved.
 *   * **Every section carries a confidence.** A guess presented at the same weight as a fact is
 *     the failure this whole document exists to prevent — the report is authored afterwards, and
 *     a human can only correct what is marked as uncertain.
 */

/** §58 — a first pass is budgeted, and the budget is reported rather than silently exceeded. */
export const READ_BUDGET = 40_000;
export const COMMITS_READ = 200;
export const ASK_LIMIT = 10;

export const UNDERSTANDING_FILE = 'understanding.md';

const CONFIDENCE = Object.freeze(['low', 'medium', 'high']);

/** Dependency names that mean "this application talks to something outside itself". */
const INTEGRATIONS = Object.freeze([
  { match: /stripe/i, name: 'Stripe', what: 'card payments' },
  { match: /sendgrid/i, name: 'SendGrid', what: 'email' },
  { match: /twilio/i, name: 'Twilio', what: 'SMS' },
  { match: /mailgun/i, name: 'Mailgun', what: 'email' },
  { match: /aws-sdk|boto3|amazon\.s3|awssdk/i, name: 'AWS', what: 'cloud services' },
  { match: /azure\.storage|azure-storage/i, name: 'Azure Storage', what: 'blob storage' },
  { match: /google-cloud|googleapis/i, name: 'Google Cloud', what: 'cloud services' },
  { match: /auth0/i, name: 'Auth0', what: 'authentication' },
  { match: /okta/i, name: 'Okta', what: 'authentication' },
  { match: /sentry/i, name: 'Sentry', what: 'error reporting' },
  { match: /elastic|opensearch/i, name: 'Elasticsearch', what: 'search' },
  { match: /redis|stackexchange\.redis/i, name: 'Redis', what: 'caching' },
  { match: /rabbitmq|masstransit/i, name: 'RabbitMQ', what: 'messaging' },
  { match: /kafka/i, name: 'Kafka', what: 'messaging' },
]);

/** Conventions a team followed without writing down. Each is a candidate rule or skill (§58). */
const CONVENTIONS = Object.freeze([
  { match: /FluentValidation|AbstractValidator/, text: 'validation is done with FluentValidation validators' },
  { match: /\bzod\b|z\.object\(/, text: 'input is validated with zod schemas' },
  { match: /DateTime\.UtcNow|Date\.UTC|utcnow\(\)|toISOString\(\)/, text: 'times are handled in UTC' },
  { match: /\bis_?deleted\b|\bdeleted_?at\b/i, text: 'records are soft-deleted rather than removed' },
  { match: /\bResult<|Result\.Ok|Either</, text: 'failures are returned as a result type rather than thrown' },
  { match: /MediatR|IRequestHandler/, text: 'requests go through MediatR handlers' },
  { match: /ILogger<|structlog|winston|pino/, text: 'logging is structured, through an injected logger' },
  { match: /\[Authorize\]|@UseGuards|requireAuth|login_required/, text: 'endpoints are protected by an authorisation attribute or guard' },
  { match: /AutoMapper|IMapper\b/, text: 'transport and domain models are mapped with AutoMapper' },
  { match: /CancellationToken/, text: 'async work takes a cancellation token' },
  { match: /\btenant(_?id)?\b/i, text: 'rows are scoped by a tenant id' },
]);

/** Field names that decide a classification. §58: guessed here, confirmed by a human. */
const CLASSIFIERS = Object.freeze([
  { match: /email|phone|address|name|dob|birth|passport|nationalid|ssn/i, klass: 'personal' },
  { match: /card|iban|account(no|number)|amount|price|invoice|payment|balance/i, klass: 'financial' },
  { match: /password|secret|token|apikey|api_key|privatekey/i, klass: 'secret' },
]);

const SECRET_PATTERNS = Object.freeze([
  { match: /(?:password|pwd)\s*[=:]\s*["'][^"'{}\s]{6,}["']/i, what: 'a password' },
  { match: /(?:api[_-]?key|apikey)\s*[=:]\s*["'][A-Za-z0-9_\-]{16,}["']/i, what: 'an API key' },
  { match: /sk_live_[A-Za-z0-9]{10,}/, what: 'a live Stripe secret key' },
  { match: /AKIA[0-9A-Z]{16}/, what: 'an AWS access key id' },
  { match: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, what: 'a private key' },
  { match: /(?:connectionstring)\s*[=:]\s*["'][^"']*password=[^"';]+/i, what: 'a connection string with a password' },
]);

const CONFIG_FILE = /(appsettings[\w.]*\.json|\.env(\..+)?|config\.(json|ya?ml)|application\.(properties|ya?ml)|settings\.py)$/i;

/**
 * Config files probed by name rather than found by walking.
 *
 * The tree walk only collects files with a recognised source extension, so a committed `.env` —
 * the single highest-value thing to find in a brownfield repo — was never opened at all.
 */
const CONFIG_CANDIDATES = Object.freeze([
  '.env', '.env.local', '.env.development', '.env.production',
  'appsettings.json', 'appsettings.Development.json', 'appsettings.Production.json',
  'config.json', 'config.yml', 'config.yaml', 'application.properties',
  'application.yml', 'settings.py', 'docker-compose.yml', 'docker-compose.yaml',
  'src/appsettings.json', 'src/appsettings.Development.json',
]);
const TEST_FILE = /(\.test\.|\.spec\.|_test\.|Tests?\.(cs|java|kt)$|^test_)/i;
const READ_EXT = /\.(cs|fs|ts|tsx|js|jsx|vue|py|java|kt|go|rb|php|swift|rs|sql|json|ya?ml|md|properties|env)$/i;

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}
;

/**
 * A reader that stops at the budget.
 *
 * §58's loading order — manifests and structure first, then one representative file per layer,
 * then anything a question sends it to — only means something if running out of budget is
 * reported rather than hidden. So this records what it read and what it did not get to.
 */
function reader(root, limit) {
  const state = { read: 0, files: [], skipped: [] };
  return {
    state,
    async file(relative) {
      if (state.read >= limit) {
        state.skipped.push(relative);
        return null;
      }
      const path = join(root, relative);
      try {
        if ((await stat(path)).size > 400_000) {
          state.skipped.push(relative);
          return null;
        }
        const text = await readFile(path, 'utf8');
        state.read += estimateCodeTokens(text);
        state.files.push(relative);
        return text;
      } catch {
        return null;
      }
    },
  };
}

const section = (key, title, confidence, from, lines) => ({
  key,
  title,
  confidence: CONFIDENCE.includes(confidence) ? confidence : 'low',
  from: [...new Set(from.filter(Boolean))].slice(0, 6),
  lines: lines.filter(Boolean),
});

/**
 * Read a repository and produce the understanding. Nothing is written.
 */
export async function understandRepo(root, { budget = READ_BUDGET, commits = COMMITS_READ } = {}) {
  const inspection = await inspect(root);
  const stack = describeStack(inspection);
  const read = reader(root, budget);

  const manifestText = [...inspection.manifests.values()].join('\n');
  const languages = languageShare(inspection.languageCounts);

  // One representative file per top-level source directory, then a wider sample for the
  // convention and risk detectors — which are the only two that need breadth rather than depth.
  const sourceSample = representative(inspection.sources);
  const bodies = [];
  for (const relative of sourceSample) {
    const text = await read.file(relative);
    if (text !== null) bodies.push([relative, text]);
  }

  const walked = inspection.sources.concat([...inspection.manifests.keys()]).filter((path) => CONFIG_FILE.test(path));
  const probed = [];
  for (const candidate of CONFIG_CANDIDATES) {
    if (await exists(join(root, candidate))) probed.push(candidate);
  }
  const configs = [];
  for (const relative of [...new Set([...probed, ...walked])].slice(0, 24)) {
    const text = await read.file(relative);
    if (text !== null) configs.push([relative, text]);
  }

  const readme = (await read.file('README.md')) ?? (await read.file('readme.md'));
  const existingRules = [];
  for (const name of ['CLAUDE.md', '.cursorrules', 'AGENTS.md', '.github/copilot-instructions.md']) {
    if (await exists(join(root, name))) existingRules.push(name);
  }

  const log = git(root, ['log', `-${commits}`, '--pretty=%s']).split('\n').filter(Boolean);
  const entities = entitiesFound(bodies, inspection.migrations);
  const externals = integrationsFound(manifestText, configs, [...inspection.manifests.keys()]);
  const tests = testsFound(inspection.sources, bodies, stack);
  const risks = risksFound(configs, bodies, inspection.sources);
  const conventions = conventionsFound(bodies);
  const commands = commandsFound(inspection.manifests, stack);

  const sections = [
    section('what', 'What it is', readme ? 'high' : 'low',
      ['README.md', ...stack.evidence.slice(0, 2).map((item) => item.file)], [
        readme ? firstParagraph(readme) : 'No README, so what this is has to come from you.',
        `${languages.length ? languages.map((entry) => `${entry.language} ${entry.share}%` ).join(' · ') : 'no recognised language'}`,
      ]),

    section('built', 'How it is built', stack.evidence.length && commands.length ? 'high' : 'low',
      stack.evidence.map((item) => item.file), [
        built(stack) || null,
        inspection.dirs.length ? `top-level: ${inspection.dirs.join(', ')}` : null,
        commands.length ? `commands: ${commands.map((command) => `${command.name} → ${command.run}`).join(' · ')}` : 'no build or test command found in any manifest',
        existingRules.length ? `already has agent rules: ${existingRules.join(', ')} — kept below the <!-- local --> marker on convert` : null,
      ]),

    section('entities', 'Entities and data', entities.length ? 'medium' : 'low',
      [...new Set(entities.flatMap((entity) => entity.from))], [
        entities.length ? `${entities.length} entit${entities.length === 1 ? 'y' : 'ies'}: ${entities.map((entity) => entity.name).join(', ')}` : 'no entity or model files recognised',
        entities.some((entity) => entity.klass !== 'internal')
          ? `classification guessed from field names: ${entities.filter((entity) => entity.klass !== 'internal').map((entity) => `${entity.name} (${entity.klass})`).join(', ')} · to confirm`
          : null,
        inspection.migrations.length ? `${inspection.migrations.length} migration(s)` : null,
      ]),

    section('talks', 'What it talks to', externals.length ? 'high' : 'medium',
      externals.flatMap((external) => external.from), [
        externals.length ? externals.map((external) => `${external.name} (${external.what})`).join(' · ') : 'nothing outside itself was recognised',
      ]),

    section('quality', 'Quality', tests.files ? 'medium' : 'high',
      [...new Set(inspection.ci), ...tests.from], [
        tests.files ? `${tests.files} test file(s)${tests.frameworks.length ? ` · ${tests.frameworks.join(', ')}` : ''}` : 'no test files found',
        inspection.ci.length ? `CI: ${[...new Set(inspection.ci)].join(', ')}` : 'no CI workflow found',
        tests.missing.length ? `missing test kinds: ${tests.missing.join(', ')}` : null,
      ]),

    section('conventions', 'Conventions nobody wrote down', 'low',
      conventions.flatMap((convention) => convention.from), [
        conventions.length ? null : 'no repeated convention was clear enough to name',
        ...conventions.map((convention) => `${convention.text} (seen in ${convention.seen} files)`),
      ]),
  ];

  const decisions = decisionsIn(log);
  const understanding = {
    root,
    plain: plainTerms({ readme, stack, languages, entities, externals, tests, inspection }),
    sections,
    risks,
    conventions,
    decisions,
    entities,
    externals,
    commands,
    existingRules,
    budget: { limit: budget, read: read.state.read, files: read.state.files.length, skipped: read.state.skipped.length },
  };
  understanding.asks = asksFor(understanding);
  return understanding;
}

// ---------------------------------------------------------------- the detectors

/** One representative file per top-level directory, then breadth up to a sane sample. */
function representative(sources) {
  const perDir = new Map();
  for (const path of sources) {
    const dir = path.split('/').slice(0, 2).join('/');
    if (!perDir.has(dir)) perDir.set(dir, []);
    perDir.get(dir).push(path);
  }
  const chosen = [];
  for (const [, paths] of [...perDir.entries()].sort()) chosen.push(...paths.slice(0, 6));
  return chosen.filter((path) => READ_EXT.test(path)).slice(0, 80);
}

const firstParagraph = (text) => String(text)
  .split('\n')
  .filter((line) => line.trim() && !/^[#>!\[]/.test(line.trim()))
  .slice(0, 2)
  .join(' ')
  .slice(0, 300) || 'The README says nothing about what this is.';

/**
 * Entities, from the shapes a codebase declares them in.
 *
 * Deliberately shallow: a class or interface whose body is mostly typed properties is a model,
 * and anything cleverer would be a parser per language. The confidence on the section says so.
 */
export function entitiesFound(bodies, migrations = []) {
  const found = new Map();

  for (const [path, text] of bodies) {
    if (TEST_FILE.test(path)) continue;
    // `\s*\}` rather than `\n\}`, and fields split on `;` as well as on line starts: a
    // one-line TypeScript interface is ordinary, and the stricter pattern saw none of them.
    for (const match of String(text).matchAll(/(?:class|interface|type|struct|model)\s+([A-Z][A-Za-z0-9_]*)\b[^{]*\{([\s\S]{0,1200}?)\s*\}/g)) {
      const [, name, body] = match;
      const fields = [...body.matchAll(/(?:^|[;{,])[ \t]*(?:public\s+|private\s+|readonly\s+)?(?:[\w<>?\[\]]+\s+)?([a-z_][A-Za-z0-9_]*)\s*[:;=]/gm)].map((field) => field[1]);
      if (fields.length < 2) continue;

      const klass = CLASSIFIERS.find((rule) => fields.some((field) => rule.match.test(field)))?.klass ?? 'internal';
      const existing = found.get(name);
      if (existing) {
        existing.from.push(path);
        continue;
      }
      found.set(name, { name, klass, fields: [...new Set(fields)].slice(0, 12), from: [path] });
    }
  }

  for (const path of migrations) {
    for (const match of basename(path).matchAll(/create([A-Z][A-Za-z0-9]*)/g)) {
      const name = match[1];
      if (!found.has(name)) found.set(name, { name, klass: 'internal', fields: [], from: [path] });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
}

export function integrationsFound(manifestText, configs, manifestPaths) {
  const configText = configs.map(([, text]) => text).join('\n');
  return INTEGRATIONS
    .filter((entry) => entry.match.test(manifestText) || entry.match.test(configText))
    .map((entry) => ({
      name: entry.name,
      what: entry.what,
      from: [
        entry.match.test(manifestText) ? manifestPaths.find((path) => entry.match.test(path)) ?? manifestPaths[0] : null,
        configs.find(([, text]) => entry.match.test(text))?.[0] ?? null,
      ].filter(Boolean),
    }));
}

export function testsFound(sources, bodies, stack = {}) {
  const testPaths = sources.filter((path) => TEST_FILE.test(path) || /(^|\/)tests?\//i.test(path));
  const text = bodies.filter(([path]) => TEST_FILE.test(path)).map(([, body]) => body).join('\n');
  const frameworks = [
    ...(stack.testFrameworks ?? []),
    /xunit/i.test(text) ? 'xUnit' : null,
    /nunit/i.test(text) ? 'NUnit' : null,
    /jest|vitest/i.test(text) ? 'Jest or Vitest' : null,
    /pytest/i.test(text) ? 'pytest' : null,
    /playwright/i.test(text) ? 'Playwright' : null,
  ].filter(Boolean);
  const unique = [...new Set(frameworks)];

  // §58 reports the kinds that are absent, because those are the gaps that become the first
  // real requirements on a converted project.
  const missing = [
    testPaths.some((path) => /contract/i.test(path)) ? null : 'contract',
    testPaths.some((path) => /smoke/i.test(path)) ? null : 'smoke',
    testPaths.some((path) => /invariant|property/i.test(path)) ? null : 'invariant',
  ].filter(Boolean);

  return { files: testPaths.length, frameworks: unique, missing, from: testPaths.slice(0, 4) };
}

/**
 * Risks, each one a security finding as well (§58), and each citing its file.
 *
 * Only patterns worth a human's attention on a first pass. Anything needing dataflow analysis is
 * deliberately absent rather than approximated: a wrong high-severity finding costs more
 * attention than it saves.
 */
export function risksFound(configs, bodies, sources) {
  const risks = [];

  for (const [path, text] of configs) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.match.test(text)) {
        risks.push({ severity: 'critical', title: `${pattern.what} is committed in ${path}`, file: path, detail: 'A secret in the repository is a secret every clone and every fork has.' });
      }
    }
  }

  for (const [path, text] of bodies) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.match.test(text)) {
        risks.push({ severity: 'critical', title: `${pattern.what} is hard-coded in ${path}`, file: path, detail: 'A secret in code cannot be rotated without a deploy.' });
      }
    }

    const concatenated = [...String(text).matchAll(/(?:SELECT|INSERT|UPDATE|DELETE)\b[^\n;]{0,200}?["']\s*\+\s*\w|f["'](?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{|\$\{[^}]+\}[^\n]{0,80}(?:FROM|WHERE)\b/gi)];
    if (concatenated.length) {
      risks.push({ severity: 'high', title: `SQL is built by string concatenation in ${path} (${concatenated.length} site${concatenated.length === 1 ? '' : 's'})`, file: path, detail: 'Parameterise it. This is the shape of most injection vulnerabilities.' });
    }

    const skipped = [...String(text).matchAll(/\b(?:it|test|describe)\.skip\b|\[(?:Ignore|Skip)[\](]|@(?:Ignore|Disabled)\b|@pytest\.mark\.skip/g)];
    if (skipped.length) {
      risks.push({ severity: 'medium', title: `${skipped.length} skipped or disabled test(s) in ${path}`, file: path, detail: 'A skipped test reads as coverage and proves nothing.' });
    }

    if (/http:\/\/(?!localhost|127\.0\.0\.1)/.test(String(text))) {
      risks.push({ severity: 'medium', title: `a plain-http URL in ${path}`, file: path, detail: 'Traffic to it is readable in transit.' });
    }
  }

  if (configs.some(([path]) => /^\.env$/.test(basename(path))) || sources.some((path) => /^\.env$/.test(basename(path)))) {
    risks.push({ severity: 'critical', title: '.env is in the repository', file: '.env', detail: 'Whatever is in it is public to everyone with the repo, and to everyone with a fork.' });
  }

  // One per title: the same pattern in forty files is one decision to make, not forty.
  const seen = new Set();
  return risks.filter((risk) => {
    const key = risk.title.replace(/\d+/g, 'n');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

export function conventionsFound(bodies) {
  return CONVENTIONS
    .map((convention) => {
      const hits = bodies.filter(([, text]) => convention.match.test(text));
      return { text: convention.text, seen: hits.length, from: hits.slice(0, 3).map(([path]) => path) };
    })
    // Two files is a coincidence; three is a habit worth writing down as a rule.
    .filter((convention) => convention.seen >= 3)
    .sort((a, b) => b.seen - a.seen);
}

export function commandsFound(manifests, stack = {}) {
  const commands = Object.entries(stack.commands ?? {})
    .filter(([, run]) => run)
    .map(([name, run]) => ({ name, run, from: 'a manifest' }));
  for (const [path, text] of manifests) {
    if (path.endsWith('package.json')) {
      try {
        const scripts = JSON.parse(text).scripts ?? {};
        for (const name of ['build', 'test', 'lint', 'start']) {
          if (scripts[name]) commands.push({ name, run: `npm run ${name}`, from: path });
        }
      } catch { /* an unparseable manifest is reported by the stack detector, not here */ }
    }
    if (/\.(cs|fs)proj$/.test(path)) {
      commands.push({ name: 'build', run: 'dotnet build', from: path }, { name: 'test', run: 'dotnet test', from: path });
    }
    if (path.endsWith('pyproject.toml')) commands.push({ name: 'test', run: 'pytest', from: path });
    if (path.endsWith('go.mod')) commands.push({ name: 'test', run: 'go test ./...', from: path });
  }
  const seen = new Set();
  return commands.filter((command) => !seen.has(command.name) && seen.add(command.name));
}

/** §58 — the ten most-referenced decisions in commit messages become decision memories. */
export function decisionsIn(log) {
  const interesting = log.filter((line) => /\b(?:switch(?:ed)? to|migrat(?:e|ed|ion) to|replac(?:e|ed) .* with|adopt(?:ed)?|drop(?:ped)? |moved? to|introduce[d]?)\b/i.test(line));
  const counts = new Map();
  for (const line of interesting) {
    const key = line.replace(/^\w+(\([^)]*\))?:\s*/, '').trim().slice(0, 120);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([text, times]) => ({ text, times }));
}

/** The stack in one phrase, from what the manifests actually declared. */
const built = (stack) => [
  [...(stack.runtimes ?? []), ...(stack.languages ?? [])].filter(Boolean).slice(0, 3).join(', '),
  (stack.frameworks ?? []).length ? `with ${stack.frameworks.slice(0, 4).join(', ')}` : '',
].filter(Boolean).join(' ');

function plainTerms({ readme, stack, languages, entities, externals, tests, inspection }) {
  const how = built(stack) || languages[0]?.language || 'an unrecognised stack';
  const talks = externals.length ? ` It talks to ${externals.map((external) => external.name).join(', ')}.` : ' Nothing outside itself was recognised.';
  return [
    readme ? firstParagraph(readme) : 'There is no README, so what this is for has to come from you.',
    `It is built in ${how}, with ${entities.length} recognised entit${entities.length === 1 ? 'y' : 'ies'} and ${inspection.migrations.length} migration(s).${talks}`,
    `${tests.files} test file(s)${inspection.ci.length ? ', run in CI' : ', and no CI workflow'}.`,
  ].join(' ');
}

// ---------------------------------------------------------------- asks (§58)

/**
 * Only what the code cannot answer. Ten at most.
 *
 * The test each one has to pass: could reading more files have answered it? If so it is not an
 * ask, it is a detector that has not been written. What is left is genuinely outside the code —
 * who uses it, what is still live, what the data means, what was intentional.
 */
export function asksFor(understanding) {
  const guessed = understanding.entities.filter((entity) => entity.klass !== 'internal');
  const asks = [
    {
      ask: 'Who uses this system, and in what roles? The code shows endpoints and authorisation attributes but not who is on the other side of them.',
      plain: 'Who actually uses this, and what are the different kinds of user?',
      lands: 'product/context.md and product/access.md',
    },
    understanding.externals.length ? {
      ask: `Which of these integrations are still live: ${understanding.externals.map((external) => external.name).join(', ')}? A dependency in a manifest may be dead code.`,
      plain: 'Which of these outside services are still actually being used?',
      lands: 'workflow/architecture.md',
    } : null,
    guessed.length ? {
      ask: `Are these classifications right: ${guessed.map((entity) => `${entity.name} (${entity.klass})`).join(', ')}? They were guessed from field names.`,
      plain: 'I guessed which data is personal or financial from the field names. Have I got it right?',
      lands: 'product/entities.md',
    } : null,
    understanding.conventions.length ? {
      ask: `Are these conventions intentional, and should they be rules: ${understanding.conventions.slice(0, 3).map((convention) => convention.text).join('; ')}?`,
      plain: 'I noticed some habits in the code. Are they deliberate, and should they be rules everyone follows?',
      lands: 'standards/rules.md',
    } : null,
    !understanding.commands.length ? {
      ask: 'What are the exact build and test commands? No manifest declared them, and an agent given the wrong one wastes a whole session.',
      plain: 'What do you actually type to build this and to run the tests?',
      lands: 'product/map.md',
    } : null,
    understanding.risks.some((risk) => risk.severity === 'critical') ? {
      ask: `${understanding.risks.filter((risk) => risk.severity === 'critical').length} committed secret(s) were found. Have they been rotated, and where should credentials live instead?`,
      plain: 'I found secrets in the repository. Have they been changed, and where should they be kept?',
      lands: 'delivery/environments.md',
    } : null,
    {
      ask: 'What must never go wrong here — the one or two failures that would matter most?',
      plain: 'What is the worst thing that could happen if this system got something wrong?',
      lands: 'product/context.md and product/invariants.md',
    },
  ].filter(Boolean);

  return asks.slice(0, ASK_LIMIT);
}

// ---------------------------------------------------------------- the report

export function renderUnderstanding(understanding, { at = new Date() } = {}) {
  const out = [
    '# Understanding',
    '',
    `Read ${at.toISOString().slice(0, 10)} · ${understanding.budget.read.toLocaleString()} of ${understanding.budget.limit.toLocaleString()} token budget · ${understanding.budget.files} files`,
    '',
    'This file is yours. Correct anything that is wrong: everything the folder is built from comes',
    'from here, and a confidence below `high` is VibeKit saying it inferred rather than read.',
    '',
    '## In plain terms',
    '',
    understanding.plain,
  ];

  for (const part of understanding.sections) {
    out.push('', `## ${part.title}`, '', `confidence: ${part.confidence}${part.from.length ? `    from: ${part.from.join(', ')}` : ''}`, '');
    for (const line of part.lines) out.push(`- ${line}`);
  }

  out.push('', '## Risks', '', `confidence: medium    ${understanding.risks.length} found; each is also an open security finding`, '');
  if (!understanding.risks.length) out.push('- None of the patterns checked for were found. That is not the same as none existing.');
  for (const risk of understanding.risks) out.push(`- **${risk.severity}** ${risk.title} — ${risk.detail}`);

  if (understanding.decisions.length) {
    out.push('', '## Decisions in the commit history', '', 'confidence: low    from: git log', '');
    for (const decision of understanding.decisions) out.push(`- ${decision.text}`);
  }

  out.push('', '## What I could not tell', '', `These are asks (§12), not gaps in the reading: ${understanding.asks.length} of them.`, '');
  for (const ask of understanding.asks) out.push(`- ${ask.plain}  → ${ask.lands}`);

  if (understanding.budget.skipped) {
    out.push('', `_${understanding.budget.skipped} file(s) were not read: the budget ran out. \`vibekit project import --refresh\` after answering the asks reads what a question points at._`);
  }
  out.push('');
  return out.join('\n');
}

/**
 * §58's conversion table. Returned as data rather than printed so `--convert` and the report
 * cannot describe it differently.
 */
export const CONVERSION = Object.freeze([
  ['What it is', 'product/context.md, glossary.md (starter)'],
  ['How it is built', 'workflow/architecture.md as observed · product/map.md with the real commands · standards/code-style.md from observed style'],
  ['Entities and data', 'product/entities.md with classifications · product/access.md skeleton'],
  ['What it talks to', '## Dependencies in the architecture record · delivery/environments.md with the secret names found'],
  ['Quality', 'product/quality.md starter · tests/smoke/ stub · the missing test kinds listed as requirements'],
  ['Risks', 'open security findings · guardrails.md denied paths for the risky areas'],
  ['Conventions', 'standards/rules.md starter · one skill stub per convention'],
  ['Commit history', 'memory/repo/ decision memories'],
]);

/** What the folder config should be, from the understanding. Used by `--convert`. */
export function configFrom(understanding, name) {
  const stackLanguages = understanding.sections.find((part) => part.key === 'built')?.lines[0] ?? '';
  return {
    name,
    description: understanding.plain.split('. ')[0],
    architecture: 'layered',
    stack: { language: stackLanguages.split(' · ')[0] || 'unrecorded' },
    commands: Object.fromEntries(understanding.commands.map((command) => [command.name, command.run])),
    entities: understanding.entities.map((entity) => ({
      name: entity.name,
      class: entity.klass,
      fields: entity.fields.map((field) => ({ name: field, type: 'unrecorded' })),
    })),
  };
}

/**
 * §58 — `--refresh` diffs the code against the last understanding and reports what changed,
 * which is how a repo converted six months ago gets re-checked.
 */
export async function refreshUnderstanding(root, folder, options = {}) {
  const previous = await readText(join(root, folder, UNDERSTANDING_FILE));
  const next = await understandRepo(root, options);
  if (previous === null) return { first: true, understanding: next, changes: [] };

  const changes = [];
  const said = (pattern) => pattern.test(previous);

  for (const entity of next.entities) {
    if (!said(new RegExp(`\\b${entity.name}\\b`))) changes.push(`${entity.name} is in the code and not in the understanding`);
  }
  for (const external of next.externals) {
    if (!said(new RegExp(external.name, 'i'))) changes.push(`it now talks to ${external.name}, which the understanding does not mention`);
  }
  for (const risk of next.risks.filter((entry) => entry.severity === 'critical')) {
    if (!said(new RegExp(risk.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))) changes.push(`new critical risk: ${risk.title}`);
  }
  return { first: false, understanding: next, changes };
}
