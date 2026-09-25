import { join } from 'node:path';
import { sprintBoard } from '../folder/sprints.js';
import { currentStage } from '../folder/workflow.js';
import { listRequirements } from '../folder/requirements.js';
import { readText } from '../fsutil.js';
import { createAsker } from '../menu.js';
import { findProject, register, setCurrentProject, setWorkingSprint, workingSprint } from '../current.js';
import { folderIn, listProjects, MARKS } from '../projects.js';
import { SHELLS, completionStatus, installCompletion, installPath, packageVersion, script, shellOf } from '../completion.js';
import { folderName } from './folder.js';

/**
 * The verbs of the CLI Spec that are one line each over something that already exists: `new`,
 * `use`, `plan`, `run`, `completion`. Kept as calls rather than copies so `vibekit run sprint`
 * and `vibekit sprint run` cannot drift apart.
 *
 * Three rules from §1 shape every function here: verb first, always; the name is optional; a
 * bare verb lists what it takes.
 */

const list = (rows, footer) => {
  const width = Math.max(...rows.map(([command]) => command.length));
  return ['', ...rows.map(([command, line]) => `  ${command.padEnd(width)}  ${line}`), '', ...(footer ? [`  ${footer}`, ''] : [])].join('\n');
};

// ---------------------------------------------------------------- new

export const newUsage = () => list([
  ['new project', 'start something: name it, describe it, answer the questions'],
  ['new sprint', 'begin the next sprint in the plan'],
  ['new feature', 'add one thing to a project already running'],
  ['new bug', 'log a defect — assess, fix, verify'],
  ['new hotfix', 'production is broken; skip the ceremony'],
], 'vibekit new <thing> --help  for more');

export async function newVerb(options) {
  const [noun, ...rest] = options.args;
  const name = rest.join(' ').trim();
  if (!noun) return void console.log(newUsage());

  if (noun === 'project') {
    if (options.preview) return previewProject(options, name);
    if (options.import !== undefined) return importProject(options, name);
    const { project } = await import('./project.js');
    return project({ ...options, args: ['new'], name: options.name ?? (name || undefined) });
  }
  if (noun === 'sprint') return newSprint(options);
  if (noun === 'feature') {
    if (options.preview) return previewFeature(options, name);
    const { feature } = await import('./verbs.js');
    if (!name) throw new Error('Usage: vibekit new feature "<what it should do>"');
    return feature({ ...options, args: ['add', name] });
  }
  if (noun === 'bug') {
    const { bug } = await import('./bug.js');
    if (!name) throw new Error('Usage: vibekit new bug "<what is wrong>" --test <path to the failing test> [--severity high|medium|low]');
    return bug({ ...options, args: [name] });
  }
  if (noun === 'hotfix') {
    const { hotfix } = await import('./verbs.js');
    if (!name) throw new Error('Usage: vibekit new hotfix "<what is broken>"');
    return hotfix({ ...options, args: [name] });
  }
  throw new Error(`"${noun}" is not something new can start.\n${newUsage()}`);
}

/** `--preview`: the questions the wizard would ask, and nothing written. */
function previewProject(options, name) {
  const { PLATFORMS } = optionsPlatforms();
  const rows = [
    ['Project name', name || '(asked)'],
    ['Where does it live?', 'this folder · a new local folder · a repository on GitHub, Azure DevOps or GitLab'],
    ['What are you building?', 'a sentence or two, or the path to a requirements document'],
    ['Where does it run?', PLATFORMS.map((platform) => platform.label).join(' · ')],
    ['Then', 'the analyst\'s questions land in vibekit show status, ten a round; three approvals follow: architecture, design, plan'],
  ];
  if (options.json) return void console.log(JSON.stringify({ questions: rows.map(([question, answers]) => ({ question, answers })), writes: [] }, null, 2));
  console.log('vibekit new project would ask:');
  console.log('');
  for (const [question, answers] of rows) console.log(`  ${question.padEnd(24)} ${answers}`);
  console.log('');
  console.log('  Nothing was written.');
}

function optionsPlatforms() {
  return { PLATFORMS: [{ label: 'Web browser' }, { label: 'iOS' }, { label: 'Android' }, { label: 'Desktop' }, { label: 'API only' }, { label: 'Command line' }, { label: 'Something else' }] };
}

async function previewFeature(options, name) {
  const rows = [
    ['Title', name || '(asked)'],
    ['Acceptance criteria', 'in EARS form: one trigger, one response, each with an id'],
    ['Size', 'S, M or L — size decides how much review it gets'],
    ['Source', 'which section of which document asked for it, or DESC-001 if you did'],
    ['Entities', 'must already be in product/entities.md; a missing one becomes an ask, never a guess'],
  ];
  if (options.json) return void console.log(JSON.stringify({ questions: rows.map(([question, answers]) => ({ question, answers })), writes: [] }, null, 2));
  console.log('vibekit new feature would ask:');
  console.log('');
  for (const [question, answers] of rows) console.log(`  ${question.padEnd(24)} ${answers}`);
  console.log('');
  console.log('  Nothing was written.');
}

/** `new project --import [path]`: there is code here already. Read it, build the spec from it, and stand in it. */
async function importProject(options, name) {
  const { understand } = await import('./understand.js');
  const target = typeof options.import === 'string' && options.import !== 'true' ? options.import : name || '.';
  await understand({ ...options, args: [target], convert: true });
  await register(options.root, { name: options.name ?? null }).catch(() => {});
  await setCurrentProject(options.root).catch(() => {});
}

/** `new sprint`: the next sprint begins when the one before it is closed at its gate. */
async function newSprint(options) {
  const { root, json } = options;
  const folder = options.folder ?? (await folderName(root));
  const stage = await currentStage(root, folder);
  if (stage.n < 5) {
    if (json) return void console.log(JSON.stringify({ started: null, why: `stage ${stage.n} ${stage.name}: the plan is not approved` }, null, 2));
    console.log(`Nothing to start: the project is at stage ${stage.n}, ${stage.name}, and the plan is not approved yet.`);
    console.log('  vibekit plan project     the sprints, in dependency order, and the gate that approves them');
    return;
  }
  const board = await sprintBoard(root, folder);
  // A sprint whose every piece is done and that nobody has closed is at its gate: closing it is
  // what begins the next one. The plan's "current" sprint has already moved past it.
  const finished = board.sprints.find((row) => row.total && row.complete && !row.closed);
  if (finished) {
    const { sprint } = await import('./sprint.js');
    return sprint({ ...options, args: ['close', String(finished.n)] });
  }
  const current = board.current;
  if (!current) {
    if (json) return void console.log(JSON.stringify({ started: null, why: 'every sprint in the plan is closed' }, null, 2));
    console.log('Every sprint in the plan is closed.');
    console.log('  vibekit plan project     add the next ones   ·   vibekit ship release    what is done is ready to ship');
    return;
  }
  if (json) return void console.log(JSON.stringify({ started: null, current: { n: current.n, title: current.title, done: current.done, total: current.total } }, null, 2));
  console.log(`Sprint ${current.n} — ${current.title} is in progress · ${current.done} of ${current.total} done.`);
  console.log('  The next sprint begins when this one is closed at its gate. vibekit run works it; vibekit show sprint says where it is.');
}

// ---------------------------------------------------------------- use

export const useUsage = () => list([
  ['use project <name>', 'switch; everything after applies here'],
  ['use sprint <n>', 'switch the working sprint'],
  ['use', 'pick from a list'],
], 'Recorded in machine settings, never in the folder: two people on one repo can be in different places.');

export async function use(options) {
  const [noun, ...rest] = options.args;
  if (!noun) return pickProject(options);
  if (noun === 'project') {
    const name = rest.join(' ').trim();
    if (!name) return pickProject(options);
    return goTo(name, options);
  }
  if (noun === 'sprint') return useSprint(options, rest[0]);
  throw new Error(`"${noun}" is not something use can switch to.\n${useUsage()}`);
}

async function goTo(name, options) {
  const row = await findProject(name);
  if (!row) throw new Error(`No project called "${name}" on this machine. \`vibekit show\` lists them; \`vibekit use\` picks from a list.`);
  if (!row.folder) throw new Error(`${row.name} has no vibekit/ folder yet. \`vibekit new project\` there first.`);
  await setCurrentProject(row.path, { name: row.name });
  await register(row.path).catch(() => {});
  const chosen = await workingSprint(row.path);
  if (options.json) return void console.log(JSON.stringify({ ...row, sprint: chosen }, null, 2));
  console.log(`✔ ${row.mark} ${row.name} · ${row.line}`);
  console.log(`  ${row.path}${chosen !== null ? ` · working sprint ${chosen}` : ''}`);
  console.log('  Everything from here applies to it until you switch again. vibekit show project says where it is.');
}

async function pickProject(options) {
  const rows = await listProjects();
  if (!rows.length) {
    console.log('No projects on this machine yet.');
    console.log('  vibekit new project                start one   ·   vibekit project select --rescan <dir>    find the ones you have');
    return;
  }
  if (!process.stdin.isTTY || options.json) {
    if (options.json) return void console.log(JSON.stringify(rows, null, 2));
    console.log('Your projects');
    console.log('');
    for (const row of rows) console.log(`  ${row.mark}  ${String(row.name).padEnd(22)} ${row.line}`);
    console.log('');
    console.log(`  ${MARKS.active} building  ${MARKS.waiting} waiting on you  ${MARKS.stopped} stopped  ${MARKS.released} released  ${MARKS.attention} needs attention`);
    console.log('  vibekit use project <name>');
    return;
  }
  const asker = createAsker();
  try {
    const id = await asker.choose({ id: 'project', header: 'project', question: 'Which project?', noOther: true, options: rows.map((row) => ({ id: row.path, label: row.name, description: row.line })) });
    const path = typeof id === 'string' ? id : null;
    const row = rows.find((entry) => entry.path === path);
    if (row) await goTo(row.name, options);
  } finally {
    asker.close();
  }
}

async function useSprint(options, which) {
  const { root, json } = options;
  if (!(await folderIn(root))) throw new Error('No project here. `vibekit use project <name>` first.');
  const folder = options.folder ?? (await folderName(root));
  const board = await sprintBoard(root, folder);
  if (which === undefined) {
    const chosen = await workingSprint(root);
    if (json) return void console.log(JSON.stringify({ working: chosen, current: board.current?.n ?? null, sprints: board.sprints.map((row) => ({ n: row.n, title: row.title, done: row.done, total: row.total, closed: Boolean(row.closed) })) }, null, 2));
    for (const row of board.sprints) console.log(`  ${row.n === (chosen ?? board.current?.n) ? '▶' : row.closed ? '✓' : '○'} sprint ${row.n} · ${row.title} · ${row.done} of ${row.total}${row.closed ? ' · closed' : ''}`);
    console.log('  vibekit use sprint <n>');
    return;
  }
  const n = Number.parseInt(String(which).replace(/^sprint\s*/i, ''), 10);
  if (!Number.isFinite(n)) throw new Error('Usage: vibekit use sprint <n>');
  const sprint = board.sprints.find((row) => row.n === n);
  if (!sprint) throw new Error(`No sprint ${n} in ${folder}/workflow/plan.md. Sprints: ${board.sprints.map((row) => row.n).join(', ') || 'none yet'}.`);
  if (sprint.closed) throw new Error(`Sprint ${n} — ${sprint.title} was closed by ${sprint.closed.by}. A closed sprint is not worked; vibekit show plan shows what is open.`);
  await setWorkingSprint(root, n);
  if (json) return void console.log(JSON.stringify({ working: n, title: sprint.title }, null, 2));
  console.log(`✔ working sprint ${n} · ${sprint.title} · ${sprint.done} of ${sprint.total} done`);
  console.log('  vibekit run works it; vibekit show sprint says where it is.');
}

// ---------------------------------------------------------------- plan

export const planUsage = () => list([
  ['plan project', 'turn the spec into sprints, in dependency order'],
  ['plan sprint', 're-order or re-scope the current sprint'],
], 'Both end at a gate. Nothing is approved without a person.');

export async function planVerb(options) {
  const [noun] = options.args;
  const { sprint } = await import('./sprint.js');
  if (!noun) {
    if (options.cost) return sprint({ ...options, args: ['plan'], cost: true });
    return void console.log(planUsage());
  }
  if (noun === 'project') return planProject(options, sprint);
  if (noun === 'sprint') return planSprint(options);
  throw new Error(`"${noun}" is not something plan decides.\n${planUsage()}`);
}

async function planProject(options, sprint) {
  const { root } = options;
  const folder = options.folder ?? (await folderName(root));
  if (options.approve) {
    const { apply } = await import('../control.js');
    if (!options.by) throw new Error('Approving the plan is a human decision: say who with --by "<name>".');
    const result = await apply(root, null, { action: 'gate.approve', stage: 4, by: options.by });
    if (options.json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ ${result.message}`);
    console.log('  vibekit run    works the first sprint');
    return;
  }
  const stage = await currentStage(root, folder);
  if (stage.n < 4 && !options.json) {
    const { nextAction } = await import('../folder/workflow.js');
    const action = await nextAction(root, folder);
    console.log(`The project is at stage ${stage.n}, ${stage.name}; the plan comes after it.`);
    if (action) console.log(`  ${action.forHuman ? 'Waiting on you' : 'Next'}: ${action.detail}\n  ${action.command}`);
    return;
  }
  const board = await sprintBoard(root, folder);
  if (!board.sprints.length && !options.json) {
    console.log(`No sprints in ${folder}/workflow/plan.md yet.`);
    console.log(`  The planner writes them from the spec: small pieces in dependency order, a working skeleton first.`);
    console.log(`  Run the prompt ${folder}/${stage.prompt} in your agent (vibekit run prints it), then come back here to approve the order.`);
    return;
  }
  await sprint({ ...options, args: ['plan'] });
  if (!options.json) {
    const { approvalOf } = await import('../folder/workflow.js');
    const approved = approvalOf(await readText(join(root, folder, 'workflow/plan.md')));
    console.log(approved ? '  vibekit show plan          the sprints as a person reads them' : '  vibekit plan project --approve --by "<your name>"    approve it, once the order is right');
  }
}

/** `plan sprint`: the pieces of the current sprint, and the two flags that move them. */
async function planSprint(options) {
  const { root, json } = options;
  const folder = options.folder ?? (await folderName(root));
  if (options.order || options.defer) {
    const { apply } = await import('../control.js');
    const split = (value) => (value ? String(value).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean) : []);
    const result = await apply(root, null, { action: 'plan.reorder', order: split(options.order), defer: split(options.defer), by: options.by ?? 'you' });
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ ${result.message}`);
    return;
  }
  const chosen = await workingSprint(root);
  const board = await sprintBoard(root, folder, { current: chosen });
  const current = board.current;
  if (!current) {
    if (json) return void console.log(JSON.stringify({ sprint: null }, null, 2));
    console.log('No sprint is open. vibekit plan project shows the plan.');
    return;
  }
  const requirements = await listRequirements(root, folder);
  const rows = current.items.map((item) => ({ id: item.id, title: item.title, status: item.status, after: item.after ?? [] }));
  if (json) return void console.log(JSON.stringify({ sprint: { n: current.n, title: current.title }, items: rows, deferred: board.deferred }, null, 2));
  console.log(`Sprint ${current.n} — ${current.title} · ${current.done} of ${current.total} done`);
  console.log('');
  for (const item of rows) console.log(`  ${item.status === 'done' ? '✓' : '○'} ${item.id.padEnd(9)} ${item.title}${item.after.length ? `   after ${item.after.map((id) => requirements.find((entry) => entry.id === id)?.title ?? id).join(', ')}` : ''}`);
  console.log('');
  console.log('  vibekit plan sprint --order REQ-002,REQ-001 --by "<name>"    a new order (identifiers, because this is the one place they are needed)');
  console.log('  vibekit plan sprint --defer REQ-003 --by "<name>"            move something out to Deferred');
  console.log('  Done work stays where it is; the plan file records who moved what.');
}

// ---------------------------------------------------------------- run

export const runUsage = () => list([
  ['run sprint', 'work the current sprint with several agents'],
  ['run check', 'every mechanical check — this is what CI runs'],
  ['run scan', 'security, against every applicable framework'],
  ['run review', 'the reviewer over anything waiting'],
  ['run docs', 'regenerate documents and diagrams'],
  ['run', 'shorthand for `run sprint`'],
]);

export async function runVerb(options) {
  const [noun, ...rest] = options.args;
  if (noun === 'help' || noun === '?') return void console.log(runUsage());
  if (!(await folderIn(options.root))) throw new Error('No project here. `vibekit new project` starts one; `vibekit use project <name>` goes to one you have.');
  if (!noun || noun === 'sprint') {
    const { sprint } = await import('./sprint.js');
    return sprint({ ...options, args: ['run', ...rest] });
  }
  if (noun === 'check') {
    const { check } = await import('./folder.js');
    return check({ ...options, args: rest, ci: options.ci || options.headless });
  }
  if (noun === 'scan') {
    const { security } = await import('./security.js');
    return security({ ...options, args: ['scan', ...rest] });
  }
  if (noun === 'review') {
    const { review } = await import('./verbs.js');
    return review({ ...options, args: rest });
  }
  if (noun === 'docs') {
    const { docs } = await import('./verbs.js');
    return docs({ ...options, args: rest });
  }
  throw new Error(`"${noun}" is not something run does.\n${runUsage()}`);
}

// ---------------------------------------------------------------- completion

export async function completion(options) {
  const [shell, ...rest] = options.args;
  const version = await packageVersion();

  if (options.check) {
    const status = await completionStatus();
    if (options.json) return void console.log(JSON.stringify(status, null, 2));
    if (!status.installed.length) {
      console.log('No completion installed. vibekit completion install writes it where your shell loads it.');
      return;
    }
    for (const entry of status.installed) console.log(`  ${entry.current ? '✔' : '✖'} ${entry.shell.padEnd(5)} ${entry.path}  ${entry.current ? `matches ${status.version}` : `is ${entry.version ?? 'unversioned'}, installed is ${status.version}`}`);
    if (status.stale.length) {
      console.log(`  Stale completion is worse than none: vibekit completion install ${status.stale[0].shell} rewrites it.`);
      process.exitCode = 1;
    }
    return;
  }

  if (shell === 'install') {
    const which = rest[0] ?? shellOf();
    if (!which) throw new Error(`Say which shell: vibekit completion install <${SHELLS.join('|')}>`);
    const path = installPath(which);
    if (options['dry-run']) return void console.log(`Would write ${path}. Nothing written.`);
    const result = await installCompletion(which);
    if (options.json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ ${result.path}`);
    console.log(`  ${result.note}`);
    return;
  }

  if (!shell) {
    console.log([
      '',
      '  vibekit completion bash > ~/.local/share/bash-completion/completions/vibekit',
      '  vibekit completion zsh  > "${fpath[1]}/_vibekit"',
      '  vibekit completion fish > ~/.config/fish/completions/vibekit.fish',
      '',
      '  vibekit completion install [shell]   writes it for you, and says where',
      '  vibekit completion --check           is the installed script this version',
      '',
      '  It completes your projects, sprints, releases and files, not just the grammar.',
      '',
    ].join('\n'));
    return;
  }
  process.stdout.write(script(shell, version));
}
