const TASK_LINE = /^- \[( |x)\] (T-\d+)(.*)$/gim;

export function parseTasks(text) {
  return [...text.matchAll(TASK_LINE)].map(([, mark, id, rest]) => ({
    id,
    done: mark.toLowerCase() === 'x',
    parallel: /\[P\]/.test(rest),
    text: `${id}${rest}`.trim(),
  }));
}

export const filesOfTask = (task) => (task.text.match(/—\s*([^[]+)/)?.[1] ?? '').split(/[,\s]+/).filter((token) => /[./]/.test(token) && !/^AC-\d+/.test(token));

export function readyParallelTasks(tasks) {
  const open = tasks.filter((task) => !task.done);
  const firstSequential = open.findIndex((task) => !task.parallel);
  return firstSequential === -1 ? open : open.slice(0, firstSequential);
}

export function planLanes(tasks, maxLanes) {
  const count = Math.min(maxLanes, tasks.length);
  const lanes = Array.from({ length: count }, (_, index) => ({ name: `lane-${index + 1}`, tasks: [] }));
  tasks.forEach((task, index) => lanes[index % count].tasks.push(task));
  return lanes;
}
