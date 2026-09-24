import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, readText } from '../../fsutil.js';
import { hasHeader } from '../../folder/header.js';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { buildModel, entitiesFrom } from './model.js';
import { DOCS_DIR, GENERATED_DOCS, docsState, modelPath } from './paths.js';

/**
 * Documentation drift. Documentation Feature Spec §7.
 *
 * Without these the model rots like any other document and the whole feature is pointless — the
 * spec says so outright, and puts them second in the build order for that reason. A beautifully
 * branded document generated from a model nobody checks is the same failure this feature exists
 * to prevent, wearing a nicer jacket.
 *
 * Every check compares the documentation against something that is independently true: the code,
 * the contract tests, the entity vocabulary, or a recorded hash.
 */

const finding = (code, message, fix = null, severity = 'error') => ({ code, message, fix, severity });

const listFiles = async (dir, match) => (await readdir(dir).catch(() => [])).filter((name) => match.test(name)).sort();

/** Placeholders a template asks for, so one that stopped resolving is reported rather than dropped. */
export const placeholdersIn = (text) => [...String(text ?? '').matchAll(/\{\{([\w.*-]+)\}\}/g)].map((match) => match[1]);

/** Endpoints a contract test pins. The tests are the source; annotations drift, tests do not. */
export function endpointsFrom(text) {
  const found = [...String(text ?? '').matchAll(/['"`](GET|POST|PUT|PATCH|DELETE)\s+(\/[\w{}/:.-]*)['"`]/gi)]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
  return [...new Set(found)].sort();
}

export async function contractEndpoints(root) {
  return (await endpointDetails(root)).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
}

/**
 * Every endpoint a contract test pins, with the file that pins it.
 *
 * The API reference cites the test rather than an annotation, so every example it prints is one
 * that provably runs — an annotation drifts from the code and a contract test fails when it does.
 */
export async function endpointDetails(root) {
  const dir = join(root, 'tests/contract');
  const names = await listFiles(dir, /\.(?:js|ts|cs|py|rb|go)$/);
  const found = new Map();
  for (const name of names) {
    for (const endpoint of endpointsFrom(await readText(join(dir, name)))) {
      const [method, ...rest] = endpoint.split(' ');
      if (!found.has(endpoint)) found.set(endpoint, { method, path: rest.join(' '), test: `tests/contract/${name}` });
    }
  }
  return [...found.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

/**
 * @param {string} root repository root
 * @param {{ folder?: string, docs?: string }} options
 */
export async function docsDrift(root, options = {}) {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const docs = options.docs ?? DOCS_DIR;
  const findings = [];

  if (!(await exists(join(root, docs)))) return { findings, checked: false };

  const model = await buildModel(root, { folder });
  const state = await docsState(root, docs);
  const dslText = await readText(modelPath(root, docs));

  // --- the model against the code ------------------------------------------------------------
  const unplanned = model.components.filter((component) => component.unplanned);
  for (const component of unplanned) {
    findings.push(finding(
      'docs.unplannedComponent',
      `${component.path} has code in it but the intended structure in product/map.md does not mention it, so every diagram is already wrong.`,
      'vibekit docs --model',
    ));
  }

  if (dslText) {
    for (const component of model.components) {
      if (!component.unplanned && !dslText.includes(`= component "${component.name}"`)) {
        findings.push(finding('docs.modelStale', `${component.name} is in the intended structure but not in ${docs}/model.dsl. The model has not been regenerated since map.md changed.`, 'vibekit docs --model'));
      }
    }
    for (const container of model.containers) {
      if (!dslText.includes(`= container "${container.name}"`)) {
        findings.push(finding('docs.modelStale', `${container.name} is a deployable but is missing from ${docs}/model.dsl.`, 'vibekit docs --model'));
      }
    }
  }

  // --- a relationship with no code behind it ---------------------------------------------------
  const known = new Set([
    ...model.people.map((person) => person.id),
    ...model.externals.map((external) => external.id),
    ...model.containers.map((container) => container.id),
    ...model.components.map((component) => component.id),
    model.system.id,
  ]);
  for (const relationship of model.relationships) {
    for (const end of [relationship.from, relationship.to]) {
      if (!known.has(end)) {
        findings.push(finding('docs.danglingRelationship', `${docs}/model.dsl has a relationship to "${end}", which is not in the model. Usually a feature that was reverted.`, 'vibekit docs --model'));
      }
    }
  }

  // --- the data model against the closed vocabulary ---------------------------------------------
  const dataModel = await readText(join(root, docs, 'data-model.md'));
  if (dataModel) {
    const documented = entitiesFrom(await readText(join(root, folder, 'product/entities.md'))).map((entity) => entity.name);
    for (const name of documented) {
      if (!dataModel.includes(name)) {
        findings.push(finding('docs.entityMissing', `${name} is in the entity vocabulary but not in ${docs}/data-model.md, so the data model document is incomplete.`, 'vibekit docs data'));
      }
    }
  }

  // --- the API reference against the contract tests ----------------------------------------------
  const apiReference = await readText(join(root, docs, 'api-reference.md'));
  if (apiReference) {
    for (const endpoint of await contractEndpoints(root)) {
      if (!apiReference.includes(endpoint)) {
        findings.push(finding('docs.endpointMissing', `${endpoint} is pinned by a contract test but is not in ${docs}/api-reference.md. Somebody will integrate against a document that does not list it.`, 'vibekit docs api'));
      }
    }
  }

  // --- a diagram older than the model it claims to render -----------------------------------------
  if (dslText && state.model && state.model !== hashOf(dslText)) {
    findings.push(finding('docs.diagramsStale', `The diagrams in ${docs}/diagrams/ were rendered from an older model.`, 'vibekit docs --model'));
  }

  // --- a template placeholder that no longer resolves ----------------------------------------------
  for (const name of await listFiles(join(root, docs, 'templates'), /\.md$/)) {
    const template = await readText(join(root, docs, 'templates', name));
    for (const placeholder of placeholdersIn(template)) {
      if (placeholder.startsWith('authored.')) continue;
      if (!(await resolves(placeholder, model, root, folder))) {
        findings.push(finding('docs.deadPlaceholder', `${docs}/templates/${name} asks for {{${placeholder}}}, which this project has nothing to fill. That section would silently vanish.`));
      }
    }
  }

  // --- a generated document a human took over -------------------------------------------------------
  for (const name of GENERATED_DOCS) {
    const text = await readText(join(root, docs, name));
    if (text === null) continue;
    if (!hasHeader(text)) {
      const since = state.detached?.[name];
      findings.push(finding(
        'docs.detached',
        `${docs}/${name} was edited by hand${since ? ` on ${since}` : ''}, so VibeKit no longer rewrites it. That is a choice, not an error — but it is now yours to keep current.`,
        null,
        'warning',
      ));
    }
  }

  return { findings, checked: true, model };
}

/** Whether a placeholder has anything behind it in this project. */
async function resolves(placeholder, model, root, folder) {
  const [group, ...rest] = placeholder.split('.');
  const key = rest.join('.');
  if (['project', 'company', 'brand', 'doc', 'product', 'narrative'].includes(group)) return true;
  if (group === 'diagram') {
    if (key.startsWith('c4.context') || key.startsWith('c4.container')) return true;
    if (key === 'erd') return model.entities.length > 0;
    if (key.startsWith('sequence')) return model.flows.length > 0;
    if (key === 'deployment') return model.deployment.length > 0;
    if (key.startsWith('c4.component')) return model.containers.some((container) => container.components?.length);
    if (key === 'trust_boundaries') return model.entities.some((entity) => entity.class !== 'internal');
    return false;
  }
  if (group === 'table') {
    if (key === 'access_matrix') return Boolean(await readText(join(root, folder, 'product/access.md')));
    if (key === 'entities' || key.startsWith('fields')) return model.entities.length > 0;
    if (key === 'containers') return model.containers.length > 0;
    if (key === 'components') return model.components.length > 0;
    if (key === 'deployment') return model.deployment.length > 0;
    return true;
  }
  return false;
}

export function hashOf(text) {
  // Kept local so drift has no reason to import the folder generator.
  let hash = 0;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return String(hash >>> 0);
}
