import { buildPlugin } from '../src/team.js';

const { skills, playbooks, agents, team } = await buildPlugin();
const extras = team.agents.length + team.plugins.length;
console.log(`✔ Built ${skills} commands, ${playbooks} playbooks and ${agents} subagents into the plugin${extras ? ` (team: ${team.agents.length} subagents, ${team.plugins.length} plugin dependencies)` : ''}`);
