import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { readConfig, writeConfig } from '../src/prompts.js';
import { listProjects } from '../src/projects.js';
import { gitInit, isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * `/vibekit:setup` writes four machine settings once. Everything after reads them: a new local
 * project lands in the projects folder, an empty project list scans that folder, and a human
 * decision carries the configured name without `--by`.
 */

async function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
}

function isolated() {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  return original;
}

test('the four setup settings are validated and listed', async () => {
  const original = isolated();
  try {
    await assert.rejects(writeConfig('projects-root', 'relative/path'), /absolute path/);
    await assert.rejects(writeConfig('git-provider', 'bitbucket'), /github, azure-devops, gitlab, none/);
    await assert.rejects(writeConfig('git-org', 'acme'), /URL/);
    const home = tempDir('vibekit-projects-');
    await capture(() => run(['settings', 'projects-root', home]));
    await capture(() => run(['settings', 'name', 'Sam Lee']));
    await capture(() => run(['settings', 'git-provider', 'azure-devops']));
    await capture(() => run(['settings', 'git-org', 'https://dev.azure.com/acme']));
    const config = await readConfig();
    assert.equal(config['projects-root'], home);
    assert.equal(config.name, 'Sam Lee');
    assert.equal(config['git-provider'], 'azure-devops');
    const listed = await capture(() => run(['settings']));
    assert.match(listed, /projects-root\s+\S*vibekit-projects-/);
    assert.match(listed, /name\s+Sam Lee/);
  } finally {
    restoreEnv(original);
  }
});

test('a new local project lands in projects-root, and an empty project list scans that folder', async () => {
  const original = isolated();
  try {
    const home = tempDir('vibekit-projects-');
    await writeConfig('projects-root', home);
    const elsewhere = tempDir('vibekit-elsewhere-');
    await capture(() => run(['new', 'project', 'Stock Take', '--where', 'local', '--yes', '--describe', 'Staff count stock.', '--platform', 'web', '--dir', elsewhere]));
    assert.match(await readFile(join(home, 'Stock Take/specs/project.json'), 'utf8'), /Stock Take/);

    // A fresh machine with the same projects folder: nothing registered, but setup said where to look.
    process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
    await writeConfig('projects-root', home);
    const rows = await listProjects();
    assert.deepEqual(rows.map((row) => row.name), ['Stock Take']);
  } finally {
    restoreEnv(original);
  }
});

test('a human decision carries the configured name when --by is not given', async () => {
  const original = isolated();
  try {
    const root = tempDir('vibekit-named-');
    await capture(() => run(['new', 'project', 'Stock', '--yes', '--describe', 'Staff count stock.', '--platform', 'web', '--dir', root]));
    gitInit(root);
    await assert.rejects(run(['action', 'approve', '1', '--dir', root]), /carries a name/);
    await writeConfig('name', 'Sam Lee');
    assert.match(await capture(() => run(['action', 'approve', '1', '--dir', root])), /reviewed by Sam Lee/);
    assert.match(await readFile(join(root, 'vibekit/workflow/assumptions.md'), 'utf8'), /by Sam Lee/);
    assert.match(await capture(() => run(['action', 'approve', '2', '--by', 'Kim', '--dir', root])), /✔/);
    assert.match(await readFile(join(root, 'vibekit/workflow/architecture.md'), 'utf8'), /by Kim/, '--by still wins');
    await mkdir(join(root, 'nothing'), { recursive: true });
  } finally {
    restoreEnv(original);
  }
});
