import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../fsutil.js';
import { renderSkill } from '../generators/claude.js';
import { isMenuSkill } from '../generators/menu.js';
import { SKILLS, contextFor } from '../generators/workflow.js';
import { loadProject } from '../project.js';

const PLAYBOOKS_DIR = fileURLToPath(new URL('../../playbooks/', import.meta.url));

/**
 * The playbooks that came from the team kit, shipped as files because they are not ours to
 * generate. Missing directory means none were imported, which is not a problem to report.
 */
async function teamPlaybooks() {
  const names = await readdir(PLAYBOOKS_DIR).catch(() => []);
  return names.filter((name) => name.endsWith('.md')).map((name) => name.replace(/\.md$/, ''));
}

const described = (text) => (text.match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? '').trim();

/** The first sentence, short enough to read down the list rather than across it. */
const gist = (text) => {
  const sentence = `${text.split(/\.\s/)[0].replace(/\.$/, '')}.`;
  return sentence.length > 92 ? `${sentence.slice(0, 89).trimEnd()}…` : sentence;
};

/**
 * Print a playbook, or list the ones there are.
 *
 * A playbook is a skill without a slash command: the same instructions, from the same generator,
 * fetched by whoever needs them. Rendering here rather than reading a built file means the text
 * is written for the project asking — the plugin's commands are named `/vibekit:…`, a project
 * that keeps its own skills names them plainly — which is what makes this a real substitute for
 * the command rather than a copy that drifts.
 */
export async function playbook({ root, args }) {
  const [name] = args;
  const project = await loadProject(root).catch(() => null);
  const team = await teamPlaybooks();

  if (!name) {
    const ours = SKILLS.filter((skill) => !isMenuSkill(skill.name));
    console.log('Playbooks — the instructions behind VibeKit, for the steps that have no command of their own.\n');
    console.log('  Workflow');
    for (const skill of ours) console.log(`    ${skill.name.padEnd(21)} ${gist(skill.description)}`);
    if (team.length) {
      console.log('\n  From your team kit');
      for (const playbookName of team) {
        console.log(`    ${playbookName.padEnd(21)} ${gist(described(await readText(join(PLAYBOOKS_DIR, `${playbookName}.md`)) || ''))}`);
      }
    }
    console.log('\nPrint one with: vibekit playbook <name>');
    return;
  }

  const skill = SKILLS.find((entry) => entry.name === name);
  if (skill && isMenuSkill(name)) {
    console.log(`${name} has a command of its own — use /vibekit:${name} (or /${name} in a project that keeps its own skills).`);
    return;
  }
  if (skill) return console.log(renderSkill(skill, contextFor(project), '').trim());

  const fromTeam = await readText(join(PLAYBOOKS_DIR, `${name}.md`));
  if (fromTeam) return console.log(fromTeam.trim());

  const known = [...SKILLS.filter((entry) => !isMenuSkill(entry.name)).map((entry) => entry.name), ...team];
  throw new Error(`There is no playbook called ${name}. There is: ${known.join(', ')}.`);
}
