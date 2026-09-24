import { join } from 'node:path';
import { readText } from '../../fsutil.js';

/**
 * Where documentation lives. Documentation Feature Spec §2.
 *
 * `docs/` sits at the repository root, beside `vibekit/` rather than inside it. The folder is the
 * machine's context; `docs/` is human output. That separation is what lets `docs/` be published,
 * printed, emailed and handed to an auditor without exposing the working files — and it puts
 * documentation where a reader opening the repository already expects to find it.
 */

export const DOCS_DIR = 'docs';

/** Generated documents, in the order §6 introduces them. */
export const GENERATED_DOCS = Object.freeze(['hld.md', 'lld.md', 'api-reference.md', 'data-model.md']);

/** Half generated, half authored: the sections an operator owns survive every regeneration. */
export const MIXED_DOCS = Object.freeze(['runbook.md']);

export const AUTHORED_FILES = Object.freeze(['brand.yml', 'views.dsl']);

export const modelPath = (root, docs = DOCS_DIR) => join(root, docs, 'model.dsl');
export const viewsPath = (root, docs = DOCS_DIR) => join(root, docs, 'views.dsl');
export const brandPath = (root, docs = DOCS_DIR) => join(root, docs, 'brand.yml');
export const diagramsDir = (root, docs = DOCS_DIR) => join(root, docs, 'diagrams');
export const templatesDir = (root, docs = DOCS_DIR) => join(root, docs, 'templates');
export const statePath = (root, docs = DOCS_DIR) => join(root, docs, '.docs-state.json');

/** Hashes and commit stamps. Git-ignored and rebuilt on demand, so it is never the only copy. */
export async function docsState(root, docs = DOCS_DIR) {
  try {
    return JSON.parse((await readText(statePath(root, docs))) ?? '{}');
  } catch {
    return {};
  }
}

/** The diagram files a model produces, named so a template can reference them by view. */
export const diagramName = (view) => `${view}.svg`;
