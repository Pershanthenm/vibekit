import { cp, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readText, writeText } from '../fsutil.js';
import { USER_AGENT_NOTICE, cursorAgentFiles } from '../generators/agents.js';
import { GENERATED_MARK, frontMatter, markdown } from '../generators/shared.js';
import { readTeam, teamPaths } from '../team.js';

const cursorHome = () => process.env.VIBECHECK_CURSOR_DIR || join(homedir(), '.cursor');
export const userCursorAgentsDir = () => join(cursorHome(), 'agents');
export const userCursorSkillsDir = () => join(cursorHome(), 'skills', 'vibe-check-cli');

function parseAgent(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = Object.fromEntries(match[1].split('\n').map((line) => line.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')]));
  return { meta, body: match[2] };
}

export function toCursorAgent(text, fallbackName) {
  const { meta, body } = parseAgent(text);
  const tools = meta.tools ?? '';
  const readonly = Boolean(tools) && !/\b(Write|Edit|MultiEdit|NotebookEdit)\b/.test(tools);
  const head = frontMatter({ name: meta.name ?? fallbackName, description: JSON.stringify(meta.description ?? `Team subagent ${fallbackName}`), model: 'inherit', readonly: String(readonly), is_background: 'false' });
  return markdown(head, USER_AGENT_NOTICE, body.trim());
}

async function teamAgentFiles() {
  const team = await readTeam();
  return Promise.all(team.agents.map(async (file) => ({ path: join(userCursorAgentsDir(), file), content: toCursorAgent(await readText(join(teamPaths().agents, file)), file.replace(/\.md$/, '')) })));
}

async function wanted() {
  return [...cursorAgentFiles(userCursorAgentsDir(), USER_AGENT_NOTICE), ...(await teamAgentFiles())];
}

export async function userCursorAgentsCurrent() {
  const files = await wanted();
  const contents = await Promise.all(files.map((entry) => readText(entry.path)));
  if (!files.every((entry, index) => contents[index] === entry.content)) return false;
  const team = await readTeam();
  const installed = await Promise.all(team.skills.map(async (name) => (await readText(join(userCursorSkillsDir(), name, 'SKILL.md'))) === (await readText(join(teamPaths().skills, name, 'SKILL.md')))));
  return installed.every(Boolean);
}

async function remove() {
  const dir = userCursorAgentsDir();
  for (const name of (await readdir(dir).catch(() => [])).filter((entry) => entry.endsWith('.md'))) {
    if ((await readText(join(dir, name)))?.includes(GENERATED_MARK)) {
      await rm(join(dir, name));
      console.log(`removed ${join(dir, name)}`);
    }
  }
  await rm(userCursorSkillsDir(), { recursive: true, force: true });
}

export async function cursorAgents({ remove: removeFlag }) {
  if (removeFlag) return remove();
  const kept = [];
  for (const entry of await wanted()) {
    const existing = await readText(entry.path);
    if (existing !== null && !existing.includes(GENERATED_MARK)) {
      kept.push(entry.path);
      continue;
    }
    await writeText(entry.path, entry.content);
  }
  const team = await readTeam();
  await rm(userCursorSkillsDir(), { recursive: true, force: true });
  for (const name of team.skills) await cp(join(teamPaths().skills, name), join(userCursorSkillsDir(), name), { recursive: true, dereference: true });
  kept.forEach((path) => console.log(`! kept your own ${path} (not created by Vibe-check-cli)`));
  console.log(`✔ Cursor subagents ready in ${userCursorAgentsDir()}: architect, test-engineer, implementer, reviewer${team.agents.length ? `, ${team.agents.map((file) => file.replace(/\.md$/, '')).join(', ')}` : ''}`);
  if (team.skills.length) console.log(`✔ Team skills ready for Cursor in ${userCursorSkillsDir()}: ${team.skills.join(', ')}`);
}
