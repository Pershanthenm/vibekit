import { join } from 'node:path';
import { DEFAULT_FOLDER } from '../folder/layout.js';
import { readText } from '../fsutil.js';
import { TIERS } from './policy.js';
import { costOf, readOverrides, readProvider } from './registry.js';

/**
 * Choosing a model, not just pricing one. Specification §63.
 *
 * The number that decides is **effective cost per completed requirement**: total spend including
 * the failures, divided by the requirements that reached `done`. Price alone is the wrong signal
 * because a cheap model that fails costs the failed session, plus the review that caught it,
 * plus the re-run.
 *
 * Every figure here comes from `.state/sessions.json` — this project's own measured usage. A
 * vendor's example workload says nothing about what a price change does to your bill, and a
 * price cut on a model you barely use is not news.
 */

/** §63 — below this there is not enough evidence to recommend, and saying so beats guessing. */
export const EVIDENCE_MIN = 20;

export const sessionsPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, '.state/sessions.json');

export async function readSessions(root, folder = DEFAULT_FOLDER) {
  try {
    const parsed = JSON.parse((await readText(sessionsPath(root, folder))) ?? '{}');
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

const within = (sessions, days, now) => (days
  ? sessions.filter((session) => new Date(session.at ?? 0).valueOf() >= now.valueOf() - days * 86400000)
  : sessions);

/**
 * Per model, per role, per size: the table §63 builds from your own data and never from marketing.
 */
export function performance(sessions, { days = 30, now = new Date() } = {}) {
  const rows = new Map();
  for (const session of within(sessions, days, now)) {
    const key = [session.model ?? 'unknown', session.role ?? 'unknown', session.size ?? '-'].join('|');
    const row = rows.get(key) ?? {
      model: session.model ?? 'unknown', role: session.role ?? 'unknown', size: session.size ?? '-',
      sessions: 0, completed: 0, escalated: 0, claims: 0, inventedNames: 0, reviewRounds: [], input: 0, output: 0, cached: 0,
    };
    row.sessions += 1;
    if (session.ended === 'done' || session.completed) row.completed += 1;
    if (session.escalated) row.escalated += 1;
    row.claims += Number(session.claimFindings ?? 0);
    row.inventedNames += Number(session.inventedNameFindings ?? 0);
    if (Number.isFinite(session.reviewRounds)) row.reviewRounds.push(session.reviewRounds);
    row.input += Number(session.input ?? 0);
    row.output += Number(session.output ?? 0);
    row.cached += Number(session.cached ?? 0);
    rows.set(key, row);
  }

  return [...rows.values()].map((row) => ({
    ...row,
    escalationRate: row.sessions ? row.escalated / row.sessions : null,
    claimsPer100: row.sessions ? (row.claims / row.sessions) * 100 : null,
    medianReviewRounds: median(row.reviewRounds),
  })).sort((a, b) => a.model.localeCompare(b.model) || a.role.localeCompare(b.role) || a.size.localeCompare(b.size));
}

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Effective cost per completed requirement.
 *
 * The denominator is completed requirements, not sessions, which is the whole point: a model
 * that needs two sessions and a re-run to finish one requirement is priced on the requirement.
 */
export async function effectiveCost(rows, provider) {
  const [file, overrides] = await Promise.all([readProvider(provider), readOverrides()]);
  const discounts = file?.discounts ?? {};

  return rows.map((row) => {
    const override = overrides.models.find((model) => model.id === row.model);
    const listed = file?.models.find((model) => model.id === row.model) ?? null;
    const rate = override ? { ...listed, ...override } : listed;
    const spend = costOf(rate, { input: row.input, output: row.output, cached: row.cached }, discounts);
    return {
      ...row,
      pricedFrom: rate ? (override ? 'overrides.yml' : `registry/${provider}.yml`) : null,
      spend,
      effectiveCost: spend !== null && row.completed ? spend / row.completed : null,
      // §63: fewer than 20 completed requirements is not evidence, and pretending otherwise is
      // how a team ends up moving its production tier on four data points.
      evidence: row.completed,
      enough: row.completed >= EVIDENCE_MIN,
    };
  });
}

/**
 * What remapping a tier would do to *this* project's bill, priced on its own last 30 days.
 */
export function impactOf(rows, { from, to, rate }) {
  const mine = rows.filter((row) => row.model === from);
  const spend = mine.reduce((total, row) => total + (row.spend ?? 0), 0);
  const input = mine.reduce((total, row) => total + row.input, 0);
  const output = mine.reduce((total, row) => total + row.output, 0);
  const cached = mine.reduce((total, row) => total + row.cached, 0);
  const would = costOf(rate, { input, output, cached });
  return {
    from,
    to,
    spend,
    would,
    delta: would === null ? null : would - spend,
    percent: spend > 0 && would !== null ? Math.round(((would - spend) / spend) * 100) : null,
  };
}

/**
 * A ranked recommendation, or an honest refusal.
 *
 * §63 is explicit that VibeKit does not pretend when there is no local evidence: it offers a
 * trial instead, which is a human decision, logged, and stoppable at any point.
 */
export function advise(priced, { tier = null } = {}) {
  const candidates = priced.filter((row) => row.effectiveCost !== null).sort((a, b) => a.effectiveCost - b.effectiveCost);
  const backed = candidates.filter((row) => row.enough);

  if (!candidates.length) {
    return { recommend: null, why: 'No completed requirements have been recorded yet, so there is nothing to price a recommendation on.', trial: null };
  }
  if (!backed.length) {
    const best = candidates[0];
    return {
      recommend: null,
      why: `${best.model} looks cheapest, but on ${best.evidence} completed requirement${best.evidence === 1 ? '' : 's'} — under the ${EVIDENCE_MIN} this needs. Recommending on that would be a guess with a number attached.`,
      trial: {
        candidate: best.model,
        shape: `route the next ${EVIDENCE_MIN - best.evidence} size-S requirements to ${best.model}, keep the reviewer one tier above, and compare effective cost against the incumbent`,
        note: 'A trial is a human decision, it is logged, and it can be stopped at any point. Until it completes, the incumbent mapping stands.',
      },
    };
  }

  const best = backed[0];
  return {
    recommend: { model: best.model, tier, effectiveCost: best.effectiveCost, evidence: best.evidence },
    why: `${best.model} has the lowest effective cost per completed requirement (${best.evidence} completed, escalation rate ${percent(best.escalationRate)}).`,
    trial: null,
  };
}

const percent = (value) => (value === null ? 'unknown' : `${Math.round(value * 100)}%`);

export { TIERS };
