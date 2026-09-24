import { createBug } from '../folder/bugs.js';
import { writeText } from '../fsutil.js';
import { frameworksFor, readPosture, renderScan, savePosture, scanContext, scanReportPath, score, securityProbe, securityRead } from '../security/scan.js';
import { folderName } from './folder.js';

/**
 * `vibekit security scan` and `vibekit security`. Specification §70.
 *
 * `scan` runs the four passes and writes the report; bare `security` prints the current posture
 * from the last scan without re-running. High findings become bugs and block the sprint gate.
 */
export async function security(options) {
  const { root, args, folder: chosen, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [verb] = args;

  if (verb === 'scan') return scan(root, folder, options);
  if (verb && verb !== 'status') throw new Error('Usage: vibekit security [scan [--url <address>] [--allow-private] [--online] [--no-bugs]]');

  const posture = await readPosture(root, folder);
  if (json) return void console.log(JSON.stringify(posture, null, 2));
  if (!posture?.last) return void console.log('No scan yet. `vibekit security scan` measures the application against the frameworks that apply.');
  console.log(`Posture · last scan ${posture.last.date}`);
  for (const framework of posture.last.frameworks) console.log(`  ${framework.id.padEnd(18)} ${String(framework.met).padStart(3)} of ${String(framework.applicable).padEnd(3)} met · ${framework.failed} failed · ${framework.human} need a person`);
  console.log(`  ${posture.last.high} high · ${posture.last.medium} medium · ${posture.last.low} low`);
  if (posture.history.length > 1) {
    const first = posture.history[0];
    const trend = posture.last.high - first.high;
    console.log(`  Trend since ${first.date}: high findings ${trend <= 0 ? `down ${-trend}` : `up ${trend}`} — ${trend <= 0 ? 'getting safer' : 'accumulating exceptions'}`);
  }
}

async function scan(root, folder, options) {
  const { json } = options;
  const context = await scanContext(root, { folder });
  const frameworks = await frameworksFor(root, { folder, context });
  const { installed } = await import('../extensions.js');
  const scoring = await installed('security-frameworks');

  const read = await securityRead(root, { folder, offline: !options.online, context });
  let probe = null;
  if (options.url) probe = await securityProbe(root, options.url, { allowPrivate: Boolean(options['allow-private']), folder });

  const evidence = { ...read.evidence, ...(probe?.evidence ?? {}) };
  const findings = [...read.findings, ...(probe?.findings ?? [])];
  const scored = scoring ? score(frameworks, evidence, { probed: Boolean(probe), context }) : [];

  // Every finding becomes a bug with the control it fails, unless told not to (a re-run should
  // not open the same bug twice; the report is the record either way).
  if (!options['no-bugs']) {
    const { listRequirements } = await import('../folder/requirements.js');
    const existing = await listRequirements(root, folder).catch(() => []);
    for (const finding of findings) {
      const title = `${finding.check}: ${finding.message}`.slice(0, 110);
      const already = existing.find((entry) => entry.kind === 'bug' && entry.status !== 'done' && entry.title === title);
      if (already) { finding.bug = already.id; continue; }
      const created = await createBug(root, {
        title, severity: finding.severity, foundBy: 'vibekit security scan', foundOn: finding.where ?? 'main', by: 'human',
        criterion: `The system shall satisfy ${finding.check} (${finding.message.replace(/\.$/, '')}).`,
      }, folder).catch(() => null);
      if (created) { finding.bug = created.id; existing.push({ id: created.id, kind: 'bug', status: 'draft', title }); }
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const result = { date, frameworks: scored, findings, high: findings.filter((entry) => entry.severity === 'high'), medium: findings.filter((entry) => entry.severity === 'medium'), low: findings.filter((entry) => entry.severity === 'low'), probed: Boolean(probe), evidence };
  const reportPath = scanReportPath(root, new Date());
  await writeText(reportPath, renderScan(result));
  result.report = reportPath;
  await savePosture(root, result, folder);

  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (scoring) {
    for (const framework of scored) console.log(`  ${(framework.name + (framework.level ? ` ${framework.level}` : '')).padEnd(22)} ${String(framework.met).padStart(3)} of ${String(framework.applicable).padEnd(4)} applicable   ${framework.failed} failed · ${framework.human} need a person`);
  } else {
    console.log('  Framework scoring is an extension: vibekit ext add security-frameworks. The read pass below ran regardless.');
  }
  console.log('');
  console.log(`  ${result.high.length} high · ${result.medium.length} medium · ${result.low.length} low  →  ${findings.filter((entry) => entry.bug).length} bug(s) open, high ones block the sprint gate`);
  for (const finding of findings.slice(0, 12)) console.log(`    ${finding.severity.padEnd(6)} ${finding.check.padEnd(14)} ${finding.message}${finding.bug ? `  → ${finding.bug}` : ''}`);
  if (findings.length > 12) console.log(`    … ${findings.length - 12} more in the report`);
  if (!probe) console.log('  Probe pass skipped: --url <address> runs headers, TLS, rate-limit and auth probes against the deployed application.');
  console.log(`  Report: ${reportPath}`);
  console.log('');
  console.log('  Not a substitute for a human penetration test before real money or real personal data goes live; it is what');
  console.log('  makes sure that tester spends their time on what a machine cannot find.');
  if (result.high.length) process.exitCode = 1;
}
