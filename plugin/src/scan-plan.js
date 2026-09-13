// Turning a selection of findings into the commands that fix them.
//
// This lives on its own because both sides need it and neither owns it: the server resolves a
// selection before running anything, and the page resolves the same selection to show what running
// it would do. It has no imports for the same reason dashboard-render.js has none — it is inlined
// into the page as source, so anything it reached for would have to be inlined too.
//
// The rule it encodes: a finding is only fixable when an existing, tested command fixes it.
// Everything else is handed back to a person, by name, rather than quietly dropped.

/** Rough size, so a plan can be ordered by what is cheap and what is not. */
export const EFFORT_HOURS = { S: 1, M: 4, L: 16 };

/**
 * The fixes the console may run, by name. Each is an existing command with existing tests; the
 * scan never invents a repair. A finding with no entry here is fixed by a person, not a button.
 */
export const FIX_ACTIONS = {
  sync: { label: 'Regenerate', command: 'vibecheck sync', detail: 'Rewrites the generated files from the specs.' },
  'analyze.fix': { label: 'Append the missing work', command: 'vibecheck analyze --fix', detail: 'Adds a task for every criterion that has none.' },
  'verify.run': { label: 'Run the suites', command: 'vibecheck verify --all --run', detail: 'Runs the tests and records the evidence against this commit.' },
};

/**
 * The distinct commands a selection needs, in the order they should run — and, named separately,
 * the chosen findings no command can fix, so the page can say which ones are still yours.
 */
export function fixPlanFor(scan, ids) {
  const chosen = (scan && scan.findings ? scan.findings : []).filter((entry) => ids.includes(entry.id));
  const steps = [];
  for (const action of Object.keys(FIX_ACTIONS)) {
    const covers = chosen.filter((entry) => entry.action === action);
    if (covers.length) steps.push({ action, ...FIX_ACTIONS[action], covers: covers.map((entry) => entry.id) });
  }
  return {
    steps,
    manual: chosen.filter((entry) => !entry.action).map((entry) => ({ id: entry.id, title: entry.title, command: entry.command })),
    hours: chosen.reduce((total, entry) => total + (EFFORT_HOURS[entry.effort] ?? 0), 0),
  };
}
