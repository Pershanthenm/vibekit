import { sectionOf } from '../context-engine.js';
import { filesOfTask, parseTasks } from '../lanes.js';

const UI_TARGETS = ['web', 'ios', 'android', 'desktop'];
const NO_UI = /^(n\/?a|none|-|no ui)?\.?$/i;

export const hasUi = (project) => project.targets.some((target) => UI_TARGETS.includes(target));
const hasDatabase = (project) => Boolean(project.stack.database) && !/^none$/i.test(project.stack.database);

export const DIAGRAM_TYPES = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|journey|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Deployment|C4Dynamic|quadrantChart|requirementDiagram|block-beta|sankey-beta|xychart-beta|architecture-beta|kanban)\b/;

export const DOC_KINDS = {
  architecture: { title: 'Architecture', diagram: /^(flowchart|graph|C4\w+|architecture-beta)/, diagramName: 'flowchart or C4' },
  'data-model': { title: 'Data model', diagram: /^erDiagram/, diagramName: 'erDiagram' },
  deployment: { title: 'Deployment', diagram: /^(flowchart|graph|C4Deployment|architecture-beta)/, diagramName: 'flowchart or C4Deployment' },
  'design-system': { title: 'Design system', diagram: null },
  'threat-model': { title: 'Threat model', diagram: /^(flowchart|graph|C4\w+)/, diagramName: 'data-flow flowchart with trust boundaries' },
  feature: { title: 'Feature', diagram: /^(sequenceDiagram|flowchart|graph|stateDiagram)/, diagramName: 'sequence, flow or state' },
  design: { title: 'Design', diagram: /^(flowchart|graph|journey|stateDiagram)/, diagramName: 'user flow (flowchart, journey or state)' },
};

const PROJECT_DOCS = [
  { kind: 'architecture', file: 'architecture.md', sources: () => ['specs/project.json', 'specs/01-architecture.md', 'specs/decisions/*.md'], when: () => true },
  { kind: 'data-model', file: 'data-model.md', sources: (project) => ['specs/01-architecture.md', ...project.docs.dataModelSources], when: hasDatabase },
  { kind: 'deployment', file: 'deployment.md', sources: () => ['specs/project.json', 'specs/decisions/*.md'], when: (project) => Boolean(project.stack.hosting) },
  { kind: 'threat-model', file: 'security/threat-model.md', sources: () => ['specs/project.json', 'specs/01-architecture.md', 'specs/decisions/*.md'], when: (project) => project.security.controls.length > 0 },
  { kind: 'design-system', file: 'design/system.md', sources: () => ['specs/project.json', 'specs/04-nfr.md'], when: hasUi },
];

export function projectDocs(project) {
  return PROJECT_DOCS.filter((doc) => doc.when(project)).map(({ kind, file, sources }) => ({
    kind,
    path: `${project.docs.dir}/${file}`,
    title: DOC_KINDS[kind].title,
    sources: sources(project),
  }));
}

export function taskFiles(tasksText) {
  return [...new Set(parseTasks(tasksText).flatMap(filesOfTask))];
}

export const plansUi = (plan) => {
  const states = sectionOf(plan, 'UI states per target');
  return Boolean(states) && !NO_UI.test(states) && !/\bTODO\b/.test(states);
};

export function featureDocs(project, feature) {
  const featureDir = `specs/features/${feature.id}`;
  const sources = [`${featureDir}/spec.md`, `${featureDir}/plan.md`, ...taskFiles(feature.tasks)];
  const docs = [{ kind: 'feature', path: `${project.docs.dir}/features/${feature.id}.md`, title: feature.title, sources }];
  if (hasUi(project) && plansUi(feature.plan)) {
    docs.push({ kind: 'design', path: `${project.docs.dir}/design/${feature.id}.md`, title: `${feature.title} — design`, sources });
  }
  return docs;
}

export const isSpecOnly = (sources) => sources.length > 0 && sources.every((source) => source.startsWith('specs/'));
