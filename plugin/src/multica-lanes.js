import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { stateDir } from './evidence.js';
import { readText, writeText } from './fsutil.js';
import { git } from './git.js';
import { mirrorFeature } from './multica-board.js';
import { commentOn, createIssue, daemonRunning, ensureProject, issueStatus, setIssueStatus, setMetadata } from './multica.js';

export const isLocal = (remote) => remote === 'local';

export function branchExists(root, branch) {
  try {
    git(root, 'rev-parse', '--verify', '--quiet', branch);
    return true;
  } catch {
    return false;
  }
}

export const FINISHED = ['in_review', 'done'];
export const FAILED = ['blocked', 'cancelled'];

function remoteUrl(root, remote) {
  try {
    return git(root, 'remote', 'get-url', remote);
  } catch {
    throw new Error(`Multica agents work from your git remote, but "${remote}" is not configured. Add one (git remote add ${remote} <url>) or set multica.remote.`);
  }
}

function assertPushed(root, remote, commit) {
  const containing = git(root, 'branch', '-r', '--contains', commit).split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${remote}/`));
  if (!containing.length) throw new Error(`Commit ${commit.slice(0, 8)} is not on ${remote} yet, so Multica agents can't start from it. Push first: git push ${remote} HEAD`);
}

const REVIEW = '- When pushed and verified, move this issue to **in_review** and comment the branch name. If blocked, move it to **blocked** and explain why.';

export const delivery = ({ url, remote, baseCommit, branch }) => (isLocal(remote) ? `
## Delivery (Multica, on this machine)
- The project lives on this machine at: ${url}
- \`git clone "${url}" lane && cd lane\`, then \`git checkout -b ${branch} ${baseCommit}\`.
- Commit with the task ids in the messages, then push the branch back into the project folder: \`git push origin ${branch}\`.
${REVIEW}
` : `
## Delivery (Multica)
- Repository: ${url}
- Start from commit ${baseCommit} and create branch \`${branch}\`.
- Commit with the task ids in the messages, then push: \`git push ${remote} ${branch}\`.
${REVIEW}
`);

export async function laneSource(root, remote) {
  if (!isLocal(remote)) {
    const url = remoteUrl(root, remote);
    assertPushed(root, remote, git(root, 'rev-parse', 'HEAD'));
    return url;
  }
  if (!(await daemonRunning())) throw new Error('Local Multica lanes run on this machine, but the Multica daemon is not running. Start it: multica daemon start (or run: vibecheck setup --only docker,multica)');
  return root;
}

export async function dispatchToMultica({ root, project, feature, lanes, briefFor }) {
  const { remote } = project.multica;
  const unassigned = lanes.filter((lane) => !(lane.agent ?? project.multica.agent));
  if (unassigned.length) throw new Error('Set multica.agent in specs/project.json to the Multica agent that should work on lanes, or route lanes to agents with workflow.routes (see: multica agent list).');
  const url = await laneSource(root, remote);
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  const projectId = await ensureProject(project);
  const parent = await mirrorFeature(project, feature);
  const dispatched = [];
  for (const lane of lanes) {
    const branch = `vc/${feature.id}/${lane.name}`;
    const description = `${briefFor(lane)}${delivery({ url, remote, baseCommit, branch })}`;
    const assignee = lane.agent ?? project.multica.agent;
    const issue = await createIssue({ title: `${feature.id} ${lane.name}: ${lane.tasks.map((task) => task.id).join(', ')}`, description, assignee, project: projectId, parent, status: 'todo' });
    await setMetadata(issue, { vibecheck_project: project.project.name, vibecheck_feature: feature.id, vibecheck_lane: lane.name, vibecheck_branch: branch });
    dispatched.push({ name: lane.name, branch, tasks: lane.tasks.map((task) => task.id), engine: 'multica', agent: assignee, issue, state: 'running' });
  }
  return { feature: feature.id, baseCommit, engine: 'multica', remote, lanes: dispatched };
}

const stateFor = (status) => (FINISHED.includes(status) ? 'finished' : FAILED.includes(status) ? 'failed' : 'running');

export async function refreshMulticaLanes(manifest) {
  for (const lane of manifest.lanes.filter((entry) => entry.engine === 'multica')) {
    lane.boardStatus = await issueStatus(lane.issue);
    lane.state = stateFor(lane.boardStatus);
  }
  return manifest;
}

export function fetchLaneBranch(root, manifest, lane) {
  if (isLocal(manifest.remote)) return branchExists(root, lane.branch);
  try {
    git(root, 'fetch', manifest.remote, `+${lane.branch}:${lane.branch}`);
    return true;
  } catch {
    return false;
  }
}

const mergedPath = (root, featureId) => join(stateDir(root, 'merged-lanes'), `${featureId}.json`);

async function mergedLanes(root, featureId) {
  try {
    return JSON.parse((await readText(mergedPath(root, featureId))) ?? '[]');
  } catch {
    return [];
  }
}

export async function markLaneMerged(root, featureId, lane, target) {
  await commentOn(lane.issue, `Merged ${lane.branch} into ${target}. It moves to Done once tests, smoke and UI pass on the merged code (vibecheck verify --run).`);
  await writeText(mergedPath(root, featureId), JSON.stringify([...(await mergedLanes(root, featureId)), { issue: lane.issue, tasks: lane.tasks }]));
}

export async function closeVerifiedLanes(root, project, feature, commit, results) {
  const lanes = await mergedLanes(root, feature.id);
  const summary = results.map((result) => `${result.ok ? '✅' : '❌'} ${result.suite}`).join(' · ');
  for (const lane of lanes) {
    await setIssueStatus(lane.issue, 'done');
    await commentOn(lane.issue, `Verified at ${commit.slice(0, 8)}: ${summary}. Done.`);
  }
  await rm(mergedPath(root, feature.id), { force: true });
  return lanes.length;
}
