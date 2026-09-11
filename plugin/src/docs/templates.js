import { joinDoc } from './freshness.js';

const LIVING = (path) => `> Living document: describes how the system works **now**. When its sources change, update it and run \`vibecheck docs stamp ${path}\`.`;

const BODIES = {
  architecture: (project, doc) => `# Architecture — ${project.project.name}

${LIVING(doc.path)}

## Context
TODO: who uses the system and which external systems it depends on.

\`\`\`mermaid
flowchart LR
  users([Users]) --> system[${project.project.name}]
  system --> external[(TODO: external systems)]
\`\`\`

## Containers
TODO: each app, service and datastore with its responsibility and technology.

\`\`\`mermaid
flowchart LR
  TODO
\`\`\`

## Key decisions
TODO: link the ADRs in specs/decisions/ that shaped this picture.
`,
  'data-model': (project, doc) => `# Data model — ${project.project.name}

${LIVING(doc.path)}

\`\`\`mermaid
erDiagram
  TODO
\`\`\`

## Entities
TODO: meaning of each entity, ownership, lifecycle, retention.
`,
  deployment: (project, doc) => `# Deployment — ${project.project.name}

${LIVING(doc.path)}

Hosting: ${project.stack.hosting}

\`\`\`mermaid
flowchart LR
  TODO
\`\`\`

## Environments & release
TODO: environments, pipeline, secrets handling, rollback.
`,
  'threat-model': (project, doc) => `# Threat model — ${project.project.name}

${LIVING(doc.path)}

Baseline controls: \`specs/security.md\`.

## Data flows and trust boundaries
\`\`\`mermaid
flowchart LR
  subgraph internet[Internet]
    user([Users])
  end
  subgraph dmz[Edge]
    edge[TODO: reverse proxy / WAF]
  end
  subgraph app[Application zone]
    api[TODO: API]
  end
  subgraph data[Data zone]
    db[(TODO: database)]
  end
  user --> edge --> api --> db
\`\`\`

## STRIDE per element
| Element | Spoofing | Tampering | Repudiation | Information disclosure | Denial of service | Elevation of privilege |
|---|---|---|---|---|---|---|
| TODO | | | | | | |

## Top risks and mitigations
TODO: each risk, its likelihood and impact, and the control in specs/security.md that mitigates it.
`,
  'design-system': (project, doc) => `# Design system — ${project.project.name}

${LIVING(doc.path)}

Targets: ${project.targets.join(', ')} · Accessibility: ${project.nfr.accessibility}
Design files: TODO (link Claude Design, Figma or similar)

## Tokens
| Token | Value | Use |
|---|---|---|
| TODO | | |

## Components
TODO: shared components, their states and where they live in code.
`,
  feature: (project, doc) => `# ${doc.title}

${LIVING(doc.path)}

## What shipped
TODO: behaviour as built, per target, and how to use it.

## How it works
\`\`\`mermaid
sequenceDiagram
  TODO
\`\`\`

## Code map
TODO: modules and files involved, and where to extend it.
`,
  design: (project, doc) => `# ${doc.title}

${LIVING(doc.path)}

Design files: TODO (link Claude Design, Figma or similar)

## Screens
| Screen | Purpose | Targets |
|---|---|---|
| TODO | | |

## States per target
| Screen | Loading | Empty | Error | Success |
|---|---|---|---|---|
| TODO | | | | |

## User flow
\`\`\`mermaid
flowchart LR
  TODO
\`\`\`

## Accessibility
TODO: focus order, labels, contrast, dynamic type against ${project.nfr.accessibility}.
`,
};

export function renderDocTemplate(project, doc, featureId) {
  const meta = { title: doc.title, kind: doc.kind, feature: featureId, sources: doc.sources };
  return joinDoc(meta, BODIES[doc.kind](project, doc));
}
