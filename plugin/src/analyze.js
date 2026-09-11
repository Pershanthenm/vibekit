import { progress } from './features.js';

const CRITERION = /^- \[[ x]\] AC-(\d+):\s*(.*)$/gim;
const TASK = /^- \[[ x]\] (T-\d+)\s*\[(test|impl|docs)\]\s*(.*)$/gim;
const TASK_CRITERIA = /\(AC-([\d,\s-]+)\)/i;
const TASK_FILES = /—\s*(.+?)\s*(?:\[P\])?$/;
// Words that mean the spec has not decided yet. TODO(unknown) is the form the evidence
// rules ask agents to write, so it is the one most worth surfacing.
const VAGUE = /\bTODO\b|\bTBD\b|\bFIXME\b|\?\?\?|\bsomehow\b|\betc\.?\s*$/im;

export const PROBLEM_KINDS = ['untasked', 'orphan-task', 'unplanned', 'vague', 'parallel-clash', 'empty'];

const criteriaIn = (spec) => [...spec.matchAll(CRITERION)].map(([, number, text]) => ({ number: Number(number), text: text.trim() }));

function tasksIn(tasks) {
  return [...tasks.matchAll(TASK)].map(([line, id, kind, rest]) => ({
    id,
    kind,
    parallel: /\[P\]/.test(rest),
    criteria: (rest.match(TASK_CRITERIA)?.[1] ?? '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
    files: (rest.match(TASK_FILES)?.[1] ?? '')
      .replace(/\[P\]\s*$/, '')
      .split(/[,\s]+/)
      .map((file) => file.trim())
      .filter(Boolean),
    line: line.trim(),
  }));
}

const overlap = (a, b) => a.files.some((file) => b.files.includes(file));

/**
 * Checks a feature's artefacts against each other, which neither `check` nor `verify` does:
 * `check` validates the schema and detects drift, `verify` traces criteria to tests. This
 * answers whether the spec, plan and tasks actually agree.
 */
export function analyzeFeature(feature) {
  const criteria = criteriaIn(feature.spec);
  const tasks = tasksIn(feature.tasks ?? '');
  const problems = [];
  const add = (kind, message) => problems.push({ kind, feature: feature.id, message });

  if (!criteria.length) add('empty', 'no acceptance criteria: nothing can be traced, tested or signed off');
  if (criteria.length && !tasks.length) add('empty', `${criteria.length} acceptance criteria but no tasks: nothing plans how they get built`);

  const claimed = new Set(tasks.flatMap((task) => task.criteria));
  for (const criterion of criteria) {
    if (!claimed.has(criterion.number)) add('untasked', `AC-${criterion.number} has no task: "${criterion.text.slice(0, 60)}"`);
    if (VAGUE.test(criterion.text)) add('vague', `AC-${criterion.number} is not decided yet: "${criterion.text.slice(0, 60)}"`);
  }

  const numbers = new Set(criteria.map((criterion) => criterion.number));
  for (const task of tasks) {
    if (!task.criteria.length) add('orphan-task', `${task.id} names no acceptance criterion: ${task.line.slice(0, 70)}`);
    for (const criterion of task.criteria) {
      if (!numbers.has(criterion)) add('orphan-task', `${task.id} points at AC-${criterion}, which the spec does not define`);
    }
    if (!task.files.length) add('orphan-task', `${task.id} names no files, so lanes cannot tell whether it overlaps another task`);
  }

  // [P] promises a task shares no files with any other open task; a clash silently corrupts lanes.
  const parallel = tasks.filter((task) => task.parallel);
  for (let i = 0; i < parallel.length; i += 1) {
    for (let j = i + 1; j < parallel.length; j += 1) {
      if (overlap(parallel[i], parallel[j])) {
        add('parallel-clash', `${parallel[i].id} and ${parallel[j].id} are both [P] but share ${parallel[i].files.filter((file) => parallel[j].files.includes(file)).join(', ')}`);
      }
    }
  }

  const plan = feature.plan ?? '';
  if (['planned', 'in-progress', 'done'].includes(feature.status) && (!plan.trim() || VAGUE.test(plan))) {
    add('unplanned', `status is ${feature.status} but plan.md is empty or still has TODOs`);
  }

  return {
    feature: feature.id,
    status: feature.status,
    criteria: criteria.length,
    tasks: tasks.length,
    covered: criteria.filter((criterion) => claimed.has(criterion.number)).length,
    taskProgress: progress(feature.tasks ?? '', 'T'),
    problems,
  };
}
