import { claudeFiles } from './claude.js';
import { contextFiles } from './context.js';
import { cursorFiles } from './cursor.js';
import { seedFiles } from './seed.js';

export { GENERATED_MARK } from './shared.js';

export const buildManagedFiles = (project) => [...contextFiles(project), ...claudeFiles(project), ...cursorFiles(project)];

export const buildSeedFiles = seedFiles;
