import { join } from 'node:path';
import { readFrontMatter } from './frontmatter.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { SENSITIVE, TIERS } from './models/policy.js';
import { exists, readText } from './fsutil.js';

/**
 * Routing across runners. Specification §62.
 *
 * The fact the architecture turns on: **a seat is a sunk cost and an API call is a marginal
 * cost.** Most coding tools pick their own model on a subscription already paid for, and VibeKit
 * cannot reach inside them to choose a cheaper one — so it routes the *work* instead, onto sunk
 * cost wherever quality allows, and spends metered tokens only where a seat cannot go.
 *
 * The consequence that shapes this module: **a tier only binds on an API runner.** On a seat the
 * tier is a minimum — VibeKit says "this job needs at least mid" and the seat's own model
 * selection either satisfies it or the session is refused with a reason. Pretending otherwise
 * would be routing that quietly does not happen.
 */

export const KINDS = Object.freeze(['seat', 'api']);

/** §62 — the mode sets the defaults and never touches the gates. */
export const MODES = Object.freeze({
  thrift: {
    why: 'seats first for everything attended; S on cheap; batch everything batchable; one implementer at a time',
    lanes: 1,
    tierShift: 0,
    batch: true,
    seatsFirst: true,
    use: 'steady development, cost matters more than the calendar',
  },
  balanced: {
    why: 'the policy as written; seats for attended work, api for unattended; two parallel lanes',
    lanes: 2,
    tierShift: 0,
    batch: true,
    seatsFirst: true,
    use: 'most of the time',
  },
  sprint: {
    why: 'every independent requirement gets a lane, api alongside seats to raise concurrency, one tier above policy to cut rework, batch disabled',
    lanes: Infinity,
    tierShift: +1,
    batch: false,
    seatsFirst: false,
    use: 'a deadline; you are buying speed with money',
  },
});

export const runnersPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, 'agents/runners.md');

const section = (text, heading) => String(text ?? '').replace(/\r\n/g, '\n')
  .match(new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im'))?.[1] ?? '';

const list = (value) => String(value ?? '').replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);

/**
 * `## Runners` in agents/runners.md.
 *
 * The entries are written as `key: value · key: value`, which is how the rest of the folder
 * writes a line meant to be read by a person first. Unknown keys are kept rather than dropped:
 * a team that records `residency: eu-west` should not have it silently ignored by §52.
 */
export function parseRunners(text) {
  const body = section(text, 'Runners');
  const runners = [];
  let current = null;

  for (const raw of body.split('\n')) {
    const line = raw.replace(/```.*/, '').trim();
    if (!line) continue;

    const start = line.match(/^-\s*id:\s*(.+)$/);
    if (start) {
      current = { id: start[1].trim(), kind: 'seat', mcp: null, sandbox: 'no', unattended: false, models: [], goodAt: [], seats: null, rateLimit: null, tier: null, residency: null };
      runners.push(current);
      continue;
    }
    if (!current) continue;

    for (const pair of line.replace(/^-\s*/, '').split('·')) {
      const [key, ...rest] = pair.split(':');
      if (!rest.length) continue;
      const name = key.trim().toLowerCase();
      const value = rest.join(':').trim();

      if (name === 'kind') current.kind = KINDS.includes(value) ? value : current.kind;
      else if (name === 'mcp') current.mcp = value;
      else if (name === 'sandbox') current.sandbox = value;
      else if (name === 'unattended') current.unattended = /^(yes|true)$/i.test(value);
      else if (name === 'models-available') current.models = list(value).filter((tier) => TIERS.includes(tier));
      else if (name === 'good-at') current.goodAt = list(value);
      else if (name === 'seats') current.seats = Number.parseInt(value, 10) || null;
      else if (name === 'rate-limit') current.rateLimit = value;
      else if (name === 'tier') current.tier = TIERS.includes(value) ? value : null;
      else if (name === 'residency') current.residency = value;
      else current[name] = value;
    }
  }
  return runners;
}

/** `## Routing preferences` — kept as written, because they are read by a person as often as by this. */
export const parsePreferences = (text) => section(text, 'Routing preferences')
  .split('\n')
  .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
  .filter(Boolean)
  .map((line) => {
    const [when, then] = line.split(/\s*→\s*/);
    return { when: when?.trim() ?? line, then: then?.trim() ?? null, text: line };
  });

export async function loadRunners(root, folder = DEFAULT_FOLDER) {
  const text = await readText(runnersPath(root, folder));
  const profile = readFrontMatter((await readText(join(root, folder, 'profile.md'))) ?? '');
  const mode = MODES[profile.mode] ? profile.mode : 'balanced';
  return {
    runners: parseRunners(text ?? ''),
    preferences: parsePreferences(text ?? ''),
    mode,
    // §62: calibration is a setting, not advice. While it is on, size S runs a tier up.
    calibrate: String(profile.calibrate ?? 'false') === 'true',
    declared: Boolean(section(text ?? '', 'Runners').trim()),
  };
}

const up = (tier) => TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + 1)];

/**
 * §62's routing decision, in the order the specification gives: attended or unattended, then
 * which runner, then which tier. Every reason is returned, because all three are recorded in
 * `sessions.json` and the budget report has to explain where the work went.
 */
export function decide({
  runners, preferences = [], mode = 'balanced', calibrate = false,
  role, size = null, classes = [], tier,
  attended = true, rateLimited = [], implementer = null,
} = {}) {
  const reasons = [];
  const rules = MODES[mode] ?? MODES.balanced;
  const sensitive = classes.some((entity) => SENSITIVE.includes(entity));

  let required = tier;
  if (calibrate && role === 'implementer' && size === 'S' && required === 'cheap') {
    required = up(required);
    reasons.push('calibrate: true — size S runs a tier up until the escalation rate says cheap is enough');
  }
  if (rules.tierShift > 0) {
    required = up(required);
    reasons.push(`mode ${mode}: one tier above policy, to cut rework`);
  }

  // 1. Attended or unattended. Unattended work has no seat available at all.
  const wantSeat = attended && rules.seatsFirst !== false;
  reasons.push(attended
    ? 'a person is at the keyboard, so a seat is available and its marginal cost is zero'
    : 'nobody is at a keyboard, so no seat can be used and this is api work');

  // 2. Which runner.
  const available = runners.filter((runner) => !rateLimited.includes(runner.id));
  for (const runner of runners.filter((entry) => rateLimited.includes(entry.id))) {
    reasons.push(`${runner.id} is rate-limited, which is itself a reason to move`);
  }

  const candidates = available.filter((runner) => {
    if (!attended) return runner.kind === 'api' && runner.unattended;
    if (wantSeat && runner.kind !== 'seat') return false;
    return true;
  });

  // §52 and §62: unsandboxed runners cannot hold L requirements or classified data unless a
  // named human is present. On a seat, a person is present by definition.
  const allowed = candidates.filter((runner) => {
    if (!(sensitive || size === 'L')) return true;
    if (runner.sandbox === 'full') return true;
    return runner.kind === 'seat' && attended;
  });
  if (allowed.length < candidates.length) {
    reasons.push(`${sensitive ? 'classified data' : 'a size L requirement'} needs sandbox: full, or a seat with a named human present`);
  }

  // §62: a seat whose plan cannot select the required tier is refused, not quietly accepted.
  const capable = allowed.filter((runner) => (runner.kind === 'api'
    ? !runner.tier || TIERS.indexOf(runner.tier) >= TIERS.indexOf(required)
    : !runner.models.length || runner.models.some((available_) => TIERS.indexOf(available_) >= TIERS.indexOf(required))));
  if (capable.length < allowed.length) {
    reasons.push(`a runner whose plan cannot select at least ${required} is refused rather than quietly used`);
  }

  // Review is never the same runner and model as the implementation.
  const forReview = ['reviewer', 'compliance'].includes(role) && implementer
    ? capable.filter((runner) => runner.id !== implementer.runner)
    : capable;
  if (forReview.length < capable.length) {
    reasons.push(`review avoids ${implementer.runner}: the same runner and model shares the implementer's blind spots`);
  }

  // The fallback obeys the sandbox rule too. §62 is explicit that `models-allowed` and
  // data residency always win over price, and a fallback that skipped the check would be the
  // one path where classified work reached an unsandboxed runner.
  const fallback = available.filter((runner) => runner.kind === 'api' && runner.unattended
    && (!runner.tier || TIERS.indexOf(runner.tier) >= TIERS.indexOf(required))
    && (!(sensitive || size === 'L') || runner.sandbox === 'full'));

  const chosen = forReview[0] ?? fallback[0] ?? null;
  if (!chosen) {
    return {
      runner: null,
      tier: required,
      binding: false,
      reasons,
      refusal: `No runner in agents/runners.md can take this: ${role}${size ? ` size ${size}` : ''} needs at least ${required}${sensitive ? ' and a sandbox' : ''}${attended ? '' : ' and must run unattended'}.`,
    };
  }
  if (!forReview.length && fallback[0]) reasons.push('no seat qualified, so this falls back to an api runner at the required tier');

  return {
    runner: chosen,
    tier: required,
    // 3. The tier only binds on an API runner; on a seat it is a minimum the runner must meet.
    binding: chosen.kind === 'api',
    minimum: chosen.kind === 'seat' ? required : null,
    reasons,
    refusal: null,
    mode,
    lanes: rules.lanes,
    batch: rules.batch,
    preferences: preferences.map((preference) => preference.text),
  };
}

/**
 * `vibekit check --runners`. §62: verify each entry can reach the folder, report which are
 * unsandboxed, and report seat utilisation — so you can see whether you are paying for seats you
 * do not use or hitting limits you should raise.
 */
export async function checkRunners(root, { folder = DEFAULT_FOLDER, sessions = [] } = {}) {
  const { runners, declared, mode, calibrate } = await loadRunners(root, folder);
  const findings = [];

  if (!declared) {
    findings.push({ severity: 'warning', code: 'runners.none', message: `${folder}/agents/runners.md lists no runner, so every routing decision is a default nobody chose.` });
  }

  const reachable = await exists(join(root, folder));
  for (const runner of runners) {
    if (!reachable) {
      findings.push({ severity: 'error', code: 'runners.unreachable', message: `${runner.id} cannot reach ${folder}/: it is not there.` });
    }
    if (runner.kind === 'seat' && runner.sandbox !== 'full') {
      findings.push({
        severity: 'warning',
        code: 'runners.unsandboxed',
        message: `${runner.id} is sandbox: ${runner.sandbox}. It cannot hold a size L requirement or anything touching secret or financial data unless a named human is present.`,
      });
    }
    if (runner.kind === 'api' && !runner.tier) {
      findings.push({ severity: 'error', code: 'runners.noTier', message: `${runner.id} is an api runner with no tier, so nothing can decide whether it is strong enough for a piece of work.` });
    }
  }

  // Seat utilisation, from real sessions rather than from an estimate.
  const used = new Map();
  for (const session of sessions) used.set(session.runner, (used.get(session.runner) ?? 0) + 1);
  const utilisation = runners.map((runner) => ({
    id: runner.id,
    kind: runner.kind,
    seats: runner.seats,
    sessions: used.get(runner.id) ?? 0,
    idle: runner.kind === 'seat' && (used.get(runner.id) ?? 0) === 0,
  }));

  for (const entry of utilisation.filter((row) => row.idle && row.seats)) {
    findings.push({
      severity: 'warning',
      code: 'runners.idleSeats',
      message: `${entry.id} has ${entry.seats} seat(s) and no recorded session. A seat you have already bought is the cheapest thing you own.`,
    });
  }

  return { runners, findings, utilisation, mode, calibrate, checked: true };
}

/**
 * §62 — at each phase gate the escalation rate decides whether `cheap` is strong enough for this
 * template. Under ten per cent it proposes dropping S to cheap and a human accepts; above it, the
 * fix is the tier mapping in app settings rather than the policy.
 */
export const CALIBRATION_THRESHOLD = 0.1;

export function calibration(sessions, { threshold = CALIBRATION_THRESHOLD } = {}) {
  const small = sessions.filter((session) => session.size === 'S' && session.role === 'implementer');
  if (!small.length) return { enough: false, rate: null, proposal: null, why: 'no size S implementer sessions have been recorded yet.' };

  const rate = small.filter((session) => session.escalated).length / small.length;
  if (rate < threshold) {
    return {
      enough: true,
      rate,
      proposal: 'drop size S to cheap, and set calibrate: false',
      why: `${Math.round(rate * 100)}% of size S work escalated, under the ${Math.round(threshold * 100)}% threshold. A human accepts this; it is not applied automatically.`,
    };
  }
  return {
    enough: true,
    rate,
    proposal: null,
    why: `${Math.round(rate * 100)}% of size S work escalated, over the ${Math.round(threshold * 100)}% threshold. The cheap mapping is too weak for this template: the fix is the mapping in app settings, not the policy.`,
  };
}
