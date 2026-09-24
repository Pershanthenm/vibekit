import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAsks } from './folder/asks.js';
import { runChecks } from './folder/checks.js';
import { readText } from './fsutil.js';
import { briefGaps, detect, extractStatements, redact, splitSections } from './sources.js';

/**
 * The workflow fixtures. Specification §32 and Extensions and Integration Spec §5.4.
 *
 * "The VibeKit repo keeps three fixture BRS documents with golden outputs: one small (a booking
 * app, ten requirements), one medium, one ugly (contradictions, missing sections, a 'should be
 * fast'). Golden outputs are the asks clarify should raise … They run in VibeKit's own CI, so a
 * prompt edit shows up as a diff in expected questions."
 *
 * Without a model the analyst's questions are the mechanical ones — what the text does not settle
 * — plus everything ingest and check raise. That is exactly what a prompt or extension change
 * can move, and it is what `ext verify` diffs before an extension reaches a customer.
 */

export const BRIEFS = Object.freeze({
  small: {
    title: 'Gym bookings',
    text: `# Gym bookings, version 2

1 Scope
Members book classes at any branch from their phone. Staff manage the schedule. About 3,000 members and 40 classes a week.

2 Booking
2.1 A member shall be able to book a place in a scheduled class.
2.2 The system shall not allow a member to hold more than one place in the same class.
2.3 When a class is full, the system shall offer a waiting list.
2.4 When a place is freed, the system shall offer it to the first member on the waiting list within five minutes.

3 Cancellation
3.1 A member shall be able to cancel a confirmed booking.
3.2 If a booking is cancelled within two hours of the class, then the system shall record a late cancellation.
3.3 The system must issue a refund through the original payment provider within 24 hours of cancellation.

4 Staff
4.1 Staff shall be able to create, move and cancel classes.
4.2 The system shall notify every booked member when a class is moved or cancelled.

5 Data
Member records hold a name, an email address and a payment token. Personal data is kept for two years after the last booking, then deleted. Availability target 99.5 percent.
`,
  },
  medium: {
    title: 'Warehouse stock take',
    text: `# Stock taking, version 1

1 Scope
A small app for counting stock in three warehouses. Staff walk the aisles with a phone, scan or type a product code and enter the quantity they see. Supervisors review the differences.

2 Counting
2.1 A counter shall be able to start a stock take for one location.
2.2 When a counter records a quantity for a product, the system shall save the count with the time and the counter's name.
2.3 If a product is counted twice in one stock take, then the system shall keep both counts and flag the product for review.
2.4 The system shall not allow a count to be edited; a correction is a new count.

3 Variances
3.1 When a stock take is closed, the system shall show each product where the counted quantity differs from the expected quantity.
3.2 The system must let a supervisor accept or reject each variance.
3.3 The expected quantity comes from a CSV export of the existing stock system uploaded when the take starts.

4 Integration
4.1 Accepted variances will be exported to the finance system nightly.
4.2 The finance system is owned by a third party and its API is undocumented.

5 Quality
Counts must be saved within one second on the warehouse Wi-Fi. The app must work offline for up to four hours and sync when reconnected. Personal data: the counter's name; retained for one year.
`,
  },
  ugly: {
    title: 'Customer portal',
    text: `Customer portal

Overview
We need a portal where customers can see their invoices and pay them. It should be fast and easy to use and look modern. Marketing want a newsletter signup too. Pricing TBD.

Requirements
Customers can log in. Customers can see invoices. Customers must be able to pay by card. Customers must never be able to pay by card, only by EFT (finance). Admins can do everything. The old portal had a bug where refunds went to the wrong account so we should be careful. Data retention: ask legal. Uptime should be good.

Notes
Contact sipho@example.com or 082 555 0100 for questions. Card numbers are stored in the customers table today.
`,
  },
});

export const GOLDEN_PATH = fileURLToPath(new URL('../fixtures/golden.json', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/vibekit', import.meta.url));

const vk = (root, args, home) => execFileSync(process.execPath, [BIN, ...args], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  env: { ...process.env, VIBEKIT_HOME: home, VIBEKIT_NO_OPEN: '1', CI: 'true' },
});

async function inHome(home, fn) {
  const was = process.env.VIBEKIT_HOME;
  process.env.VIBEKIT_HOME = home;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.VIBEKIT_HOME; else process.env.VIBEKIT_HOME = was;
  }
}

async function walk(root, dir, out = []) {
  for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.state') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, path, out);
    else out.push(relative(root, path).split('\\').join('/'));
  }
  return out;
}

/**
 * Run one brief through intake, ingest and the mechanical half of clarify, then check the folder.
 * `home` is the VIBEKIT_HOME the run sees — pass one with an extension enabled to see what it changes.
 */
export async function runBrief(name, { home = null, keep = false } = {}) {
  const brief = BRIEFS[name];
  if (!brief) throw new Error(`No fixture brief "${name}". One of: ${Object.keys(BRIEFS).join(', ')}.`);
  const root = await mkdtemp(join(tmpdir(), `vibekit-fixture-${name}-`));
  const ownHome = home ?? (await mkdtemp(join(tmpdir(), 'vibekit-fixture-home-')));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    vk(root, ['init', '--yes', '--no-tour'], ownHome);
    await writeFile(join(root, 'brief.md'), brief.text);
    vk(root, ['ingest', 'brief.md', '--yes'], ownHome);

    const text = brief.text;
    const found = detect(text);
    const { sections } = splitSections(redact(text, found));
    const statements = extractStatements(sections);
    const gaps = briefGaps(text, { sections, statements, found });
    const asks = (await listAsks(root, 'vibekit')).map((ask) => ({ id: ask.id, kind: ask.kind, plain: ask.plain, blocking: Boolean(ask.blocking) }));
    // The checks run in this process, and the extensions they pick up come from VIBEKIT_HOME at
    // call time — so the brief's home is the process's home for exactly this call.
    const checks = await inHome(ownHome, () => runChecks(root, { folder: 'vibekit' }));
    const source = (await readText(join(root, 'vibekit/product/sources/BRS-001/extract.md'))) ?? '';
    return {
      name,
      sections: sections.length,
      statements: statements.length,
      redacted: found.map((hit) => hit.kind).sort(),
      gaps,
      asks,
      findings: checks.findings.map((finding) => finding.code).sort(),
      files: await walk(root, join(root, 'vibekit')),
      obligations: [...source.matchAll(/^\| (§[\d.]+) \| (.+?) \|/gm)].map((match) => `${match[1]} ${match[2]}`),
      root: keep ? root : undefined,
    };
  } finally {
    if (!keep) await rm(root, { recursive: true, force: true }).catch(() => {});
    if (!home) await rm(ownHome, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runAll(options = {}) {
  const out = {};
  for (const name of Object.keys(BRIEFS)) out[name] = await runBrief(name, options);
  return out;
}

export async function readGolden() {
  try {
    return JSON.parse((await readText(GOLDEN_PATH)) ?? 'null');
  } catch {
    return null;
  }
}

const diffLists = (before = [], after = []) => ({ added: after.filter((item) => !before.includes(item)), removed: before.filter((item) => !after.includes(item)) });

/** What moved between a golden snapshot and a run: the questions, the findings, the folder. */
export function compareRuns(golden, actual) {
  const askKey = (ask) => `${ask.kind}: ${ask.plain}`;
  return {
    gaps: diffLists(golden.gaps, actual.gaps),
    asks: diffLists((golden.asks ?? []).map(askKey), (actual.asks ?? []).map(askKey)),
    findings: diffLists(golden.findings, actual.findings),
    files: diffLists(golden.files, actual.files),
    counts: { sections: [golden.sections, actual.sections], statements: [golden.statements, actual.statements] },
  };
}

export const unchanged = (diff) => ['gaps', 'asks', 'findings', 'files'].every((key) => !diff[key].added.length && !diff[key].removed.length)
  && diff.counts.sections[0] === diff.counts.sections[1] && diff.counts.statements[0] === diff.counts.statements[1];

/** Strip the run-specific parts before writing a golden file. */
export const snapshot = (run) => ({ sections: run.sections, statements: run.statements, redacted: run.redacted, gaps: run.gaps, asks: run.asks.map((ask) => ({ kind: ask.kind, plain: ask.plain, blocking: ask.blocking })), findings: run.findings, files: run.files, obligations: run.obligations });
