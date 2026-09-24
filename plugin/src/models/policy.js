import { join } from 'node:path';
import { DEFAULT_FOLDER } from '../folder/layout.js';
import { readText } from '../fsutil.js';
import { readFrontMatter } from '../frontmatter.js';

/**
 * Tiers, and which one a piece of work earns. Specification §61.
 *
 * **The folder never names a model; it names a tier.** That is the whole design: model names
 * change every few months and the judgement of what a job is worth does not, so the repository
 * records the judgement and an install maps it to today's models (§63).
 *
 * The policy is not invented here either. It is written in `agents/humans.md` under
 * `## Model policy`, because it is a decision a tech lead makes and revisits — the table below
 * is only what that file says when nobody has changed it.
 */

/** §61 — four tiers, in ascending order of what they cost and what they are trusted with. */
export const TIERS = Object.freeze(['local', 'cheap', 'mid', 'strong']);

export const TIER_NOTES = Object.freeze({
  local: 'never leaves the machine: secret detection, redaction, EARS parsing, matching',
  cheap: 'mechanical: S requirements, scaffolding, fixtures, docs generation, changelog, compliance',
  mid: 'production: implementing M and L requirements, migrations, design system extraction',
  strong: 'judgement: clarify, architecture, plan, review of L, security review, understanding a repo',
});

/** §52 and §61 — the classes that pull a requirement up a tier and restrict where it may route. */
export const SENSITIVE = Object.freeze(['financial', 'secret']);

export const DEFAULT_POLICY = Object.freeze([
  { role: 'analyst', tier: 'strong' },
  { role: 'planner', tier: 'strong' },
  { role: 'designer', tier: 'strong' },
  { role: 'implementer', size: 'S', tier: 'cheap' },
  { role: 'implementer', size: 'M', tier: 'mid' },
  { role: 'implementer', size: 'L', tier: 'mid', sensitiveTier: 'strong' },
  { role: 'migrator', tier: 'mid' },
  { role: 'reviewer', aboveImplementer: true },
  { role: 'compliance', tier: 'cheap' },
]);

const policyPath = (root, folder) => join(root, folder, 'agents/humans.md');

const section = (text, heading) => String(text ?? '').replace(/\r\n/g, '\n')
  .match(new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im'))?.[1] ?? '';

/**
 * `## Model policy` in agents/humans.md.
 *
 * Each line is `<role> [size X]: <tier>[, <tier> when …]`. The reviewer's line is special and
 * says so in words rather than naming a tier, because "one above the implementer" is the rule —
 * pinning the reviewer to a tier is how review quietly becomes cheaper than the work it reviews.
 */
export function parsePolicy(text) {
  const body = section(text, 'Model policy');
  const rules = [];
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^\s*[-*]\s+/, '').trim();
    if (!line || !line.includes(':')) continue;
    const [left, right] = line.split(/:\s*/);
    const subject = left.trim().toLowerCase();
    const value = right.trim();

    if (/one tier above the implementer/i.test(value)) {
      rules.push({ role: 'reviewer', aboveImplementer: true, differentModel: /different model/i.test(value) });
      continue;
    }

    const sizeMatch = subject.match(/^(\w+)\s+size\s+([sml])$/i);
    const roles = (sizeMatch ? [sizeMatch[1]] : subject.split(/\s*,\s*/)).map((role) => role.trim()).filter(Boolean);
    const size = sizeMatch ? sizeMatch[2].toUpperCase() : null;

    const tiers = value.split(/\s*,\s*/);
    const base = TIERS.find((tier) => tiers[0].split(/\s+/).includes(tier));
    if (!base) continue;
    // "mid, strong when it touches financial or secret data" — the conditional tier is the one
    // that matters for a classified requirement, so it is kept rather than flattened away.
    const conditional = tiers.slice(1).join(', ');
    const sensitiveTier = TIERS.find((tier) => conditional.split(/\s+/).includes(tier)) ?? null;

    for (const role of roles) rules.push({ role, size, tier: base, sensitiveTier });
  }
  return rules.length ? rules : [...DEFAULT_POLICY];
}

export async function loadPolicy(root, folder = DEFAULT_FOLDER) {
  const text = await readText(policyPath(root, folder));
  return { rules: parsePolicy(text ?? ''), declared: Boolean(section(text ?? '', 'Model policy').trim()) };
}

const above = (tier) => TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + 1)];

/**
 * The tier for one piece of work, and every reason for it.
 *
 * Reasons are returned rather than logged because a routing decision nobody can see is one
 * nobody can argue with, and the budget report has to explain the bill.
 */
export function tierFor(rules, { role, size = null, classes = [] } = {}) {
  const sensitive = classes.some((entity) => SENSITIVE.includes(entity));
  const reasons = [];

  if (role === 'reviewer' || role === 'compliance') {
    const rule = rules.find((entry) => entry.role === role);
    if (rule?.aboveImplementer) {
      // §61: review is where a cheap implementer's mistakes are caught.
      const implementer = tierFor(rules, { role: 'implementer', size, classes });
      reasons.push(`one tier above the implementer on this work (${implementer.tier})`);
      if (rule.differentModel !== false) reasons.push('and a different model, so it does not share the implementer\'s blind spots');
      return { tier: above(implementer.tier), reasons, differentModel: rule.differentModel !== false };
    }
  }

  // Exact size first, then a sizeless rule, then any rule for the role. Every implementer line
  // in the default policy carries a size, so asking without one found nothing and reported the
  // role as unrouted — which it is not.
  const match = rules.find((entry) => entry.role === role && entry.size === size)
    ?? rules.find((entry) => entry.role === role && !entry.size)
    ?? rules.find((entry) => entry.role === role);
  if (!match) return { tier: null, reasons: [`agents/humans.md has no model policy line for ${role}`], differentModel: false };

  let tier = match.tier;
  reasons.push(`agents/humans.md: ${role}${size ? ` size ${size}` : ''} → ${tier}`);
  if (sensitive && match.sensitiveTier) {
    tier = match.sensitiveTier;
    reasons.push(`raised to ${tier} because it touches ${classes.filter((entity) => SENSITIVE.includes(entity)).join(' and ')} data`);
  }
  return { tier, reasons, differentModel: false };
}

// ---------------------------------------------------------------- escalation (§61)

/**
 * Cheap first, escalate on evidence, never on a hunch.
 *
 * The distinction the spec draws and this keeps: two review rounds is the *budget* being spent,
 * so the third attempt moves up; a claim or an invented name is a model being untrustworthy on
 * this task, so it moves up immediately. A model that hallucinated once does not get a second
 * try at the same tier.
 */
export function escalation({ tier, reviewRounds = 0, findings = [] } = {}) {
  const untrustworthy = findings.filter((finding) => ['claim', 'inventedName'].includes(finding));
  if (untrustworthy.length) {
    return { escalate: true, to: above(tier), why: `a ${untrustworthy[0]} finding — a model that did that on this task does not get a second try at the same tier` };
  }
  if (reviewRounds >= 2) {
    return { escalate: true, to: above(tier), why: 'the reviewer returned findings twice; the review budget is spent' };
  }
  return { escalate: false, to: tier, why: null };
}

// ---------------------------------------------------------------- caps (§61)

export const CAPS = Object.freeze([
  { key: 'cap-requirement', label: 'per requirement', onBreach: 'the session ends at the next checkpoint and the requirement is blocked with reason "over budget"' },
  { key: 'cap-phase', label: 'per phase', onBreach: 'no new requirement starts until a human raises the cap or re-scopes' },
  { key: 'cap-day', label: 'per day', onBreach: 'new sessions pause until midnight or a human override; running sessions checkpoint and stop' },
]);

/** The caps in profile.md, in tokens. A cap nobody set is reported as unset, never guessed. */
export async function loadCaps(root, folder = DEFAULT_FOLDER) {
  const profile = readFrontMatter((await readText(join(root, folder, 'profile.md'))) ?? '');
  return CAPS.map((cap) => {
    const raw = String(profile[cap.key] ?? '').replace(/[_,\s]/g, '');
    const tokens = Number.parseInt(raw, 10);
    return { ...cap, tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : null };
  });
}

/** Which caps this spend has broken. Ceilings, not targets: under one is not a result. */
export const breached = (caps, spend) => caps
  .filter((cap) => cap.tokens !== null && Number(spend[cap.key] ?? 0) > cap.tokens)
  .map((cap) => ({ ...cap, spent: Number(spend[cap.key]) }));
