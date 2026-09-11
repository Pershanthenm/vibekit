import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPrompter } from './prompt.js';

const OTHER = { id: '__other', label: 'Other (type your own)', description: '' };
const DIM = (text) => `\x1b[2m${text}\x1b[22m`;
const CYAN = (text) => `\x1b[36m${text}\x1b[39m`;

const entriesOf = (question) => (question.noOther ? question.options : [...question.options, OTHER]);

export function initialMenuState(question = {}) {
  const defaults = question.defaults ?? [];
  const cursor = Math.max(0, (question.options ?? []).findIndex((option) => option.id === defaults[0]));
  return { cursor, selected: question.multi ? [...defaults] : [], status: 'active' };
}

function toggle(selected, id) {
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}

function submit(state, question) {
  const current = entriesOf(question)[state.cursor];
  if (current === OTHER) return { ...state, status: 'other' };
  const selected = question.multi && state.selected.length ? state.selected : [current.id];
  return { ...state, selected, status: 'submitted' };
}

export function reduceMenu(state, key, question) {
  const count = entriesOf(question).length;
  const current = entriesOf(question)[state.cursor];
  if (key.ctrl && key.name === 'c') return { ...state, status: 'aborted' };
  if (key.name === 'up' || key.name === 'k') return { ...state, cursor: (state.cursor - 1 + count) % count };
  if (key.name === 'down' || key.name === 'j') return { ...state, cursor: (state.cursor + 1) % count };
  if (key.name === 'space' && question.multi && current !== OTHER) return { ...state, selected: toggle(state.selected, current.id) };
  if (key.name === 'return' || key.name === 'enter') return submit(state, question);
  return state;
}

export function renderMenu(state, question) {
  const lines = entriesOf(question).map((option, index) => {
    const pointer = index === state.cursor ? CYAN('❯') : ' ';
    const box = question.multi && option !== OTHER ? `${state.selected.includes(option.id) ? CYAN('◉') : '◯'} ` : '';
    const detail = index === state.cursor && option.description ? DIM(` — ${option.description}`) : '';
    return `${pointer} ${box}${option.label}${detail}`;
  });
  const hint = question.multi ? '↑↓ move · space select · enter confirm' : '↑↓ move · enter select';
  return [`${CYAN('?')} ${question.question}`, ...lines, DIM(hint)].join('\n');
}

export const answerSummary = (question, answer) =>
  answer?.other ?? [answer].flat().map((id) => question.options.find((option) => option.id === id)?.label ?? id).join(', ');

async function askText(prompt, fallback = '') {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const hint = fallback ? ` (${fallback})` : '';
    return (await readline.question(`${CYAN('?')} ${prompt}${hint}: `)).trim() || fallback;
  } finally {
    readline.close();
  }
}

function runMenu(question) {
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  let state = initialMenuState(question);
  let drawnLines = 0;
  const draw = () => {
    if (drawnLines) stdout.write(`\x1b[${drawnLines}A\x1b[0J`);
    const text = renderMenu(state, question);
    stdout.write(`${text}\n`);
    drawnLines = text.split('\n').length;
  };
  stdout.write('\x1b[?25l');
  draw();
  return new Promise((resolve, reject) => {
    const onKey = (_, key = {}) => {
      state = reduceMenu(state, key, question);
      if (state.status === 'active') return draw();
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write(`\x1b[${drawnLines}A\x1b[0J\x1b[?25h`);
      if (state.status === 'aborted') return reject(new Error('Cancelled.'));
      resolve(state);
    };
    stdin.on('keypress', onKey);
  });
}

async function menu(question) {
  const state = await runMenu(question);
  const answer = state.status === 'other'
    ? { other: await askText(question.question) }
    : question.multi ? state.selected : state.selected[0];
  stdout.write(`${CYAN('✔')} ${question.header}: ${answerSummary(question, answer)}\n`);
  return answer;
}

async function numbered(prompter, question) {
  const labels = question.options.map((option) => option.label);
  const toId = (label) => question.options.find((option) => option.label === label)?.id;
  if (!question.multi) {
    const fallback = question.options.find((option) => option.id === question.defaults?.[0])?.label ?? labels[0];
    const picked = await prompter.choose(question.question, labels, fallback);
    return toId(picked) ?? { other: picked };
  }
  const defaults = question.options.filter((option) => question.defaults?.includes(option.id)).map((option) => option.label);
  const picked = await prompter.pick(question.question, labels, defaults);
  const ids = picked.map(toId);
  return ids.every(Boolean) ? ids : { other: picked.join(', ') };
}

export function createAsker() {
  if (stdin.isTTY) return { choose: menu, text: askText, close: () => {} };
  const prompter = createPrompter();
  return { choose: (question) => numbered(prompter, question), text: prompter.ask, close: prompter.close };
}
