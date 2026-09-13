import { antigravityFiles } from './antigravity.js';
import { claudeFiles } from './claude.js';
import { contextFiles } from './context.js';
import { cursorFiles } from './cursor.js';
import { seedFiles } from './seed.js';
import { windsurfFiles } from './windsurf.js';

export { GENERATED_MARK } from './shared.js';

/**
 * One adapter per editor, by the name `specs/project.json` uses for it.
 *
 * `contextFiles` is deliberately not in here: AGENTS.md and the rest are the project's own, read
 * by every editor and by people, so they are written whatever this list says.
 */
const ADAPTERS = {
  claude: claudeFiles,
  cursor: cursorFiles,
  antigravity: antigravityFiles,
  windsurf: windsurfFiles,
};

export const EDITOR_NAMES = Object.keys(ADAPTERS);

/** Which editors this project asked for. A project written before the field existed gets them all. */
export const editorsOf = (project) => (Array.isArray(project.editors) && project.editors.length
  ? project.editors.filter((editor) => editor in ADAPTERS)
  : EDITOR_NAMES);

export const buildManagedFiles = (project) => [
  ...contextFiles(project),
  ...editorsOf(project).flatMap((editor) => ADAPTERS[editor](project)),
];

/**
 * The files the editors this project did *not* ask for would have been given.
 *
 * Turning an editor off has to take its files away, or the repository keeps a stale copy of the
 * workflow that nothing updates any more — worse than the clutter it was turned off to avoid.
 * Only ever used to remove files this tool generated; the caller checks that before deleting.
 */
export const unusedEditorFiles = (project) => {
  const wanted = new Set(editorsOf(project));
  return EDITOR_NAMES.filter((editor) => !wanted.has(editor)).flatMap((editor) => ADAPTERS[editor](project));
};

export const buildSeedFiles = seedFiles;
