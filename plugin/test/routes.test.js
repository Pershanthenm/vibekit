import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { worktreeBase } from '../src/git.js';
import { validate, normalize } from '../src/schema.js';
import { EXAMPLE, TOOL_FREE_PATH, fillSpec, gitInit, installFakeBin, installFakeMultica, newProject, patchProject, restoreEnv, setDocsEnabled, sh } from './helpers.js';

const FEATURE = '001-shared-list';
const TASKS = [
  '- [x] T-1 [impl] contracts (AC-1) — packages/core/list.ts',
  '- [ ] T-2 [impl] API (AC-1) — apps/api/list.ts [P]',
  '- [ ] T-3 [impl] web dialog (AC-1) — apps/web/assign.vue [P]',
];
const ORIGINAL_ENV = { ...process.env };
const FAKE_AGENT = `#!/usr/bin/env node
const { writeFileSync } = require('fs');
const { execFileSync } = require('child_process');
const { basename } = require('path');
if (process.argv[2] === '--version') { console.log('fake'); process.exit(0); }
const name = basename(process.argv[1]);
writeFileSync('built-by.txt', name + String.fromCharCode(10));
execFileSync('git', ['add', '-A'], { stdio: 'ignore' });
execFileSync('git', ['commit', '-qm', 'lane by ' + name], { stdio: 'ignore' });
`;

beforeEach(async () => {
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  process.env.VIBECHECK_HOME = await mkdtemp(join(tmpdir(), 'vc-home-'));
});

afterEach(() => {
  restoreEnv(ORIGINAL_ENV);
  process.exitCode = 0;
});

async function inProgress(routes, extra = {}) {
  const root = await newProject('--from', EXAMPLE);
  await setDocsEnabled(root, false);
  await patchProject(root, { workflow: { routes, ...extra.workflow }, commands: { install: '' }, ...extra.patch });
  await run(['feature', '--dir', root, 'Shared list']);
  await fillSpec(root, FEATURE, { tasks: TASKS });
  await run(['status', '--dir', root, FEATURE, 'approved']);
  await run(['status', '--dir', root, FEATURE, 'in-progress', '--force']);
  gitInit(root);
  return root;
}

test('one batch runs Cursor and Claude side by side, routed by the files each lane touches', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'fake-agents-'));
  for (const name of ['cursor-agent', 'claude']) {
    await installFakeBin(bin, name, FAKE_AGENT);
  }
  process.env.PATH = [bin, TOOL_FREE_PATH].join(delimiter);
  const root = await inProgress([{ match: 'apps/web/**', engine: 'claude' }], { workflow: { engine: 'cursor' } });

  await run(['dispatch', '--dir', root, FEATURE]);
  const builtBy = (lane) => sh(join(worktreeBase(root), `${FEATURE}-${lane}`), 'git', 'log', '-1', '--format=%s').trim();
  assert.equal(builtBy('lane-1'), 'lane by cursor-agent', 'API lane falls back to the default engine');
  assert.equal(builtBy('lane-2'), 'lane by claude', 'web lane is routed to Claude');
});

test('Multica lanes can be assigned to different agents, such as a Cursor agent and a Claude agent', async () => {
  const fake = await installFakeMultica();
  Object.assign(process.env, fake.env);
  const root = await inProgress([{ match: 'apps/web/**', agent: 'Nova (Cursor)' }], {
    workflow: { engine: 'multica' },
    patch: { multica: { agent: 'Lambda (Claude Code)', board: true } },
  });
  await run(['dispatch', '--dir', root, FEATURE]);
  const lanes = (await fake.state()).issues.filter((issue) => issue.metadata.vibecheck_lane);
  assert.deepEqual(lanes.map((issue) => [issue.metadata.vibecheck_lane, issue.assignee]), [['lane-1', 'Lambda (Claude Code)'], ['lane-2', 'Nova (Cursor)']]);
});

test('routes are validated', () => {
  assert.deepEqual(validate(normalize({ workflow: { routes: [{ match: 'web/**', engine: 'cursor' }, { match: 'mobile/**', agent: 'Nova' }] } })), []);
  const errors = validate(normalize({ workflow: { routes: [{ match: 'web/**', engine: 'copilot' }, { engine: 'claude' }, { match: 'x/**' }] } }));
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /engine must be one of: cursor, claude, manual[\s\S]*match must be a glob[\s\S]*needs an "engine"/);
});
