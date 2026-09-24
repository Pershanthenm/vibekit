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
  folder: 'vibekit',
  tunnel: null,
  project: { name: 'bookings', generatedAt: '2026-09-24T08:00:00.000Z', commit: 'abc1234', branch: 'main' },
  stage: { n: 5, name: 'build', prompt: 'vibekit/workflow/stages/5-build.md' },
  gates: { 0: { passed: true, detail: '1 source recorded', name: 'intake' } },
  stats: {
    requirements: 3, done: 1, percent: 33, ready: 1, inProgress: 1, blocked: 1, tested: 0,
    openAsks: 1, blockingAsks: 1, oldestAskDays: 4, alwaysLoaded: 2360, cap: 5500, typicalTask: 2900,
  },
  byStatus: { done: 1, ready: 1, blocked: 1 },
  statuses: ['draft', 'ready', 'in-progress', 'blocked', 'paused', 'tested', 'review', 'done'],
  next: { kind: 'answer-ask', forHuman: true, id: 'P-001', detail: 'We need somewhere to record money paid back.', command: 'vibekit ask answer P-001 "…"' },
  needsYou: [{
    kind: 'ask', id: 'P-001', blocking: true, waitingDays: 4,
    plain: 'We need somewhere to record money paid back. Nothing in the folder describes one yet.',
    why: 'Cancelling a booking cannot record what was returned.',
    options: ['A new kind of record for refunds', 'Extra fields on the payment'],
    weight: 130, actions: ['answer', 'reject'],
  }],
  requirements: [
    {
      id: 'REQ-001', title: 'Cancel a booking', kind: 'requirement', size: 'M', status: 'blocked',
      entities: ['Booking'], criteria: [{ id: 'AC-1', pattern: 'event', text: 'When a booking is cancelled, the system shall refund it.' }],
      malformed: 0, phase: null, after: [], log: [], holder: null, heldHours: null, offers: ['paused'],
    },
    {
      id: 'REQ-002', title: 'Invite a member', kind: 'requirement', size: 'S', status: 'done',
      entities: ['Member'], criteria: [], malformed: 0, phase: null, after: [], log: [],
      holder: { role: 'implementer', runner: 'claude-code', branch: 'req/REQ-002' }, heldHours: 2, offers: ['release'],
    },
  ],
  asks: [{ id: 'P-001', kind: 'proposal', for: 'REQ-001', status: 'waiting', blocking: true, waitingDays: 4, plain: 'x', why: 'y', options: [], answer: '', radius: 2 }],
  assumptions: [{ id: 'A-003', text: 'single currency (ZAR) · confidence: low', confidence: 'low', bearing: 4 }],
  security: {
    classified: [{ name: 'Payment', class: 'financial' }],
    touching: 1,
    findings: [{ code: 'guardrail.todo', message: 'The guardrails still name a placeholder path.', severity: 'error' }],
    unclassified: ['Booking'],
  },
  schedule: { remaining: 2, perWeek: 1.5, weeksLeft: 2, basis: 'measured from 4 closed requirements over 19 days' },
  budget: { alwaysLoaded: 2360, ceiling: 5500, typicalTask: 2900, rows: [], perTask: [], wholeFolder: 4000, passes: true, counts: {} },
  checks: [],
  setup: null,
  problems: [],
};

const SCAN = {
  project: { name: 'bookings', commit: 'abc1234def', features: 3 },
  score: 62,
  counts: { critical: 1, high: 1, medium: 2, low: 1 },
  categories: { security: 0, evidence: 2, traceability: 1, planning: 1, generated: 1, docs: 0 },
  notScanned: [{ area: 'security', why: 'no scanner is wired up' }],
  findings: [
    { id: 'S-01', severity: 'critical', category: 'evidence', title: 'nothing proves AC-1', detail: 'x', file: 'vibekit/product/requirements/REQ-001.md', feature: 'REQ-001', effort: 'S', action: 'analyze.fix', command: 'vibekit analyze --fix' },
    { id: 'S-02', severity: 'medium', category: 'planning', title: 'AC-2 is not decided yet', detail: 'y', file: 'vibekit/product/requirements/REQ-001.md', feature: 'REQ-001', effort: 'M', action: null, command: null },
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
  for (const name of [
    'renderAll', 'renderCards', 'cardNeedsYou', 'cardWhereWeAre', 'cardSecurity', 'cardSchedule',
    'renderNext', 'renderBudgetStrip', 'renderTunnel', 'escape', 'STATUS_WORDS',
    'renderHero', 'cardBugs', 'cardCost', 'cardDocs', 'cardTeam', 'gerund', 'SEVERITY_WORDS',
  ]) {
    assert.notEqual(evaluate(`typeof ${name}`), 'undefined', `${name} is used by the page but never reaches it`);
  }
});

test('every card renders from a real state without throwing', () => {
  const evaluate = sandbox();
  for (const name of ['cardNeedsYou', 'cardWhereWeAre', 'cardSecurity', 'cardSchedule']) {
    const html = evaluate(`${name}(STATE, { writable: true })`);
    assert.ok(html.includes('<'), `${name} produced no markup`);
  }
  assert.match(evaluate('renderAll(STATE, { writable: true })'), /Needs you/);
});

test('the page leads with plain language, not identifiers', () => {
  // §12: no file paths, no ids, no jargon in what a person reads first. The id is still there,
  // one tap away, because somebody eventually needs it.
  const evaluate = sandbox();
  const html = evaluate('cardNeedsYou(STATE, { writable: true })');
  const firstParagraph = html.slice(html.indexOf('class="plain"'), html.indexOf('</p>', html.indexOf('class="plain"')));
  assert.match(firstParagraph, /money paid back/);
  assert.doesNotMatch(firstParagraph, /P-001|REQ-|vibekit\//, 'an identifier reached the line a person reads first');
  assert.match(html, /P-001/, 'the id is still available behind the detail');
});

test('a read-only page offers no buttons', () => {
  const evaluate = sandbox();
  const html = evaluate('cardNeedsYou(STATE, { writable: false })');
  assert.doesNotMatch(html, /<button type="button" class="act/, 'a read-only viewer was offered an action');
  assert.match(html, /Read-only/);
});

test('the assembled page script is syntactically valid as a whole', () => {
  const html = renderDashboard(STATE, { stream: true, control: { url: '/x/do', token: 't' }, streamUrl: '/x/events' });
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.ok(script.length > 1000, 'the page carries its script');
  // Throws a SyntaxError if anything in the assembly is malformed.
  new Script(script);
});
