import { findFeature, listFeatures } from '../features.js';
import { assertCleanTree, git } from '../git.js';
import { recordMerge } from '../journal.js';
import { branchExists, fetchLaneBranch, markLaneMerged, refreshMulticaLanes } from '../multica-lanes.js';
import { createManifestWriter, deleteManifest, loadManifest } from '../manifest.js';
import { loadProject } from '../project.js';

const DONE_STATES = ['finished', 'failed'];
const count = (root, range) => Number(git(root, 'rev-list', '--count', range));

function removeLane(root, lane, { force = false } = {}) {
  if (lane.path) git(root, 'worktree', 'remove', ...(force ? ['--force'] : []), lane.path);
  git(root, 'branch', force ? '-D' : '-d', lane.branch);
}


function mergeLane(root, manifest, lane) {
  if (lane.state === 'running') return 'running';
  if (lane.engine === 'multica' && !fetchLaneBranch(root, manifest, lane)) {
    if (!DONE_STATES.includes(lane.state)) return 'waiting';
    if (branchExists(root, lane.branch)) git(root, 'branch', '-D', lane.branch);
    return 'empty';
  }
  if (lane.path && git(lane.path, 'status', '--porcelain')) return 'uncommitted';
  if (count(root, `${manifest.baseCommit}..${lane.branch}`) === 0) {
    if (!DONE_STATES.includes(lane.state)) return 'waiting';
    removeLane(root, lane, { force: true });
    return 'empty';
  }
  if (count(root, `HEAD..${lane.branch}`) > 0) {
    try {
      git(root, 'merge', '--no-ff', '-m', `merge(${manifest.feature}): ${lane.name} (${lane.tasks.join(', ')})`, lane.branch);
    } catch {
      return 'conflict';
    }
  }
  removeLane(root, lane);
  return 'merged';
}

const MESSAGES = {
  merged: (lane) => `✔ ${lane.name} merged — verify, then tick ${lane.tasks.join(', ')}${lane.engine === 'multica' ? ` (Multica ${lane.issue} stays in review until verify passes)` : ''}`,
  empty: (lane) => `· ${lane.name} produced no commits — ${lane.tasks.join(', ')} stay open (log: ${lane.logPath})`,
  running: (lane) => `… ${lane.name} is still running${lane.issue ? ` (Multica ${lane.issue}: ${lane.boardStatus})` : ''}`,
  waiting: (lane) => `… ${lane.name} has no commits yet (${lane.path})`,
  uncommitted: (lane) => `✖ ${lane.name} has uncommitted changes — commit them in ${lane.path} and re-run`,
  conflict: (lane) => `✖ ${lane.name} conflicts — resolve, commit, then re-run "vibecheck merge"`,
};
const FINAL = ['merged', 'empty'];

export async function merge({ root, args }) {
  const feature = findFeature(await listFeatures(root), args[0] ?? '');
  const loaded = await loadManifest(root, feature.id);
  if (!loaded) throw new Error(`No dispatched lanes for ${feature.id}.`);
  assertCleanTree(root, 'merging needs a clean working tree');
  const manifest = loaded.engine === 'multica' ? await refreshMulticaLanes(loaded) : loaded;
  const target = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');

  const remaining = [];
  const outcomes = [];
  let blocked = false;
  for (const lane of manifest.lanes) {
    const outcome = blocked ? 'waiting' : mergeLane(root, manifest, lane);
    blocked ||= outcome === 'conflict';
    console.log(MESSAGES[outcome](lane));
    if (outcome === 'merged' && lane.engine === 'multica') await markLaneMerged(root, feature.id, lane, target).catch(() => console.log(`  ! could not comment on Multica ${lane.issue}`));
    outcomes.push({ lane, outcome });
    if (!FINAL.includes(outcome)) remaining.push(lane);
  }
  const worthRemembering = outcomes.filter(({ outcome }) => ['merged', 'empty', 'conflict'].includes(outcome));
  await recordMerge(await loadProject(root), feature.id, worthRemembering);

  if (!remaining.length) {
    await deleteManifest(root, feature.id);
    console.log(`\nAll lanes integrated. Run lint, typecheck and tests, then tick the tasks in specs/features/${feature.id}/tasks.md.`);
    return;
  }
  await createManifestWriter(root)({ ...manifest, lanes: remaining });
  process.exitCode = 1;
}
