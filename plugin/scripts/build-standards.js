// Turn the Universal Engineering Rules into a standards library.
//
// The rules are prose, written once, in one file. A standards library wants them as one file per
// topic with a description that injection can match on — so this splits section 26 of the
// guidelines into those files rather than anyone retyping them, which is how wording drifts.
//
// Run it when the guidelines change:
//
//   node scripts/build-standards.js <path to ENGINEERING-GUIDELINES.md>
//
// The output is committed. Nothing reads the guidelines at runtime: the plugin ships the standards
// it ships, and a machine without that file still gets them.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeText } from '../src/fsutil.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where each rule group lands, and what injection matches on.
 *
 * The description is the load-bearing field — it decides whether a standard is loaded for a task —
 * so each one says what the rules are about in the words someone would use asking about them.
 * `globs` is set only where a rule belongs to a kind of file rather than a kind of task.
 */
const TOPICS = [
  {
    heading: 'Responsive UI',
    path: 'ui/responsive.md',
    description: 'Responsive UI and layout: mobile, phone, tablet, laptop, desktop, screen sizes, breakpoints',
  },
  {
    heading: 'WCAG 2.2 AA',
    path: 'ui/accessibility.md',
    description: 'Accessibility for any UI, screen, page, form or component: WCAG, keyboard, focus, semantic HTML, contrast, screen readers',
  },
  {
    heading: 'No hardcoded business/application data',
    path: 'data/no-hardcoded-data.md',
    description: 'Where users, roles, statuses, permissions, URLs, dropdown options, lists and business rules come from; mock and seed data',
  },
  {
    heading: 'Secure APIs',
    path: 'api/secure-apis.md',
    description: 'Securing an API, endpoint, route or controller: server-side enforcement, DTOs rather than entities, what a response may contain',
  },
  {
    heading: 'Asynchronous implementation',
    path: 'code/async.md',
    description: 'Async and await for I/O, database, network and file calls; cancellation tokens; blocking calls to avoid',
  },
  {
    heading: 'Secure secret management',
    path: 'security/secrets.md',
    description: 'Secrets, API keys, tokens, passwords, certificates and credentials: where they live and how they are supplied',
  },
  {
    heading: 'Environment separation',
    path: 'delivery/environments.md',
    description: 'Environments and configuration: development, QA, staging and production differing by config rather than code',
  },
  {
    heading: 'Code-first migrations',
    path: 'database/migrations.md',
    description: 'Database schema, tables, columns and migrations: code-first and version controlled',
    globs: '**/migrations/**,**/*.prisma,**/schema.sql,**/schema.rb',
  },
  {
    heading: 'Input validation',
    path: 'api/input-validation.md',
    description: 'Validating input, requests, forms, parameters and payloads on the server, whatever the frontend already does',
  },
  {
    heading: 'Authentication & authorisation',
    path: 'security/authorisation.md',
    description: 'Authentication, authorisation, login, sign in, sessions, roles and permissions, enforced server-side',
  },
  {
    heading: 'Logging & observability',
    path: 'operations/logging.md',
    description: 'Logging, tracing, metrics and observability: structured logs, correlation ids, log levels',
  },
  {
    heading: 'Testing',
    path: 'testing/testing.md',
    description: 'Tests and coverage: business logic, endpoints, auth paths, critical workflows, and a regression test for every bug fix',
  },
  {
    heading: 'Error handling',
    path: 'code/error-handling.md',
    description: 'Errors, exceptions and failure handling at boundaries: useful to developers, safe for users',
  },
  {
    heading: 'Secure dependency management',
    path: 'security/dependencies.md',
    description: 'Dependencies, packages and libraries: keeping them minimal, current and scanned',
  },
  {
    heading: 'No sensitive information in logs',
    path: 'operations/sensitive-data-in-logs.md',
    description: 'What must never be logged: passwords, tokens, keys, credentials, personal data and PII',
  },
  {
    heading: 'No secrets in source control',
    path: 'security/secrets-in-git.md',
    description: 'Keeping secrets out of git and source control, and what to do when one is committed',
  },
  {
    heading: 'Quality & security gates',
    path: 'delivery/quality-gates.md',
    description: 'Quality gates and definition of done: build, tests, code analysis, security and dependency scanning, coverage, accessibility, linting',
  },
  {
    heading: 'Anti-hallucination / specification-first development',
    path: 'process/specification-first.md',
    description: 'Never inventing requirements, APIs, endpoints, schemas, config or test results; what to do when the spec is silent',
  },
];

const SECTION = '# 26. Universal Engineering Rules';

/** The body under one `## <heading>` of section 26, down to the next heading of any level. */
function bodyOf(guidelines, heading) {
  const section = guidelines.slice(guidelines.indexOf(SECTION));
  const lines = section.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`No "## ${heading}" in ${SECTION}. The guidelines changed; update TOPICS.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('#'));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

const frontMatter = ({ description, globs }) => [
  '---',
  `description: ${JSON.stringify(description)}`,
  ...(globs ? [`globs: ${JSON.stringify(globs)}`] : []),
  '---',
].join('\n');

export async function buildStandards(source) {
  const guidelines = await readFile(source, 'utf8');
  if (!guidelines.includes(SECTION)) throw new Error(`${source} has no "${SECTION}".`);
  const written = [];
  for (const topic of TOPICS) {
    const content = `${frontMatter(topic)}\n\n# ${topic.heading}\n\n${bodyOf(guidelines, topic.heading)}\n`;
    await writeText(join(ROOT, 'standards', topic.path), content);
    written.push(topic.path);
  }
  return written;
}

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/build-standards.js <path to ENGINEERING-GUIDELINES.md>');
  process.exitCode = 1;
} else {
  const written = await buildStandards(source);
  console.log(`✔ Wrote ${written.length} standards into standards/`);
  written.forEach((path) => console.log(`  ${path}`));
}
