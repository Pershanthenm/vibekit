import { join } from 'node:path';
import { converge as runConverge } from '../folder/converge.js';
import { runChecks } from '../folder/checks.js';
import { holdAgeHours, listRequirements, readTasksState } from '../folder/requirements.js';
import { closeSprint, gerund, sprintBoard, sprintGate, stepWords } from '../folder/sprints.js';
import { approvalOf, currentStage, gateState, nextAction } from '../folder/workflow.js';
import { readText } from '../fsutil.js';
import { folderName, next as nextCommand, req } from './folder.js';
import { plan as planCost } from './report.js';

/**
 * `vibekit sprint`. Specification §67.
 *
 *   sprint plan      turn the spec into sprints, in dependency order — a human approves
 *   sprint start     work the current sprint one piece at a time, watching
 *   sprint run       work the current sprint with several agents at once
 *   sprint status    this sprint: progress, lanes, what is blocked
 *   sprint close     close the sprint at its gate
 *
 * `run` and `start` always mean the current sprint. There is no orchestrator agent making these
 * decisions: the plan says what is next, the rules below say who does it and how many at once,
 * and both are readable.
 */

const usage = () => [
  'Usage',
  '  vibekit sprint plan [--cost]          the sprints as plan.md has them, in dependency order; a human approves',
  '  vibekit sprint start                  the next piece of work, watching: prints the prompt to run',
  '  vibekit sprint run [--lanes 2] [--until blocked|gate] [--headless]',
  '                                        hand out up to N pieces of independent work at once',
  '  vibekit sprint status [--json]        this sprint: progress, lanes, what is blocked',
  '  vibekit sprint close [N] --by "<name>" [--no-tag]   the gate: everything done, checks green, then a person closes it',
].join('\n');

export async function sprint(options) {
  const { root, args, folder: chosen, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [verb, ...rest] = args;

  if (verb === 'plan') return plan(root, folder, options);
  if (verb === 'start') return start(root, folder, options);
  if (verb === 'run') return run(root, folder, options);
  if (verb === 'status') return status(root, folder, options);
  if (verb === 'close') return close(root, folder, rest, options);
  if (verb) throw new Error(`"${verb}" is not something a sprint does.\n${usage()}`);
  console.log(usage());
  if (!json) {
    const board = await sprintBoard(root, folder).catch(() => null);
    if (board?.current) console.log(`\n  Current: sprint ${board.current.n} — ${board.current.title} · ${board.current.done} of ${board.current.total} done`);
  }
}

// ---------------------------------------------------------------- plan

async function plan(root, folder, options) {
  if (options.cost) return planCost({ ...options, cost: true });
  const board = await sprintBoard(root, folder);
  const planText = await readText(join(root, folder, 'workflow/plan.md'));
  const approved = approvalOf(planText);

  if (options.json) return void console.log(JSON.stringify({ approved, sprints: board.sprints.map(({ items, ...row }) => ({ ...row, items: items.map((item) => ({ id: item.id, title: item.title, status: item.status })) })), deferred: board.deferred, unplanned: board.unplanned.map((entry) => entry.id) }, null, 2));

  if (!board.sprints.length) {
    console.log(`No sprints in ${folder}/workflow/plan.md yet.`);
    console.log('  The planner (stage 4) writes them: small pieces in dependency order, a working skeleton first.');
    console.log('  Run the stage prompt from `vibekit sprint run`, then approve the order in plan.md.');
    return;
  }
  const width = Math.max(...board.sprints.map((row) => `Sprint ${row.n} — ${row.title}`.length), 20);
  for (const row of board.sprints) {
    const label = `Sprint ${row.n} — ${row.title}`.padEnd(width);
    const summary = row.total ? `${row.items.slice(0, 4).map((item) => gerund(item.title).toLowerCase()).join(', ')}${row.items.length > 4 ? ', …' : ''}` : row.lines.slice(0, 2).join(' · ');
    console.log(`  ${label}  ${summary.slice(0, 60).padEnd(60)} ${row.total ? `${row.total} item${row.total === 1 ? '' : 's'}` : ''}${row.closed ? '  closed' : row.complete ? '  done' : ''}`);
  }
  if (board.deferred.length) console.log(`  ${'Deferred'.padEnd(width)}  ${board.deferred.join(', ')}`);
  if (board.unplanned.length) console.log(`  ${'Unplanned'.padEnd(width)}  ${board.unplanned.map((entry) => entry.id).join(', ')} — real work the plan does not place`);
  console.log('');
  console.log(approved ? `  Approved by ${approved.by}${approved.date ? ` on ${approved.date}` : ''}.` : `  Not approved. A human writes \`approved: <date> by <name>\` in ${folder}/workflow/plan.md; editing the order first is expected.`);
  console.log('  vibekit sprint plan --cost   the token forecast per sprint, before approving it');
}

// ---------------------------------------------------------------- start

/** One piece at a time, watching: the same gate reader as before, with the sprint in view. */
async function start(root, folder, options) {
  const board = await sprintBoard(root, folder).catch(() => null);
  if (board?.current && !options.json) console.log(`sprint ${board.current.n} — ${board.current.title} · ${board.current.done} of ${board.current.total} done`);
  return nextCommand({ ...options, folder });
}

// ---------------------------------------------------------------- run

/**
 * How work is handed out (§67): only what the plan says is ready; never two agents on the same
 * entity; a ceiling on lanes. It hands out; it does not run a model here — the runner that takes
 * a lane is the person's seat or `vibekit serve`, and the prompt it prints is what they run.
 */
export async function lanesFor(root, folder, { lanes = 2 } = {}) {
  const [board, requirements, tasks] = await Promise.all([sprintBoard(root, folder), listRequirements(root, folder), readTasksState(root, folder)]);
  const scope = board.current ? new Set(board.current.ids) : null;
  const byId = new Map(requirements.map((entry) => [entry.id, entry]));
  const heldEntities = new Set(Object.keys(tasks.held).flatMap((id) => byId.get(id)?.entities ?? []));
  const chosen = [];
  const taken = new Set(heldEntities);

  for (const entry of requirements) {
    if (chosen.length + Object.keys(tasks.held).length >= lanes) break;
    if (entry.status !== 'ready') continue;
    if (scope && !scope.has(entry.id) && entry.kind !== 'bug') continue;
    if (!entry.after.every((id) => byId.get(id)?.status === 'done')) continue;
    // Never two agents on the same entity: two ready items that share one are sequenced.
    if (entry.entities.some((name) => taken.has(name))) continue;
    chosen.push(entry);
    for (const name of entry.entities) taken.add(name);
  }
  return { board, lanes: chosen, held: tasks.held, ceiling: lanes };
}

async function run(root, folder, options) {
  const lanes = Number.parseInt(options.lanes ?? '2', 10) || 2;
  const stage = await currentStage(root, folder);
  const gates = await gateState(root, folder);
  const headless = Boolean(options.headless);

  // Before build, `run` is the gate reader: nothing to hand out until the plan is approved.
  if (stage.n < 5) {
    const action = await nextAction(root, folder);
    if (options.json || headless) return void console.log(JSON.stringify({ stage: stage.n, name: stage.name, gate: gates[stage.n], action }, null, 2));
    console.log(`stage ${stage.n} · ${stage.name} — nothing to hand out until the plan is approved.`);
    if (action) console.log(`  ${action.forHuman ? 'Waiting on you' : 'Next'}: ${action.detail}\n  ${action.command}${action.prompt ? `\n  prompt: ${action.prompt}` : ''}`);
    if (options.until === 'blocked' && action?.forHuman) process.exitCode = 1;
    return;
  }

  const { board, lanes: chosen, held } = await lanesFor(root, folder, { lanes });
  const requirements = await listRequirements(root, folder);
  const blocked = requirements.filter((entry) => entry.status === 'blocked');
  const startable = [];
  for (const entry of chosen) {
    // `vibekit start` does the holding, the branch and the log, so a lane handed out here and a
    // lane a person starts by hand are the same thing.
    await req({ ...options, args: ['start', entry.id], as: 'implementer', runner: options.runner ?? 'cli', folder, json: false, quiet: true }).catch((error) => {
      startable.push({ id: entry.id, refused: error.message });
    });
    if (!startable.some((row) => row.id === entry.id)) startable.push({ id: entry.id, started: true, prompt: `${folder}/workflow/stages/5-build.md` });
  }
  const now = await readTasksState(root, folder);
  const view = {
    sprint: board.current ? { n: board.current.n, title: board.current.title, done: board.current.done, total: board.current.total } : null,
    lanes: Object.entries(now.held).map(([id, holder]) => {
      const entry = requirements.find((item) => item.id === id) ?? { title: id, status: 'in-progress' };
      return { id, title: gerund(entry.title), runner: holder.runner, role: holder.role, minutes: Math.round(holdAgeHours(holder) * 60), step: stepWords(entry, holder) };
    }),
    started: startable,
    blocked: blocked.map((entry) => ({ id: entry.id, title: gerund(entry.title), why: 'waiting on your answer' })),
    next: requirements.filter((entry) => entry.status === 'ready' && !now.held[entry.id] && (!board.current || board.current.ids.includes(entry.id))).map((entry) => ({ id: entry.id, title: gerund(entry.title) })),
    ceiling: lanes,
  };

  if (options.json || headless) {
    console.log(JSON.stringify(view, null, 2));
    if (headless && (view.blocked.length && !view.lanes.length)) process.exitCode = 1;
    return;
  }

  console.log(view.sprint ? `Sprint ${view.sprint.n} — ${view.sprint.title} · ${view.sprint.done} of ${view.sprint.total} done` : 'Build · no sprint in plan.md');
  console.log('');
  for (const lane of view.lanes) console.log(`  ▶ ${lane.title.padEnd(44)} ${lane.runner} · ${lane.minutes} min\n    ${lane.step}`);
  for (const item of view.blocked) console.log(`  ⏸ ${item.title}\n    ${item.why}`);
  for (const item of view.next) console.log(`  ○ ${item.title.padEnd(44)} next`);
  if (!view.lanes.length && !view.next.length && !view.blocked.length) console.log('  Nothing ready. `vibekit sprint status` says why.');
  console.log('');
  const seats = view.lanes.filter((lane) => lane.runner !== 'api').length;
  console.log(`  ${view.lanes.length} lane${view.lanes.length === 1 ? '' : 's'} of ${lanes}${seats ? ` · a seat runs each: open the branch and run the prompt \`vibekit sprint start\` prints, or attach \`vibekit serve --stdio\`` : ''}`);
  if (view.blocked.length && !view.lanes.length && !view.next.length) {
    console.log('  Every lane is waiting on the same decision. `vibekit action` shows it.');
    if (options.until === 'blocked') process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- status

async function status(root, folder, options) {
  const [board, requirements, tasks] = await Promise.all([sprintBoard(root, folder), listRequirements(root, folder), readTasksState(root, folder)]);
  const current = board.current;
  const items = current ? current.items : requirements;
  const bugs = requirements.filter((entry) => entry.kind === 'bug' && entry.status !== 'done');
  const view = {
    sprint: current ? { n: current.n, of: board.sprints.length, title: current.title } : null,
    needsYou: items.filter((entry) => entry.status === 'blocked').length,
    inProgress: items.filter((entry) => tasks.held[entry.id]).map((entry) => ({ id: entry.id, title: gerund(entry.title), holder: tasks.held[entry.id], step: stepWords(entry, tasks.held[entry.id]) })),
    blocked: items.filter((entry) => entry.status === 'blocked').map((entry) => ({ id: entry.id, title: gerund(entry.title) })),
    review: items.filter((entry) => ['tested', 'review'].includes(entry.status)).map((entry) => ({ id: entry.id, title: gerund(entry.title) })),
    done: items.filter((entry) => entry.status === 'done').length,
    total: items.length,
    bugs: { open: bugs.length, high: bugs.filter((entry) => entry.severity === 'high').length },
    next: items.find((entry) => entry.status === 'ready' && !tasks.held[entry.id]) ?? null,
  };
  if (options.json) return void console.log(JSON.stringify(view, null, 2));

  console.log(view.sprint ? `sprint ${view.sprint.n} of ${view.sprint.of} · ${view.sprint.title}` : 'no sprint in plan.md — everything below is the whole backlog');
  console.log('');
  const label = (text) => text.padEnd(16);
  console.log(`  ${label('IN PROGRESS')}${view.inProgress.length ? view.inProgress.map((row) => `${row.title} (${row.holder.runner}, ${Math.round(holdAgeHours(row.holder) * 60)} min · ${row.step})`).join('\n' + ' '.repeat(18)) : 'nothing'}`);
  console.log(`  ${label('WAITING ON YOU')}${view.blocked.length ? view.blocked.map((row) => row.title).join(', ') : 'nothing'}`);
  console.log(`  ${label('SECOND EYES')}${view.review.length ? view.review.map((row) => row.title).join(', ') : 'nothing'}`);
  console.log(`  ${label('DONE')}${view.done} of ${view.total}${view.bugs.open ? ` · ${view.bugs.open} bug${view.bugs.open === 1 ? '' : 's'} open${view.bugs.high ? ` (${view.bugs.high} high)` : ''}` : ''}`);
  console.log(`  ${label('NEXT')}${view.next ? gerund(view.next.title) : view.done === view.total && view.total ? 'close the sprint: vibekit sprint close --by "<name>"' : 'nothing ready'}`);
}

// ---------------------------------------------------------------- close

/**
 * §23's sprint gate, then the one step VibeKit cannot do: a human closes it. Everything that has
 * to run (checks, the security read pass, documents, reports, lessons) runs here and is reported
 * as rows; a red row stops the close and says what to do about it.
 */
async function close(root, folder, rest, options) {
  const board = await sprintBoard(root, folder);
  const n = rest[0] ? Number.parseInt(rest[0], 10) : board.current?.n ?? board.sprints[board.sprints.length - 1]?.n;
  if (n === undefined || Number.isNaN(n)) throw new Error('No sprint to close: workflow/plan.md has none.');

  const extra = [];
  const checks = await runChecks(root, { folder }).catch(() => null);
  const errors = checks?.findings.filter((entry) => entry.severity === 'error') ?? [];
  extra.push({ ok: errors.length === 0, what: 'vibekit check green', why: errors.length ? `${errors.length} problem(s): ${errors[0].message}` : 'green' });

  const { securityRead } = await import('../security/scan.js').catch(() => ({ securityRead: null }));
  if (securityRead) {
    const scan = await securityRead(root, { folder }).catch((error) => ({ high: [{ message: error.message }] }));
    extra.push({ ok: !scan.high?.length, what: 'security scan clean of high findings', why: scan.high?.length ? `${scan.high.length} high: ${scan.high[0].message}` : 'clean' });
  }

  const gate = await sprintGate(root, n, { folder, extra });
  const rows = gate.rows;

  if (!gate.ok) {
    if (options.json) return void console.log(JSON.stringify({ n, ok: false, rows }, null, 2));
    console.log(`✖ Sprint ${n} is not at its gate:`);
    for (const row of rows) console.log(`  ${row.ok ? '✔' : '✖'} ${row.what.padEnd(40)} ${row.why}`);
    process.exitCode = 1;
    return;
  }

  // Everything that has to have been produced: converge, documents, reports, lessons. Each is
  // attempted and reported; a failure here is a fact about the folder, not a reason to stop.
  const produced = [];
  const converged = await runConverge(root, { folder, ids: gate.sprint.ids }).catch(() => null);
  produced.push({ what: 'converged', ok: converged?.state === 'converged', detail: converged?.why ?? 'not run' });
  const { archdocs } = await import('./archdocs.js');
  const docs = await withQuietConsole(() => archdocs({ root, folder, args: [] })).then(() => ({ ok: true })).catch((error) => ({ ok: false, detail: error.message }));
  produced.push({ what: 'documents regenerated', ...docs });
  const { report } = await import('./report.js');
  const reports = await withQuietConsole(() => report({ root, folder, args: [], all: true, out: join(root, `reports-sprint-${n}.md`) })).then(() => ({ ok: true, detail: `reports-sprint-${n}.md` })).catch((error) => ({ ok: false, detail: error.message }));
  produced.push({ what: 'all three reports', ...reports });
  const { distil } = await import('./reverse.js');
  const lessons = await withQuietConsole(() => distil({ root, folder, args: [] })).then(() => ({ ok: true })).catch((error) => ({ ok: false, detail: error.message }));
  produced.push({ what: 'lessons proposed', ...lessons });

  const stillOk = produced.every((row) => row.ok);
  if (!stillOk && !options.force) {
    if (options.json) return void console.log(JSON.stringify({ n, ok: false, rows, produced }, null, 2));
    console.log(`✖ Sprint ${n}: the gate holds, but not everything the close produces could be produced:`);
    for (const row of produced) console.log(`  ${row.ok ? '✔' : '✖'} ${row.what.padEnd(40)} ${row.detail ?? ''}`);
    process.exitCode = 1;
    return;
  }

  if (!options.by) {
    if (options.json) return void console.log(JSON.stringify({ n, ok: true, rows, produced, closed: false, why: 'a human closes the sprint: --by "<name>"' }, null, 2));
    console.log(`Sprint ${n} finished.`);
    for (const row of [...rows, ...produced]) console.log(`  ✔ ${row.what.padEnd(40)} ${row.why ?? row.detail ?? ''}`);
    console.log('');
    console.log(`  Close it: vibekit sprint close ${n} --by "<your name>"   — the one step VibeKit cannot do for you.`);
    return;
  }

  const closed = await closeSprint(root, n, { by: options.by, folder, tag: options.tag !== false });
  if (options.json) return void console.log(JSON.stringify({ n, ok: true, rows, produced, closed }, null, 2));
  console.log(`✔ Sprint ${n} closed by ${closed.by}${closed.tagged ? ` · tagged phase/${n}` : ''}`);
  const nextSprint = board.sprints.find((row) => row.n > n && !row.closed);
  console.log(nextSprint ? `  Next: sprint ${nextSprint.n} — ${nextSprint.title}. \`vibekit sprint run\` starts it.` : '  That was the last sprint in the plan. `vibekit release` is next.');
}

async function withQuietConsole(work) {
  const original = console.log;
  console.log = () => {};
  try {
    return await work();
  } finally {
    console.log = original;
  }
}
