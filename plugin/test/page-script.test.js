// The page's script is assembled by stripping `export` off server modules and concatenating them.
// That trick is cheap and keeps one copy of the markup, and it has one failure mode: a function
// that exists on the server but was never inlined. The page then loads, looks perfect, and throws
// the first time someone clicks — which is exactly how it shipped once.
//
// So: run the assembled script and call into it, the way the page does.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { renderDashboard } from '../src/dashboard-view.js';
import { BROWSER_MODULES, browserSource } from '../src/page-chrome.js';

const STATE = {
  project: { name: 'demo', generatedAt: '2026-09-13T08:00:00.000Z', engine: 'claude', autonomy: 'gated' },
  tests: { ok: 1, flaky: 1, failed: 0, missing: 2, suites: 4, stale: 1, untraced: 2 },
  next: { step: 'implement', feature: '001-thing', command: 'vibecheck implement', gate: null, reason: '2 tasks open' },
  setup: null,
  problems: ['docs/roadmap.md is out of date'],
  features: [{
    id: '001-thing',
    title: 'Thing',
    status: 'in-progress',
    criteria: { done: 1, total: 3 },
    tasks: { done: 2, total: 5 },
    gates: [{ id: 'evidence', label: 'Evidence', state: 'blocked', problems: ['evidence: no recorded run'] }],
    lanes: [{ name: 'api', state: 'running', tasks: ['T-3'], detail: 'claude · 2 commits' }],
    tests: {
      suites: [{ suite: 'test', state: 'flaky', command: 'npm test', runs: 3, passed: 2, seconds: 4 }],
      required: 2, at: '2026-09-13T07:00:00.000Z', commit: 'abc1234', dirty: false, stale: true,
      trace: { covered: 1, missing: [2, 3], orphans: [] },
    },
  }],
};

const SCAN = {
  project: { name: 'demo', generatedAt: '2026-09-13T08:00:00.000Z', commit: 'abc1234', features: 1 },
  scanned: ['evidence', 'traceability', 'planning', 'generated', 'docs'],
  notScanned: [{ category: 'security', why: 'No scanner is wired up.' }],
  score: 62,
  counts: { critical: 1, high: 1, medium: 2, low: 1 },
  categories: { security: 0, evidence: 2, traceability: 1, planning: 1, generated: 1, docs: 0 },
  findings: [
    { id: 'S-01', severity: 'critical', category: 'evidence', title: 'nothing proves AC-1', detail: 'x', file: 'specs/features/001-thing/tasks.md', feature: '001-thing', effort: 'S', action: 'analyze.fix', command: 'vibecheck analyze --fix' },
    { id: 'S-02', severity: 'medium', category: 'planning', title: 'AC-2 is not decided yet', detail: 'y', file: 'specs/features/001-thing/spec.md', feature: '001-thing', effort: 'M', action: null, command: null },
  ],
};

/**
 * The inlined source, in a sandbox with just enough of a browser to answer questions.
 *
 * Everything is read back by evaluating an expression inside the sandbox rather than by reading a
 * property off it: `const` and `let` at the top of a script are lexical bindings and never become
 * properties of the global object, so checking `context.escape` would report every one of them
 * missing whether it was there or not.
 */
function sandbox() {
  const context = createContext({ window: {}, document: { querySelectorAll: () => [] }, console, STATE, SCAN });
  runInContext(browserSource(), context);
  return (expression) => runInContext(expression, context);
}

test('every module the page needs is inlined, not left behind on the server', () => {
  const source = browserSource();
  for (const name of BROWSER_MODULES) assert.ok(source.length, `${name} contributed nothing`);
  assert.doesNotMatch(source, /^import /m, 'an import left in the page would throw on load');
  assert.doesNotMatch(source, /^export /m, 'so would an export');
});

// Each of these is called by the page's own script. A missing one is a page that renders and then
// dies on the first click, which no amount of HTML assertion catches.
test('the functions the page calls are all defined in the inlined source', () => {
  const evaluate = sandbox();
  for (const name of ['renderPage', 'renderAll', 'navItems', 'issuesOf', 'escape', 'PAGES', 'STAGE_WORDS',
    'SCAN_PAGES', 'pageScan', 'pageFindings', 'pagePlan', 'pageExecute', 'fixPlanFor', 'renderScanAll']) {
    assert.notEqual(evaluate(`typeof ${name}`), 'undefined', `${name} is used by the page but never reaches it`);
  }
});

test('every lifecycle page renders from a real state without throwing', () => {
  const evaluate = sandbox();
  for (const name of evaluate('Object.keys(PAGES)')) {
    const html = evaluate(`renderPage(${JSON.stringify(name)}, null, STATE, { writable: true })`);
    assert.ok(html.includes('<'), `${name} produced no markup`);
  }
  assert.match(evaluate("renderPage('feature', '001-thing', STATE, { writable: true })"), /Thing/);
});

test('every scan page renders from a real scan without throwing', () => {
  const evaluate = sandbox();
  const plan = evaluate("fixPlanFor(SCAN, ['S-01', 'S-02'])");

  assert.equal(plan.steps.length, 1, 'one command covers the fixable finding');
  assert.equal(plan.manual.length, 1, 'and the other is handed back to a person');

  const ctx = "{ writable: true }, ['S-01', 'S-02']";
  assert.match(evaluate(`pageScan(SCAN, ${ctx})`), /was not scanned/);
  assert.match(evaluate(`pageFindings(SCAN, ${ctx})`), /S-01/);
  assert.match(evaluate(`pagePlan(SCAN, ${ctx}, fixPlanFor(SCAN, ['S-01', 'S-02']))`), /vibecheck analyze --fix/);
  assert.match(evaluate(`pageExecute(SCAN, ${ctx}, null)`), /Nothing has run/);
});

test('the assembled page script is syntactically valid as a whole', () => {
  const html = renderDashboard(STATE, { stream: true, control: '/x/do', scan: SCAN, scanUrl: '/x/scan.json' });
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.ok(script.length > 1000, 'the page carries its script');
  // Throws a SyntaxError if anything in the assembly is malformed.
  new Script(script);
});
