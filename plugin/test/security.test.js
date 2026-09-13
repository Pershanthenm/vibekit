import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { run } from '../src/cli.js';
import { CONTROLS } from '../src/security/controls.js';
import { resolveSecurity, securityRounds } from '../src/security/questions.js';
import { FAILS, PASSES, PASSING_SUITES, TOOL_FREE_PATH, approveReview, commitAll, exitCodeOf, fillSpec, gitInit, newProject, patchProject, read, restoreEnv, runHook, setDocsEnabled, sh, writeTracedTests } from './helpers.js';

const LAPTOP_APP = {
  platform: 'web', appType: 'internal', scale: 'medium', clients: ['mobile'], ecosystem: 'microsoft', licensing: 'oss-only',
  hosting: 'linux', team: ['csharp', 'typescript'], data: 'reporting', architecture: 'recommend', signin: 'sso',
  security: ['rbac-audit', 'mfa'], compliance: 'privacy', integrations: ['directory', 'devices'], autonomy: 'gated', engine: 'cursor', context: ['docs'],
};
const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env.VIBEKIT_HOME = await mkdtemp(join(tmpdir(), 'vibekit-home-'));
  process.env.AGENTMEMORY_URL = 'http://127.0.0.1:9';
  process.env.PATH = TOOL_FREE_PATH;
});

afterEach(() => {
  restoreEnv(ORIGINAL_ENV);
  process.exitCode = 0;
});

async function laptopProject() {
  const root = await newProject('--yes');
  await writeFile(join(root, 'specs/requirements.json'), JSON.stringify(LAPTOP_APP));
  await run(['advise', '--dir', root, 'apply', 'dotnet-vue']);
  return root;
}

test('security questions fit the menus and adapt to the application', () => {
  const rounds = securityRounds(LAPTOP_APP);
  for (const question of rounds.flatMap((round) => round.questions)) {
    assert.ok(question.options.length >= 2 && question.options.length <= 4, question.id);
    assert.ok(question.header.length <= 12, question.id);
  }
  const ids = (requirements, questionId) => securityRounds(requirements).flatMap((r) => r.questions).find((q) => q.id === questionId).options.map((o) => o.id);
  assert.deepEqual(ids(LAPTOP_APP, 'accounts'), ['idp-mfa', 'session-timeout', 'least-privilege'], 'SSO moves account security to the IdP');
  assert.ok(ids({ ...LAPTOP_APP, signin: 'local-mfa' }, 'accounts').includes('lockout'));
  assert.ok(!ids(LAPTOP_APP, 'secrets').includes('cloud-kms'), 'fully open source removes paid secret managers');
  assert.ok(ids({ ...LAPTOP_APP, licensing: 'commercial-ok', hosting: 'cloud' }, 'secrets').includes('cloud-kms'));
  assert.ok(!ids({ ...LAPTOP_APP, hosting: 'windows' }, 'pipeline').includes('containers'));
  assert.ok(ids({ ...LAPTOP_APP, appType: 'saas' }, 'authz').includes('tenant-isolation'));
});

test('unanswered questions keep secure defaults; dropping required controls becomes an accepted risk', () => {
  const defaults = resolveSecurity(LAPTOP_APP, {});
  assert.ok(defaults.controls.includes('field-encryption') && defaults.controls.includes('retention'));
  assert.deepEqual(defaults.acceptedRisks, []);
  const risky = resolveSecurity(LAPTOP_APP, { data: ['Encrypted, tested backups'] });
  assert.deepEqual(risky.acceptedRisks.map((risk) => risk.id).sort(), ['audit-append-only', 'field-encryption', 'retention']);
  assert.match(risky.acceptedRisks[0].reason, /POPIA \/ GDPR/);
});

test('every control has an acceptance criterion and an implementation for each stack family', () => {
  for (const item of CONTROLS) {
    assert.match(item.acceptance, /^Given .+ then /, item.id);
    assert.ok(item.impl.generic || ['dotnet', 'php', 'node', 'python', 'java'].every((family) => item.impl[family]), item.id);
  }
});

test('applying the baseline writes the spec, rules, criteria, CI workflow and threat model', async () => {
  const root = await laptopProject();
  await run(['security', '--dir', root, 'apply']);

  const project = JSON.parse(await read(root, 'specs/project.json'));
  assert.equal(project.security.stack, 'aspnetcore');
  assert.ok(project.security.controls.includes('bff-cookie'));

  const securityDoc = await read(root, 'specs/security.md');
  assert.match(securityDoc, /\| Cookie sessions via the backend \| ASP\.NET Core cookie auth \(BFF pattern\) \+ antiforgery \|/);
  assert.match(await read(root, 'AGENTS.md'), /## Security baseline \(mandatory\)[\s\S]*Browser clients never hold tokens/);
  assert.match(await read(root, '.cursor/rules/vibekit-security.mdc'), /globs: .*appsettings/);

  const foundation = await read(root, 'specs/features/001-foundation/spec.md');
  assert.match(foundation, /- \[ \] AC-2: Given a signed-in browser session[\s\S]*\(security: bff-cookie\)/);
  const workflow = await read(root, '.github/workflows/security.yml');
  assert.match(workflow, /gitleaks[\s\S]*semgrep scan[\s\S]*dotnet list package --vulnerable[\s\S]*trivy/);
  assert.match(await read(root, 'docs/security/threat-model.md'), /kind: "threat-model"/);

  await run(['security', '--dir', root, 'apply']);
  const again = await read(root, 'specs/features/001-foundation/spec.md');
  assert.equal(again.match(/\(security: bff-cookie\)/g).length, 1, 're-applying never duplicates criteria');
  assert.equal(await exitCodeOf(['check', '--dir', root]), 0);
});

test('an approved foundation gets a separate security-baseline feature instead', async () => {
  const root = await laptopProject();
  await setDocsEnabled(root, false);
  await run(['feature', '--dir', root, 'Foundation']);
  await fillSpec(root, '001-foundation', { tasks: ['- [ ] T-1 [impl] skeleton (AC-1)'] });
  await run(['status', '--dir', root, '001', 'approved']);
  await run(['security', '--dir', root, 'apply']);
  assert.match(await read(root, 'specs/features/002-security-baseline/spec.md'), /\(security: headers-csp\)/);
});

test('verify traces criteria to tests and the done gate enforces it', async () => {
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await run(['feature', '--dir', root, 'Assign laptop']);
  await fillSpec(root, '001-assign-laptop', { tasks: ['- [ ] T-1 [impl] assign (AC-1)'] });
  const specPath = join(root, 'specs/features/001-assign-laptop/spec.md');
  await writeFile(specPath, (await readFile(specPath, 'utf8')).replace(/(- \[ \] AC-1:.*)/, '$1\n- [ ] AC-2: Given a retired laptop, when assigned, then it is rejected'));
  for (const status of ['approved', 'planned', 'in-progress']) await run(['status', '--dir', root, '001', status]);
  for (const name of ['spec.md', 'tasks.md']) {
    const path = join(root, 'specs/features/001-assign-laptop', name);
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll('- [ ]', '- [x]'));
  }

  await writeTracedTests(root, '001-assign-laptop', [1, 3]);
  assert.equal(await exitCodeOf(['verify', '--dir', root, '001']), 1);
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /AC-2 has no test named "001:AC-2 …"/);

  await writeTracedTests(root, '001-assign-laptop', [1, 2]);
  assert.equal(await exitCodeOf(['verify', '--dir', root, '001']), 0);
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /evidence: the project needs a git repository/);

  await patchProject(root, PASSING_SUITES);
  gitInit(root);
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /evidence: no recorded test, smoke and UI run/);
  assert.equal(await exitCodeOf(['verify', '--dir', root, '001', '--run']), 0);
  await approveReview(root, '001-assign-laptop');
  await run(['status', '--dir', root, '001', 'done']);
  assert.match(await read(root, 'specs/features/001-assign-laptop/spec.md'), /^status: done$/m);
});

test('evidence must be fresh, clean and passing for every defined suite', async () => {
  const root = await newProject('--yes');
  await setDocsEnabled(root, false);
  await patchProject(root, { commands: { test: PASSES, smoke: PASSES, ui: FAILS } });
  await run(['feature', '--dir', root, 'Assign laptop']);
  await fillSpec(root, '001-assign-laptop', { tasks: ['- [x] T-1 [impl] assign (AC-1)'] });
  const specPath = join(root, 'specs/features/001-assign-laptop/spec.md');
  await writeFile(specPath, (await readFile(specPath, 'utf8')).replaceAll('- [ ]', '- [x]'));
  for (const status of ['approved', 'planned', 'in-progress']) await run(['status', '--dir', root, '001', status]);
  await writeTracedTests(root, '001-assign-laptop', [1]);
  gitInit(root);

  assert.equal(await exitCodeOf(['verify', '--dir', root, '001', '--run']), 1, 'UI suite fails');
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /evidence: UI suite failed/);

  await patchProject(root, { commands: { ui: PASSES } });
  sh(root, 'git', 'add', '-A');
  sh(root, 'git', 'commit', '-qm', 'fix ui');
  assert.equal(await exitCodeOf(['verify', '--dir', root, '001', '--run']), 0);
  await writeFile(join(root, 'src.ts'), 'export {}\n');
  commitAll(root, 'more code');
  await assert.rejects(run(['status', '--dir', root, '001', 'done']), /evidence: code changed since the last run/);
});

test('verify --run reports failing tests', async () => {
  const root = await newProject('--yes');
  const projectPath = join(root, 'specs/project.json');
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  await writeFile(projectPath, JSON.stringify({ ...project, commands: { ...project.commands, test: 'exit 3' } }));
  await run(['feature', '--dir', root, 'Assign laptop']);
  assert.equal(await exitCodeOf(['verify', '--dir', root, '001', '--run']), 1);
});

test('session protocol and reviewer know about the baseline', async () => {
  const root = await laptopProject();
  await run(['security', '--dir', root, 'apply']);
  const pluginReviewer = await readFile(new URL('../agents/reviewer.md', import.meta.url), 'utf8');
  assert.match(pluginReviewer, /read `AGENTS\.md`[\s\S]*specs\/security\.md[\s\S]*vibekit verify/);
  assert.match(await read(root, 'AGENTS.md'), /## Agent roles[\s\S]*\*\*reviewer\*\*[\s\S]*## Security baseline|## Security baseline[\s\S]*## Agent roles[\s\S]*\*\*reviewer\*\*/);
  const start = JSON.parse((await runHook(root, 'session-start', {})).stdout).hookSpecificOutput.additionalContext;
  assert.match(start, /Documentation needing attention[\s\S]*threat-model/);
});
