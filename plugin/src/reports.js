import { join } from 'node:path';
import { ASK_THRESHOLD_DAYS, blastRadius, isOpen, listAsks } from './folder/asks.js';
import { budgetReport } from './folder/budget.js';
import { runChecks } from './folder/checks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { holdAgeHours, listRequirements, readTasksState } from './folder/requirements.js';
import { readAssumptions } from './folder/workflow.js';
import { effectiveCost, performance, readSessions } from './models/advise.js';
import { loadCaps } from './models/policy.js';
import { entitiesFrom } from './docs/arch/model.js';
import { readIndex } from './sources.js';
import { traceMatrix } from './why.js';
import { readText } from './fsutil.js';

/**
 * Three reports, one source of truth. Specification §48.
 *
 * "Every number comes from files already in the folder or `.state/`; nothing is tracked
 * separately." That is the constraint that makes the reports worth reading, and it is also what
 * makes them cheap: there is no reporting database to keep in step, only a different view of
 * files that had to be right anyway.
 *
 * Two rules from §48 that shape every function here:
 *
 *   * **A report never contains a number that cannot be traced to a file.** So every section
 *     carries the path it came from, and a figure with no source is not printed.
 *   * **Reports are read-only.** Nothing is fixed from a report; it points at the file to fix.
 */

export const KINDS = Object.freeze(['build', 'budget', 'security']);

const section = (title, from, rows, note = null) => ({ title, from, rows, note });

// ---------------------------------------------------------------- assumptions (§38)

/**
 * §38 — every assumption with the number of requirements standing on it, sorted.
 *
 * "This turns 'we assumed and found out in month three' into a line on a screen at planning
 * time." The gate rule below is the half that does the work: a low-confidence assumption
 * load-bearing for more than three requirements blocks the plan until somebody decides.
 */
export const LOAD_BEARING_LIMIT = 3;

export async function assumptionReport(root, folder = DEFAULT_FOLDER) {
  const [assumptions, requirements] = await Promise.all([
    readAssumptions(root, folder),
    listRequirements(root, folder),
  ]);

  const rows = assumptions.map((assumption) => {
    const standing = requirements.filter((requirement) => requirement.assumes.includes(assumption.id));
    return {
      ...assumption,
      // `readAssumptions` keeps the whole bullet, confidence marker included. Printing it beside
      // a "confidence:" column would say the same thing twice.
      text: assumption.text.replace(/\s*[·|]\s*confidence:\s*\w+\s*$/i, '').replace(/\s*confidence:\s*\w+\s*$/i, '').trim(),
      requirements: standing.map((requirement) => requirement.id),
      count: standing.length,
      // The phase gate refuses this combination until it is confirmed or accepted as a risk.
      blocksPlan: assumption.confidence === 'low' && standing.length > LOAD_BEARING_LIMIT,
    };
  }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  // An assumption a requirement names that nobody wrote down is the other direction of the same
  // failure, and it is invisible unless looked for.
  const named = new Set(assumptions.map((assumption) => assumption.id));
  const undeclared = [...new Set(requirements.flatMap((requirement) => requirement.assumes))]
    .filter((id) => !named.has(id));

  return { rows, undeclared, blocking: rows.filter((row) => row.blocksPlan) };
}

// ---------------------------------------------------------------- cost before build (§40)

/**
 * §40 — the token cost of a requirement is computable before it is built, because every stage
 * has a loading manifest and every requirement a scoped set.
 *
 * The per-role multiplier is learned from this repo's sessions rather than assumed. With no
 * sessions yet it is 1 and says so: a forecast built on a number nobody measured is a guess
 * wearing a decimal point.
 */
export const SIZE_PASSES = Object.freeze({ S: 2, M: 5, L: 12 });

export function multipliers(sessions) {
  const byRole = new Map();
  for (const session of sessions) {
    const role = session.role ?? 'implementer';
    const entry = byRole.get(role) ?? { tokens: 0, sessions: 0 };
    entry.tokens += Number(session.input ?? 0) + Number(session.output ?? 0);
    entry.sessions += 1;
    byRole.set(role, entry);
  }
  const overall = [...byRole.values()].reduce((total, entry) => total + entry.tokens, 0);
  const count = [...byRole.values()].reduce((total, entry) => total + entry.sessions, 0);
  const mean = count ? overall / count : 0;

  return {
    measured: count > 0,
    sessions: count,
    byRole: Object.fromEntries([...byRole.entries()].map(([role, entry]) => [
      role,
      mean ? Number(((entry.tokens / entry.sessions) / mean).toFixed(2)) : 1,
    ])),
  };
}

export async function costForecast(root, folder = DEFAULT_FOLDER) {
  const [requirements, budget, sessions, caps] = await Promise.all([
    listRequirements(root, folder),
    budgetReport(root, folder).catch(() => null),
    readSessions(root, folder),
    loadCaps(root, folder),
  ]);

  const learned = multipliers(sessions);
  const always = budget?.alwaysLoaded ?? 4900;
  const scoped = 1500;

  const rows = requirements.map((requirement) => {
    const passes = SIZE_PASSES[requirement.size] ?? SIZE_PASSES.M;
    const multiplier = learned.byRole.implementer ?? 1;
    const perPass = always + scoped + requirement.tokens;
    return {
      id: requirement.id,
      title: requirement.title,
      size: requirement.size,
      phase: requirement.phase ?? null,
      status: requirement.status,
      passes,
      estimate: Math.round(perPass * passes * multiplier),
    };
  });

  const phases = new Map();
  for (const row of rows) {
    const key = row.phase ?? 'unphased';
    phases.set(key, (phases.get(key) ?? 0) + row.estimate);
  }

  return {
    rows: rows.sort((a, b) => b.estimate - a.estimate),
    phases: [...phases.entries()].map(([phase, estimate]) => ({ phase, estimate })).sort((a, b) => String(a.phase).localeCompare(String(b.phase))),
    total: rows.reduce((sum, row) => sum + row.estimate, 0),
    learned,
    caps,
    always,
  };
}

// ---------------------------------------------------------------- the build report (§48)

const weeksBetween = (from, to) => Math.max(1, Math.round((to - from) / (7 * 86400000)));

export async function buildReport(root, folder = DEFAULT_FOLDER) {
  const [requirements, asks, held, checks, assumptions, matrix] = await Promise.all([
    listRequirements(root, folder),
    listAsks(root, folder),
    readTasksState(root, folder).then((state) => state.held),
    runChecks(root, { folder }).catch(() => ({ findings: [] })),
    assumptionReport(root, folder),
    traceMatrix(root, { folder, all: true }).catch(() => ({ rows: [], broken: [] })),
  ]);

  const byStatus = {};
  for (const requirement of requirements) byStatus[requirement.status] = (byStatus[requirement.status] ?? 0) + 1;

  // Throughput from the `## Log` timestamps — the only record of when work actually moved.
  const stamps = requirements.flatMap((requirement) => requirement.log
    .map((line) => line.match(/^(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean)
    .map((date) => new Date(date).valueOf()));
  const done = requirements.filter((requirement) => requirement.status === 'done');
  const span = stamps.length ? weeksBetween(Math.min(...stamps), Math.max(...stamps)) : 1;

  const open = asks.filter(isOpen);
  const untested = matrix.rows.filter((row) => row.criterion && !row.test);

  return {
    kind: 'build',
    sections: [
      section('Progress', `${folder}/product/requirements/`, [
        [`${requirements.length} requirement(s)`, Object.entries(byStatus).map(([status, count]) => `${count} ${status}`).join(', ') || 'none'],
        ['done', `${done.length} of ${requirements.length}`],
      ]),
      section('Throughput', 'the ## Log timestamps', [
        ['requirements to done per week', stamps.length ? (done.length / span).toFixed(1) : 'nothing logged yet'],
        ['weeks of recorded activity', String(span)],
      ], stamps.length ? null : 'No requirement has a dated log line yet, so throughput is not measurable.'),
      section('Blocked', `${folder}/workflow/asks/ and .state/tasks.json`, [
        ['open asks', open.length ? `${open.length} (${open.filter((ask) => ask.blocking).length} blocking)` : 'none'],
        ['oldest pending decision', open.length ? `${Math.max(...open.map((ask) => ask.waitingDays))} day(s), threshold ${ASK_THRESHOLD_DAYS}` : '—'],
        ['held requirements', Object.entries(held).map(([id, holder]) => `${id} by ${holder.role} for ${Math.round(holdAgeHours(holder))}h`).join('; ') || 'none'],
      ]),
      section('Risk', `${folder}/workflow/assumptions.md`, assumptions.blocking.length
        ? assumptions.blocking.map((row) => [row.id, `${row.text} — load-bearing for ${row.count}`])
        : [['load-bearing low-confidence assumptions', 'none']]),
      section('Drift', 'vibekit check', [
        ['errors', String(checks.findings.filter((finding) => finding.severity === 'error').length)],
        ['warnings', String(checks.findings.filter((finding) => finding.severity !== 'error').length)],
      ]),
      section('Quality', 'the ## Verification of each requirement', [
        ['criteria with no test', `${untested.length} (should be zero)`],
        ['criteria traced', `${matrix.rows.length - untested.length} of ${matrix.rows.length}`],
      ]),
    ],
  };
}

// ---------------------------------------------------------------- the budget report (§48)

export async function budgetReportFor(root, folder = DEFAULT_FOLDER) {
  const [forecast, sessions, context] = await Promise.all([
    costForecast(root, folder),
    readSessions(root, folder),
    budgetReport(root, folder).catch(() => null),
  ]);

  const rows = performance(sessions, { days: 0 });
  const priced = await effectiveCost(rows, 'anthropic').catch(() => rows);
  const spent = sessions.reduce((total, session) => total + Number(session.input ?? 0) + Number(session.output ?? 0), 0);

  // §48 — currency from rates.yml in app settings, never from the folder. Without a rate the report
  // stays in tokens; a currency figure nobody set the rate for would be believed.
  const { priceInCurrency, readRates } = await import('./models/registry.js');
  const rates = await readRates();
  let money = null;
  if (rates.currency) {
    let total = 0;
    let priced_ = 0;
    for (const session of sessions.filter((entry) => entry.model)) {
      const price = await priceInCurrency('anthropic', session.model, { input: session.input ?? 0, output: session.output ?? 0, cached: session.cached ?? 0 }, rates).catch(() => null);
      if (price) { total += price.amount; priced_ += 1; }
    }
    money = { currency: rates.currency, total, priced: priced_, of: sessions.length };
  }
  const blocked = sessions.filter((session) => session.ended === 'blocked');

  return {
    kind: 'budget',
    sections: [
      section('Forecast', 'vibekit show plan --cost', [
        ['estimated total', `${forecast.total.toLocaleString()} tokens`],
        ...forecast.phases.map((phase) => [`phase ${phase.phase}`, `${phase.estimate.toLocaleString()} tokens`]),
      ], forecast.learned.measured
        ? `Per-role multiplier learned from ${forecast.learned.sessions} session(s) on this repo.`
        : 'No sessions recorded yet, so the multiplier is 1. A forecast built on an unmeasured number is a guess with a decimal point.'),
      section('Actual', `${folder}/.state/sessions.json`, sessions.length
        ? [
          ['sessions', String(sessions.length)],
          ['tokens in and out', spent.toLocaleString()],
          ...(money ? [[`spend (${money.currency})`, `${money.total.toFixed(2)} across ${money.priced} of ${money.of} session(s) with a priced model`]] : [['spend', 'in tokens only — set currency and per-usd in ~/.vibekit/registry/rates.yml']]),
        ]
        : [['recorded', 'nothing yet']]),
      section('Waste', `${folder}/.state/sessions.json`, [
        ['sessions that ended blocked', String(blocked.length)],
        ['escalations', String(sessions.filter((session) => session.escalated).length)],
      ]),
      section('Context health', 'vibekit run check --budget', context
        ? [
          ['always-loaded', `${context.alwaysLoaded} of ${context.ceiling} tokens${context.passes ? '' : ' — over the ceiling'}`],
          ['files nearest the ceiling', context.rows.filter((row) => row.budget && row.tokens > row.budget).map((row) => row.path).slice(0, 3).join(', ') || 'none over'],
          ['a typical task', `${context.typicalTask} tokens`],
        ]
        : [['budget', 'not computable']]),
      section('Per-model', `${folder}/.state/sessions.json`, priced.length
        ? priced.map((row) => [row.model, `${row.role} ${row.size} · ${row.completed} done${row.effectiveCost ? ` · effective ${row.effectiveCost.toFixed(4)}` : ''}`])
        : [['models used', 'nothing recorded']]),
      section('Caps', `${folder}/profile.md`, forecast.caps.map((cap) => [cap.key, cap.tokens === null ? 'not set' : cap.tokens.toLocaleString()])),
    ],
  };
}

// ---------------------------------------------------------------- the security report (§48)

export async function securityReport(root, folder = DEFAULT_FOLDER) {
  const [requirements, checks, sources, entitiesText, humansText] = await Promise.all([
    listRequirements(root, folder),
    runChecks(root, { folder }).catch(() => ({ findings: [] })),
    readIndex(root, folder).catch(() => []),
    readText(join(root, folder, 'product/entities.md')),
    readText(join(root, folder, 'agents/humans.md')),
  ]);

  // The entity vocabulary has one parser already. A second regex here would eventually disagree
  // with the one the documents and the drift checks use, and the security report is the last
  // place that should be reading a different list.
  const classified = entitiesFrom(entitiesText ?? '')
    .map((entity) => ({ name: entity.name, klass: String(entity.class ?? 'internal').toLowerCase() }))
    .filter((entity) => ['personal', 'financial', 'secret'].includes(entity.klass));

  const touching = classified.map((entity) => ({
    ...entity,
    requirements: requirements.filter((requirement) => requirement.entities.includes(entity.name)).map((requirement) => requirement.id),
  }));

  const securityFindings = checks.findings.filter((finding) => /security|guardrail|redact|denied|secret/i.test(finding.code));
  // Offline here: a report is read, and a report that reached the network to render itself would
  // be one that could not be regenerated from a past commit. `check --deps` is the online check.
  const { auditDependencies } = await import('./deps.js');
  const deps = await auditDependencies(root, { folder, offline: true }).catch(() => ({ findings: [], unchecked: [] }));
  const depFindings = deps.findings.filter((finding) => finding.severity === 'error');
  const unredacted = sources.filter((source) => !source.redacted);
  const missingNotes = requirements.filter((requirement) => ['M', 'L'].includes(requirement.size) && !requirement.security.trim());

  return {
    kind: 'security',
    sections: [
      section('Data map', `${folder}/product/entities.md`, touching.length
        ? touching.map((entity) => [`${entity.name} (${entity.klass})`, entity.requirements.length ? `touched by ${entity.requirements.join(', ')}` : 'no requirement touches it yet'])
        : [['classified entities', 'none']]),
      section('Checks', 'vibekit check', securityFindings.length
        ? securityFindings.map((finding) => [finding.code, finding.message])
        : [['open security findings', 'none']]),
      section('Review findings', 'the ## Security of each requirement', [
        ['M or L requirements with no security note', missingNotes.length ? missingNotes.map((requirement) => requirement.id).join(', ') : 'none'],
      ]),
      section('Dependencies', 'vibekit check --deps', depFindings.length
        ? depFindings.map((finding) => [finding.code, finding.message])
        : [['flagged', deps.unchecked.length ? `nothing offline · ${deps.unchecked.length} lookup(s) not made; run vibekit check --deps` : 'none']]),
      section('Redaction', `${folder}/product/sources/index.md`, unredacted.length
        ? unredacted.map((source) => [source.id, 'ingested without redaction'])
        : [['sources ingested unredacted', sources.length ? 'none' : 'no sources ingested yet']]),
      section('Access', `${folder}/agents/humans.md`, [
        ['named approvers', String((String(humansText ?? '').match(/^\|\s*(?:product owner|tech lead|security)\s*\|/gim) ?? []).length)],
      ]),
    ],
  };
}

export const reportFor = (kind) => ({ build: buildReport, budget: budgetReportFor, security: securityReport }[kind]);

/** §48 — the export for people who do not open the app. Every figure footnotes its file. */
export function renderReport(report, { folder = DEFAULT_FOLDER, at = new Date() } = {}) {
  const out = [`# ${report.kind[0].toUpperCase()}${report.kind.slice(1)} report`, '', `${at.toISOString().slice(0, 10)} · generated from ${folder}/ and .state/`, ''];
  for (const part of report.sections) {
    out.push(`## ${part.title}`, '', `_from ${part.from}_`, '');
    for (const [label, value] of part.rows) out.push(`- **${label}** — ${value}`);
    if (part.note) out.push('', `> ${part.note}`);
    out.push('');
  }
  out.push('Nothing is fixed from a report. Each line names the file to fix.', '');
  return out.join('\n');
}
