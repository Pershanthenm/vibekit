import { access, constants, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { openAsk, answerAsk } from '../folder/asks.js';
import { generateFolder } from '../folder/generate.js';
import { exists, readText, writeText } from '../fsutil.js';
import { folderIn } from '../projects.js';
import { loadProject, saveProject } from '../project.js';
import { detectSurface, palette as makePalette } from '../tui/surface.js';
import { DONT_KNOW, doneScreen, errorScreen, noticedLine, openingScreen, plainFacts, questionScreen, setupReport } from '../tui/init-screens.js';
import { assumptionFor, selectQuestions, SHAPE_QUESTIONS } from './questions.js';
import { detectTools, parseToolsFlag, writeToolFiles } from './tools.js';

/**
 * `vibekit` with nothing here (Init Spec). One question — what are you building — then setup is
 * done and reported in three lines, then the questions that change the shape of the app, one
 * per screen. On an agent surface nothing blocks: each invocation prints one question and
 * exits, and the next invocation carries the answer. State lives in the folder, so an
 * interrupted setup resumes from anywhere, including a different tool.
 */

const STATE = '.state/init.json';
const PLATFORM_IDS = { web: ['web'], mobile: ['ios', 'android'], 'web,mobile': ['web', 'ios', 'android'], api: ['api'], cli: ['cli'] };

const statePath = (root, folder) => join(root, folder, STATE);
export async function readInitState(root, folder) {
  try { return JSON.parse((await readText(statePath(root, folder))) ?? 'null'); } catch { return null; }
}
async function writeInitState(root, folder, state) {
  await mkdir(dirname(statePath(root, folder)), { recursive: true });
  await writeText(statePath(root, folder), `${JSON.stringify(state, null, 2)}\n`);
}
export async function initPending(root) {
  const folder = await folderIn(root);
  if (!folder) return false;
  const state = await readInitState(root, folder);
  return Boolean(state && state.at < state.questions.length);
}

/** Does this look like an answer to the pending question, or a description, rather than a mistyped command? */
export async function looksLikeInitInput(root, positionals) {
  const text = positionals.join(' ').trim();
  if (!text) return false;
  const folder = await folderIn(root);
  if (!folder) return /\s/.test(text) || (await exists(resolve(root, text)));
  const state = await readInitState(root, folder);
  if (!state || state.at >= state.questions.length) return false;
  return /^\d+$/.test(text) || /\s/.test(text) || text === '?';
}

const capture = async (fn) => {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
};

async function countFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules').length;
}

export async function initFlow(options) {
  const env = options.env ?? process.env;
  const surface = detectSurface({ env, isTTY: options.isTTY ?? Boolean(process.stdout.isTTY), mode: options.mode ?? null });
  const c = makePalette({ env, surface });
  let root = options.root;
  const out = (text) => console.log(text);

  let folder = await folderIn(root);

  // ---------------------------------------------------------------- the first screen
  if (!folder) {
    const { looksLikeExistingCode } = await import('../guide.js');
    const hasCode = await looksLikeExistingCode(root);
    const existingFiles = hasCode ? await countFiles(root) : 0;
    let text = options.text ?? options.describe ?? null;
    let from = options.from ?? null;
    if (!text && !from) {
      out(openingScreen({ surface, palette: c, existingFiles }));
      if (surface !== 'full') return { asked: 'description' };
      const { readDescription } = await import('../tui/input.js');
      text = await readDescription({ palette: c });
      if (!text) return { asked: 'description' };
    }
    if (text && !from && (await exists(resolve(root, text.trim()))) && /\.(?:md|txt|docx|pdf|rtf|html?)$/i.test(text.trim())) { from = resolve(root, text.trim()); text = null; }

    try {
      await access(root, constants.W_OK);
    } catch {
      out(errorScreen({ surface, palette: c, what: 'I can\'t write here.', why: `${root} isn't writable, and I need to create a vibekit/ folder in it.`, tries: [`sudo chown -R $(whoami) ${root}`, 'or run this somewhere else'] }));
      process.exitCode = 1;
      return { error: 'not writable' };
    }

    // Reading what is here, without changing it.
    let reading = null;
    if (hasCode) {
      const { analyze } = await import('../commands/analyze.js');
      const raw = await capture(() => analyze({ root, args: ['.'], depth: 'quick', json: true })).catch(() => '');
      let summary = `${existingFiles} files read`;
      try {
        const report = JSON.parse(raw);
        const stack = String(report.plain ?? '').match(/built in ([^.]+?)(?:, with|\.)/)?.[1];
        summary = stack ? `${stack}` : summary;
      } catch { /* the count is enough */ }
      reading = { files: existingFiles, summary };
    }

    // The folder. Non-interactive; every answer the wizard would ask for is here or comes next.
    let name = options.name ?? basename(root);
    const platformGiven = Boolean(options.platform);
    if (options.where === 'local') {
      // A new folder, under the projects folder setup recorded or beside this one; the rest of the run happens there.
      const { readConfig } = await import('../prompts.js');
      const target = resolve((await readConfig())['projects-root'] ?? root, name);
      await mkdir(target, { recursive: true });
      root = target;
      name = options.name ?? basename(target);
    }
    const { project } = await import('../commands/project.js');
    await capture(() => project({ ...options, root, args: ['new'], name, yes: true, json: true, where: 'here', describe: text ?? undefined, from: from ?? undefined, platform: options.platform ?? 'web', answer: undefined, text: undefined, mode: undefined }));
    folder = await folderIn(root);
    const config = await loadProject(root);

    // Detection, not selection: every tool on this machine, and AGENTS.md regardless.
    const tools = await detectTools({ root, env, only: parseToolsFlag(options.tools) });
    await writeToolFiles({ root, folder, config: { name, description: config.project?.description ?? text ?? null }, tools });

    const { questions, shape } = selectQuestions({ description: text ?? config.project?.description ?? '', platformGiven });
    const state = { description: text ?? null, questions: questions.map((question) => question.id), shape, at: 0, answered: 0, assumed: 0, surface };
    await writeInitState(root, folder, state);

    if (surface === 'plain') {
      const { version } = JSON.parse(await readText(new URL('../../package.json', import.meta.url)));
      out(plainFacts([
        ['vibekit', version],
        ['project', `${name} at ${root}`],
        ['tools', `${tools.map((tool) => tool.id).join(' ')}${tools.length ? ' ' : ''}agents.md`],
        ['existing', `${existingFiles} files unchanged`],
        ['wrote', `${folder}/`],
        ['questions', `${questions.length} shape ${shape}`],
      ]));
    } else {
      out(setupReport({ surface, palette: c, reading, tools, questions: questions.length, shape }));
    }
    return continueQuestions({ root, folder, state, surface, c, options, out });
  }

  // ---------------------------------------------------------------- a later run
  const state = await readInitState(root, folder);
  if (state && state.at < state.questions.length) {
    const answer = options.text ?? options.answer?.[0] ?? null;
    if (answer !== null && answer !== undefined) {
      await recordAnswer({ root, folder, state, question: questionById(state.questions[state.at]), answer: String(answer) });
      await writeInitState(root, folder, state);
    }
    return continueQuestions({ root, folder, state, surface, c, options, out });
  }

  // Nothing pending: notice a tool that appeared since last time, in one line, and hand back.
  const config = await loadProject(root).catch(() => null);
  if (config?.project?.name) {
    const tools = await detectTools({ root, env, only: parseToolsFlag(options.tools) });
    const result = await writeToolFiles({ root, folder, config: { name: config.project.name, description: config.project.description ?? null }, tools }).catch(() => null);
    if (result?.noticed?.length && surface !== 'plain') out(surface === 'agent' ? noticedLine(result.noticed.map((tool) => tool.label)) : `  ${c.muted(noticedLine(result.noticed.map((tool) => tool.label)))}`);
  }
  return null;
}

const questionById = (id) => SHAPE_QUESTIONS.find((question) => question.id === id);

async function continueQuestions({ root, folder, state, surface, c, options, out }) {
  const total = state.questions.length;
  while (state.at < total) {
    const question = questionById(state.questions[state.at]);
    if (surface !== 'full') {
      out(questionScreen({ surface, palette: c, question, index: state.at, total, shape: state.shape }));
      return { asked: question.id, at: state.at, total };
    }
    const { askQuestion } = await import('../tui/input.js');
    const result = await askQuestion({ palette: c, question, index: state.at, total, shape: state.shape });
    if (result.back) { state.at = Math.max(0, state.at - 1); continue; }
    const answer = result.option ? result.option.id : result.dontKnow ? '?' : result.text;
    await recordAnswer({ root, folder, state, question, answer });
    await writeInitState(root, folder, state);
  }
  await generateFolder(root, (await loadProject(root)).project ? await folderConfigOf(root) : {}, { folder }).catch(() => {});
  out(doneScreen({ surface, palette: c, answered: state.answered, assumed: state.assumed }));
  return { done: true, answered: state.answered, assumed: state.assumed };
}

async function folderConfigOf(root) {
  const { folderConfig } = await import('../commands/folder.js');
  return folderConfig(root);
}

/** A number picks an option; the last number or `?` is "I don't know"; anything else is the person's own words. */
export async function recordAnswer({ root, folder, state, question, answer }) {
  const options = question.options;
  const n = /^\d+$/.test(answer) ? Number(answer) : null;
  const dontKnow = answer === '?' || answer.toLowerCase() === DONT_KNOW.label.toLowerCase() || n === options.length + 1;
  const option = n && n >= 1 && n <= options.length ? options[n - 1] : options.find((item) => item.id === answer) ?? null;
  const text = dontKnow ? null : option ? option.label : answer;

  const ask = await openAsk(root, { kind: 'question', ask: question.question, plain: question.question, why: question.why, options: options.map((item) => item.label), by: 'vibekit', stage: 1, topic: [question.topic] }, folder);
  if (dontKnow) {
    const path = join(root, folder, 'workflow/assumptions.md');
    const current = (await readText(path)) ?? '---\nreviewed:\n---\n\n# Assumptions\n';
    const next = ([...current.matchAll(/\bA-(\d+)\b/g)].map((match) => Number(match[1])).sort((a, b) => b - a)[0] ?? 0) + 1;
    await writeText(path, `${current.trimEnd()}\n- A-${String(next).padStart(3, '0')}  ${assumptionFor(question)} · ask: ${ask.id}\n`);
    state.assumed += 1;
  } else {
    await answerAsk(root, ask.id, { answer: text, by: 'human' }, folder);
    state.answered += 1;
    if (question.record === 'platforms' && option) {
      const config = await loadProject(root);
      config.project.platforms = PLATFORM_IDS[option.id] ?? [option.id];
      await saveProject(root, config);
    }
  }
  state.answers = { ...(state.answers ?? {}), [question.id]: dontKnow ? null : (option?.id ?? text) };
  state.at += 1;
  return { ask: ask.id, dontKnow, text };
}
