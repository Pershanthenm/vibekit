import { execFileSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isOpen, listAsks } from '../folder/asks.js';
import { holdAgeHours, listRequirements, readTasksState, readyBlockers } from '../folder/requirements.js';
import { gerund, sprintBoard, stepWords } from '../folder/sprints.js';
import { approvalOf, currentStage, gateState, nextAction, STAGES } from '../folder/workflow.js';
import { exists, readText } from '../fsutil.js';
import { currentProject } from '../current.js';
import { GENERATED_DOCS, MIXED_DOCS, DOCS_DIR, diagramsDir } from '../docs/arch/paths.js';
import { folderIn, listProjects, MARKS, register, timeAgo } from '../projects.js';
import { readPosture } from '../security/scan.js';
import { readSessions } from '../session.js';
import { folderName } from './folder.js';

/**
 * `vibekit show`. CLI Spec §2, §4 and §5.
 *
 * "Never changes anything. Safe to run at any time, including mid-sprint." Every screen here is
 * read from files, so it is identical in the terminal, the app and the tracker, and correct after
 * a crash. Every `show` takes `--all` for every project and `--json` for scripting.
 */

const NOUNS = [
  ['project', 'where this project is'], ['plan', 'the sprints, in order, with dependencies'], ['sprint', 'this sprint: lanes, progress, blockers'],
  ['status', 'what needs you, across every project'], ['cost', 'spend, forecast, waste'], ['security', 'framework scores and open findings'],
  ['backlog', 'what is not in a sprint, and why'], ['docs', 'the generated architecture documents'], ['why', 'why this line of code exists'],
  ['team', 'who approves what'], ['migration', 'slices moved, verified, traffic shifted'], ['differences', 'where old and new disagree'],
];

export function showUsage() {
  const width = Math.max(...NOUNS.map(([noun]) => `show ${noun}`.length));
  return [
    '',
    ...NOUNS.map(([noun, line]) => `  ${`show ${noun}`.padEnd(width)}  ${line}`),
    '',
    '  Every show takes --all for every project, and --json for scripting.',
    '',
  ].join('\n');
}

export async function show(options) {
  const [noun, ...rest] = options.args;
  if (!noun) return projects(options);
  const handler = {
    project, plan, sprint: sprintScreen, status, cost, security, backlog, docs, why, team, migration, differences,
  }[noun];
  if (!handler) throw new Error(`"${noun}" is not something show can tell you.\n${showUsage()}`);
  if (options.all && !['status', 'why'].includes(noun)) return everyProject(options, (each) => handler({ ...each, args: rest }));
  return handler({ ...options, args: rest });
}

// ---------------------------------------------------------------- helpers

const label = (text) => text.padEnd(15);
const runnerLabel = (runner) => ({ 'claude-code': 'Claude Code', claude: 'Claude Code', cursor: 'Cursor', 'cursor-agent': 'Cursor', codex: 'Codex', api: 'API', cli: 'a seat', tracker: 'the tracker' }[String(runner ?? '').toLowerCase()] ?? String(runner ?? 'a seat'));
const shortDate = (iso) => {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.valueOf())) return null;
  return `${date.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]}`;
};
const ageOf = (iso) => {
  const hours = (Date.now() - Date.parse(iso ?? '')) / 3600000;
  if (!Number.isFinite(hours)) return null;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
};
const lower = (text) => { const value = String(text ?? '').trim(); return value ? value.charAt(0).toLowerCase() + value.slice(1) : value; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const columns = () => (Number.isFinite(process.stdout.columns) ? process.stdout.columns : 100);

/** A two-column row: under 100 columns the right side drops to its own line (§7, width-aware). */
function row(left, right, { width = 36 } = {}) {
  if (!right) return `  ${left}`;
  if (columns() < 100) return `  ${left}\n      ${right}`;
  return `  ${left.padEnd(width)} ${right}`;
}

/** "waiting on your answer about people who leave": the open ask that blocks this work, in a few words. */
function blockedWhy(requirement, asks) {
  const ask = asks.find((entry) => isOpen(entry) && entry.for === requirement.id) ?? asks.find((entry) => isOpen(entry) && entry.blocking);
  if (!ask) return 'waiting on your answer';
  const topic = ask.topic?.[0] ?? ask.about ?? null;
  const words = String(ask.plain || ask.ask).replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ').replace(/[?.:,]+$/, '');
  return `waiting on your answer about ${lower(topic ?? words)}`;
}

/** Spend for the sprint's work, in the currency rates.yml names, or tokens when nobody set a rate. */
async function spendFor(root, folder, ids) {
  const sessions = (await readSessions(root, folder)).filter((session) => !ids || ids.includes(session.requirement));
  const tokens = sessions.reduce((sum, session) => sum + Number(session.input ?? 0) + Number(session.output ?? 0), 0);
  const { loadCaps } = await import('../models/policy.js');
  const cap = (await loadCaps(root, folder)).find((entry) => entry.key === 'cap-phase')?.tokens ?? null;
  const { priceInCurrency, readRates } = await import('../models/registry.js');
  const rates = await readRates().catch(() => ({ currency: null }));
  if (!rates.currency) return { tokens, cap, currency: null, amount: null };
  let amount = 0;
  for (const session of sessions.filter((entry) => entry.model)) {
    const price = await priceInCurrency('anthropic', session.model, { input: session.input ?? 0, output: session.output ?? 0, cached: session.cached ?? 0 }, rates).catch(() => null);
    if (price) amount += price.amount;
  }
  return { tokens, cap, currency: rates.currency, amount };
}

const money = (currency, amount) => `${currency === 'ZAR' ? 'R' : currency} ${Math.round(amount).toLocaleString()}`;
const k = (tokens) => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens));

/** Run one show for every registered project, with a heading each — or one JSON array. */
async function everyProject(options, each) {
  const rows = (await listProjects()).filter((entry) => entry.folder);
  if (!rows.length) return void console.log(options.json ? '[]' : 'No projects registered. `vibekit new project` starts one; `vibekit use` finds the ones you have.');
  if (options.json) {
    const out = [];
    for (const entry of rows) {
      const captured = [];
      const original = console.log;
      console.log = (line = '') => captured.push(String(line));
      try { await each({ ...options, root: entry.path, folder: entry.folder, all: false }); } catch (error) { captured.push(JSON.stringify({ error: error.message })); } finally { console.log = original; }
      let parsed = null;
      try { parsed = JSON.parse(captured.join('\n')); } catch { parsed = captured.join('\n'); }
      out.push({ project: entry.name, path: entry.path, result: parsed });
    }
    return void console.log(JSON.stringify(out, null, 2));
  }
  for (const entry of rows) {
    console.log(`── ${entry.name}`);
    await each({ ...options, root: entry.path, folder: entry.folder, all: false }).catch((error) => console.log(`  ${error.message}`));
    console.log('');
  }
}

async function projectName(root) {
  const { loadProject } = await import('../project.js');
  return (await loadProject(root).catch(() => null))?.project?.name ?? root.split(/[\\/]/).pop();
}

// ---------------------------------------------------------------- show (bare): your projects

async function projects(options) {
  const rows = await listProjects();
  const here = (await folderIn(options.root)) ? options.root : (await currentProject())?.path ?? null;
  if (options.json) return void console.log(JSON.stringify(rows.map((entry) => ({ ...entry, current: entry.path === here })), null, 2));
  if (!rows.length) {
    console.log('No projects yet.');
    console.log('');
    console.log('  vibekit new project      start one');
    console.log('  vibekit use              find the ones you already have');
    return;
  }
  console.log('Your projects');
  console.log('');
  for (const entry of rows) {
    const current = entry.path === here;
    console.log(`  ${entry.mark}  ${String(entry.name).padEnd(22)} ${entry.line}${current ? '   · you are here' : ''}`);
    console.log(`     ${entry.path} · ${timeAgo(entry.lastSeen)}`);
  }
  console.log('');
  console.log(`  ${MARKS.active} building  ${MARKS.waiting} waiting on you  ${MARKS.stopped} stopped  ${MARKS.released} released  ${MARKS.attention} needs attention`);
  console.log('  vibekit use project <name>    switch   ·   vibekit show project    where this one is');
}

// ---------------------------------------------------------------- show project (§4)

export async function projectView(root, folder) {
  const [board, requirements, tasks, asks, gates, stage, posture, name] = await Promise.all([
    sprintBoard(root, folder), listRequirements(root, folder), readTasksState(root, folder), listAsks(root, folder), gateState(root, folder), currentStage(root, folder), readPosture(root, folder).catch(() => null), projectName(root),
  ]);
  const { workingSprint } = await import('../current.js');
  const chosen = await workingSprint(root);
  const current = (chosen !== null && board.sprints.find((row) => row.n === chosen)) || board.current;
  const items = current ? current.items : requirements;
  const open = asks.filter(isOpen);
  const oldest = open.map((ask) => ask.asked).filter(Boolean).sort()[0] ?? null;
  const stageGate = stage.n < 5 ? STAGES.slice(0, 5).find((entry) => !gates[entry.n]?.passed && /approved|reviewed/.test(gates[entry.n]?.detail ?? '')) : null;
  const sprintGate = board.sprints.filter((row) => row.complete && !row.closed).length;
  const closable = requirements.filter((entry) => entry.status === 'review' && entry.review.trim()).length;

  const inProgress = Object.entries(tasks.held).map(([id, holder]) => {
    const entry = requirements.find((item) => item.id === id) ?? { title: id, status: 'in-progress' };
    return { id, title: gerund(entry.title), runner: runnerLabel(holder.runner), minutes: Math.round(holdAgeHours(holder) * 60), step: stepWords(entry, holder) };
  });
  // Blocked work anywhere in the project is waiting on a person now, whichever sprint it sits in.
  const blocked = requirements.filter((entry) => entry.status === 'blocked').map((entry) => ({ id: entry.id, title: gerund(entry.title), why: blockedWhy(entry, asks) }));
  const bugs = requirements.filter((entry) => entry.kind === 'bug' && entry.status !== 'done');
  const bySeverity = ['high', 'medium', 'low'].map((severity) => [severity, bugs.filter((bug) => bug.severity === severity).length]).filter(([, count]) => count);
  const spend = await spendFor(root, folder, current ? current.ids : null).catch(() => ({ tokens: 0, cap: null, currency: null, amount: null }));
  const action = await nextAction(root, folder);
  const nextReady = items.find((entry) => entry.status === 'ready' && !tasks.held[entry.id] && entry.after.every((id) => requirements.find((other) => other.id === id)?.status === 'done')) ?? null;

  const needs = [];
  if (open.length) needs.push(`${plural(open.length, 'decision')}${oldest ? ` (oldest ${ageOf(oldest)})` : ''}`);
  if (stageGate) needs.push(`the ${stageGate.name} stage is waiting for your approval`);
  if (sprintGate) needs.push(`${plural(sprintGate, 'sprint gate')}`);
  if (closable) needs.push(`${closable} reviewed, waiting for you to call ${closable === 1 ? 'it' : 'them'} done`);

  let next;
  if (open.length) next = { text: `answer the ${open.length === 1 ? 'question' : 'questions'}`, command: 'vibekit show status' };
  else if (stageGate) next = { text: `approve the ${stageGate.name} stage`, command: stageGate.n === 4 ? 'vibekit plan project' : 'vibekit run' };
  else if (sprintGate) next = { text: 'close the finished sprint', command: 'vibekit new sprint --by "<your name>"' };
  else if (closable) next = { text: `call ${lower(requirements.find((entry) => entry.status === 'review' && entry.review.trim()).title)} done`, command: `vibekit req done ${requirements.find((entry) => entry.status === 'review' && entry.review.trim()).id}` };
  else if (nextReady) next = { text: nextReady.title, command: 'vibekit run' };
  else if (action) next = { text: action.detail ?? action.kind, command: action.command };
  else if (current && current.done === current.total && current.total) next = { text: 'close the sprint', command: 'vibekit new sprint --by "<your name>"' };
  else next = { text: 'nothing ready', command: 'vibekit show plan' };

  return {
    name,
    sprint: current ? { n: current.n, of: board.sprints.length, title: current.title } : null,
    stage: { n: stage.n, name: stage.name },
    needsYou: { decisions: open.length, oldest, stageGate: stageGate ? stageGate.name : null, sprintGates: sprintGate, closable, line: needs.join(' · ') || 'nothing' },
    inProgress, blocked,
    done: { count: items.filter((entry) => entry.status === 'done').length, total: items.length, bugs: Object.fromEntries(bySeverity), bugsOpen: bugs.length },
    security: posture?.last ? { date: posture.last.date, high: posture.last.high, medium: posture.last.medium, low: posture.last.low } : null,
    spent: spend,
    next,
  };
}

function renderProject(view) {
  const lines = [];
  lines.push(`${view.name} · ${view.sprint ? `sprint ${view.sprint.n} of ${view.sprint.of} · ${view.sprint.title}` : `stage ${view.stage.n} · ${view.stage.name}`}`);
  lines.push('');
  lines.push(`  ${label('NEEDS YOU')}${view.needsYou.line}`);
  if (view.inProgress.length) {
    view.inProgress.forEach((lane, at) => lines.push(row(`${at ? label('') : label('IN PROGRESS')}${lane.title}`, `${lane.runner} · ${lane.minutes} min · ${lane.step}`, { width: 44 })));
  } else lines.push(`  ${label('IN PROGRESS')}nothing`);
  if (view.blocked.length) {
    view.blocked.forEach((item, at) => lines.push(row(`${at ? label('') : label('BLOCKED')}${item.title}`, item.why, { width: 44 })));
  }
  const bugText = view.done.bugsOpen ? ` · ${plural(view.done.bugsOpen, 'bug')} open (${Object.entries(view.done.bugs).map(([severity, count]) => `${count} ${severity}`).join(', ')})` : '';
  lines.push(`  ${label('DONE')}${view.done.count} of ${view.done.total}${bugText}`);
  const securityText = !view.security ? 'not scanned yet' : view.security.high ? `${plural(view.security.high, 'high finding')} open` : view.security.medium ? `clean of high findings · ${view.security.medium} medium to look at` : 'clean';
  lines.push(`  ${label('SECURITY')}${securityText}`);
  const spent = view.spent.currency
    ? `${money(view.spent.currency, view.spent.amount)}${view.spent.cap ? ` · ${k(view.spent.tokens)} of ${k(view.spent.cap)} tokens` : ''} this sprint`
    : `${k(view.spent.tokens)} tokens${view.spent.cap ? ` of ${k(view.spent.cap)}` : ''} this sprint`;
  lines.push(`  ${label('SPENT')}${spent}`);
  lines.push(`  ${label('NEXT')}${view.next.text}`);
  lines.push('');
  lines.push(`  ${view.next.command}`);
  return lines.join('\n');
}

async function project(options) {
  const { root, json } = options;
  const folder = options.folder ?? (await folderName(root));
  if (!(await folderIn(root))) throw new Error('No project here. `vibekit new project` starts one; `vibekit use project <name>` goes to one you have.');
  await register(root).catch(() => {});
  const view = await projectView(root, folder);
  if (json) return void console.log(JSON.stringify(view, null, 2));
  console.log(renderProject(view));
}

// ---------------------------------------------------------------- show plan (§5)

/** Throughput from the requirement logs: pieces finished per day since the first log line. */
export function paceFrom(requirements, now = Date.now()) {
  const dates = requirements.flatMap((entry) => entry.log.map((line) => line.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]).filter(Boolean));
  const started = dates.sort()[0] ?? null;
  const done = requirements.filter((entry) => entry.status === 'done').length;
  if (!started || done < 2) return { measured: false, perDay: null };
  const days = Math.max(1, (now - Date.parse(started)) / 86400000);
  return { measured: true, perDay: done / days };
}

export async function planView(root, folder) {
  const [board, requirements, tasks, asks, name] = await Promise.all([sprintBoard(root, folder), listRequirements(root, folder), readTasksState(root, folder), listAsks(root, folder), projectName(root)]);
  const planText = await readText(join(root, folder, 'workflow/plan.md'));
  const approved = approvalOf(planText);
  const byId = new Map(requirements.map((entry) => [entry.id, entry]));
  const titleOf = (id) => lower(byId.get(id)?.title ?? id);

  const sprints = board.sprints.map((sprint) => {
    const state = sprint.closed ? { word: 'done', detail: shortDate(sprint.closed.closedAt) }
      : sprint.complete ? { word: 'finished', detail: 'close it' }
        : sprint === board.current ? { word: 'in progress', detail: `${sprint.done} of ${sprint.total}` }
          : sprint.total ? { word: 'not started', detail: plural(sprint.total, 'piece') }
            : { word: board.current && sprint.n < board.current.n ? 'done' : 'not started', detail: null };
    const items = sprint.total
      ? sprint.items.map((item) => {
        const holder = tasks.held[item.id];
        const unmet = item.after?.filter((id) => byId.get(id)?.status !== 'done') ?? [];
        let mark = '○'; let right = '';
        if (item.status === 'done') { mark = '✓'; right = item.after?.length ? `needed ${item.after.map(titleOf).join(', ')}` : ''; }
        else if (holder) { mark = '▶'; right = `${runnerLabel(holder.runner)} · ${stepWords(item, holder)}`; }
        else if (item.status === 'blocked') { mark = '⏸'; right = blockedWhy(item, asks); }
        else if (['tested', 'review'].includes(item.status)) { mark = '⏸'; right = 'waiting for a second pair of eyes'; }
        else if (unmet.length) { right = `needs ${unmet.map(titleOf).join(' and ')} first`; }
        else if (item.missing) { right = 'no such requirement'; }
        else if (item.after?.length) { right = `needed ${item.after.map(titleOf).join(', ')}`; }
        const title = holder ? gerund(item.title) : item.title;
        return { id: item.id, mark, title, right, status: item.status };
      })
      : sprint.lines.map((line) => ({ id: null, mark: state.word === 'done' ? '✓' : '○', title: line, right: '', status: null }));
    return { n: sprint.n, title: sprint.title, state, items };
  });

  const deferredLines = [...String(planText ?? '').matchAll(/^\s*[-*]\s+((?:REQ|MIG|BUG)-[\w.-]+)[^\n]*?(?:reason:\s*(.+))?$/gm)];
  const deferred = board.deferred.map((id) => ({ id, title: byId.get(id)?.title ?? id, why: deferredLines.find((match) => match[1] === id)?.[2]?.trim() ?? 'you moved this at planning' }));
  const lanes = Object.keys(tasks.held).length;
  const remaining = requirements.filter((entry) => entry.status !== 'done' && !board.deferred.includes(entry.id) && entry.kind !== 'bug').length;
  const pace = paceFrom(requirements);
  const daysLeft = pace.measured && pace.perDay > 0 ? Math.ceil(remaining / pace.perDay) : null;

  return {
    name, pieces: requirements.filter((entry) => entry.kind !== 'bug').length, sprints, deferred,
    approved: approved ? { by: approved.by, date: approved.date } : null,
    lanes, remaining, pace: { ...pace, daysLeft },
    unplanned: board.unplanned.map((entry) => ({ id: entry.id, title: entry.title })),
  };
}

function renderPlan(view) {
  const lines = [`${view.name} · ${plural(view.pieces, 'piece')} of work · ${plural(view.sprints.length, 'sprint')} · ${view.approved ? `approved${view.approved.date ? ` ${shortDate(view.approved.date)}` : ''} by ${view.approved.by}` : 'not yet approved'}`];
  if (!view.sprints.length) {
    lines.push('', '  No sprints yet. `vibekit plan project` turns the spec into sprints, in dependency order.');
    return lines.join('\n');
  }
  for (const sprint of view.sprints) {
    lines.push('');
    const head = `SPRINT ${sprint.n} · ${sprint.title}`;
    const state = `${sprint.state.word}${sprint.state.detail ? ` · ${sprint.state.detail}` : ''}`;
    lines.push(columns() < 100 ? `${head}\n    ${state}` : `${head.padEnd(Math.max(52, 78 - state.length))}${state}`);
    for (const item of sprint.items) lines.push(row(`${item.mark} ${item.title}`, item.right, { width: 38 }));
  }
  if (view.deferred.length) {
    lines.push('', 'DEFERRED');
    for (const item of view.deferred) lines.push(row(`○ ${item.title}`, item.why, { width: 38 }));
  }
  if (view.unplanned.length) {
    lines.push('', 'NOT IN ANY SPRINT');
    for (const item of view.unplanned) lines.push(row(`○ ${item.title}`, 'real work the plan does not place', { width: 38 }));
  }
  lines.push('');
  const left = view.pace.daysLeft !== null ? `about ${plural(view.pace.daysLeft, 'day')} left, from your actual pace` : 'no pace measured yet — the estimate comes from what actually gets done, never from a guess';
  lines.push(`  ${plural(view.lanes, 'lane')} running · ${left}`);
  return lines.join('\n');
}

async function plan(options) {
  const { root, json } = options;
  const folder = options.folder ?? (await folderName(root));
  if (options.cost) {
    const { plan: planCost } = await import('./report.js');
    return planCost({ ...options, folder, cost: true });
  }
  const view = await planView(root, folder);
  if (json) return void console.log(JSON.stringify(view, null, 2));
  console.log(renderPlan(view));
}

// ---------------------------------------------------------------- the rest: one line each over what exists

async function sprintScreen(options) {
  const { sprint } = await import('./sprint.js');
  return sprint({ ...options, args: ['status'] });
}

async function status(options) {
  const { action } = await import('./action.js');
  return action({ ...options, args: [] });
}

async function cost(options) {
  const { cost: costCommand } = await import('./verbs.js');
  if (options.at) {
    const { report } = await import('./report.js');
    return report({ ...options, args: ['budget'] });
  }
  return costCommand(options);
}

async function security(options) {
  const { security: securityCommand } = await import('./security.js');
  return securityCommand({ ...options, args: ['status'] });
}

async function team(options) {
  const { team: teamCommand } = await import('./team.js');
  return teamCommand({ ...options, args: ['status'] });
}

async function why(options) {
  const { why: whyCommand } = await import('./why.js');
  if (!options.args[0]) throw new Error('Usage: vibekit show why <file>[:<line>]   — why this line of code exists');
  return whyCommand(options);
}

async function migration(options) {
  const { migrate } = await import('./migrate.js');
  return migrate({ ...options, args: ['status'] });
}

async function differences(options) {
  const { verify } = await import('./verify.js');
  return verify({ ...options, args: [], report: true });
}

/** What is not in a sprint, and why: unplanned work with its blockers, deferred work with its reason. */
async function backlog(options) {
  const { root, json } = options;
  const folder = options.folder ?? (await folderName(root));
  const [board, requirements, name] = await Promise.all([sprintBoard(root, folder), listRequirements(root, folder), projectName(root)]);
  const planText = await readText(join(root, folder, 'workflow/plan.md'));
  const reasons = new Map([...String(planText ?? '').matchAll(/^\s*[-*]\s+((?:REQ|MIG|BUG)-[\w.-]+)[^\n]*?reason:\s*(.+)$/gm)].map((match) => [match[1], match[2].trim()]));
  const unplanned = board.unplanned.map((entry) => {
    const blockers = readyBlockers(entry);
    return { id: entry.id, title: entry.title, status: entry.status, why: entry.status === 'done' ? 'done, though the plan never placed it' : blockers.length ? `not ready: ${blockers[0]}` : 'ready, and the plan does not place it' };
  });
  const deferred = board.deferred.map((id) => ({ id, title: requirements.find((entry) => entry.id === id)?.title ?? id, why: reasons.get(id) ?? 'you moved this at planning' }));
  const bugs = board.bugs.filter((bug) => bug.status !== 'done').map((bug) => ({ id: bug.id, title: bug.title, severity: bug.severity, why: `${bug.severity ?? 'unsized'} bug · ${stepWords(bug)}` }));
  const view = { name, unplanned, deferred, bugs };
  if (json) return void console.log(JSON.stringify(view, null, 2));
  const total = unplanned.length + deferred.length + bugs.length;
  console.log(`${name} · ${total ? `${plural(total, 'piece')} of work not in a sprint` : 'everything is in a sprint'}`);
  if (unplanned.length) { console.log('', 'NOT PLANNED'); for (const item of unplanned) console.log(row(`○ ${item.title}`, item.why, { width: 38 })); }
  if (deferred.length) { console.log('', 'DEFERRED'); for (const item of deferred) console.log(row(`○ ${item.title}`, item.why, { width: 38 })); }
  if (bugs.length) { console.log('', 'BUGS'); for (const item of bugs) console.log(row(`○ ${item.title}`, item.why, { width: 38 })); }
  console.log('');
  console.log(total ? '  vibekit plan sprint    put it in a sprint, or say why not' : '  vibekit show plan      the order of work');
}

/** The generated architecture documents: which exist, how old, and where. `--at` reads a past commit. */
async function docs(options) {
  const { root, json, at } = options;
  const wanted = [...GENERATED_DOCS, ...MIXED_DOCS];
  const name = await projectName(root);
  let rows;
  if (at) {
    let listed = '';
    try { listed = execFileSync('git', ['ls-tree', '--name-only', at, `${DOCS_DIR}/`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { throw new Error(`"${at}" is not a commit or tag in this repository.`); }
    const present = new Set(listed.split('\n').map((line) => line.trim().replace(`${DOCS_DIR}/`, '')));
    rows = wanted.map((doc) => ({ file: `${DOCS_DIR}/${doc}`, exists: present.has(doc), at }));
  } else {
    rows = [];
    for (const doc of wanted) {
      const path = join(root, DOCS_DIR, doc);
      const info = await stat(path).catch(() => null);
      rows.push({ file: `${DOCS_DIR}/${doc}`, exists: Boolean(info), modified: info ? info.mtime.toISOString() : null });
    }
  }
  const diagrams = at ? null : (await readdir(diagramsDir(root)).catch(() => [])).filter((file) => file.endsWith('.svg')).length;
  const view = { name, at: at ?? null, documents: rows, diagrams };
  if (json) return void console.log(JSON.stringify(view, null, 2));
  console.log(`${name} · documents${at ? ` as at ${at}` : ''}`);
  console.log('');
  for (const entry of rows) console.log(`  ${entry.exists ? '✓' : '○'} ${entry.file.padEnd(28)} ${entry.exists ? (entry.modified ? `generated ${timeAgo(entry.modified)}` : 'present') : 'not generated yet'}`);
  if (diagrams !== null) console.log(`  ${diagrams ? '✓' : '○'} ${`${DOCS_DIR}/diagrams/`.padEnd(28)} ${diagrams ? plural(diagrams, 'diagram') : 'none yet'}`);
  console.log('');
  console.log(rows.some((entry) => !entry.exists) ? '  vibekit run docs       regenerate documents and diagrams' : '  vibekit run docs --at <tag>    as they were at a release');
}

export { exists };
