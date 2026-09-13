// What the agents remember about this project, and what you can do about it.
//
// Recall answers a question. These answer the other one — what does it think it knows — because a
// memory you cannot see is a memory you cannot correct, and a wrong one is quietly repeated into
// every brief from here on. So every row prints its id: an id is what turns "that is wrong" into
// something you can act on.
//
// Correcting is delete-then-save rather than an edit. agentmemory supersedes a memory when a new
// one is close enough to it, which is the right behaviour for an agent writing as it works and the
// wrong one for a person saying "no, it is this": a correction that only sometimes replaces what it
// corrects is worse than no correction at all.

import { CAPTURE_KINDS, forgetMemories, isMemoryEnabled, listMemories, memoryHealth, recall, remember, searchMemories } from '../memory.js';
import { loadProject, saveProject } from '../project.js';

const USAGE = `Usage:
  vibecheck memory status                        Is agentmemory reachable?
  vibecheck memory list [--limit <n>]            What it holds for this project, newest first
  vibecheck memory search "<text>"               Find memories, with their ids
  vibecheck memory recall "<text>"               What an agent would be told, as it would read it
  vibecheck memory remember "<fact>"             Save one yourself
  vibecheck memory correct <id> "<fact>"         Replace a wrong memory with the right one
  vibecheck memory forget <id> [<id> ...]        Delete outright. There is no undo
  vibecheck memory capture [<kind> ...]          What vibecheck records by itself (${CAPTURE_KINDS.join(', ')})`;

const day = (value) => (value ? String(value).slice(0, 10) : '');

const line = (memory) => {
  const text = String(memory.content ?? memory.title ?? '').replace(/\s+/g, ' ').trim();
  const version = memory.version > 1 ? ` · v${memory.version}` : '';
  return `  ${memory.id}  ${day(memory.createdAt)}${version}\n    ${text.slice(0, 240)}`;
};

async function status(project) {
  const { ok, detail } = await memoryHealth(project);
  console.log(`${ok ? '✔' : '✖'} ${detail}`);
  const capture = project.memory.capture ?? CAPTURE_KINDS;
  console.log(`  Recording by itself: ${capture.length ? capture.join(', ') : 'nothing — only what you save yourself'}`);
  if (!ok) process.exitCode = 1;
}

async function listCommand(project, _text, options) {
  const memories = await listMemories(project, { limit: Number(options.limit) || 50 });
  if (!memories.length) {
    console.log('Nothing remembered for this project yet (or agentmemory is not reachable — see "vibecheck memory status").');
    return;
  }
  console.log(`${memories.length} memor${memories.length === 1 ? 'y' : 'ies'} for ${project.project.name}, newest first:\n`);
  memories.forEach((memory) => console.log(line(memory)));
  console.log('\nWrong? vibecheck memory correct <id> "<the right version>"   ·   Gone for good: vibecheck memory forget <id>');
}

async function searchCommand(project, text) {
  const memories = await searchMemories(project, text);
  if (!memories.length) {
    console.log('Nothing matched (or agentmemory is not reachable — see "vibecheck memory status").');
    return;
  }
  memories.forEach((memory) => console.log(line(memory)));
}

async function recallCommand(project, text) {
  const memories = await recall(project, text);
  if (!memories.length) {
    console.log('No matching memories (or agentmemory is not reachable — see "vibecheck memory status").');
    return;
  }
  memories.forEach((memory) => console.log(`- ${memory}`));
}

async function rememberCommand(project, text) {
  const saved = await remember(project, text, ['note']);
  console.log(saved ? '✔ Saved to agentmemory' : '✖ Not saved — see "vibecheck memory status"');
  if (!saved) process.exitCode = 1;
}

async function forgetCommand(project, text) {
  const ids = text.split(/[\s,]+/).filter(Boolean);
  const { deleted, asked } = await forgetMemories(project, ids);
  // agentmemory reports what it actually found. An id that was already gone is not a deletion,
  // and calling it one would be a quiet lie about what this machine now knows.
  console.log(deleted === asked
    ? `✔ Forgot ${deleted} of ${asked}.`
    : `✔ Forgot ${deleted} of ${asked}. The rest were not there — check the ids with "vibecheck memory list".`);
}

async function correctCommand(project, text) {
  const [id, ...rest] = text.split(/\s+/);
  const replacement = rest.join(' ').trim();
  if (!id || !replacement) throw new Error('Usage: vibecheck memory correct <id> "<the right version>"');
  const { deleted } = await forgetMemories(project, [id], 'vibecheck memory correct');
  if (!deleted) throw new Error(`There is no memory ${id}. List them with "vibecheck memory list".`);
  const saved = await remember(project, replacement, ['note']);
  if (!saved) throw new Error(`The old memory is gone, but the replacement was not saved: ${replacement}`);
  console.log(`✔ ${id} replaced.`);
}

/**
 * What vibecheck may record without being asked. With no arguments it reports; with kinds it sets
 * the list, and `none` switches the lot off without turning off memory itself — you can still
 * recall, and still save something deliberately.
 */
async function captureCommand(project, text, _options, root) {
  if (!text) {
    const capture = project.memory.capture ?? CAPTURE_KINDS;
    console.log(capture.length ? `Recording by itself: ${capture.join(', ')}` : 'Recording nothing by itself.');
    console.log(`Available: ${CAPTURE_KINDS.join(', ')}   ·   Off: vibecheck memory capture none`);
    return;
  }
  const wanted = text.split(/[\s,]+/).filter(Boolean);
  const chosen = wanted.length === 1 && wanted[0] === 'none' ? [] : wanted;
  const unknown = chosen.filter((kind) => !CAPTURE_KINDS.includes(kind));
  if (unknown.length) throw new Error(`There is nothing called ${unknown.join(', ')}. Choose from: ${CAPTURE_KINDS.join(', ')}, or "none".`);
  await saveProject(root, { ...project, memory: { ...project.memory, capture: chosen } });
  console.log(chosen.length ? `✔ Recording by itself: ${chosen.join(', ')}` : '✔ Recording nothing by itself. You can still recall, and still save memories yourself.');
}

const ACTIONS = {
  status,
  list: listCommand,
  search: searchCommand,
  recall: recallCommand,
  remember: rememberCommand,
  forget: forgetCommand,
  correct: correctCommand,
  capture: captureCommand,
};

// The ones that read or write a particular fact need something to work on; the rest stand alone.
const NEEDS_TEXT = new Set(['search', 'recall', 'remember', 'forget', 'correct']);

export async function memory({ root, args, limit }) {
  const [action, ...words] = args;
  const text = words.join(' ').trim();
  const run = ACTIONS[action];
  if (!run || (NEEDS_TEXT.has(action) && !text)) throw new Error(USAGE);
  const project = await loadProject(root);
  if (!isMemoryEnabled(project)) throw new Error('Memory is off. Set "memory": { "provider": "agentmemory" } in specs/project.json.');
  await run(project, text, { limit }, root);
}
