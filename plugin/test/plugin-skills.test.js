import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PLUGIN, '..');

/**
 * Claude Code names a plugin's skills `/<plugin>:<name>`, taking `name` from SKILL.md when it is
 * set and the directory otherwise. The two must agree, and every place that lists the helpers
 * must use the colon form: a doc that says `/vibekit.build` sends a person to a command that
 * does not exist, which is what "the plugin is broken" turned out to mean.
 */

const frontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'has frontmatter');
  return Object.fromEntries(match[1].split('\n').map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]));
};

const skillDirs = async () => (await readdir(join(PLUGIN, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test('every skill directory holds one SKILL.md whose name is the directory, with a description and a body that runs the CLI', async () => {
  const dirs = await skillDirs();
  assert.ok(dirs.length >= 19, `${dirs.length} skills`);
  for (const dir of dirs) {
    const files = await readdir(join(PLUGIN, 'skills', dir));
    assert.deepEqual(files, ['SKILL.md'], `${dir} ships only SKILL.md`);
    const text = await readFile(join(PLUGIN, 'skills', dir, 'SKILL.md'), 'utf8');
    const meta = frontmatter(text);
    assert.equal(meta.name, dir, `${dir}: frontmatter name matches the directory`);
    assert.match(dir, /^[a-z][a-z-]*$/, `${dir}: a slug, so the command is /vibekit:${dir}`);
    assert.ok(meta.description && meta.description.length > 10, `${dir}: has a description`);
    assert.match(text, /`vibekit /, `${dir}: tells the agent which CLI command to run`);
    assert.match(text, /AskUserQuestion/, `${dir}: asks with a picker, not a prompt`);
    if (meta['argument-hint']) assert.match(text, /\$ARGUMENTS/, `${dir}: takes an argument-hint, so it must use $ARGUMENTS`);
  }
});

test('one skill per verb a person types on a normal day', async () => {
  const dirs = await skillDirs();
  for (const name of ['setup', 'use-project', 'answer', 'new-project', 'new-sprint', 'new-feature', 'new-bug', 'new-hotfix', 'plan-project', 'plan-sprint', 'run-sprint', 'run-check', 'run-review', 'show-status', 'show-plan', 'show-why', 'clarify', 'build', 'analyze']) {
    assert.ok(dirs.includes(name), `/vibekit:${name}`);
  }
});

test('nothing refers to a helper by the dot form; Claude Code names plugin commands /vibekit:<name>', async () => {
  const dirs = await skillDirs();
  const files = ['README.md', 'ONBOARDING.md', 'GUIDE.md', 'docs/MULTI-EDITOR.md', 'docs/BROWNFIELD.md', 'site/src/Content.jsx', ...dirs.map((dir) => `plugin/skills/${dir}/SKILL.md`)];
  for (const file of files) {
    const text = await readFile(join(REPO, file), 'utf8').catch(() => '');
    const dotted = text.match(/\/vibekit\.(?!git\b)[a-z-]+/g) ?? [];
    assert.deepEqual(dotted, [], `${file} uses the dot form`);
    for (const [, name] of text.matchAll(/\/vibekit:([a-z-]+)/g)) assert.ok(dirs.includes(name), `${file} names /vibekit:${name}, which does not ship`);
  }
});

test('the marketplace and plugin manifests agree and point at the folder that holds the skills', async () => {
  const marketplace = JSON.parse(await readFile(join(REPO, '.claude-plugin/marketplace.json'), 'utf8'));
  const plugin = JSON.parse(await readFile(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8'));
  const entry = marketplace.plugins.find((item) => item.name === 'vibekit');
  assert.equal(entry.source, './plugin');
  assert.equal(entry.version, plugin.version);
  assert.equal(plugin.name, 'vibekit');
  const hooks = JSON.parse(await readFile(join(PLUGIN, 'hooks/hooks.json'), 'utf8'));
  for (const event of ['SessionStart', 'PreToolUse', 'Stop']) assert.ok(hooks.hooks[event], `${event} hook`);
});
