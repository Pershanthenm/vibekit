import { findFeature, listFeatures } from '../features.js';
import { createAsker } from '../menu.js';
import { loadProject } from '../project.js';
import { applySecurity, publishSecurity, readSecurityAnswers, requirementsOrEmpty } from '../security/apply.js';
import { findControl, implementationFor, stackFamily } from '../security/controls.js';
import { securityRounds } from '../security/questions.js';
import { traceFeature } from '../verify.js';
import { sync } from './sync.js';

const USAGE = 'Usage: vibekit security [questions [--json] | apply [--from <answers.json>] | status]';

async function finish(root, raw, force) {
  const { project, criteria, workflowCreated, saved } = await applySecurity(root, raw);
  await sync({ root, force });
  const published = await publishSecurity(root, project);
  const { controls, acceptedRisks } = project.security;
  console.log(`✔ Security baseline: ${controls.length} controls → specs/project.json, specs/security.md, AGENTS.md`);
  console.log(`✔ ${criteria.added} acceptance criteria added to ${criteria.featureId} (each needs a passing test before done)`);
  if (workflowCreated) console.log('✔ CI security workflow created: .github/workflows/security.yml');
  if (saved || published) console.log(`✔ Saved to ${[saved && 'agentmemory', published && 'OpenContext'].filter(Boolean).join(' and ')}`);
  acceptedRisks.forEach((risk) => console.log(`! Accepted risk: ${findControl(risk.id).title} — ${risk.reason}`));
}

export async function interactiveSecurity(root, { asker, force }) {
  const raw = {};
  for (const round of securityRounds(await requirementsOrEmpty(root))) {
    console.log(`\n── ${round.title} ──`);
    for (const question of round.questions) raw[question.id] = await asker.choose(question);
  }
  await finish(root, raw, force);
}

async function questions(root, { json }) {
  const rounds = securityRounds(await requirementsOrEmpty(root));
  if (json) return console.log(JSON.stringify({ rounds }, null, 2));
  rounds.forEach((round) => {
    console.log(`\n${round.title}`);
    round.questions.forEach((question) => console.log(`  ${question.id}${question.multi ? ' (multi)' : ''}: ${question.options.map((option) => `${option.id}${question.defaults.includes(option.id) ? '*' : ''}`).join(' | ')}`));
  });
  console.log('\n* = secure default');
}

async function status(root) {
  const project = await loadProject(root);
  const family = stackFamily(project);
  if (!project.security.controls.length) return console.log('No security baseline yet. Run: vibekit security');
  project.security.controls.map(findControl).forEach((item) => console.log(`✔ ${item.title} — ${implementationFor(item, family)}`));
  project.security.acceptedRisks.forEach((risk) => console.log(`! Accepted risk: ${findControl(risk.id).title}`));
  const features = await listFeatures(root);
  const target = features.find((feature) => feature.spec.includes('(security: '));
  if (!target) return;
  const trace = await traceFeature(root, findFeature(features, target.id));
  console.log(`\n${target.id}: ${trace.covered.length} of ${trace.covered.length + trace.missing.length} criteria traced to tests (vibekit verify ${target.id.slice(0, 3)})`);
}

async function withAsker(work) {
  const asker = createAsker();
  try {
    return await work(asker);
  } finally {
    asker.close();
  }
}

const ACTIONS = {
  questions,
  apply: async (root, { from, force }) => finish(root, await readSecurityAnswers(root, from), force),
  status,
};

export async function security(options) {
  const [action] = options.args;
  if (!action) return withAsker((asker) => interactiveSecurity(options.root, { asker, force: options.force }));
  const run = ACTIONS[action];
  if (!run) throw new Error(USAGE);
  await run(options.root, options);
}
