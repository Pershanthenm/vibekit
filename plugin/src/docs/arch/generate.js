import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeText } from '../../fsutil.js';
import { withHeader } from '../../folder/header.js';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { loadBrand } from './brand.js';
import { renderDsl, renderErd, renderMermaid } from './dsl.js';
import { hashOf } from './drift.js';
import { buildModel } from './model.js';
import { DOCS_DIR, diagramName, diagramsDir, docsState, modelPath, statePath } from './paths.js';
import { renderContainerSvg, renderComponentSvg, renderContextSvg, renderErdSvg } from './svg.js';
import { renderHld } from './documents.js';
import { renderApi, renderData, renderLld, renderRunbook } from './library.js';
import { renderSrs, renderTechspec } from './specs.js';

/**
 * Writing the documentation. Documentation Feature Spec §7 and §8.
 *
 * Two speeds, deliberately. The **model** updates with every requirement that reaches done, so it
 * is never more than one merged requirement out of date and the diff is visible in the pull
 * request — an architecture change nobody noticed is an architecture change nobody agreed to. The
 * **documents** regenerate at gates, because generating on every merge produces noise nobody
 * reads and generating on demand means it never happens.
 */

export async function generateModel(root, options = {}) {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const docs = options.docs ?? DOCS_DIR;
  const model = await buildModel(root, { folder });
  const brand = await loadBrand(root, docs);
  const written = [];

  const dsl = withHeader('model.dsl', 'architecture', renderDsl(model, { brand }));
  await writeText(modelPath(root, docs), dsl);
  written.push(`${docs}/model.dsl`);

  await mkdir(diagramsDir(root, docs), { recursive: true });
  const diagrams = [
    ['context', renderContextSvg(model, brand)],
    ['container', renderContainerSvg(model, brand)],
    ...model.containers
      .filter((container) => container.components?.length)
      .map((container) => [`component-${container.id}`, renderComponentSvg(model, container, brand)]),
    ['erd', renderErdSvg(model, brand)],
  ].filter(([, svg]) => svg);

  for (const [view, svg] of diagrams) {
    await writeText(join(diagramsDir(root, docs), diagramName(view)), svg);
    written.push(`${docs}/diagrams/${diagramName(view)}`);
  }

  // Mermaid alongside the SVG: a second view of the same model, for a reader whose tool renders
  // Markdown and nothing else. Generated, so it cannot disagree with the DSL.
  for (const [view, body] of [['context', renderMermaid(model, 'context')], ['container', renderMermaid(model, 'container')], ['erd', renderErd(model)]]) {
    if (view === 'erd' && !model.entities.length) continue;
    await writeText(join(diagramsDir(root, docs), `${view}.mmd`), `${body}\n`);
    written.push(`${docs}/diagrams/${view}.mmd`);
  }

  const state = { ...(await docsState(root, docs)), model: hashOf(dsl), modelAt: new Date().toISOString() };
  await writeText(statePath(root, docs), `${JSON.stringify(state, null, 2)}\n`);

  return { model, brand, written, diagrams: diagrams.map(([view]) => view) };
}

/**
 * @param {string} root
 * @param {{ folder?: string, docs?: string, only?: string[], commit?: string|null }} options
 */
export async function generateDocs(root, options = {}) {
  const docs = options.docs ?? DOCS_DIR;
  const { model, brand, written } = await generateModel(root, options);
  const only = options.only?.length ? new Set(options.only) : null;

  const context = { docs, commit: options.commit ?? null, date: options.date ?? null, folder: options.folder ?? DEFAULT_FOLDER };
  const all = [
    ['hld', 'hld.md', renderHld],
    ['lld', 'lld.md', renderLld],
    ['api', 'api-reference.md', renderApi],
    ['data', 'data-model.md', renderData],
    ['runbook', 'runbook.md', renderRunbook],
    ['srs', 'srs.md', renderSrs],
    ['techspec', 'tech-spec.md', renderTechspec],
  ];

  const documents = [];
  for (const [key, name, render] of all) {
    if (only && !only.has(key)) continue;
    documents.push([name, await render(root, model, brand, context)]);
  }

  for (const [name, body] of documents) {
    await writeText(join(root, docs, name), body);
    written.push(`${docs}/${name}`);
  }

  return { model, brand, written, documents: documents.map(([name]) => name) };
}
