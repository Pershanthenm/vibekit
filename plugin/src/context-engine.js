import { searchKnowledge } from './knowledge.js';
import { recall } from './memory.js';

export const sectionOf = (markdown, heading) =>
  markdown.match(new RegExp(`## ${heading}\\n+([\\s\\S]*?)(?=\\n## |$)`, 'i'))?.[1]?.trim() ?? '';

export const featureQuery = (feature) => `${feature.title} ${sectionOf(feature.spec, 'Problem')}`.slice(0, 300);

export async function gatherContext(project, query) {
  const [memories, documents] = await Promise.all([recall(project, query), searchKnowledge(project, query)]);
  return { memories, documents };
}

export function renderContext({ memories, documents }, heading = 'Relevant context') {
  const memoryLines = memories.map((memory) => `- ${memory}`);
  const documentLines = documents.map(({ title, snippet, path }) => `- ${title}${snippet ? ` — ${snippet}` : ''}${path ? ` (read: ${path})` : ''}`);
  const parts = [
    memoryLines.length && `### From past sessions (agentmemory)\n${memoryLines.join('\n')}`,
    documentLines.length && `### From your knowledge library (OpenContext)\n${documentLines.join('\n')}`,
  ].filter(Boolean);
  return parts.length ? `## ${heading}\n\n${parts.join('\n\n')}` : '';
}

export async function contextForFeature(project, feature, heading = `Relevant context for ${feature.id}`) {
  return renderContext(await gatherContext(project, featureQuery(feature)), heading);
}
