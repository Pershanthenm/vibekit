// Most stacks have a boilerplate that has already solved tenants, roles, auditing and the build
// pipeline. Starting from one is often the right call — and sometimes plainly the wrong one,
// because its conventions replace the ones this tool would generate.
//
// Like components.js this is keyed on the stack, never on what the app is for. A starter is
// offered because it fits the chosen backend or front end, not because the project is about
// stock, or bookings, or anything else.

const starter = (raw) => ({
  ...raw,
  licence: { name: raw.licence[0], class: raw.licence[1] },
  gives: raw.gives ?? [],
  caveats: raw.caveats ?? [],
  fits: raw.fits ?? {},
  // A starter with no command is one you download or clone yourself, after buying or signing up.
  scaffold: raw.scaffold ?? '',
});

export const STARTERS = [
  starter({
    id: 'abp',
    label: 'ABP Framework',
    licence: ['LGPL-3.0', 'weak-copyleft'],
    fits: { backend: ['aspnetcore'] },
    summary: 'Opinionated .NET application framework with DDD layering, multi-tenancy and a module system.',
    gives: [
      'Users, roles, permissions, tenants, settings and audit logging already built',
      'Domain / Application / EntityFrameworkCore / HttpApi layering wired up for you',
      'A CLI that generates CRUD pages and APIs from an entity',
    ],
    caveats: [
      'LGPL-3.0 — fine to build a closed-source product on, but read the terms if you intend to fork the framework itself.',
      'Large surface area: your architecture becomes ABP conventions, not the ones vibekit would generate.',
    ],
    scaffold: 'dotnet tool install -g Volo.Abp.Studio.Cli && abp new <Name>',
    docs: 'https://abp.io/docs',
    weight: 2,
  }),
  starter({
    id: 'aspnet-zero',
    label: 'ASP.NET Zero',
    licence: ['Commercial (paid)', 'proprietary'],
    fits: { backend: ['aspnetcore'] },
    summary: 'Paid ABP-based product: full source, a finished admin UI and a working tenant and user system on day one.',
    gives: [
      'A complete admin application — tenants, users, roles, audit logs, settings — already styled',
      'Full source code, changed freely, plus Power Tools for rapid CRUD generation',
      'Vendor support and an upgrade path for the life of the licence',
    ],
    caveats: [
      'Paid per developer, and the source lives in a private repository you are granted access to.',
      'Check the current licence terms yourself before committing — it is not open source.',
    ],
    docs: 'https://aspnetzero.com/pricing',
    weight: 2,
  }),
  starter({
    id: 'clean-architecture-sln',
    label: 'Clean Architecture solution template (.NET)',
    licence: ['MIT', 'permissive'],
    fits: { backend: ['aspnetcore'] },
    summary: 'A small, unopinionated .NET solution already split into Domain, Application, Infrastructure and Web.',
    gives: ['The layering and project references set up correctly', 'Testing projects wired in from the start'],
    caveats: ['Structure only — no users, roles or admin UI. You build those.'],
    scaffold: 'dotnet new install Clean.Architecture.Solution.Template && dotnet new ca-sln -o <Name>',
    docs: 'https://github.com/jasontaylordev/CleanArchitecture',
    weight: 1,
  }),
  starter({
    id: 'jhipster',
    label: 'JHipster',
    licence: ['Apache-2.0', 'permissive'],
    fits: { backend: ['spring'] },
    summary: 'Generates a Spring Boot application plus an Angular, React or Vue front end from an entity model.',
    gives: [
      'Authentication, users and roles generated',
      'Entities, REST APIs and screens generated from a JDL model',
      'Docker Compose, CI and monitoring configuration included',
    ],
    caveats: ['Regenerating over hand-edited code needs care; keep customisations where the generator does not overwrite.'],
    scaffold: 'npx generator-jhipster',
    docs: 'https://www.jhipster.tech',
    weight: 2,
  }),
  starter({
    id: 'cookiecutter-django',
    label: 'Cookiecutter Django',
    licence: ['BSD-3-Clause', 'permissive'],
    fits: { backend: ['django'] },
    summary: 'The standard production Django layout: split settings, Docker, Celery, allauth and CI already in place.',
    gives: [
      'Sign-up, sign-in and email flows via django-allauth',
      'Split settings, Docker Compose and Postgres configured',
      'Ruff, mypy and pytest set up',
    ],
    caveats: ['Asks a long list of questions up front; the choices are baked in once generated.'],
    scaffold: 'uvx cookiecutter gh:cookiecutter/cookiecutter-django',
    docs: 'https://cookiecutter-django.readthedocs.io',
    weight: 2,
  }),
  starter({
    id: 'fastapi-full-stack',
    label: 'Full Stack FastAPI template',
    licence: ['MIT', 'permissive'],
    fits: { backend: ['fastapi'] },
    summary: 'FastAPI, SQLModel, Postgres and a React front end, with auth and Docker already wired together.',
    gives: [
      'JWT auth, user management and password recovery',
      'SQLModel, Alembic migrations and Docker Compose',
      'A React admin front end talking to the API',
    ],
    caveats: ['Opinionated about SQLModel and the bundled React front end; swapping either is real work.'],
    scaffold: 'Use the GitHub template at fastapi/full-stack-fastapi-template',
    docs: 'https://github.com/fastapi/full-stack-fastapi-template',
    weight: 2,
  }),
  starter({
    id: 'laravel-starter-kit',
    label: 'Laravel starter kit',
    licence: ['MIT', 'permissive'],
    fits: { backend: ['laravel'] },
    summary: 'The official Laravel installer scaffolds auth and a chosen front end (React, Vue or Livewire).',
    gives: ['Registration, sign-in, password reset and profile screens', 'Your chosen front end wired to Vite and Tailwind'],
    caveats: ['The front-end choice is made at generation time.'],
    scaffold: 'laravel new <name>',
    docs: 'https://laravel.com/docs/starter-kits',
    weight: 2,
  }),
  starter({
    id: 'nest-cli',
    label: 'Nest CLI scaffold',
    licence: ['MIT', 'permissive'],
    fits: { backend: ['nestjs'] },
    summary: 'The standard NestJS project skeleton with modules, testing and tooling configured.',
    gives: ['Module, controller and service structure', 'Jest and end-to-end test setup'],
    caveats: ['Structure only — no auth or users.'],
    scaffold: 'npx @nestjs/cli new <name>',
    docs: 'https://docs.nestjs.com/cli/overview',
    weight: 1,
  }),
  starter({
    id: 't3',
    label: 'create-t3-app',
    licence: ['MIT', 'permissive'],
    fits: { web: ['react-next'] },
    summary: 'Next.js with TypeScript, tRPC, Prisma, NextAuth and Tailwind — only the parts you tick.',
    gives: ['End-to-end typed API calls via tRPC', 'Prisma schema and NextAuth sign-in configured'],
    caveats: ['Full-stack Next.js: it assumes the API lives with the front end, not in a separate backend.'],
    scaffold: 'npm create t3-app@latest',
    docs: 'https://create.t3.gg',
    weight: 2,
  }),
  starter({
    id: 'refine',
    label: 'Refine',
    licence: ['MIT', 'permissive'],
    fits: { web: ['react-next'] },
    summary: 'React framework aimed at admin panels and internal tools: CRUD, tables, forms and auth as hooks.',
    gives: [
      'CRUD screens, filtering, sorting and pagination generated from a data provider',
      'Auth, access control and audit-log hooks',
    ],
    caveats: ['Strongest for data-heavy admin UIs; less of a fit for a bespoke public-facing design.'],
    scaffold: 'npm create refine-app@latest',
    docs: 'https://refine.dev',
    weight: 1,
  }),
  starter({
    id: 'next-supabase',
    label: 'Next.js + Supabase starter',
    licence: ['MIT', 'permissive'],
    fits: { backend: ['supabase'], web: ['react-next'] },
    needs: ['backend', 'web'],
    summary: 'Next.js wired to Supabase auth, with cookie-based sessions already handled.',
    gives: ['Supabase auth, sessions and protected routes working', 'Client and server Supabase helpers set up'],
    caveats: ['A thin starting point — the data model and screens are yours to build.'],
    scaffold: 'npx create-next-app -e with-supabase',
    docs: 'https://supabase.com/docs/guides/getting-started/quickstarts/nextjs',
    weight: 2,
  }),
  starter({
    id: 'very-good-flutter',
    label: 'Very Good CLI (Flutter)',
    licence: ['MIT', 'permissive'],
    fits: { mobile: ['flutter'], desktop: ['flutter'], web: ['flutter-web'] },
    summary: 'A Flutter app scaffold with flavours, localisation, strict lints and test coverage from the start.',
    gives: ['Dev, staging and production flavours', 'Localisation, strict analysis options and CI workflows'],
    caveats: ['Opinionated lints will flag code that a default Flutter project accepts.'],
    scaffold: 'dart pub global activate very_good_cli && very_good create flutter_app <name>',
    docs: 'https://cli.vgv.dev',
    weight: 2,
  }),
];

export const findStarter = (id) => STARTERS.find((item) => item.id === id);

const layerFits = (ids, chosen) => !chosen || ids.includes(chosen.id);

/**
 * A starter fits when at least one layer it names matches, no layer it names is contradicted, and
 * every layer in `needs` is both present and matching. The Supabase + Next.js starter must not be
 * offered to someone who chose Supabase and Angular, nor to an API-only project with no web layer.
 */
export const fitsStack = (item, choices) => Object.entries(item.fits).some(([layer, ids]) => ids.includes(choices[layer]?.id))
  && Object.entries(item.fits).every(([layer, ids]) => layerFits(ids, choices[layer]))
  && (item.needs ?? []).every((layer) => item.fits[layer]?.includes(choices[layer]?.id));

// Why one starter is worth more than its neighbours here. Deliberately about the shape of the
// build — sign-in, compliance, architecture, scale — and never about what the app is for.
const RULES = [
  (item, x) => /tenant|users, roles|user management|auth/i.test(item.gives.join(' ')) && x.signin && x.signin !== 'social'
    && [2, 'sign-in, users and roles are already built, which is the slowest part to get right'],
  (item, x) => /audit/i.test(item.gives.join(' ')) && ['elevated', 'privacy', 'strict'].includes(x.compliance)
    && [2, 'ships the audit logging your compliance level requires'],
  (item, x) => item.id === 'abp' && x.architecture === 'modular-clean' && [2, 'its module system is a modular monolith by design'],
  (item, x) => item.licence.class === 'proprietary' && x.licensing === 'commercial-ok' && [1, 'paid tooling is acceptable here'],
  (item) => item.licence.class === 'permissive' && [1, 'permissive licence, no obligations to manage'],
  (item, x) => /structure only/i.test(item.caveats.join(' ')) && ['large', 'huge'].includes(x.scale)
    && [-1, 'gives structure but none of the identity plumbing this scale needs'],
];

const LICENCE_TEXT = {
  'weak-copyleft': 'weak copyleft (LGPL/MPL)',
  copyleft: 'copyleft (GPL)',
  'source-available': 'source-available, not OSI open source',
  proprietary: 'proprietary or paid',
};
const ALLOWED = {
  permissive: ['permissive'],
  'oss-only': ['permissive', 'weak-copyleft', 'copyleft'],
};

function excludedReason(item, licensing) {
  const allowed = ALLOWED[licensing];
  if (!allowed || allowed.includes(item.licence.class)) return null;
  const policy = licensing === 'permissive' ? 'permissive open source only' : 'any open source';
  return `${item.licence.name} is ${LICENCE_TEXT[item.licence.class]}, which "${policy}" rules out`;
}

const score = (item, context) => {
  const reasons = RULES.map((rule) => rule(item, context)).filter(Boolean).map(([points, text]) => ({ points, text }));
  return { ...item, reasons, score: (item.weight ?? 0) + reasons.reduce((sum, reason) => sum + reason.points, 0) };
};

/**
 * The starters that fit this stack, best first, plus the ones the licensing answer rules out.
 * An empty `ranked` means no boilerplate is on offer, and the question should not be asked.
 */
export function rankStarters(choices, answers = {}) {
  const fitting = STARTERS.filter((item) => fitsStack(item, choices));
  const excluded = fitting.map((item) => ({ item, reason: excludedReason(item, answers.licensing) })).filter(({ reason }) => reason);
  const ranked = fitting.filter((item) => !excluded.some((entry) => entry.item.id === item.id))
    .map((item) => score(item, answers))
    .sort((left, right) => right.score - left.score);
  return { ranked, excluded: excluded.map(({ item, reason }) => ({ id: item.id, label: item.label, reason })) };
}
