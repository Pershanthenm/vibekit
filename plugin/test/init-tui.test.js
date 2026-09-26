import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { detectSurface, palette } from '../src/tui/surface.js';
import { doneScreen, errorScreen, openingScreen, questionScreen, setupReport, wordmark } from '../src/tui/init-screens.js';
import { assumptionFor, selectQuestions, SHAPE_QUESTIONS } from '../src/init/questions.js';
import { detectTools, parseToolsFlag, TOOLS } from '../src/init/tools.js';
import { initPending, looksLikeInitInput, readInitState } from '../src/init/flow.js';
import { installFakeBin, isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * Init Spec. The first screen is a question to you; setup is reported, not requested; nothing is
 * asked about tooling; on an agent surface nothing blocks. The words are the same on every
 * surface, and plain mode is one fact per line.
 */

async function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
}

function isolated() {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  delete process.env.CLAUDECODE;
  delete process.env.CURSOR_AGENT;
  delete process.env.AGENT;
  delete process.env.CI;
  return original;
}

const DESCRIPTION = 'A todo app for small teams. People sign in, create lists, add tasks with a due date, assign them to a teammate, mark them done. Admins can invite and remove people.';

// ---------------------------------------------------------------- §6 surface detection

test('surface detection: not a TTY is plain; an agent env is agent; TERM=dumb and CI are plain; --mode forces', () => {
  assert.equal(detectSurface({ env: {}, isTTY: false }), 'plain');
  assert.equal(detectSurface({ env: { CLAUDECODE: '1' }, isTTY: false }), 'agent', 'an agent\'s shell is not a TTY, and is still an agent');
  assert.equal(detectSurface({ env: { CLAUDECODE: '1' }, isTTY: true }), 'agent');
  assert.equal(detectSurface({ env: { CURSOR_AGENT: '1' }, isTTY: true }), 'agent');
  assert.equal(detectSurface({ env: { AGENT: 'ssh' }, isTTY: true }), 'full', 'AGENT alone on a real terminal is somebody else\'s variable');
  assert.equal(detectSurface({ env: { AGENT: '1' }, isTTY: false }), 'agent');
  assert.equal(detectSurface({ env: { TERM: 'dumb' }, isTTY: true }), 'plain');
  assert.equal(detectSurface({ env: { CI: 'true' }, isTTY: true }), 'plain');
  assert.equal(detectSurface({ env: {}, isTTY: true }), 'full');
  assert.equal(detectSurface({ env: { CLAUDECODE: '1' }, isTTY: true, mode: 'full' }), 'full');
  assert.throws(() => detectSurface({ env: {}, isTTY: true, mode: 'fancy' }), /--mode is one of/);
  assert.equal(palette({ env: { NO_COLOR: '1' }, surface: 'full' }).on, false, 'NO_COLOR keeps the layout and drops the colour');
  assert.equal(palette({ env: {}, surface: 'agent' }).on, false, 'no escape codes on an agent surface');
  assert.equal(palette({ env: {}, surface: 'full' }).teal('x'), '\x1b[38;5;37mx\x1b[39m');
});

// ---------------------------------------------------------------- §2, §3, §4, §5 the screens

test('the opening screen is a question, with no wordmark, no menu and no box; agent mode is Markdown with the same words', () => {
  const c = palette({ env: {}, surface: 'full' });
  const full = openingScreen({ surface: 'full', palette: c });
  assert.match(full, /Before I build anything, I need to understand what you want\./);
  assert.match(full, /What are you building\?/);
  assert.doesNotMatch(full, /vibekit|◣|─|│|┌/, 'no wordmark, no borders');
  const agent = openingScreen({ surface: 'agent', palette: palette({ env: {}, surface: 'agent' }) });
  assert.match(agent, /^Before I build anything, I need to understand what you want\.\n\n\*\*What are you building\?\*\*/);
  assert.doesNotMatch(agent, /\x1b/, 'no escape codes for a model to relay');
  assert.match(openingScreen({ surface: 'agent', palette: palette({ env: {}, surface: 'agent' }), because: 'CLAUDECODE' }), /Agent mode, because CLAUDECODE is set in this shell\. On your own terminal, `vibekit --mode full` gives the screens\./);
  const withCode = openingScreen({ surface: 'full', palette: c, existingFiles: 19 });
  assert.match(withCode, /19 files here already — I'll read them before I ask anything\./);
  assert.match(openingScreen({ surface: 'plain', palette: c, existingFiles: 3 }), /^existing 3 files\nquestion What are you building\?/);
});

test('setup is reported in three lines and says how many questions change the shape', () => {
  const tools = TOOLS.filter((tool) => ['claude', 'cursor', 'codex'].includes(tool.id));
  const c = palette({ env: { NO_COLOR: '1' }, surface: 'full' });
  const full = setupReport({ surface: 'full', palette: c, reading: { files: 19, summary: 'JavaScript with React' }, tools, questions: 6, shape: 4 });
  assert.match(full, /Got it\./);
  assert.match(full, /Reading what's here\s+█+\s+JavaScript with React/);
  assert.match(full, /Setting up\s+Claude Code, Cursor, Codex — and AGENTS\.md for the rest/);
  assert.match(full, /Checking\s+nothing existing was changed/);
  assert.match(full, /Now — 6 questions\. 4 of them change the shape of the app\./);
  const agent = setupReport({ surface: 'agent', palette: c, reading: null, tools, questions: 6, shape: 4 });
  assert.match(agent, /Set up for Claude Code, Cursor, Codex, plus `AGENTS\.md` for anything else\./);
  assert.match(agent, /\*\*6 questions — 4 change the shape of the app\.\*\*/);
  assert.match(setupReport({ surface: 'plain', palette: c, reading: null, tools, questions: 6, shape: 4 }), /^tools claude cursor codex agents\.md\nexisting 0 files\nquestions 6 shape 4$/);
});

test('a question screen: counter, consequence, options, "I don\'t know" always there, keys line; identical wording in agent mode', () => {
  const question = SHAPE_QUESTIONS.find((entry) => entry.id === 'tenancy');
  const c = palette({ env: { NO_COLOR: '1' }, surface: 'full' });
  const full = questionScreen({ surface: 'full', palette: c, question, index: 0, total: 6, shape: 4, cursor: 0 });
  assert.match(full, /1 of 6\s+4 change the shape/);
  assert.match(full, /Do teams see each other's data\?/);
  assert.match(full, /This decides whether every record carries a team/);
  assert.match(full, /▸ 1\s+Each team sees only its own/);
  assert.match(full, /\?\s+I don't know\s+records it as a guess for you to check/);
  assert.match(full, /↑↓ move  ⏎ choose  t type something else  esc back/);
  assert.doesNotMatch(full, /[┌─│]/, 'never in a box');
  const agent = questionScreen({ surface: 'agent', palette: c, question, index: 0, total: 6, shape: 4 });
  assert.match(agent, /^\*\*1\. Do teams see each other's data\?\*\*\n\nThis decides whether every record carries a team/);
  assert.match(agent, /\n1\. Each team sees only its own\n2\. People can belong to several teams and switch\n3\. One team only — no separation needed\n4\. I don't know — record it as a guess I'll check later\n/);
  assert.match(agent, /Reply with a number\./);
  assert.match(questionScreen({ surface: 'plain', palette: c, question, index: 0, total: 6, shape: 4 }), /^question 1\/6 Do teams see each other's data\?\noption 1 Each team sees only its own/);
});

test('errors have three parts; the wordmark is two lines and only for version', () => {
  const c = palette({ env: { NO_COLOR: '1' }, surface: 'full' });
  const shown = errorScreen({ surface: 'full', palette: c, what: 'I can\'t write here.', why: '/x isn\'t writable, and I need to create a vibekit/ folder in it.', tries: ['sudo chown -R $(whoami) /x', 'or run this somewhere else'] });
  assert.match(shown, /I can't write here\.\n\n  \/x isn't writable[\s\S]*Try\s+sudo chown -R \$\(whoami\) \/x\n\s+or run this somewhere else/);
  assert.doesNotMatch(shown, /unexpected error|at .*\.js:\d+/);
  assert.equal(wordmark('0.1.0'), '◣ vibekit 0.1.0\n  Agents build it. You decide it.');
  assert.match(doneScreen({ surface: 'agent', palette: c, answered: 5, assumed: 1 }), /5 answers recorded, 1 guess written down for you to check\./);
});

// ---------------------------------------------------------------- §4 the questions

test('the questions fit the description: tenancy when teams are mentioned, offline when phones are; the shape count is honest', () => {
  const teams = selectQuestions({ description: DESCRIPTION });
  assert.deepEqual(teams.questions.map((question) => question.id), ['platform', 'tenancy', 'auth', 'roles', 'data', 'integrations']);
  assert.equal(teams.shape, 4);
  const solo = selectQuestions({ description: 'A command-line tool that renames photos by date.', platformGiven: true });
  assert.ok(!solo.questions.some((question) => question.id === 'platform'), 'platform given, not asked');
  assert.ok(solo.questions.some((question) => question.id === 'scale'), 'no teams, so scale instead');
  const field = selectQuestions({ description: 'Store staff count stock on their phones.', limit: 8 });
  assert.ok(field.questions.some((question) => question.id === 'offline'));
  for (const question of SHAPE_QUESTIONS) {
    assert.ok(question.why.split(/(?<=\.)\s/).length <= 2, `${question.id}: consequence is two sentences at most`);
    assert.ok(question.options.length >= 3, `${question.id}: options where they exist`);
  }
  assert.match(assumptionFor(SHAPE_QUESTIONS[1]), /^Assumed "Each team sees only its own" .* · confidence: low · blast radius: This decides whether every record carries a team, and whether the data layer filters by it\.$/);
});

// ---------------------------------------------------------------- §3 detection, not selection

test('tools are detected from PATH, home folders and the repo; AGENTS.md is always written; --tools restricts', async () => {
  const original = isolated();
  try {
    const bin = tempDir('vibekit-bin-');
    await installFakeBin(bin, 'cursor', '#!/usr/bin/env node\n');
    await installFakeBin(bin, 'gemini', '#!/usr/bin/env node\n');
    const home = tempDir('vibekit-fakehome-');
    await mkdir(join(home, '.claude'), { recursive: true });
    const root = tempDir('vibekit-init-');
    await mkdir(join(root, '.github'), { recursive: true });
    const env = { ...process.env, PATH: bin, HOME: home };
    const found = await detectTools({ root, env, home });
    assert.deepEqual(found.map((tool) => tool.id), ['claude', 'cursor', 'gemini', 'copilot']);
    assert.deepEqual((await detectTools({ root, env, home, only: ['claude', 'zed'] })).map((tool) => tool.id), ['claude', 'zed'], 'the opt-out is exact');
    assert.deepEqual(parseToolsFlag('claude, Cursor'), ['claude', 'cursor']);
    assert.throws(() => parseToolsFlag('vim'), /--tools: vim not known/);
  } finally {
    restoreEnv(original);
  }
});

// ---------------------------------------------------------------- the flow, on the surfaces an agent and CI use

test('agent surface: the first invocation asks and exits; the description sets up; each answer is one invocation; a "don\'t know" is an assumption', async () => {
  const original = isolated();
  try {
    const root = tempDir('vibekit-init-');
    const bin = tempDir('vibekit-bin-');
    await installFakeBin(bin, 'cursor', '#!/usr/bin/env node\n');
    process.env.PATH = bin;
    process.env.HOME = tempDir('vibekit-fakehome-');
    process.env.CLAUDECODE = '1';

    const first = await capture(() => run(['--dir', root]));
    assert.match(first, /^Before I build anything, I need to understand what you want\.\n\n\*\*What are you building\?\*\*/);
    assert.doesNotMatch(first, /\x1b/);
    assert.ok(!(await readInitState(root, 'vibekit')), 'nothing written by a question');

    const setup = await capture(() => run([DESCRIPTION, '--dir', root]));
    assert.match(setup, /Set up for Cursor, plus `AGENTS\.md` for anything else\./);
    assert.match(setup, /\*\*6 questions — 4 change the shape of the app\.\*\*/);
    assert.match(setup, /\*\*1\. Where will people use it\?\*\*/, 'the first question follows in the same reply');
    assert.match(setup, /Reply with a number\./);
    assert.ok(await initPending(root));
    for (const file of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/vibekit.mdc', 'vibekit/product/sources/DESC-001/source.md']) assert.ok(await readFile(join(root, file), 'utf8'), file);
    assert.match(await readFile(join(root, '.cursor/rules/vibekit.mdc'), 'utf8'), /^---\ndescription: VibeKit/);

    // A number answers; the next question comes back. "?" records a guess and moves on.
    const second = await capture(() => run(['3', '--dir', root]));
    assert.match(second, /^\*\*2\. Do teams see each other's data\?\*\*/);
    const config = JSON.parse(await readFile(join(root, 'specs/project.json'), 'utf8'));
    assert.deepEqual(config.project.platforms, ['web', 'ios', 'android'], 'the platform answer is recorded on the project');
    const third = await capture(() => run(['?', '--dir', root]));
    assert.match(third, /^\*\*3\. Who can sign in\?\*\*/);
    assert.match(await readFile(join(root, 'vibekit/workflow/assumptions.md'), 'utf8'), /- A-\d+  Assumed "Each team sees only its own" for "Do teams see each other's data\?"[^\n]*confidence: low[^\n]*blast radius/);
    assert.ok(await looksLikeInitInput(root, ['2']));
    assert.ok(!(await looksLikeInitInput(root, ['sho'])), 'a one-word typo is still a typo');

    // Own words are an answer too.
    await capture(() => run(['Only people we invite, and later single sign-on', '--dir', root]));
    for (const answer of ['2', '2', '1']) await capture(() => run([answer, '--dir', root]));
    const done = await capture(() => run(['--dir', root]));
    assert.ok(!(await initPending(root)));
    const status = await readFile(join(root, 'vibekit/workflow/status.md'), 'utf8');
    assert.match(status, /Open asks: 1/, 'the guess stays open for a person to check; the answered ones are closed');
    assert.match(done, /vibekit|stage/i, 'bare vibekit is the start screen again once init is done');
  } finally {
    restoreEnv(original);
  }
});

test('plain surface: facts one per line, and a later run notices a new tool in one line', async () => {
  const original = isolated();
  try {
    const root = tempDir('vibekit-init-');
    process.env.PATH = tempDir('vibekit-bin-');
    process.env.HOME = tempDir('vibekit-fakehome-');
    await writeFile(join(root, 'index.js'), 'console.log(1)\n');
    await writeFile(join(root, 'package.json'), '{"name":"x"}\n');
    const opening = await capture(() => run(['--mode', 'plain', '--dir', root]));
    assert.match(opening, /^existing 2 files\nquestion What are you building\?\nanswer vibekit "<a sentence or two>"/);
    const setup = await capture(() => run(['--mode', 'plain', 'A small API that serves photo metadata.', '--platform', 'api', '--tools', 'claude', '--dir', root]));
    assert.match(setup, /^vibekit \S+\nproject vibekit-init-\S+ at \S+\ntools claude agents\.md\nexisting 2 files unchanged\nwrote vibekit\/\nquestions \d shape \d\nquestion 1\/\d Who can sign in\?\noption 1 Anyone who registers/m);
    assert.equal(await readFile(join(root, 'index.js'), 'utf8'), 'console.log(1)\n', 'nothing existing was changed');
    assert.ok(!(await readFile(join(root, '.cursor/rules/vibekit.mdc'), 'utf8').catch(() => null)), '--tools claude wrote nothing for cursor');

    // Windsurf appears; the next bare run says so once, and does not ask.
    await mkdir(join(process.env.HOME, '.codeium/windsurf'), { recursive: true });
    for (const answer of ['1', '1', '1', '1', '1']) await capture(() => run(['--mode', 'plain', answer, '--dir', root]));
    const later = await capture(() => run(['--mode', 'agent', '--dir', root]));
    assert.match(later, /Noticed Windsurf since last time — added its config\./);
    assert.ok(await readFile(join(root, '.windsurfrules'), 'utf8'));
    const again = await capture(() => run(['--mode', 'agent', '--dir', root]));
    assert.doesNotMatch(again, /Noticed/, 'once');
  } finally {
    restoreEnv(original);
  }
});

test('a folder that cannot be written gets a three-part error, not a stack trace', async () => {
  const original = isolated();
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  try {
    const root = tempDir('vibekit-init-');
    const { chmod } = await import('node:fs/promises');
    await chmod(root, 0o500);
    const out = await capture(() => run(['--mode', 'plain', 'A thing.', '--dir', root]));
    assert.match(out, /^error I can't write here\.\nwhy .* isn't writable, and I need to create a vibekit\/ folder in it\.\ntry sudo chown/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    await chmod(root, 0o700);
  } finally {
    restoreEnv(original);
  }
});

test('--where local creates the folder under projects-root and runs the rest there; the finish says what happens next', async () => {
  const original = isolated();
  try {
    const home = tempDir('vibekit-projects-');
    const { writeConfig } = await import('../src/prompts.js');
    await writeConfig('projects-root', home);
    process.env.PATH = tempDir('vibekit-bin-');
    process.env.HOME = tempDir('vibekit-fakehome-');
    const elsewhere = tempDir('vibekit-elsewhere-');
    const out = await capture(() => run(['--mode', 'plain', 'A photo archive for one family.', '--name', 'Family Photos', '--where', 'local', '--platform', 'web', '--dir', elsewhere]));
    assert.match(out, new RegExp(`project Family Photos at ${join(home, 'Family Photos').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(await readFile(join(home, 'Family Photos/AGENTS.md'), 'utf8'));
    assert.ok(!(await readFile(join(elsewhere, 'AGENTS.md'), 'utf8').catch(() => null)), 'nothing written where the command ran');
    for (const answer of ['1', '1', '1', '1', '1']) await capture(() => run(['--mode', 'plain', answer, '--dir', join(home, 'Family Photos')]));
    const c = palette({ env: { NO_COLOR: '1' }, surface: 'full' });
    const done = doneScreen({ surface: 'full', palette: c, answered: 5, assumed: 0 });
    assert.match(done, /5 answers recorded\./);
    assert.match(done, /The analyst reads your answers\s+next and asks only what they do not cover\./);
    assert.match(done, /Next\s+vibekit show status\s+what is waiting on you/);
    assert.match(doneScreen({ surface: 'agent', palette: c, answered: 5, assumed: 1 }), /^That's everything I need to start\. 5 answers recorded, 1 guess written down for you to check\./);
  } finally {
    restoreEnv(original);
  }
});
