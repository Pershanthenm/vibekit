import { findFeature, listFeatures } from '../features.js';
import { parseTasks, planLanes, readyParallelTasks } from '../lanes.js';
import { createManifestWriter, loadManifest } from '../manifest.js';
import { refreshMulticaLanes } from '../multica-lanes.js';
import { describeRoute, routeLanes } from '../routes.js';
import { loadProject } from '../project.js';

export async function lanes({ root, args }) {
  const project = await loadProject(root);
  const feature = findFeature(await listFeatures(root), args[0] ?? '');
  const manifest = await loadManifest(root, feature.id);
  if (manifest) {
    if (manifest.engine === 'multica') await createManifestWriter(root)(await refreshMulticaLanes(manifest));
    console.log(`Dispatched lanes for ${feature.id}:`);
    manifest.lanes.forEach((lane) => console.log(`  ${lane.name}  ${lane.state.padEnd(8)}  ${lane.tasks.join(', ')}  (${lane.engine === 'multica' ? `Multica ${lane.issue} · ${lane.agent} · ${lane.boardStatus}` : `${lane.engine ?? 'agent'} · ${lane.commits ?? 0} commits · log: ${lane.logPath}`})`));
    return;
  }
  const planned = planLanes(readyParallelTasks(parseTasks(feature.tasks)), project.workflow.maxLanes);
  if (!planned.length) {
    console.log(`${feature.id}: no ready [P] tasks — the next open task is sequential.`);
    return;
  }
  console.log(`${feature.id}: ${planned.length} lane(s) ready (default engine: ${project.workflow.engine})`);
  routeLanes(planned, project).forEach((lane) => console.log(`  ${lane.name} → ${describeRoute(lane, project.workflow.engine)}${lane.routedBy ? ` (route ${lane.routedBy})` : ''}: ${lane.tasks.map((task) => task.text).join(' | ')}`));
}
