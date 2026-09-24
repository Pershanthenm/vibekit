/**
 * Acceptance criteria in EARS form. Specification §49.
 *
 * Five patterns, one trigger and one response each, and nothing else allowed. The constraint is
 * not pedantry: because a criterion is exactly one trigger and one response, the reviewer's
 * mapping in `## Verification` becomes mechanical — one test per `AC-n`, named for it — instead
 * of a judgement about whether a paragraph was covered. It is also the contract between product,
 * design and engineering: readable by all three, executable by the last.
 *
 * "The system should be fast" parses as nothing, and that is the point.
 */

export const PATTERNS = Object.freeze({
  /** `The system shall …` */
  ubiquitous: /^the system shall\s+(?<response>.+?)\.?$/i,
  /** `When <trigger>, the system shall …` */
  event: /^when\s+(?<trigger>.+?),\s*(?:then\s+)?the system shall\s+(?<response>.+?)\.?$/i,
  /** `While <state>, the system shall …` */
  state: /^while\s+(?<trigger>.+?),\s*(?:then\s+)?the system shall\s+(?<response>.+?)\.?$/i,
  /** `Where <feature is included>, the system shall …` */
  optional: /^where\s+(?<trigger>.+?),\s*(?:then\s+)?the system shall\s+(?<response>.+?)\.?$/i,
  /** `If <unwanted condition>, then the system shall …` */
  unwanted: /^if\s+(?<trigger>.+?),\s*then\s+the system shall\s+(?<response>.+?)\.?$/i,
});

/** `- AC-1  When …` — the id is what a test is named for, so it is required. */
const CRITERION = /^[-*]\s*(?<id>AC-\d+)\b[.:)]?\s*(?<text>.+)$/i;

/**
 * A response that describes no observable outcome. These are the words people reach for when the
 * behaviour has not been decided yet, and a criterion built on one cannot be turned into a test.
 */
const UNOBSERVABLE = /^(?:be|remain|stay|look|feel|seem)\s+(?:fast|quick|responsive|performant|scalable|secure|reliable|robust|simple|intuitive|user[- ]friendly|easy|clean|modern|good|better|nice)\b/i;

const VAGUE_RESPONSE = /^(?:handle|support|manage|deal with|work with|process)\s+(?:it|this|them|things|data|everything|all)\b/i;

export const CRITERION_ORDER = Object.freeze(['unwanted', 'event', 'state', 'optional', 'ubiquitous']);

/**
 * Parse one criterion line.
 *
 * Returns `{ ok: true, … }` when it is a usable criterion, or `{ ok: false, reason }` naming what
 * is wrong in words the person who wrote it can act on.
 */
export function parseCriterion(line) {
  const matched = String(line).trim().match(CRITERION);
  if (!matched) {
    return { ok: false, reason: 'does not start with an id: a criterion is written `- AC-1  <criterion>` so a test can be named for it' };
  }
  const { id, text } = matched.groups;
  const body = text.trim();

  for (const name of CRITERION_ORDER) {
    const hit = body.match(PATTERNS[name]);
    if (!hit) continue;
    const response = hit.groups.response.trim();
    const trigger = hit.groups.trigger?.trim() ?? null;
    const negated = /^not\s+/i.test(response);
    const bare = response.replace(/^not\s+/i, '');

    if (UNOBSERVABLE.test(bare) || VAGUE_RESPONSE.test(bare)) {
      return {
        ok: false,
        id: id.toUpperCase(),
        pattern: name,
        observable: false,
        reason: `names no observable response ("${response}"). What would a test assert? That is an ask, not a criterion.`,
      };
    }

    return { ok: true, id: id.toUpperCase(), pattern: name, trigger, response, negated, text: body };
  }

  return {
    ok: false,
    id: id.toUpperCase(),
    reason: 'is not in EARS form. Use one of: "The system shall …", "When <trigger>, the system shall …", "While <state>, …", "Where <feature>, …", "If <condition>, then the system shall …"',
  };
}

/** Every `- AC-n` line in a `## Acceptance` section, parsed. */
export function parseCriteria(section) {
  return String(section ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s/.test(line))
    .map(parseCriterion);
}

/**
 * The test name a criterion should be proved by, so the reviewer's mapping is mechanical and
 * `vibekit drift` can check the link without reading anything.
 */
export const testNameFor = (requirementId, criterionId) => `${requirementId}:${criterionId}`;

export const isTodo = (line) => /\bTODO\b/i.test(String(line));
