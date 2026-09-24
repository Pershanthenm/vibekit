import { answerAsk, blastRadius, isOpen, listAsks, rejectAsk } from '../folder/asks.js';
import { listRequirements } from '../folder/requirements.js';
import { gateState, STAGES } from '../folder/workflow.js';
import { readText, writeText } from '../fsutil.js';
import { createAsker } from '../menu.js';
import { folderIn, listProjects, register } from '../projects.js';
import { folderName } from './folder.js';

/**
 * `vibekit action`. Specification §67 ("Answer from anywhere").
 *
 * "Decisions are the thing that blocks work, so they are the one exception worth making. `vibekit
 * action` gathers every open ask across every project into one queue, ordered by how much work
 * each is blocking, and lets you answer them without moving."
 *
 * Each answer is written and committed in its own project, through the same function the CLI
 * calls there. The only cross-project thing here is the list.
 */

/** Everything waiting on a person in one project: asks by blast radius, then the gate that is ready. */
export async function decisionsIn(root, folder) {
  const [asks, requirements, gates] = await Promise.all([listAsks(root, folder), listRequirements(root, folder), gateState(root, folder)]);
  const items = asks.filter(isOpen).map((ask) => {
    const radius = blastRadius(ask, requirements);
    return {
      kind: 'ask', id: ask.id, blocks: radius.count ?? radius.length ?? 0, blocking: Boolean(ask.blocking),
      plain: ask.plain || ask.ask.split('\n')[0], command: `vibekit ask answer ${ask.id} "<answer>"`,
    };
  });
  for (const stage of STAGES.slice(0, 5)) {
    const gate = gates[stage.n];
    if (gate && !gate.passed && /approved|reviewed|approve/.test(gate.detail) && !gate.skipped) {
      items.push({ kind: 'gate', id: `stage ${stage.n}`, blocks: requirements.filter((entry) => entry.status !== 'done').length, blocking: true, plain: `The ${stage.name} stage is waiting for your approval: ${gate.detail}`, command: 'vibekit sprint run' });
      break;
    }
  }
  const closable = requirements.filter((entry) => entry.status === 'review' && entry.review.trim());
  for (const entry of closable) {
    items.push({ kind: 'close', id: entry.id, blocks: requirements.filter((other) => other.after.includes(entry.id) && other.status !== 'done').length, blocking: false, plain: `${entry.title} is reviewed and waiting for you to call it done`, command: `vibekit req done ${entry.id}` });
  }
  return items.sort(byUrgency);
}

/** §57's order: asks by blast radius, then gates ready to approve, then reviewed work to close. */
const RANK = { ask: 0, gate: 1, close: 2 };
export const byUrgency = (a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || Number(b.blocking) - Number(a.blocking) || b.blocks - a.blocks;

export async function action(options) {
  const { root, args, json, project: only } = options;
  const [verb, ...rest] = args;

  // Answering. Four ways, because a person with one question and a person with twelve are not
  // in the same situation:
  //   vibekit action answer                       walk through them one at a time, options as a menu
  //   vibekit action answer 3 "text" 5 "text"     several at once, by number or id
  //   vibekit action export > answers.md          a fill-in file; then
  //   vibekit action answer --from answers.md     every line that has an answer
  if (verb === 'export') return exportQueue(await gather(root, only), options);
  if (verb === 'answer' || verb === 'reject') {
    const queue = await gather(root, only);
    if (options.from) return fromFile(queue, options);
    if (!rest.length) {
      if (verb === 'reject') throw new Error('Usage: vibekit action reject <number | ask id> "<reason>"');
      return walk(queue, options);
    }
    if (rest.length % 2) throw new Error(`Usage: vibekit action ${verb} <number | ask id> "<${verb === 'answer' ? 'answer' : 'reason'}>" [<number | id> "<text>" …]   ·   or just \`vibekit action answer\` to be walked through them`);
    const results = [];
    for (let at = 0; at < rest.length; at += 2) {
      const target = pick(queue, rest[at]);
      results.push(await settle(target, verb === 'reject' ? { reject: rest[at + 1] } : { answer: rest[at + 1] }, options));
    }
    if (json) return void console.log(JSON.stringify(results, null, 2));
    for (const result of results) console.log(`✔ ${result.project} · ${result.id} ${result.status}`);
    return;
  }

  const queue = await gather(root, only);
  if (json) return void console.log(JSON.stringify(queue, null, 2));
  if (!queue.length) {
    console.log('Nothing needs you. Agents have what they need, and every gate that could open has.');
    return;
  }
  const projects = new Set(queue.map((item) => item.project));
  console.log(`${queue.length} decision${queue.length === 1 ? '' : 's'} across ${projects.size} project${projects.size === 1 ? '' : 's'}, most blocking first`);
  console.log('');
  const width = Math.max(...queue.map((item) => item.project.length));
  const idWidth = Math.max(...queue.map((item) => item.id.length));
  queue.forEach((item, index) => {
    console.log(`  ${String(index + 1).padStart(2)}. ${item.project.padEnd(width)}  ${item.id.padEnd(idWidth)}  blocks ${String(item.blocks).padEnd(3)} ${item.plain}`);
  });
  console.log('');
  const asks = queue.filter((item) => item.kind === 'ask').length;
  if (asks) {
    console.log(`  vibekit action answer                        walk through the ${asks === 1 ? 'question' : `${asks} questions`}, one at a time, options as a menu`);
    console.log('  vibekit action answer <n> "<answer>" …       one or several, by number or id; `reject <n> "<reason>"` sends one back');
    console.log('  vibekit action export > answers.md           a file to fill in offline; `vibekit action answer --from answers.md` applies it');
  }
  const other = queue.filter((item) => item.kind !== 'ask');
  if (other.length) console.log(`  ${other.map((item) => item.command).filter((value, index, all) => all.indexOf(value) === index).join(' · ')}   for the ${other.length === 1 ? 'gate or review' : 'gates and reviews'} above`);
}

/**
 * Which queue item "3", "Q-004" or "stock-take/Q-004" means. Ask ids are per project, so the same
 * id can be open in two projects at once; then only the qualified form is accepted, because a
 * guess that answered the wrong project's question would be worse than a refusal.
 */
export function pick(queue, which) {
  const text = String(which).trim();
  if (/^\d+$/.test(text)) {
    const item = queue[Number(text) - 1];
    if (!item) throw new Error(`Nothing in the queue is number ${text}. \`vibekit action\` lists what is.`);
    if (item.kind !== 'ask') throw new Error(`${text} is ${item.id}, which is not a question to answer here: ${item.command}`);
    return item;
  }
  const [projectPart, idPart] = text.includes('/') ? text.split('/', 2) : [null, text];
  const matches = queue.filter((item) => item.kind === 'ask' && item.id.toLowerCase() === idPart.toLowerCase() && (!projectPart || item.project.toLowerCase() === projectPart.toLowerCase()));
  if (!matches.length) throw new Error(`Nothing in the queue is "${text}" and an ask. \`vibekit action\` lists what is.`);
  if (matches.length > 1) throw new Error(`${idPart} is open in ${matches.map((item) => item.project).join(' and ')}. Say which: ${matches.map((item) => `${item.project}/${item.id}`).join(' or ')}.`);
  return matches[0];
}

/** Write one answer or rejection into its own project, through the same functions `vibekit ask` uses there. */
async function settle(target, { answer = null, reject = null }, options) {
  const by = options.by ?? 'action';
  const result = reject !== null
    ? await rejectAsk(target.root, target.id, { reason: reject, by }, target.folder)
    : await answerAsk(target.root, target.id, { answer, by }, target.folder);
  return { project: target.project, id: result.id, status: result.status ?? 'rejected', for: result.for };
}

/** The ask's full text, for the options and the reason it was asked. */
async function detail(target) {
  const asks = await listAsks(target.root, target.folder).catch(() => []);
  return asks.find((ask) => ask.id === target.id) ?? { options: [], why: '', ask: target.plain };
}

/**
 * The walk. One question at a time, the agent's options as a menu with "type my own", "skip",
 * "reject" and "stop" beneath them; each answer is written the moment it is given, so stopping
 * halfway loses nothing. Gates and reviews are not walked: they have their own commands and a
 * person should read the work before approving it, not a summary line.
 */
async function walk(queue, options) {
  const asks = queue.filter((item) => item.kind === 'ask');
  if (!asks.length) {
    console.log('No questions are waiting.');
    for (const item of queue) console.log(`  ${item.project} · ${item.plain}  →  ${item.command}`);
    return;
  }
  const asker = options.asker ?? createAsker();
  const done = [];
  let stopped = false;
  try {
    for (const [index, target] of asks.entries()) {
      const ask = await detail(target);
      console.log('');
      console.log(`── ${index + 1} of ${asks.length} · ${target.project} · ${target.id}${target.blocking ? ' · blocking' : ''}${target.blocks ? ` · blocks ${target.blocks} requirement(s)` : ''}`);
      console.log(`   ${target.plain}`);
      const why = String(ask.why ?? '').trim().split('\n').filter((line) => line.trim() && !/^\s*(?:TODO|_)/.test(line)).slice(0, 2).join(' ');
      if (why) console.log(`   why: ${why}`);
      const choice = await asker.choose({
        header: target.id,
        question: 'Your decision',
        noOther: true,
        options: [
          ...ask.options.map((option, at) => ({ id: `option-${at}`, label: option })),
          { id: '__type', label: 'Type my own answer' },
          { id: '__skip', label: 'Skip for now' },
          { id: '__reject', label: 'Send it back (reject, with a reason)' },
          { id: '__stop', label: 'Stop here' },
        ],
      });
      const picked = typeof choice === 'string' ? choice : `__typed:${choice.other ?? ''}`;
      if (picked === '__stop') { stopped = true; break; }
      if (picked === '__skip') { done.push({ project: target.project, id: target.id, status: 'skipped' }); continue; }
      if (picked === '__reject') {
        const reason = (await asker.text('Why is it sent back', '')).trim();
        if (!reason) { done.push({ project: target.project, id: target.id, status: 'skipped' }); continue; }
        done.push(await settle(target, { reject: reason }, options));
      } else {
        let answer = picked.startsWith('option-') ? ask.options[Number(picked.slice(7))] : picked.startsWith('__typed:') ? picked.slice(8) : null;
        if (picked === '__type' || !answer) answer = (await asker.text('Your answer (empty skips)', '')).trim();
        if (!answer) { done.push({ project: target.project, id: target.id, status: 'skipped' }); continue; }
        done.push(await settle(target, { answer }, options));
      }
      const last = done[done.length - 1];
      console.log(`   ✔ ${last.project} · ${last.id} ${last.status}`);
    }
  } finally {
    asker.close?.();
  }
  const settled = done.filter((item) => item.status !== 'skipped');
  const skipped = done.filter((item) => item.status === 'skipped');
  console.log('');
  console.log(`${settled.length} decision${settled.length === 1 ? '' : 's'} written${skipped.length ? `, ${skipped.length} skipped` : ''}${stopped ? `, ${asks.length - done.length} not reached` : ''}. Each is in its own project, ready for the next agent that looks.`);
  if (options.json) console.log(JSON.stringify(done, null, 2));
  return done;
}

// ---------------------------------------------------------------- the fill-in file

/**
 * `vibekit action export`: the queue as a file a person fills in wherever they are — on a plane,
 * in a meeting, in an editor that is not a terminal. One line per question, the answer after the
 * colon; `reject:` before the text sends it back; a blank stays open. Everything else is a comment.
 */
async function exportQueue(queue, options) {
  const asks = queue.filter((item) => item.kind === 'ask');
  const lines = [
    `# Decisions waiting · ${new Date().toISOString().slice(0, 10)} · fill in after the colon, leave blank to skip`,
    '# `reject: <reason>` sends a question back. Lines starting with # are ignored.',
    '# Apply with: vibekit action answer --from <this file>',
  ];
  for (const target of asks) {
    const ask = await detail(target);
    lines.push('', `# ${target.project} · ${target.blocking ? 'blocking · ' : ''}blocks ${target.blocks} · ${target.plain}`);
    if (ask.options.length) lines.push(`#   options: ${ask.options.join(' | ')}`);
    lines.push(`${target.project}/${target.id}: `);
  }
  if (!asks.length) lines.push('', '# No questions are waiting.');
  const text = `${lines.join('\n')}\n`;
  if (options.out) {
    await writeText(options.out, text);
    console.log(`✔ ${asks.length} question(s) written to ${options.out}. Fill it in, then: vibekit action answer --from ${options.out}`);
    return;
  }
  process.stdout.write(text);
}

/** Read a filled-in file: `project/ID: answer` or `ID: answer`, continued on following lines until the next entry. */
export function parseAnswers(text) {
  const entries = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*#/.test(line)) continue;
    const head = line.match(/^([A-Za-z0-9][\w.-]*(?:\/[A-Za-z][\w-]*)?|[A-Za-z][\w-]*-\d+):\s?(.*)$/);
    if (head && /-\d+$/.test(head[1])) { entries.push({ which: head[1], text: head[2] }); continue; }
    if (entries.length && line.trim()) entries[entries.length - 1].text += `\n${line}`;
  }
  return entries
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter((entry) => entry.text)
    .map((entry) => {
      const reject = entry.text.match(/^reject:\s*([\s\S]*)$/i);
      return reject ? { which: entry.which, reject: reject[1].trim() || 'Rejected.' } : { which: entry.which, answer: entry.text };
    });
}

async function fromFile(queue, options) {
  const text = await readText(options.from);
  if (text === null) throw new Error(`${options.from} is not readable.`);
  const entries = parseAnswers(text);
  if (!entries.length) { console.log(`Nothing to apply: no line in ${options.from} has an answer after its colon.`); return []; }
  const results = [];
  const problems = [];
  for (const entry of entries) {
    try {
      results.push(await settle(pick(queue, entry.which), entry, options));
    } catch (error) {
      problems.push(`${entry.which}: ${error.message}`);
    }
  }
  if (options.json) return void console.log(JSON.stringify({ applied: results, problems }, null, 2));
  for (const result of results) console.log(`✔ ${result.project} · ${result.id} ${result.status}`);
  for (const problem of problems) console.log(`✖ ${problem}`);
  console.log(`${results.length} applied${problems.length ? `, ${problems.length} not applied` : ''}.`);
  if (problems.length) process.exitCode = 1;
  return results;
}

/** The queue: this project first when run inside one, then every registered project. */
async function gather(root, only) {
  const here = await folderIn(root);
  const projects = [];
  if (here) {
    const registered = await register(root).catch(() => null);
    projects.push({ name: registered?.name ?? root.split(/[\\/]/).pop(), path: root, folder: await folderName(root) });
  }
  for (const entry of await listProjects()) {
    if (projects.some((known) => known.path === entry.path) || !entry.folder) continue;
    projects.push({ name: entry.name, path: entry.path, folder: entry.folder });
  }
  const queue = [];
  for (const project of projects.filter((entry) => !only || entry.name === only || entry.path === only)) {
    const items = await decisionsIn(project.path, project.folder).catch(() => []);
    queue.push(...items.map((item) => ({ ...item, project: project.name, root: project.path, folder: project.folder })));
  }
  return queue.sort(byUrgency);
}
