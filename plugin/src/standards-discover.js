// What a codebase has, and which of it nothing has been written down about.
//
// STANDARDS AC-8 asks for `vibecheck standards discover`. The specification is explicit about what
// that command may and may not do: extracting "this team returns errors as ProblemDetails and names
// tests after the criterion" is judgement, and "a deterministic implementation would produce
// confident nonsense". So nothing here reads a line of code and decides what a convention is.
//
// What a command can do honestly is the half that is evidence: this part of the tree exists, these
// files are what it looks like, and no standard covers it yet. That is what this returns, and the
// skill hands it to an agent that can read the files and draft the standards for review.

import { inspect } from './brownfield/detect.js';
import { globToRegExp } from './docs/files.js';
import { ROOT_DOMAIN, scanStandards } from './standards.js';

/**
 * The areas worth having a standard about, and how to tell one is present.
 *
 * Each is recognised by where files sit, not by what is in them — a folder called `migrations`
 * full of migrations is a fact; what those migrations have in common is not.
 */
const AREAS = [
  { area: 'api', matches: /(^|\/)(controllers?|routes?|endpoints?|api|handlers?)(\/|$)|controller\.|\.controller\./i, why: 'HTTP endpoints: how requests are validated, what responses look like, how errors are shaped' },
  { area: 'database', matches: /(^|\/)(migrations?|entities|models?|schema)(\/|$)|\.prisma$|repository\./i, why: 'Data access: migrations, entities and how queries are written' },
  { area: 'ui', matches: /\.(tsx|jsx|vue|svelte)$|(^|\/)(components?|pages?|views?|screens?)(\/|$)/i, why: 'Components and screens: structure, state, styling and accessibility' },
  { area: 'testing', matches: /(^|\/)(tests?|spec|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$/i, why: 'Tests: how they are named, arranged and what they are expected to cover' },
  { area: 'code', matches: /(^|\/)(src|lib|app|internal)(\/|$)/i, why: 'The code in general: naming, error handling, how modules are put together' },
];

const SAMPLE = 6;

/** Does any existing standard already speak for this area? */
function coveredBy(standards, area, files) {
  return standards.filter((entry) => {
    if (entry.domain === area) return true;
    if (!entry.globs) return false;
    return entry.globs
      .split(',')
      .map((glob) => glob.trim())
      .filter(Boolean)
      .some((glob) => files.some((file) => globToRegExp(glob).test(file)));
  });
}

/**
 * What is here, what is already written down, and what is not.
 *
 * Returns areas in the order they are worth looking at: uncovered first, biggest first, because
 * the part of a codebase nobody has written anything about is where a convention is most likely
 * to be both real and unstated.
 */
export async function discoverAreas(root) {
  const { sources } = await inspect(root);
  const standards = await scanStandards(root).catch(() => []);

  const found = AREAS.map(({ area, matches, why }) => {
    const files = sources.filter((path) => matches.test(path));
    const covered = coveredBy(standards, area, files);
    return {
      area,
      why,
      files: files.length,
      samples: files.slice(0, SAMPLE),
      covered: covered.map((entry) => entry.path),
    };
  }).filter((entry) => entry.files > 0);

  found.sort((first, second) => (first.covered.length - second.covered.length) || (second.files - first.files));
  return {
    areas: found,
    standards: standards.map((entry) => ({ path: entry.path, domain: entry.domain, description: entry.description })),
    // Said plainly so nothing downstream mistakes this for an extraction.
    extracted: false,
  };
}

/** Areas with real code and nothing written down about them. */
export const uncovered = (report) => report.areas.filter((entry) => !entry.covered.length);

export { ROOT_DOMAIN };
