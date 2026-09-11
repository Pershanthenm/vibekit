import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { importEcc } from '../src/import-ecc.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
let repo;
let ecc;

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'vc-ecc-'));
  repo = join(base, 'vibe-check-cli');
  await cp(REPO, repo, { recursive: true });
  await rm(join(repo, 'team'), { recursive: true, force: true });
  ecc = join(base, 'ecc-universal');
  await put(join(ecc, 'package.json'), '{"name":"ecc-universal","version":"9.9.9"}');
  await put(join(ecc, 'LICENSE'), 'MIT License\n\nCopyright (c) Affaan Mustafa\n');
  await put(join(ecc, 'skills/api-design/SKILL.md'), '---\nname: api-design\ndescription: REST API design.\n---\nDesign resources.\n');
  await put(join(ecc, 'skills/api-design/references/errors.md'), '# Errors\n');
  await put(join(ecc, 'skills/learning-v2/SKILL.md'), '---\nname: learning-v2\ndescription: Learns.\n---\nObserve sessions.\n');
  await put(join(ecc, 'skills/learning-v2/hooks/observe.sh'), '#!/bin/sh\n');
  await put(join(ecc, 'skills/old-learning/SKILL.md'), '---\nname: old-learning\ndescription: "[DEPRECATED - use learning-v2] Old."\n---\n');
  await put(join(ecc, 'skills/run/SKILL.md'), '---\nname: run\ndescription: clash\n---\n');
  await put(join(ecc, 'agents/security-reviewer.md'), '---\nname: security-reviewer\ndescription: Security review.\ntools: ["Read", "Grep"]\n---\nReview.\n');
  await put(join(ecc, 'agents/planner.md'), '---\nname: planner\ndescription: Plans.\n---\n');
  await put(join(ecc, 'commands/code-review.md'), '---\ndescription: Code review of local changes or a PR\nargument-hint: [pr-number | blank]\n---\n\n# Code Review\n\n**Input**: $ARGUMENTS\n');
  await put(join(ecc, 'commands/sessions.md'), '---\ndescription: Sessions\n---\nnode "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/cost-tracker.js"\n');
  await put(join(ecc, 'commands/plan.md'), '---\ndescription: Plan\n---\nInvoke the planner agent.\n');
});

afterEach(() => { process.exitCode = 0; });

test('imports what works on its own and explains everything it skips', async () => {
  const report = await importEcc(repo, ['api-design', 'learning-v2', 'old-learning', 'run', 'security-reviewer', 'code-review', 'sessions', 'plan', 'verify'], { from: ecc });
  assert.deepEqual(report.imported.map((item) => `${item.kind}:${item.name}`), ['skill:api-design', 'agent:security-reviewer', 'command:code-review']);
  const reasons = Object.fromEntries(report.skipped.map((item) => [item.name, item.reason]));
  assert.match(reasons['learning-v2'], /hook runtime/);
  assert.match(reasons['old-learning'], /deprecated/);
  assert.match(reasons.run, /clashes with Vibe-check-cli's \/run/);
  assert.match(reasons.sessions, /ECC's scripts/);
  assert.match(reasons.plan, /needs ECC agent\(s\) planner/);
  assert.deepEqual(report.unknown.map((item) => item.name), ['verify']);

  assert.equal(await readFile(join(repo, 'team/skills/api-design/references/errors.md'), 'utf8'), '# Errors\n');
  const converted = await readFile(join(repo, 'team/skills/code-review/SKILL.md'), 'utf8');
  assert.match(converted, /^---\nname: code-review\ndescription: "Code review of local changes or a PR"\nargument-hint: "\[pr-number \| blank\]"\n---\n# Code Review[\s\S]*\$ARGUMENTS/);
  const notice = await readFile(join(repo, 'team/THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notice, /ecc-universal@9\.9\.9[\s\S]*code-review \(command, converted to a skill\)[\s\S]*MIT License[\s\S]*Affaan Mustafa/);
});

test('adding the agent a command needs lets it through; the build ships the licence notice', async () => {
  const report = await importEcc(repo, ['plan', 'planner'], { from: ecc });
  assert.deepEqual(report.imported.map((item) => item.name).sort(), ['plan', 'planner']);
  await run(['team', 'import-ecc', 'api-design', '--from', ecc, '--repo', repo]);
  assert.ok((await readdir(join(repo, 'plugin/skills'))).includes('api-design'));
  assert.match(await readFile(join(repo, 'plugin/THIRD_PARTY_NOTICES.md'), 'utf8'), /MIT License/);
});

test('a bare import-ecc re-runs your recorded list (for updating to a newer ECC)', async () => {
  await run(['team', 'import-ecc', 'api-design,code-review', '--from', ecc, '--repo', repo]);
  const recorded = JSON.parse(await readFile(join(repo, 'team/imports/ecc.json'), 'utf8'));
  assert.deepEqual(recorded.requested, ['api-design', 'code-review']);
  await run(['team', 'import-ecc', '--from', ecc, '--repo', repo]);
  assert.equal(JSON.parse(await readFile(join(repo, 'team/imports/ecc.json'), 'utf8')).version, '9.9.9');
});
