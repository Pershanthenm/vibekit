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
    untasked: criteria.filter((criterion) => !claimed.has(criterion.number)).map((criterion) => criterion.number),
    taskProgress: progress(feature.tasks ?? '', 'T'),
    problems,
  };
}

const TASK_NUMBER = /^- \[[ x]\] T-(\d+)\b/gim;

const nextTaskNumber = (tasks) => Math.max(0, ...[...tasks.matchAll(TASK_NUMBER)].map(([, number]) => Number(number))) + 1;

/**
 * Turns the two gaps that describe *missing work* into tasks. The other problem kinds are
 * disagreements between artefacts — an orphan task, a lane clash, a criterion nobody has decided,
 * an empty plan — and appending a task to one of those papers over a decision a person has to make.
 *
 * The appended lines name no files, because nothing here knows which files they touch. That is the
 * next real decision, and analyze reports it as `orphan-task` until someone makes it — the same
 * shape a scaffolded tasks.md starts in.
 */
export function tasksForGaps(feature, { untasked = [], untested = [] } = {}) {
  const criteria = new Map(criteriaIn(feature.spec).map((criterion) => [criterion.number, criterion.text]));
  const untaskedSet = new Set(untasked);
  // A [test] task does not make a criterion traced — only a test file naming it does — so an
  // untested criterion stays untested after the task is written. Appending again every run would
  // grow tasks.md without end; the task already planned is the work, and it is only planned once.
  const testTasked = new Set(tasksIn(feature.tasks ?? '').filter((task) => task.kind === 'test').flatMap((task) => task.criteria));
  const describe = (number) => `AC-${number}: ${criteria.get(number) ?? ''}`.trim();
  let number = nextTaskNumber(feature.tasks ?? '');
  const line = (kind, text) => `- [ ] T-${number++} [${kind}] ${text}`;
  return [
    ...untasked.flatMap((criterion) => [
      line('test', `Test ${describe(criterion)} (AC-${criterion})`),
      line('impl', `Build ${describe(criterion)} (AC-${criterion})`),
    ]),
    // A criterion that has a task but no test needs only the test; adding an impl task would
    // duplicate work that tasks.md already plans.
    ...untested.filter((criterion) => !untaskedSet.has(criterion) && !testTasked.has(criterion)).map((criterion) => line('test', `Test ${describe(criterion)} (AC-${criterion})`)),
  ];
}

export function appendTasks(tasks, lines) {
  if (!lines.length) return tasks;
  const body = (tasks ?? '').replace(/\s*$/, '');
  return `${body}\n${lines.join('\n')}\n`;
}
