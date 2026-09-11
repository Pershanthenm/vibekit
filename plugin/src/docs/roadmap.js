import { FEATURE_STATUSES } from '../schema.js';
import { GENERATED_NOTICE, markdown } from '../generators/shared.js';

const LABELS = { draft: 'Draft', approved: 'Approved', planned: 'Planned', 'in-progress': 'In progress', done: 'Done' };
const nodeId = (id) => `f${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
const label = (feature) => `${feature.id.slice(0, 3)} ${feature.title}`.replace(/"/g, "'");

function diagram(features) {
  const groups = FEATURE_STATUSES.map((status) => [status, features.filter((feature) => feature.status === status)]).filter(([, group]) => group.length);
  const lines = groups.flatMap(([status, group]) => [
    `  subgraph ${status.replace('-', '_')}["${LABELS[status]}"]`,
    ...group.map((feature) => `    ${nodeId(feature.id)}["${label(feature)}"]`),
    '  end',
  ]);
  return ['```mermaid', 'flowchart LR', ...lines, '```'].join('\n');
}

function table(features) {
  const rows = features.map((feature) => `| ${feature.id} | ${feature.title} | ${feature.status} |`);
  return ['| Feature | Title | Status |', '|---|---|---|', ...rows, '', 'Live progress per feature: `vibecheck list`.'].join('\n');
}

export function renderRoadmap(project, features) {
  const content = features.length ? [diagram(features), table(features)] : ['No features yet.'];
  return markdown(GENERATED_NOTICE, `# Roadmap — ${project.project.name}`, ...content);
}
