// The standards a new project starts with.
//
// These are the Universal Engineering Rules, shipped with the plugin as one file per topic and
// copied into a project the first time it is set up. After that they are the project's own: seeds
// are written once and never overwritten, so a team can edit, delete or add to them and `sync`
// will leave them alone.
//
// They are read off disk rather than embedded as strings, so `scripts/build-standards.js` has one
// place to write and there is no second copy to fall out of step.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix, relative, sep } from 'node:path';
import { STANDARDS_DIR } from '../standards.js';

const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'standards');

/** Every shipped standard, as project-relative paths and their contents. */
export function standardsSeeds() {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) found.push(full);
    }
  };
  try {
    walk(SHIPPED);
  } catch {
    // A checkout without the standards folder still produces a working project; it just starts
    // without a library. Failing setup over missing guidance would be the wrong trade.
    return [];
  }
  return found
    .map((full) => ({
      path: posix.join(STANDARDS_DIR, relative(SHIPPED, full).split(sep).join('/')),
      content: readFileSync(full, 'utf8'),
    }))
    .sort((first, second) => first.path.localeCompare(second.path));
}
