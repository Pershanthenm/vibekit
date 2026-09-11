import { findControl, implementationFor, stackFamily } from './controls.js';

const escapeCell = (text) => text.replace(/\|/g, '\\|');

export const securityControls = (project) => project.security.controls.map(findControl).filter(Boolean);

export function securityRules(project) {
  return securityControls(project).map((item) => item.rule);
}

export function renderSecurityBody(project) {
  const family = stackFamily(project);
  const rows = securityControls(project).map((item) =>
    `| ${item.title} | ${escapeCell(implementationFor(item, family))} | test for \`(security: ${item.id})\` criterion | ${item.asvs} |`);
  const risks = project.security.acceptedRisks.map((risk) => `- **${findControl(risk.id)?.title ?? risk.id}** — ${risk.reason}. Revisit before launch.`);
  return [
    `# Security baseline — ${project.project.name}`,
    `Compliance: ${project.nfr.security}${project.nfr.privacy ? ` · Privacy: ${project.nfr.privacy}` : ''}`,
    '## Controls\n\nEach control is an acceptance criterion in the foundation (or security-baseline) feature and must be proven by a test before that feature is done.',
    ['| Control | Implementation | Verified by | ASVS |', '|---|---|---|---|', ...rows].join('\n'),
    `## Rules for every change\n\n${securityRules(project).map((rule) => `- ${rule}`).join('\n')}`,
    risks.length ? `## Accepted risks\n\n${risks.join('\n')}` : '',
    project.security.notes.length ? `## Notes from the questionnaire\n\n${project.security.notes.map((note) => `- ${note}`).join('\n')}` : '',
    '## Threat model\n\nSee `docs/security/threat-model.md` (living document: data flows, trust boundaries, STRIDE per element).',
  ].filter(Boolean);
}
