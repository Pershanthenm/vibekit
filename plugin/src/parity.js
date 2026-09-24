/**
 * The parity rule. Specification §70.
 *
 * "Anything a command can do, the app can do. No feature is terminal-only… a pull request that
 * adds a command without its screen is incomplete, and `vibekit check --parity` in VibeKit's own
 * CI lists commands with no matching app action."
 *
 * The page here is the tracker (§57). Its actions are `control.js`'s ACTIONS; its read views are
 * the cards. This file is the mapping from commands to the page, and a command missing from it is
 * the finding. Commands that are the machine's own (hooks, the MCP server, CI entry points) have
 * no page and are listed as such rather than counted.
 */

/** Command → what on the page does it. `read` means a card shows it; `action` names the control action. */
export const PAGE = Object.freeze({
  action: { read: 'Needs you card', action: 'ask.answer' },
  ask: { read: 'Needs you card', action: 'ask.answer' },
  'sprint status': { read: 'Where we are card' },
  'sprint plan': { read: 'Schedule card', action: 'plan.reorder' },
  'sprint run': { read: 'Where we are card (lanes)' },
  'sprint close': { read: 'Schedule card (gate)', action: 'gate.approve' },
  'project status': { read: 'Where we are card' },
  'project select': { read: 'Projects list' },
  'project stop': { read: 'Resume note' },
  req: { read: 'Where we are card', action: 'req.status' },
  start: { action: 'req.start' },
  unhold: { action: 'req.release' },
  add: { action: 'req.add' },
  feature: { action: 'req.add' },
  hotfix: { action: 'req.hotfix' },
  quick: { action: 'req.hotfix' },
  bug: { read: 'Security card', action: 'bug.severity' },
  review: { read: 'Needs you card (PRs awaiting review)' },
  why: { read: 'details tap on any requirement' },
  security: { read: 'Security card' },
  check: { read: 'Security card (checks)' },
  report: { read: 'full reports, one tap from the cards' },
  cost: { read: 'Schedule card (spend)' },
  release: { read: 'Schedule card (releases)' },
  evidence: { read: 'full reports' },
  assumptions: { read: 'Needs you card (risk)' },
  trace: { read: 'details tap' },
  team: { read: 'approvers in humans.md drive who may act' },
  design: { read: 'Design screen' },
  docs: { read: 'Docs tap' },
  tracker: { read: 'the page itself' },
  track: { read: 'the page itself' },
  note: { action: 'note.add' },
  distil: { action: 'memory.accept' },
});

/** The machine's own entry points: no page is expected. */
export const NO_PAGE = Object.freeze(['hook', 'githook', 'serve', 'version', 'tour', 'rescan', 'tools', 'replay', 'test-skills', 'upgrade-prompts', 'ext', 'settings', 'config', 'init', 'ingest', 'clarify', 'reverse', 'spec', 'skills', 'verify', 'drift', 'changelog', 'ship', 'rollback', 'undo', 'revert', 'understand', 'arch-docs', 'pause', 'stop', 'resume', 'next', 'plan', 'project', 'sprint']);

export async function parityReport() {
  const { commandNames } = await import('./cli.js');
  const { ACTIONS } = await import('./control.js');
  const covered = [];
  const missing = [];
  for (const name of commandNames()) {
    if (NO_PAGE.includes(name) && !PAGE[name]) continue;
    const entry = PAGE[name];
    if (!entry) { missing.push(name); continue; }
    if (entry.action && !ACTIONS[entry.action]) { missing.push(`${name} (page action ${entry.action} is not implemented)`); continue; }
    covered.push(name);
  }
  return { covered, missing };
}
