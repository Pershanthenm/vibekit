export const EXAMPLE_PROJECT = {
  version: 1,
  project: {
    name: 'mealmate',
    description: 'Plan weekly meals as a household and get one shared, auto-generated shopping list.',
    problem: 'Households waste time and food because meal planning and grocery shopping are disconnected.',
    users: ['busy parents', 'flatmates sharing groceries'],
  },
  targets: ['web', 'ios', 'android', 'api'],
  stack: {
    languages: ['TypeScript'],
    frontend: 'Next.js (App Router)',
    mobile: 'React Native (Expo)',
    desktop: '',
    backend: 'Node.js + Fastify',
    database: 'PostgreSQL + Drizzle ORM',
    auth: 'Clerk',
    hosting: 'Vercel (web), Fly.io (API), EAS (mobile)',
    other: ['Turborepo monorepo', 'Sentry'],
  },
  architecture: {
    style: 'clean',
    notes: [
      'Monorepo: apps/web, apps/mobile, apps/api, packages/core (domain + use cases), packages/ui.',
      'packages/core has no React, HTTP or database imports.',
    ],
  },
  standards: {
    naming: 'camelCase values, PascalCase types and components, kebab-case files.',
    testing: { framework: 'Vitest (unit), Playwright (web e2e), Maestro (mobile e2e)', coverage: 80, tdd: true },
    commits: 'Conventional Commits',
    branching: 'Trunk-based with short-lived feature branches',
    rules: [
      'Functions do one thing: aim for ≤ 20 lines and ≤ 3 parameters.',
      'Guard clauses over nesting (max 2 levels).',
      'No dead code, commented-out code or speculative abstractions (YAGNI).',
      'Comments explain why, never what.',
      'Handle errors explicitly; never swallow them.',
    ],
  },
  commands: {
    install: 'pnpm install',
    dev: 'pnpm dev',
    lint: 'pnpm lint',
    format: 'pnpm format',
    typecheck: 'pnpm typecheck',
    test: 'pnpm test',
    build: 'pnpm build',
  },
  workflow: { enforce: true, autonomy: 'gated', engine: 'cursor', maxLanes: 3, skills: 'plugin' },
  memory: { provider: 'agentmemory', url: 'http://localhost:3111', recallLimit: 5 },
  knowledge: { provider: 'opencontext', folder: 'projects/mealmate', playbook: 'playbook' },
  docs: {
    enabled: true,
    dir: 'docs',
    dataModelSources: ['packages/db/schema.ts', 'packages/db/migrations/**'],
  },
  nfr: {
    accessibility: 'WCAG 2.2 AA',
    performance: 'Web LCP < 2.5 s on 4G; API p95 < 300 ms',
    security: 'OWASP ASVS Level 1',
    privacy: 'GDPR: data export and deletion',
    i18n: ['en', 'de'],
  },
};

export const EXAMPLE_JSON = `${JSON.stringify(EXAMPLE_PROJECT, null, 2)}\n`;
