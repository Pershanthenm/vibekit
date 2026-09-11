import { ARCHITECTURES } from './architectures.js';
import { commandPresetFor } from './languages.js';
import { findControl } from './security/controls.js';

export const TARGETS = ['web', 'ios', 'android', 'desktop', 'api', 'cli'];
export const FEATURE_STATUSES = ['draft', 'approved', 'planned', 'in-progress', 'done'];
export const ENGINES = ['cursor', 'claude', 'manual', 'multica'];
export const AUTONOMY_LEVELS = ['gated', 'auto'];
export const SKILL_MODES = ['plugin', 'project'];
export const MEMORY_PROVIDERS = ['agentmemory', 'none'];
export const KNOWLEDGE_PROVIDERS = ['opencontext', 'none'];
export const MOBILE_APPROACHES = [
  'React Native (Expo)',
  'Flutter',
  'Native (Swift + Kotlin)',
  'Kotlin Multiplatform',
  '.NET MAUI',
];

export const DEFAULT_PROJECT = {
  version: 1,
  project: { name: 'my-app', description: '', problem: '', users: [] },
  targets: ['web'],
  stack: {
    languages: ['TypeScript'],
    frontend: 'Next.js',
    mobile: '',
    desktop: '',
    backend: 'Node.js + Fastify',
    database: 'PostgreSQL',
    auth: '',
    hosting: '',
    other: [],
  },
  architecture: { style: 'clean', notes: [] },
  standards: {
    naming: 'Idiomatic for each language; names reveal intent; booleans read as questions (isActive, hasAccess).',
    testing: { framework: 'Vitest', coverage: 80, tdd: true },
    commits: 'Conventional Commits',
    branching: 'Trunk-based with short-lived feature branches',
    rules: [
      'Functions do one thing: aim for ≤ 20 lines and ≤ 3 parameters.',
      'Guard clauses over nesting (max 2 levels).',
      'No dead code, commented-out code or speculative abstractions (YAGNI).',
      'Comments explain why, never what.',
      'Handle errors explicitly; never swallow them.',
      'No secrets in code; configuration comes from the environment and is validated at startup.',
    ],
  },
  commands: {},
  workflow: {
    enforce: true,
    autonomy: 'gated',
    engine: 'cursor',
    maxLanes: 3,
    skills: 'plugin',
    traceability: true,
    evidence: true,
    review: true,
    routes: [],
  },
  memory: {
    provider: 'agentmemory',
    url: 'http://localhost:3111',
    recallLimit: 5,
  },
  multica: {
    agent: '',
    project: '',
    remote: 'local',
    board: false,
    doneOnBoard: true,
  },
  security: {
    stack: '',
    controls: [],
    acceptedRisks: [],
    notes: [],
    answers: {},
  },
  docs: {
    enabled: true,
    dir: 'docs',
    dataModelSources: ['**/schema.*', '**/*.prisma', '**/migrations/**', '**/models/**'],
  },
  knowledge: {
    provider: 'opencontext',
    folder: '',
    playbook: 'playbook',
  },
  nfr: {
    accessibility: 'WCAG 2.2 AA',
    performance: '',
    security: 'OWASP ASVS Level 1',
    privacy: '',
    i18n: ['en'],
  },
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeDeep(base, override) {
  for (const [key, value] of Object.entries(override)) {
    base[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value;
  }
  return base;
}

export function normalize(input = {}) {
  const project = mergeDeep(structuredClone(DEFAULT_PROJECT), input);
  project.commands = { ...commandPresetFor(project.stack.languages), ...input.commands };
  return project;
}

export function validate(project) {
  const errors = [];
  const unknownTargets = project.targets.filter((target) => !TARGETS.includes(target));
  if (!project.project.name) errors.push('project.name is required');
  if (!project.targets.length) errors.push(`targets needs at least one of: ${TARGETS.join(', ')}`);
  if (unknownTargets.length) errors.push(`unknown targets: ${unknownTargets.join(', ')} (allowed: ${TARGETS.join(', ')})`);
  if (!project.stack.languages.length) errors.push('stack.languages must not be empty');
  if (!ARCHITECTURES[project.architecture.style]) {
    errors.push(`architecture.style must be one of: ${Object.keys(ARCHITECTURES).join(', ')}`);
  }
  if (!project.commands.test) errors.push('commands.test is required — agents need a way to verify their work');
  errors.push(...validateWorkflow(project.workflow), ...validateMemory(project.memory), ...validateKnowledge(project.knowledge), ...validateDocs(project.docs), ...validateSecurity(project.security));
  return errors;
}

function validateWorkflow(workflow) {
  const oneOf = (key, allowed) => !allowed.includes(workflow[key]) && `workflow.${key} must be one of: ${allowed.join(', ')}`;
  return [
    oneOf('autonomy', AUTONOMY_LEVELS),
    oneOf('engine', ENGINES),
    oneOf('skills', SKILL_MODES),
    !(Number.isInteger(workflow.maxLanes) && workflow.maxLanes > 0) && 'workflow.maxLanes must be a positive integer',
    typeof workflow.traceability !== 'boolean' && 'workflow.traceability must be true or false',
    typeof workflow.evidence !== 'boolean' && 'workflow.evidence must be true or false',
    typeof workflow.review !== 'boolean' && 'workflow.review must be true or false',
    ...validateRoutes(workflow.routes),
  ].filter(Boolean);
}

function validateMemory(memory) {
  return [
    !MEMORY_PROVIDERS.includes(memory.provider) && `memory.provider must be one of: ${MEMORY_PROVIDERS.join(', ')}`,
    !/^https?:\/\//.test(memory.url) && 'memory.url must be an http(s) URL',
    !(Number.isInteger(memory.recallLimit) && memory.recallLimit > 0) && 'memory.recallLimit must be a positive integer',
  ].filter(Boolean);
}

const isUnsafeFolder = (folder) => folder.startsWith('/') || folder.split('/').includes('..');

function validateKnowledge(knowledge) {
  return [
    !KNOWLEDGE_PROVIDERS.includes(knowledge.provider) && `knowledge.provider must be one of: ${KNOWLEDGE_PROVIDERS.join(', ')}`,
    [knowledge.folder, knowledge.playbook].some(isUnsafeFolder) && 'knowledge.folder and knowledge.playbook must be relative folders inside the OpenContext library',
  ].filter(Boolean);
}

function validateDocs(docs) {
  return [
    typeof docs.enabled !== 'boolean' && 'docs.enabled must be true or false',
    (isUnsafeFolder(docs.dir) || !docs.dir) && 'docs.dir must be a relative folder such as "docs"',
    !Array.isArray(docs.dataModelSources) && 'docs.dataModelSources must be a list of glob patterns',
  ].filter(Boolean);
}

function validateSecurity(security) {
  const unknown = [...security.controls, ...security.acceptedRisks.map((risk) => risk.id)].filter((id) => !findControl(id));
  return unknown.length ? [`security: unknown controls ${unknown.join(', ')}`] : [];
}

const LOCAL_ENGINES = ['cursor', 'claude', 'manual'];

function validateRoutes(routes) {
  if (!Array.isArray(routes)) return ['workflow.routes must be a list of { "match": "<glob>", "engine" or "agent": … }'];
  return routes.flatMap((route, index) => [
    typeof route.match !== 'string' && `workflow.routes[${index}].match must be a glob such as "web/**" (use | for several)`,
    !route.engine && !route.agent && `workflow.routes[${index}] needs an "engine" (${LOCAL_ENGINES.join(', ')}) or a Multica "agent"`,
    route.engine && !LOCAL_ENGINES.includes(route.engine) && `workflow.routes[${index}].engine must be one of: ${LOCAL_ENGINES.join(', ')}`,
  ].filter(Boolean));
}
