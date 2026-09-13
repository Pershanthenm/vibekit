import { ARCHITECTURES } from './architectures.js';
import { commandPresetFor } from './languages.js';
import { CAPTURE_KINDS } from './memory.js';
import { findControl } from './security/controls.js';

export const TARGETS = ['web', 'ios', 'android', 'desktop', 'api', 'cli'];
export const FEATURE_STATUSES = ['draft', 'approved', 'planned', 'in-progress', 'done'];
export const ENGINES = ['cursor', 'claude', 'manual'];
export const AUTONOMY_LEVELS = ['gated', 'auto'];
export const SKILL_MODES = ['plugin', 'project'];
// The editor adapters a project can have written for it. Every supported editor by default: a
// project stays portable, and a developer who opens it in an editor nobody planned for still gets
// the workflow. Listing fewer is how a single-editor team stops carrying the others' clutter.
export const EDITORS = ['claude', 'cursor', 'antigravity', 'windsurf'];
export const MEMORY_PROVIDERS = ['agentmemory', 'none'];
// What vibecheck may record without being asked. Re-exported so project.json has one vocabulary.
export { CAPTURE_KINDS };
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
  editors: [...EDITORS],
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
  // The boilerplate the codebase was generated from, if any. Empty means built from scratch.
  starter: { id: '', label: '', licence: '', scaffold: '', docs: '' },
  architecture: { style: 'clean', notes: [] },
  standards: {
    naming: 'Idiomatic for each language; names reveal intent; booleans read as questions (isActive, hasAccess).',
    // `runs` is how many times each suite must pass before evidence counts. Above 1 catches
    // flaky tests, which otherwise reach done on whichever run happened to come out green.
    testing: { framework: 'Vitest', coverage: 80, tdd: true, runs: 1 },
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
    design: true,
    routes: [],
  },
  memory: {
    provider: 'agentmemory',
    url: 'http://localhost:3111',
    recallLimit: 5,
    capture: [...CAPTURE_KINDS],
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
  // Silently falling back to 1 would turn a typo into "flake detection is off" without saying so.
  if (!(Number.isInteger(project.standards.testing.runs) && project.standards.testing.runs > 0)) {
    errors.push('standards.testing.runs must be a positive integer (how many times each suite must pass)');
  }
  if (!ARCHITECTURES[project.architecture.style]) {
    errors.push(`architecture.style must be one of: ${Object.keys(ARCHITECTURES).join(', ')}`);
  }
  if (!project.commands.test) errors.push('commands.test is required — agents need a way to verify their work');
  const unknownEditors = (Array.isArray(project.editors) ? project.editors : []).filter((editor) => !EDITORS.includes(editor));
  if (!Array.isArray(project.editors)) errors.push(`editors must be a list of: ${EDITORS.join(', ')}`);
  else if (!project.editors.length) errors.push('editors must name at least one editor, or be left out to get all of them');
  else if (unknownEditors.length) errors.push(`unknown editors: ${unknownEditors.join(', ')} (allowed: ${EDITORS.join(', ')})`);
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
    typeof workflow.design !== 'boolean' && 'workflow.design must be true or false',
    ...validateRoutes(workflow.routes),
  ].filter(Boolean);
}

function validateMemory(memory) {
  const capture = memory.capture;
  const unknown = Array.isArray(capture) ? capture.filter((kind) => !CAPTURE_KINDS.includes(kind)) : [];
  return [
    !MEMORY_PROVIDERS.includes(memory.provider) && `memory.provider must be one of: ${MEMORY_PROVIDERS.join(', ')}`,
    !/^https?:\/\//.test(memory.url) && 'memory.url must be an http(s) URL',
    !(Number.isInteger(memory.recallLimit) && memory.recallLimit > 0) && 'memory.recallLimit must be a positive integer',
    !Array.isArray(capture) && 'memory.capture must be a list of what vibecheck may record by itself',
    unknown.length && `memory.capture has nothing called ${unknown.join(', ')} (choose from: ${CAPTURE_KINDS.join(', ')})`,
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

function validateRoutes(routes) {
  if (!Array.isArray(routes)) return ['workflow.routes must be a list of { "match": "<glob>", "engine": "cursor" | "claude" | "manual" }'];
  return routes.flatMap((route, index) => [
    typeof route.match !== 'string' && `workflow.routes[${index}].match must be a glob such as "web/**" (use | for several)`,
    !route.engine && `workflow.routes[${index}] needs an "engine" (${ENGINES.join(', ')})`,
    route.engine && !ENGINES.includes(route.engine) && `workflow.routes[${index}].engine must be one of: ${ENGINES.join(', ')}`,
  ].filter(Boolean));
}
