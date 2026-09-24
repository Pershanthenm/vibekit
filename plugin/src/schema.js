import { ARCHITECTURES } from './architectures.js';
import { commandPresetFor } from './languages.js';

/**
 * `specs/project.json` — the config the folder is generated from. Specification §11.
 *
 * Small on purpose: what the generator needs (name, platforms, stack, architecture, the real
 * commands, entities, design tokens, delivery mode) and the two settings §70 keeps at project
 * level (the security frameworks measured, the folder name). Everything else lives in the folder,
 * where a person edits it, or in machine settings, where a fork cannot inherit it.
 */

export const TARGETS = ['web', 'ios', 'android', 'desktop', 'api', 'cli', 'other'];
export const DELIVERY_MODES = ['none', 'checks-only', 'full'];
export const MOBILE_APPROACHES = ['React Native (Expo)', 'Flutter', 'Native (Swift + Kotlin)', 'Kotlin Multiplatform', '.NET MAUI'];

export const DEFAULT_PROJECT = {
  version: 2,
  project: { name: 'my-app', description: '', users: [], platforms: ['web'] },
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
  commands: {},
  entities: [],
  design: {},
  delivery: {},
  security: { frameworks: null },
  template: null,
  folder: null,
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeDeep(base, override) {
  for (const [key, value] of Object.entries(override ?? {})) {
    base[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value;
  }
  return base;
}

export function normalize(input = {}) {
  const project = mergeDeep(structuredClone(DEFAULT_PROJECT), input);
  // Older files carried `targets`; the spec's word is platforms, and both are read.
  if (Array.isArray(input.targets) && !input.project?.platforms) project.project.platforms = input.targets;
  project.commands = { ...commandPresetFor(project.stack.languages ?? []), ...(input.commands ?? {}) };
  return project;
}

export function validate(project) {
  const errors = [];
  const platforms = project.project?.platforms ?? [];
  if (!project.project?.name) errors.push('project.name is required');
  const unknown = platforms.filter((target) => !TARGETS.includes(target));
  if (unknown.length) errors.push(`unknown platforms: ${unknown.join(', ')} (allowed: ${TARGETS.join(', ')})`);
  if (!Array.isArray(project.stack?.languages) || !project.stack.languages.length) errors.push('stack.languages must not be empty');
  if (!ARCHITECTURES[project.architecture?.style]) errors.push(`architecture.style must be one of: ${Object.keys(ARCHITECTURES).join(', ')}`);
  if (!project.commands?.test) errors.push('commands.test is required — agents need a way to verify their work');
  if (project.folder && (project.folder.startsWith('/') || project.folder.split('/').includes('..'))) errors.push('folder must be a relative folder such as "vibekit"');
  if (project.security?.frameworks !== null && project.security?.frameworks !== undefined && !Array.isArray(project.security.frameworks)) errors.push('security.frameworks must be a list of framework ids, or absent');
  return errors;
}
