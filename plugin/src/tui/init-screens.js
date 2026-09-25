import { bar } from './surface.js';

/**
 * The screens of `vibekit` on first run, as pure functions of their facts, so the three surfaces
 * are provably the same words in a different dress (Init Spec §6 rule 3). Full mode is space
 * and one accent; agent mode is Markdown a model relays faithfully; plain mode is one fact per
 * line for a pipe.
 */

export const OPENING = Object.freeze({
  lead: 'Before I build anything, I need to understand what you want.',
  question: 'What are you building?',
  hint: 'Describe it in a sentence or two, or give me a path to a requirements document.',
  keys: '⏎ when you\'re done  ·  or drop a requirements document here',
});

const s = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** §2. The first screen: one question, a gutter, nothing about VibeKit. */
export function openingScreen({ surface, palette: c, existingFiles = 0, resume = false }) {
  const existing = existingFiles ? `${s(existingFiles, 'file')} here already — I'll read them before I ask anything.` : null;
  if (surface === 'agent') {
    return [
      ...(existing ? [existing, ''] : []),
      OPENING.lead,
      '',
      `**${OPENING.question}** ${OPENING.hint}`,
      '',
      `Reply, and I run: \`vibekit "<your answer>"\`${resume ? '' : ' (or `vibekit --from <file>` for a document)'}.`,
    ].join('\n');
  }
  if (surface === 'plain') {
    return [
      ...(existing ? [`existing ${existingFiles} files`] : []),
      `question ${OPENING.question}`,
      `answer vibekit "<a sentence or two>"   or   vibekit --from <requirements document>`,
    ].join('\n');
  }
  return [
    '',
    '',
    ...(existing ? [`  ${c.muted(existing)}`, ''] : []),
    `  ${OPENING.lead}`,
    '',
    `  ${c.bold(OPENING.question)}`,
    '',
  ].join('\n');
}

/** §3. Setup is reported, not requested: three lines, then how many questions and how many matter. */
export function setupReport({ surface, palette: c, reading, tools, changed = 0, questions, shape }) {
  const readingLine = reading ? `${reading.summary}` : 'nothing here yet — starting from your description';
  const toolsLine = tools.length ? `${tools.map((tool) => tool.label).join(', ')} — and AGENTS.md for the rest` : 'AGENTS.md — no coding tool found on this machine yet; whichever you install reads it';
  const checkLine = changed ? `${s(changed, 'existing file')} changed — see the list above` : 'nothing existing was changed';
  const next = `Now — ${s(questions, 'question')}. ${shape} of them change the shape of the app.`;
  if (surface === 'agent') {
    return [
      `Set up for ${tools.length ? tools.map((tool) => tool.label).join(', ') + ', plus `AGENTS.md` for anything else' : '`AGENTS.md`; no coding tool was found on this machine yet'}.`,
      reading ? `${reading.summary}; ${checkLine}.` : `Nothing was here before; ${checkLine}.`,
      '',
      `**${s(questions, 'question')} — ${shape} change the shape of the app.**`,
    ].join('\n');
  }
  if (surface === 'plain') {
    return [
      `tools ${tools.map((tool) => tool.id).join(' ')}${tools.length ? ' ' : ''}agents.md`,
      reading ? `existing ${reading.files} files unchanged` : 'existing 0 files',
      `questions ${questions} shape ${shape}`,
    ].join('\n');
  }
  const label = (text) => c.muted(text.padEnd(22));
  return [
    '  Got it.',
    '',
    `  ${label('Reading what\'s here')} ${reading ? `${bar(1, { palette: c })}  ${readingLine}` : c.muted(readingLine)}`,
    `  ${label('Setting up')} ${toolsLine}`,
    `  ${label('Checking')} ${checkLine}`,
    '',
    `  ${next}`,
    '',
  ].join('\n');
}

/** A later run that found a tool it had not seen. One line, once, no question. */
export const noticedLine = (labels) => `Noticed ${labels.join(' and ')} since last time — added ${labels.length === 1 ? 'its' : 'their'} config.`;

export const DONT_KNOW = Object.freeze({ id: '?', label: 'I don\'t know', description: 'records it as a guess for you to check' });
export const KEYS_LINE = '↑↓ move  ⏎ choose  t type something else  esc back';

/** §4. One question per screen: counter, question, consequence, options, the "I don't know" row, keys. */
export function questionScreen({ surface, palette: c, question, index, total, shape, cursor = 0 }) {
  const counter = `${index + 1} of ${total}`;
  const options = question.options.map((option, n) => ({ n: n + 1, ...option }));
  if (surface === 'agent') {
    return [
      `**${index + 1}. ${question.question}**`,
      '',
      question.why,
      '',
      ...options.map((option) => `${option.n}. ${option.label}`),
      `${options.length + 1}. ${DONT_KNOW.label} — record it as a guess I'll check later`,
      '',
      `Reply with a number. Then I run \`vibekit ${'<number>'}\`; \`vibekit "<words>"\` for something else.`,
    ].join('\n');
  }
  if (surface === 'plain') {
    return [
      `question ${index + 1}/${total} ${question.question}`,
      ...options.map((option) => `option ${option.n} ${option.label}`),
      `option ${options.length + 1} ${DONT_KNOW.label}`,
      `answer vibekit <number>   or   vibekit "<words>"`,
    ].join('\n');
  }
  const width = 62;
  const shapeNote = `${shape} change the shape`;
  const rows = [...options, { n: '?', label: DONT_KNOW.label, description: DONT_KNOW.description }];
  return [
    '',
    '',
    `  ${c.muted(counter)}${' '.repeat(Math.max(1, width - counter.length - shapeNote.length))}${c.muted(shapeNote)}`,
    '',
    `  ${c.bold(question.question)}`,
    '',
    ...wrap(question.why, width).map((line) => `  ${c.muted(line)}`),
    '',
    ...rows.map((row, at) => {
      const current = at === cursor;
      const pointer = current ? c.teal('▸') : ' ';
      const label = current ? row.label : c.muted(row.label);
      const detail = row.description && (current || row.n === '?') ? `${' '.repeat(Math.max(2, 34 - row.label.length))}${c.muted(row.description)}` : '';
      return `  ${pointer} ${String(row.n).padEnd(3)} ${label}${detail}`;
    }).flatMap((line, at) => (at === rows.length - 1 ? ['', line] : [line])),
    '',
    '',
    `  ${c.muted(KEYS_LINE)}`,
    '',
  ].join('\n');
}

/** After the last question. */
export function doneScreen({ surface, palette: c, answered, assumed, next = 'vibekit show status' }) {
  const summary = `${s(answered, 'answer')} recorded${assumed ? `, ${s(assumed, 'guess')} written down for you to check` : ''}.`;
  if (surface === 'agent') return [summary, '', `Next: \`${next}\` — where the analyst's questions land, and where each stage waits for your approval.`].join('\n');
  if (surface === 'plain') return [`answered ${answered}`, `assumed ${assumed}`, `next ${next}`].join('\n');
  return ['', `  ${summary}`, '', `  ${c.muted('Next')}   ${next}`, ''].join('\n');
}

/** §7. Three parts, always: what happened, why it matters, what to do. */
export function errorScreen({ surface, palette: c, what, why, tries = [] }) {
  if (surface === 'plain') return [`error ${what}`, `why ${why}`, ...tries.map((line) => `try ${line}`)].join('\n');
  if (surface === 'agent') return [`**${what}**`, '', why, '', ...(tries.length ? ['Try:', ...tries.map((line) => `- \`${line}\``)] : [])].join('\n');
  return [
    '',
    `  ${c.brick(what)}`,
    '',
    ...wrap(why, 66).map((line) => `  ${c.muted(line)}`),
    '',
    ...tries.map((line, at) => `  ${at === 0 ? c.muted('Try') : '   '}   ${line}`),
    '',
  ].join('\n');
}

/** §6 plain mode: the facts, one per line, greppable. */
export const plainFacts = (rows) => rows.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => `${key} ${value}`).join('\n');

/** §5. The wordmark, on `--version` and nowhere else. */
export const wordmark = (version) => `◣ vibekit ${version}\n  Agents build it. You decide it.`;

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) { lines.push(line.trim()); line = word; } else line = `${line} ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
