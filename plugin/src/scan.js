// What is wrong with this project, gathered from the checks that already exist.
//
// Every finding here is derived from something the repository actually says: a generated file that
// no longer matches its source, a criterion no task claims, a suite whose last run was against a
// different commit. Nothing is guessed, and nothing is graded by a model.
//
// What this is NOT: a vulnerability scanner. There is no taint analysis, no dependency CVE lookup
// and no secret detection in here, so the security category is reported as "not scanned" rather
// than as zero findings — an empty list from a scanner that never ran is the most misleading thing
// a security report can show. Wiring real tools (semgrep, gitleaks, npm audit, dotnet list
// package --vulnerable) is separate work; when it lands it adds sources to this file and the page
// does not change.
//
// The severity of a finding is a judgement about evidence, applied consistently:
//
//   critical  the project claims something is finished that nothing supports
//   high      work in flight is unsound, or evidence describes code that no longer exists
//   medium    a real gap that has not caused harm yet
//   low       tidiness, and documents that are behind
//
// A finding carries an `action` only where an allowlisted command genuinely fixes it. Everything
// else carries a command for a person to run, because the fix needs a decision.

import { analyzeFeature } from './analyze.js';
import { findDrift } from './commands/sync.js';
import { docsReport } from './docs/index.js';
import { definedSuites, loadEvidence, repoState, runCountOf } from './evidence.js';
import { checkFeature, listFeatures } from './features.js';
import { traceFeature } from './verify.js';
import { EFFORT_HOURS, FIX_ACTIONS } from './scan-plan.js';

// Re-exported so callers keep one place to ask about a scan, while the page gets the planning
// logic inlined from a module small enough to ship into a <script> tag.
export { EFFORT_HOURS, FIX_ACTIONS, fixPlanFor } from './scan-plan.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// What each open finding costs the health score. One critical is worth four mediums, which is the
// ordering the report is meant to push you towards.
export const WEIGHT = { critical: 18, high: 9, medium: 4, low: 1 };

export const CATEGORIES = {
  security: 'Security',
  evidence: 'Evidence',
  traceability: 'Traceability',
  planning: 'Planning',
  generated: 'Generated files',
  docs: 'Documentation',
};

const finding = (entry) => ({ effort: 'M', file: null, feature: null, action: null, command: null, ...entry });

// --- Sources -------------------------------------------------------------------------------

/** Generated files that no longer match what generated them. `sync` is the whole fix. */
const generatedFindings = (drift) => drift.map((message) => finding({
  severity: 'medium',
  category: 'generated',
  title: message,
  detail: 'A generated file and its source disagree, so the repository describes two different projects.',
  file: message.split(' ')[0],
  effort: 'S',
  action: 'sync',
  command: FIX_ACTIONS.sync.command,
}));

// A feature whose own files contradict its status. `checkFeature` words these precisely already,
// so they are passed through rather than reworded into something vaguer.
const featureFindings = (feature) => checkFeature(feature).map((message) => finding({
  severity: feature.status === 'done' ? 'critical' : 'high',
  category: 'planning',
  title: `${feature.id}: ${message.replace(`${feature.id}: `, '')}`,
  detail: feature.status === 'done'
    ? 'This feature is marked done, and its own files do not support that.'
    : 'The feature has moved past the point where this should have been settled.',
  file: `specs/features/${feature.id}/`,
  feature: feature.id,
}));

const ANALYSIS = {
  empty: { severity: 'high', category: 'planning', effort: 'M', file: 'spec.md', detail: 'Nothing can be traced, tested or signed off against an empty spec.' },
  untasked: { severity: 'medium', category: 'traceability', effort: 'S', file: 'tasks.md', action: 'analyze.fix', detail: 'A criterion no task claims is work nobody has planned.' },
  vague: { severity: 'medium', category: 'planning', effort: 'M', file: 'spec.md', detail: 'A criterion that is still undecided cannot be built or tested as written.' },
  'orphan-task': { severity: 'medium', category: 'traceability', effort: 'S', file: 'tasks.md', detail: 'A task naming no criterion or no files cannot be traced or dispatched.' },
  'parallel-clash': { severity: 'high', category: 'planning', effort: 'S', file: 'tasks.md', detail: 'Two [P] tasks touching the same file will overwrite each other when lanes run.' },
  unplanned: { severity: 'high', category: 'planning', effort: 'M', file: 'plan.md', detail: 'The feature is being built against a plan that was never written.' },
};

const analysisFindings = (feature) => analyzeFeature(feature).problems.map((problem) => {
  const { file, ...rule } = ANALYSIS[problem.kind] ?? { severity: 'medium', category: 'planning', effort: 'M', file: 'spec.md', detail: '' };
  return finding({
    ...rule,
    title: `${feature.id}: ${problem.message}`,
    file: `specs/features/${feature.id}/${file}`,
    feature: feature.id,
    command: rule.action ? FIX_ACTIONS[rule.action].command : null,
  });
});

/**
 * What the tests do and do not prove. Kept as separate findings because the fix for each differs:
 * a criterion no test names, a suite that never ran, a suite that fails or flaps, and a recorded
 * run that describes an older commit are four different problems.
 */
async function evidenceFindings(root, project, feature, head) {
  const found = [];
  const done = feature.status === 'done';
  const trace = await traceFeature(root, feature).catch(() => ({ missing: [] }));

  if (trace.missing.length) {
    found.push(finding({
      severity: done ? 'critical' : 'medium',
      category: 'evidence',
      title: `${feature.id}: ${trace.missing.length} acceptance criteria have no test naming them (${trace.missing.map((number) => `AC-${number}`).join(', ')})`,
      detail: done
        ? 'This feature is marked done, and nothing proves these criteria were ever built.'
        : 'A criterion no test names is unproven, however much code exists for it.',
      file: `specs/features/${feature.id}/tasks.md`,
      feature: feature.id,
      action: 'analyze.fix',
      command: FIX_ACTIONS['analyze.fix'].command,
    }));
  }

  const evidence = await loadEvidence(root, feature.id).catch(() => null);
  const recorded = new Map((evidence?.suites ?? []).map((result) => [result.suite, result]));
  const never = definedSuites(project).filter((suite) => !recorded.has(suite));
  if (never.length && ['in-progress', 'done'].includes(feature.status)) {
    found.push(finding({
      severity: done ? 'critical' : 'medium',
      category: 'evidence',
      title: `${feature.id}: ${never.join(', ')} ${never.length === 1 ? 'has' : 'have'} never been run`,
      detail: 'There is no recorded run for these suites, so nothing is known about them either way.',
      feature: feature.id,
      effort: 'S',
      action: 'verify.run',
      command: `vibecheck verify ${feature.id} --run`,
    }));
  }

  for (const [suite, result] of recorded) {
    const { flaky } = runCountOf(result);
    if (flaky || !result.ok) {
      found.push(finding({
        severity: 'high',
        category: 'evidence',
        title: `${feature.id}: the ${suite} suite is ${flaky ? 'flaky' : 'failing'}`,
        detail: flaky
          ? 'A suite that passes on some runs and not others is not evidence of anything.'
          : 'The last recorded run of this suite failed.',
        feature: feature.id,
        command: `vibecheck verify ${feature.id} --run`,
      }));
    }
  }

  if (evidence?.commit && head && evidence.commit !== head) {
    found.push(finding({
      severity: 'high',
      category: 'evidence',
      title: `${feature.id}: the recorded evidence is from an older commit`,
      detail: 'It describes code that has since changed, so it proves nothing about what is here now.',
      feature: feature.id,
      effort: 'S',
      action: 'verify.run',
      command: `vibecheck verify ${feature.id} --run`,
    }));
  }

  if (evidence?.dirty) {
    found.push(finding({
      severity: 'medium',
      category: 'evidence',
      title: `${feature.id}: the evidence was recorded on a dirty tree`,
      detail: 'Uncommitted changes were present, so nobody can say which code was tested.',
      feature: feature.id,
      effort: 'S',
      command: `vibecheck verify ${feature.id} --run`,
    }));
  }
  return found;
}

const docsFindings = ({ errors, warnings }) => [
  ...errors.map((message) => finding({
    severity: 'medium',
    category: 'docs',
    title: message.replace(/^docs: /, ''),
    detail: 'The document and the code it describes have diverged.',
    file: message.replace(/^docs: /, '').split(' ')[0],
  })),
  ...warnings.map((message) => finding({
    severity: 'low',
    category: 'docs',
    title: message.replace(/^docs: /, ''),
    detail: 'A document is behind, but nothing contradicts the code yet.',
    file: message.replace(/^docs: /, '').split(' ')[0],
    effort: 'S',
  })),
];

// --- The scan ------------------------------------------------------------------------------

const bySeverity = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

/** 100 minus the weight of everything open. Never below zero, and never flattering. */
export const scoreOf = (findings) =>
  Math.max(0, 100 - findings.reduce((total, entry) => total + (WEIGHT[entry.severity] ?? 0), 0));

/**
 * Everything the checks can say about this project right now, as plain JSON. Safe to serialise,
 * diff or publish: it names files and criteria, and quotes no code.
 */
export async function collectScan(root, project) {
  const features = await listFeatures(root).catch(() => []);
  const head = repoState(root)?.commit ?? null;
  const [drift, docs] = await Promise.all([
    findDrift(root, project).catch(() => []),
    docsReport(root, project).catch(() => ({ errors: [], warnings: [] })),
  ]);

  const collected = [
    ...generatedFindings(drift),
    ...features.flatMap(featureFindings),
    ...features.flatMap(analysisFindings),
    ...(await Promise.all(features.map((feature) => evidenceFindings(root, project, feature, head)))).flat(),
    ...docsFindings(docs),
  ];

  const findings = collected.sort(bySeverity).map((entry, index) => ({ ...entry, id: `S-${String(index + 1).padStart(2, '0')}` }));

  return {
    project: { name: project.project.name, generatedAt: new Date().toISOString(), commit: head, features: features.length },
    // Carried in the data, not only in the prose: an absence of security findings here is an
    // absence of scanning, and no surface may let that read as an absence of vulnerabilities.
    scanned: Object.keys(CATEGORIES).filter((category) => category !== 'security'),
    notScanned: [{
      category: 'security',
      why: 'No vulnerability, dependency or secret scanner is wired up. This scan says nothing about them.',
    }],
    score: scoreOf(findings),
    counts: Object.fromEntries(SEVERITIES.map((severity) => [severity, findings.filter((entry) => entry.severity === severity).length])),
    categories: Object.fromEntries(Object.keys(CATEGORIES).map((category) => [category, findings.filter((entry) => entry.category === category).length])),
    findings,
  };
}
