import { buildPlugin } from '../src/team.js';

const { skills, agents, team } = await buildPlugin();
const extras = team.skills.length + team.agents.length + team.plugins.length;
console.log(`✔ Built ${skills} skills and ${agents} subagents into the plugin${extras ? ` (team: ${team.skills.length} skills, ${team.agents.length} subagents, ${team.plugins.length} plugin dependencies)` : ''}`);
