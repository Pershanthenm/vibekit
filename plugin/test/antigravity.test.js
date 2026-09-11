import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { RULE_CHARACTER_LIMIT, antigravityFiles } from '../src/generators/antigravity.js';
import { buildManagedFiles } from '../src/generators/index.js';
import { normalize } from '../src/schema.js';
import { EXAMPLE, newProject, read } from './helpers.js';

console.log = () => {};

const projectWith = (overrides = {}) => normalize({
  project: { name: 'demo' },
  stack: { languages: ['TypeScript'] },
  ...overrides,
});

// Antigravity reads workspace rules from `.agents/rules` and slash commands from `.agents/workflows`.
test('rules and workflows land in the folders Antigravity reads', () => {
  const paths = antigravityFiles(projectWith()).map((entry) => entry.path);

  assert.ok(paths.includes('.agents/rules/vibecheck-workflow.md'), paths.join('\n'));
  assert.ok(paths.includes('.agents/rules/vibecheck-specs.md'));
  assert.ok(paths.includes('.agents/rules/vibecheck-tests.md'));
  assert.ok(paths.some((path) => path.startsWith('.agents/workflows/')), 'expected workflow commands');
  assert.ok(paths.every((path) => path.startsWith('.agents/')), `unexpected path: ${paths.find((p) => !p.startsWith('.agents/'))}`);
  assert.ok(paths.every((path) => path.endsWith('.md')), 'Antigravity rules and workflows are Markdown files');
});

// The documented hard limit: 12,000 characters per rule.
test('no generated rule exceeds the 12,000 character limit', () => {
  const project = projectWith({
    security: { controls: ['rbac', 'object-level', 'field-encryption', 'audit-append-only', 'headers-csp', 'rate-limit', 'secrets-scan', 'sast'] },
    docs: { enabled: true },
  });
  for (const entry of antigravityFiles(project).filter((f) => f.path.startsWith('.agents/rules/'))) {
    assert.ok(
      entry.content.length <= RULE_CHARACTER_LIMIT,
      `${entry.path} is ${entry.content.length} characters, over the ${RULE_CHARACTER_LIMIT} limit`,
    );
  }
});

// Only `description` is documented for workflow frontmatter; rules have no documented schema.
test('workflows carry a description, rules state their scope in prose', () => {
  const files = antigravityFiles(projectWith());
  const workflow = files.find((entry) => entry.path.startsWith('.agents/workflows/'));
  assert.match(workflow.content, /^---\ndescription: "/, workflow.content.slice(0, 120));

  const rule = files.find((entry) => entry.path === '.agents/rules/vibecheck-specs.md');
  assert.doesNotMatch(rule.content, /^---/, 'no frontmatter schema is documented for rules, so none is invented');
  assert.match(rule.content, /\*\*Applies to:\*\* files under `specs\/\*\*`/);
});

test('optional rules appear only when the project uses them', () => {
  const bare = antigravityFiles(projectWith({ security: { controls: [] }, docs: { enabled: false } })).map((f) => f.path);
  assert.ok(!bare.includes('.agents/rules/vibecheck-security.md'));
  assert.ok(!bare.includes('.agents/rules/vibecheck-docs.md'));

  const full = antigravityFiles(projectWith({ security: { controls: ['rbac'] }, docs: { enabled: true } })).map((f) => f.path);
  assert.ok(full.includes('.agents/rules/vibecheck-security.md'));
  assert.ok(full.includes('.agents/rules/vibecheck-docs.md'));
});

test('every editor gets its own folder from one project definition', () => {
  const paths = buildManagedFiles(projectWith()).map((entry) => entry.path);

  assert.ok(paths.includes('AGENTS.md'), 'the neutral spine every editor reads');
  assert.ok(paths.includes('CLAUDE.md'), 'Claude Code');
  assert.ok(paths.some((path) => path.startsWith('.cursor/rules/')), 'Cursor');
  assert.ok(paths.some((path) => path.startsWith('.agents/rules/')), 'Antigravity');
  assert.ok(paths.some((path) => path.startsWith('.windsurf/rules/')), 'Windsurf');
  assert.equal(new Set(paths).size, paths.length, 'no two generators may claim the same path');
});

// Windsurf caps individual rules at 6,000 characters and ALL rules combined at 12,000.
test('Windsurf rules stay inside the combined 12,000 character budget', () => {
  const rules = buildManagedFiles(projectWith({ security: { controls: ['rbac', 'object-level', 'field-encryption'] }, docs: { enabled: true } }))
    .filter((entry) => entry.path.startsWith('.windsurf/rules/'));

  assert.ok(rules.length, 'expected Windsurf rules');
  for (const entry of rules) assert.ok(entry.content.length <= 6000, `${entry.path} is ${entry.content.length} characters, over the 6,000 per-file limit`);
  const total = rules.reduce((sum, entry) => sum + entry.content.length, 0);
  assert.ok(total <= 12000, `Windsurf rules total ${total} characters, over the 12,000 combined limit`);
});

test('a new project is scaffolded with every editor folder on disk', async () => {
  const root = await newProject('--from', EXAMPLE);

  for (const path of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.cursor/rules', '.agents/rules', '.agents/workflows', '.windsurf/rules']) {
    assert.ok(existsSync(join(root, path)), `${path} is missing from a new project`);
  }

  const gate = await read(root, '.agents/rules/vibecheck-workflow.md');
  assert.match(gate, /AGENTS\.md/, 'the Antigravity gate must point back at the neutral spine');
  assert.match(gate, /specs\/features/);

  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Evidence over guesswork/, 'the evidence rules reach every editor through AGENTS.md');
});
