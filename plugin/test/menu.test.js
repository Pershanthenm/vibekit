// A menu of forty entries is not a menu.
//
// Five skills get a slash command; the rest, plus whatever the team kit has imported, are
// playbooks. The thing that makes that a trim rather than a removal is that every demoted skill
// is still reachable, still complete, and still named correctly by the skills that invoke it —
// so these check the reachability, not just the count.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playbook } from '../src/commands/playbook.js';
import { buildManagedFiles } from '../src/generators/index.js';
import { MENU, isMenuSkill } from '../src/generators/menu.js';
import { PLUGIN_CONTEXT, SKILLS } from '../src/generators/workflow.js';
import { pluginSkillFiles } from '../src/team.js';
import { EXAMPLE, newProject, patchProject } from './helpers.js';

const printed = () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  return { lines, done: () => { console.log = original; return lines.join('\n'); } };
};

const say = async (root, ...args) => {
  const capture = printed();
  try {
    await playbook({ root, args });
  } finally {
    return capture.done();
  }
};

test('every name in the menu is a skill that exists', () => {
  const names = SKILLS.map((skill) => skill.name);
  for (const name of MENU) assert.ok(names.includes(name), `${name} is in the menu but there is no such skill`);
});

test('the plugin ships a command only for the menu', () => {
  const built = pluginSkillFiles().filter((file) => file.path.endsWith('SKILL.md')).map((file) => file.path.split('/')[0]);

  assert.deepEqual(built.sort(), [...MENU].sort());
});

test('a project gets the same short menu, in every editor it asked for', async () => {
  const root = await newProject('--from', EXAMPLE);
  await patchProject(root, { workflow: { skills: 'project' }, editors: ['claude', 'cursor'] });
  const { loadProject } = await import('../src/project.js');
  const paths = buildManagedFiles(await loadProject(root)).map((file) => file.path);

  const claudeSkills = paths.filter((path) => path.startsWith('.claude/skills/') && path.endsWith('SKILL.md'));
  const cursorCommands = paths.filter((path) => path.startsWith('.cursor/commands/'));

  assert.equal(claudeSkills.length, MENU.length);
  assert.equal(cursorCommands.length, MENU.length);
  assert.ok(!paths.some((path) => path.includes('implement-feature')), 'a demoted skill is not written as a command');
});

// --- Still reachable ---------------------------------------------------------------------------

test('a demoted skill prints in full, so nothing was removed by demoting it', async () => {
  const root = await newProject('--from', EXAMPLE);

  const text = await say(root, 'docs');

  const skill = SKILLS.find((entry) => entry.name === 'docs');
  assert.ok(text.includes('name: docs'), 'it keeps its front matter, so it reads as the skill it is');
  assert.ok(text.includes(skill.body(PLUGIN_CONTEXT).trim().split('\n')[0]), 'and its body is the generated one, not a summary');
});

test('a skill that still has a command says so rather than printing twice', async () => {
  const root = await newProject('--from', EXAMPLE);

  assert.match(await say(root, 'run'), /\/vibekit:run/);
});

test('a name nobody has is refused with the list of names somebody does have', async () => {
  const root = await newProject('--from', EXAMPLE);

  await assert.rejects(() => playbook({ root, args: ['docsx'] }), /no playbook called docsx.*implement-feature/s);
});

test('the listing names every demoted skill, so the menu is short and nothing is hidden', async () => {
  const root = await newProject('--from', EXAMPLE);

  const text = await say(root);

  for (const skill of SKILLS.filter((entry) => !isMenuSkill(entry.name))) {
    assert.ok(text.includes(skill.name), `${skill.name} has no command and is not listed either`);
  }
});

// Taking the middle of the workflow off the menu is only safe because `run` is what invokes it.
// If `run` ever stops naming a step, that step became unreachable the moment it lost its command —
// so this pins the thing the trim depends on, not the trim itself.
test('the loop still names every step it invokes, by command or by playbook', () => {
  const body = SKILLS.find((skill) => skill.name === 'run').body(PLUGIN_CONTEXT);

  for (const name of ['spec-feature', 'plan-feature', 'implement-feature', 'review-feature']) {
    const named = isMenuSkill(name) ? `/vibekit:${name}` : `vibekit playbook ${name}`;
    assert.ok(body.includes(named), `run is meant to invoke ${name} but does not name it as ${named}`);
  }
});

test('a demoted step still hands on to the next one, so the chain is unbroken', () => {
  const named = (name) => (isMenuSkill(name) ? `/vibekit:${name}` : `vibekit playbook ${name}`);
  const body = (name) => SKILLS.find((skill) => skill.name === name).body(PLUGIN_CONTEXT);

  assert.ok(body('dispatch').includes(named('merge-lanes')), 'dispatch must say what finishes the lanes');
  assert.ok(body('merge-lanes').includes(named('run')), 'merge-lanes must hand back to the loop');
  assert.ok(body('implement-feature').includes(named('review-feature')), 'implementing must end in a review');
});
