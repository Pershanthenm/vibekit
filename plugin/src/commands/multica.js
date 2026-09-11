import { listFeatures } from '../features.js';
import { assertCleanTree, git } from '../git.js';
import { upsertFeatureIssue } from '../multica-board.js';
import { pullDone } from '../multica-done.js';
import { FAILED, FINISHED, branchExists, delivery, fetchLaneBranch, laneSource } from '../multica-lanes.js';
import { commentOn, createIssue, ensureProject, issueStatus, multicaHealth, multicaInstalled, setIssueStatus, setMetadata } from '../multica.js';
import { loadProject } from '../project.js';

const USAGE = 'Usage: vibecheck multica <status | sync | pull | selftest [--timeout <seconds>]>';
const DEFAULT_TIMEOUT_S = 600;
const pollMs = () => Number(process.env.VIBECHECK_POLL_MS) || 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function selftestBrief(project, root, url, branch) {
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  return `Automated vibecheck self-test. Change nothing else.

1. Create a file named .vibecheck-selftest containing the text "ok".
2. Commit it with the message "chore: vibecheck self-test".
${delivery({ url, remote: project.multica.remote, baseCommit, branch })}`;
}

async function waitForAgent(root, project, issue, branch, deadline) {
  while (Date.now() < deadline) {
    const status = await issueStatus(issue);
    if (FAILED.includes(status)) return { ok: false, reason: `the agent moved the issue to ${status}` };
    if (FINISHED.includes(status) && fetchLaneBranch(root, { remote: project.multica.remote }, { branch })) return { ok: true };
    await sleep(pollMs());
  }
  return { ok: false, reason: 'timed out waiting for the agent (is it assigned to this machine\'s runtime? check the issue on the board)' };
}

async function selftest(project, root, { timeout }) {
  if (!project.multica.agent) throw new Error('Set multica.agent in specs/project.json first (see: multica agent list).');
  assertCleanTree(root, 'the self-test starts from your last commit');
  const url = await laneSource(root, project.multica.remote);
  const branch = `vc/selftest-${Date.now()}`;
  const seconds = Number(timeout) || DEFAULT_TIMEOUT_S;
  const started = Date.now();
  const issue = await createIssue({ title: 'vibecheck self-test', description: selftestBrief(project, root, url, branch), assignee: project.multica.agent, project: await ensureProject(project), status: 'todo' });
  await setMetadata(issue, { vibecheck_project: project.project.name, vibecheck_selftest: branch });
  console.log(`▶ ${issue} assigned to ${project.multica.agent}; waiting up to ${seconds}s for it to push ${branch}…`);
  const result = await waitForAgent(root, project, issue, branch, started + seconds * 1000);
  if (branchExists(root, branch)) git(root, 'branch', '-D', branch);
  await setIssueStatus(issue, result.ok ? 'done' : 'cancelled').catch(() => {});
  await commentOn(issue, result.ok ? 'vibecheck self-test passed; test branch removed.' : `vibecheck self-test failed: ${result.reason}`).catch(() => {});
  const took = Math.round((Date.now() - started) / 1000);
  console.log(result.ok ? `✔ Multica works on this machine: an agent picked up ${issue}, pushed a branch and moved it to review in ${took}s.` : `✖ Self-test failed after ${took}s: ${result.reason}`);
  if (!result.ok) process.exitCode = 1;
}

async function status(project) {
  const checks = await multicaHealth(project);
  checks.forEach(({ ok, warn, detail }) => console.log(`${warn ? '!' : ok ? '✔' : '✖'} ${detail}`));
  console.log(`  engine: ${project.workflow.engine} · board mirror: ${project.multica.board ? 'on' : 'off'} · lanes: ${project.multica.remote === 'local' ? 'local (agents clone this folder, no git host needed)' : `via git remote "${project.multica.remote}"`}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

async function sync(project, root) {
  if (!multicaInstalled()) throw new Error('multica CLI not found. Install it, run "multica setup", then retry.');
  for (const feature of await listFeatures(root)) {
    console.log(`✔ ${feature.id} [${feature.status}] → Multica ${await upsertFeatureIssue(project, feature)}`);
  }
}

async function pull(project, root) {
  if (!multicaInstalled()) throw new Error('multica CLI not found. Install it, run "multica setup", then retry.');
  const results = await pullDone(root, project);
  if (!results.length) console.log('Nothing new marked done on the board.');
  results.forEach((result) => console.log(result.done ? `✔ ${result.feature}: marked done on Multica (${result.issue}) → recorded as done` : `✖ ${result.feature}: moved back to In review — ${result.problems.join('; ')}`));
}

const ACTIONS = { status, sync, pull, selftest };

export async function multica({ root, args, timeout }) {
  const run = ACTIONS[args[0]];
  if (!run) throw new Error(USAGE);
  await run(await loadProject(root), root, { timeout });
}
