import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { DONT_KNOW, KEYS_LINE, OPENING, questionScreen } from './init-screens.js';

/**
 * Full-mode input (Init Spec §2 and §4): a gutter for prose, a cursor for options. Only ever
 * called on a TTY; the agent and plain surfaces never reach here.
 */

/** The opening answer: lines behind a `▏` gutter; Enter on a non-empty answer submits. A pasted document arrives as many lines at once and is kept whole. */
export async function readDescription({ palette: c, input = stdin, output = stdout }) {
  const gutter = `  ${c.teal('▏')}`;
  // The keys line sits two lines under the input before anything is typed, and the cursor goes
  // back up to the gutter; on a pipe there is no cursor to move, so the hint simply precedes.
  if (input.isTTY) output.write(`\n\n  ${c.muted(OPENING.keys)}\x1b[2A\r${gutter}`);
  else output.write(`  ${c.muted(OPENING.keys)}\n${gutter}`);
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  const lines = [];
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      rl.close();
      if (input.isTTY) output.write('\x1b[0J');
      output.write('\n');
      resolve(lines.join('\n').trim());
    };
    rl.on('line', (line) => {
      if (timer) clearTimeout(timer);
      const text = String(line);
      if (!text.trim() && !lines.length) { output.write(gutter); return; }
      lines.push(text);
      // A paste delivers its lines within a few milliseconds; a person's Enter stands alone.
      timer = setTimeout(() => {
        const whole = lines.join('\n').trim();
        if (looksLikePath(whole) || whole) finish();
      }, 40);
      output.write(gutter);
    });
    rl.on('close', () => { if (timer) clearTimeout(timer); if (lines.length) resolve(lines.join('\n').trim()); else resolve(''); });
  });
}

export const looksLikePath = (text) => /^[~./\\]|^[A-Za-z]:\\/.test(String(text).trim()) && !/\s{2,}/.test(text) && existsSync(String(text).trim().replace(/^~/, process.env.HOME ?? ''));

/**
 * One question: arrow keys move, Enter chooses, `?` is "I don't know", `t` types something else,
 * Esc goes back. Returns { option } | { dontKnow: true } | { text } | { back: true }.
 */
export async function askQuestion({ palette: c, question, index, total, shape, input = stdin, output = stdout }) {
  const rows = question.options.length + 1;
  let cursor = 0;
  let drawn = 0;
  const draw = () => {
    if (drawn) output.write(`\x1b[${drawn}A\x1b[0J`);
    const text = questionScreen({ surface: 'full', palette: c, question, index, total, shape, cursor });
    output.write(`${text}\n`);
    drawn = text.split('\n').length;
  };
  emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  input.resume();
  output.write('\x1b[?25l');
  draw();
  const result = await new Promise((resolve, reject) => {
    const onKey = (chunk, key = {}) => {
      if (key.ctrl && key.name === 'c') return done(reject, new Error('Cancelled.'));
      if (key.name === 'up' || key.name === 'k') { cursor = (cursor - 1 + rows) % rows; return draw(); }
      if (key.name === 'down' || key.name === 'j') { cursor = (cursor + 1) % rows; return draw(); }
      if (chunk === '?') return done(resolve, { dontKnow: true });
      if (chunk === 't') return done(resolve, { type: true });
      if (key.name === 'escape') return done(resolve, { back: true });
      if (/^[1-9]$/.test(chunk ?? '') && Number(chunk) <= question.options.length) return done(resolve, { option: question.options[Number(chunk) - 1] });
      if (key.name === 'return' || key.name === 'enter') return done(resolve, cursor === rows - 1 ? { dontKnow: true } : { option: question.options[cursor] });
      return null;
    };
    const done = (settle, value) => {
      input.off('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      output.write(`\x1b[${drawn}A\x1b[0J\x1b[?25h`);
      settle(value);
    };
    input.on('keypress', onKey);
  });
  if (result.type) {
    const rl = createInterface({ input, output });
    try {
      output.write(`  ${c.muted('In your own words — Enter to send, empty to go back')}\n`);
      const text = (await rl.question(`  ${c.teal('▏')}`)).trim();
      return text ? { text } : { back: true };
    } finally {
      rl.close();
    }
  }
  const chosen = result.option ? result.option.label : result.dontKnow ? DONT_KNOW.label : null;
  if (chosen) output.write(`  ${c.teal('✔')} ${c.muted(question.question)}  ${chosen}\n`);
  return result;
}

export { KEYS_LINE };
