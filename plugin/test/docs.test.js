import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { globToRegExp } from '../src/docs/files.js';
import { joinDoc, splitDoc } from '../src/docs/freshness.js';
import { EXAMPLE, exitCodeOf, fillSpec, newProject, patchProject, read, runHook, sh, writeTracedTests } from './helpers.js';

const FEATURE = '001-shared-list';
const ORIGINAL_ENV = { ...process.env };
const ARCHITECTURE = `# Architecture

## Context
Households use mealmate from web and mobile.

\`\`\`mermaid
flowchart LR
  users([Households]) --> web[Web app]
  users --> mobile[Mobile app]
  web --> api[API]
  mobile --> api
  api --> db[(PostgreSQL)]
\`\`\`
`;

beforeEach(() => {
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  process.env.PATH = '/usr/bin:/bin';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.exitCode = 0;
});

async function writeDocBody(root, path, body) {
  const { meta } = splitDoc(await read(root, path));
  await writeFile(join(root, path), joinDoc(meta, body));
}

const withDiagram = (title, type, lines) => `# ${title}\n\nDescribes the system as built.\n\n\`\`\`mermaid\n${type}\n${lines}\n\`\`\`\n`;

async function freshProjectDocs(root) {
  await writeDocBody(root, 'docs/architecture.md', ARCHITECTURE);
  await writeDocBody(root, 'docs/data-model.md', withDiagram('Data model', 'erDiagram', '  HOUSEHOLD ||--o{ LIST : owns'));
  await writeDocBody(root, 'docs/deployment.md', withDiagram('Deployment', 'flowchart LR', '  vercel[Vercel] --> fly[Fly.io API]'));
  await writeDocBody(root, 'docs/design/system.md', '# Design system\n\nTokens: 8px spacing grid, Inter type scale.\n');
  await run(['docs', '--dir', root, 'stamp', 'docs/architecture.md', 'docs/deployment.md', 'docs/design/system.md']);
  await writeFile(join(root, 'db/schema.sql'), 'create table households (id uuid primary key);\n').catch(async () => {
    sh(root, 'mkdir', '-p', 'db');
    await writeFile(join(root, 'db/schema.sql'), 'create table households (id uuid primary key);\n');
  });
  await run(['docs', '--dir', root, 'stamp', 'docs/data-model.md']);
}

async function plannedFeature(root, planExtra = '') {
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: ['- [ ] T-1 [impl] list api (AC-1) — apps/api/list.ts'] });
  await writeFile(join(root, 'specs/features', FEATURE, 'plan.md'), `# Plan\n\n## Approach\n\nREST endpoint.\n${planExtra}`);
  await run(['status', '--dir', root, FEATURE, 'approved']);
}

test('init seeds living docs for the project and a generated roadmap', async () => {
  const root = await newProject('--from', EXAMPLE);
  for (const path of ['docs/architecture.md', 'docs/data-model.md', 'docs/deployment.md', 'docs/design/system.md']) {
    assert.match(await read(root, path), /^---\ntitle: .*\nkind: .*\nsources: \[/);
  }
  assert.match(await read(root, 'AGENTS.md'), /## Living documentation/);
  assert.match(await read(root, '.cursor/rules/vibecheck-docs.mdc'), /globs: docs\/\*\*/);
  await run(['feature', '--dir', root, 'Shared list']);
  assert.match(await read(root, 'docs/roadmap.md'), /subgraph draft\["Draft"\]\n\s+f001_shared_list\["001 Shared list"\]/);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0, 'unwritten docs are warnings, not errors');
});

test('planning is blocked until the architecture doc is written and stamped', async () => {
  const root = await newProject('--from', EXAMPLE);
  await plannedFeature(root);
  await assert.rejects(run(['status', '--dir', root, FEATURE, 'planned']), /docs\/architecture\.md — still has TODOs|docs\/architecture\.md is still/);
  await writeDocBody(root, 'docs/architecture.md', ARCHITECTURE);
  await assert.rejects(run(['status', '--dir', root, FEATURE, 'planned']), /never stamped/);
  await run(['docs', '--dir', root, 'stamp', 'docs/architecture.md']);
  await run(['status', '--dir', root, FEATURE, 'planned']);
  assert.match(await read(root, 'docs/roadmap.md'), /subgraph planned\["Planned"\]/);
});

test('re-architecting makes stamped diagrams stale and blocks the turn until they are updated', async () => {
  const root = await newProject('--from', EXAMPLE);
  await freshProjectDocs(root);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0);

  const projectPath = join(root, 'specs/project.json');
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  project.architecture.notes.push('Add a Redis cache in front of the API.');
  await writeFile(projectPath, JSON.stringify(project, null, 2));
  await run(['sync', '--dir', root]);

  assert.equal(await exitCodeOf(['check', '--dir', root]), 1);
  const stop = await runHook(root, 'stop', {});
  assert.equal(stop.code, 2);
  assert.match(stop.stderr, /docs\/architecture\.md — its sources changed[\s\S]*update the document now/);

  await assert.rejects(run(['docs', '--dir', root, 'stamp', 'docs/architecture.md']), /sources changed but the document didn't/);
  await writeDocBody(root, 'docs/architecture.md', ARCHITECTURE.replace('api --> db', 'api --> cache[(Redis)]\n  api --> db'));
  await run(['docs', '--dir', root, 'stamp', 'docs/architecture.md']);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 1, 'deployment and design system read project.json too');
  await run(['docs', '--dir', root, 'stamp', 'docs/deployment.md', 'docs/design/system.md', '--still-accurate']);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0);
});

test('--still-accurate records a review when sources changed but the doc needed no edit', async () => {
  const root = await newProject('--from', EXAMPLE);
  await freshProjectDocs(root);
  await writeFile(join(root, 'specs/decisions/0002-naming.md'), '# 0002 — Naming\n\nUse kebab-case files.\n');
  await assert.rejects(run(['docs', '--dir', root, 'stamp', 'docs/architecture.md']), /--still-accurate/);
  await run(['docs', '--dir', root, 'stamp', 'docs/architecture.md', '--still-accurate']);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 1, 'deployment also depends on ADRs');
  await run(['docs', '--dir', root, 'stamp', 'docs/deployment.md', '--still-accurate']);
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0);
});

test('done requires fresh feature and design docs with the right diagrams', async () => {
  const root = await newProject('--from', EXAMPLE);
  await patchProject(root, { workflow: { evidence: false } });
  await freshProjectDocs(root);
  await plannedFeature(root, '\n## UI states per target\n\nWeb and mobile: loading, empty, error, success.\n');
  sh(root, 'mkdir', '-p', 'apps/api');
  await writeFile(join(root, 'apps/api/list.ts'), 'export const listRoute = () => [];\n');
  for (const status of ['planned', 'in-progress']) await run(['status', '--dir', root, FEATURE, status]);
  for (const name of ['spec.md', 'tasks.md']) {
    const path = join(root, 'specs/features', FEATURE, name);
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll('- [ ]', '- [x]'));
  }

  await writeTracedTests(root, FEATURE);
  await assert.rejects(run(['status', '--dir', root, FEATURE, 'done']), /docs\/features\/001-shared-list\.md — missing[\s\S]*docs\/design\/001-shared-list\.md — missing/);
  await run(['docs', '--dir', root, 'new', 'feature', FEATURE]);
  await run(['docs', '--dir', root, 'new', 'design', FEATURE]);
  assert.match(await read(root, `docs/features/${FEATURE}.md`), /"apps\/api\/list\.ts"/);

  await writeDocBody(root, `docs/features/${FEATURE}.md`, '# Shared list\n\nOnly prose, no diagram.\n');
  await assert.rejects(run(['docs', '--dir', root, 'stamp', `docs/features/${FEATURE}.md`]), /needs a sequence, flow or state diagram/);
  await writeDocBody(root, `docs/features/${FEATURE}.md`, withDiagram('Shared list', 'sequenceDiagram', '  App->>API: GET /lists\n  API-->>App: lists'));
  await writeDocBody(root, `docs/design/${FEATURE}.md`, withDiagram('Shared list — design', 'flowchart LR', '  open[Open lists] --> share[Share]'));
  await run(['docs', '--dir', root, 'stamp', `docs/features/${FEATURE}.md`, `docs/design/${FEATURE}.md`]);

  await writeFile(join(root, 'apps/api/list.ts'), 'export const listRoute = () => ["changed"];\n');
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0, 'code drift is a warning mid-feature');
  await assert.rejects(run(['status', '--dir', root, FEATURE, 'done']), /features\/001-shared-list\.md — its sources changed/);
  await run(['docs', '--dir', root, 'stamp', `docs/features/${FEATURE}.md`, `docs/design/${FEATURE}.md`, '--still-accurate']);
  await run(['status', '--dir', root, FEATURE, 'done']);
  assert.match(await read(root, 'docs/roadmap.md'), /subgraph done\["Done"\]/);
});

test('invalid Mermaid is rejected, and hooks protect the roadmap but allow doc edits', async () => {
  const root = await newProject('--from', EXAMPLE);
  await writeDocBody(root, 'docs/deployment.md', '# Deployment\n\n```mermaid\nflowchartt LR\n  a --> b\n```\n');
  await assert.rejects(run(['docs', '--dir', root, 'stamp', 'docs/deployment.md']), /unknown Mermaid diagram type "flowchartt LR"/);
  const edit = (path) => runHook(root, 'pre-edit', { tool_name: 'Edit', tool_input: { file_path: join(root, path) } });
  assert.match((await edit('docs/roadmap.md')).stderr, /generated by Vibe-check-cli/);
  assert.equal((await edit('docs/architecture.md')).code, 0);
});

test('session start lists docs needing attention', async () => {
  const root = await newProject('--from', EXAMPLE);
  const start = JSON.parse((await runHook(root, 'session-start', {})).stdout).hookSpecificOutput.additionalContext;
  assert.match(start, /Documentation needing attention[\s\S]*docs\/architecture\.md — still has TODOs|Documentation needing attention[\s\S]*architecture/);
  assert.match(start, /Living docs: diagrams and documents/);
});

test('globs match like a shell', () => {
  assert.ok(globToRegExp('specs/decisions/*.md').test('specs/decisions/0001-x.md'));
  assert.ok(!globToRegExp('specs/decisions/*.md').test('specs/decisions/old/0001.md'));
  assert.ok(globToRegExp('**/schema.*').test('schema.sql'));
  assert.ok(globToRegExp('**/schema.*').test('packages/db/schema.ts'));
  assert.ok(globToRegExp('**/migrations/**').test('db/migrations/001/up.sql'));
});

test('ticking tasks by hand never blocks the turn over the generated roadmap', async () => {
  const root = await newProject('--from', EXAMPLE);
  await plannedFeature(root);
  const tasksPath = join(root, 'specs/features', FEATURE, 'tasks.md');
  await writeFile(tasksPath, (await readFile(tasksPath, 'utf8')).replace('- [ ] T-1', '- [x] T-1'));
  await writeFile(join(root, 'specs/features', FEATURE, 'spec.md'), (await read(root, `specs/features/${FEATURE}/spec.md`)).replace('title: "Shared list"', 'title: "Shared shopping list"'));
  assert.equal((await runHook(root, 'stop', {})).code, 0);
  assert.match(await read(root, 'docs/roadmap.md'), /Shared shopping list/);
});
