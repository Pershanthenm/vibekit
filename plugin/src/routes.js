import { globToRegExp } from './docs/files.js';
import { filesOfTask } from './lanes.js';

const patternsOf = (route) => route.match.split('|').map((pattern) => globToRegExp(pattern.trim()));

function bestRoute(files, routes) {
  const scored = routes.map((route, order) => {
    const patterns = patternsOf(route);
    return { route, order, hits: files.filter((file) => patterns.some((pattern) => pattern.test(file))).length };
  });
  return scored.filter((entry) => entry.hits > 0).sort((a, b) => b.hits - a.hits || a.order - b.order)[0]?.route ?? null;
}

export function routeLanes(lanes, project) {
  const routes = project.workflow.routes ?? [];
  return lanes.map((lane) => {
    const route = bestRoute(lane.tasks.flatMap(filesOfTask), routes);
    return {
      ...lane,
      engine: route?.engine ?? project.workflow.engine,
      routedBy: route?.match ?? null,
    };
  });
}

export const describeRoute = (lane) => lane.engine;
