// `vibecheck scan` — everything the checks can say about this project, in one place.
//
// The terminal output is the summary; the page is where you work through it. Both come from the
// same collectScan(), so the numbers cannot differ between them.
//
// The written page is deliberately read-only. Choosing findings and running their fixes needs the
// served console, because a page opened from a file:// path has nothing to send a request to.

import { collectState, dashboardPath, renderDashboard } from '../dashboard.js';
import { writeText } from '../fsutil.js';
import { loadProject } from '../project.js';
import { CATEGORIES, SEVERITIES, collectScan } from '../scan.js';
import { collectProblems } from './check.js';
import { openInBrowser } from './dashboard.js';

const MARK = { critical: '✖', high: '✖', medium: '!', low: '·' };

const scanPath = (root) => dashboardPath(root).replace(/status\.html$/, 'scan.html');

export async function scan({ root, json, open, out }) {
  const project = await loadProject(root);
  const result = await collectScan(root, project);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const worst = SEVERITIES.filter((severity) => result.counts[severity] > 0);
  console.log(`${result.project.name} — health ${result.score}/100`);
  console.log(`  ${result.findings.length} finding(s)${worst.length ? `: ${worst.map((severity) => `${result.counts[severity]} ${severity}`).join(', ')}` : ''}`);

  for (const gap of result.notScanned) {
    // Said every time, not only on the page: silence about a category nobody scanned is the one
    // thing a report like this must never imply.
    console.log(`\n! ${CATEGORIES[gap.category] ?? gap.category} was not scanned. ${gap.why}`);
  }

  const shown = result.findings.slice(0, 10);
  if (shown.length) console.log('');
  for (const entry of shown) {
    console.log(`${MARK[entry.severity]} [${entry.id}] ${entry.title}`);
    if (entry.command) console.log(`    fix: ${entry.command}`);
  }
  if (result.findings.length > shown.length) {
    console.log(`\n  …and ${result.findings.length - shown.length} more. See them all on the page, or with --json.`);
  }

  const problems = await collectProblems(root, project).catch(() => []);
  const state = await collectState(root, project, { problems });
  const path = out ?? scanPath(root);
  await writeText(path, renderDashboard(state, { live: false, scan: result }));
  console.log(`\nWrote ${path}`);
  console.log('  To choose findings and run their fixes: vibecheck dashboard --serve');
  if (open) openInBrowser(path);
}
