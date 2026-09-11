// Turns a requirements document someone already wrote — a bulleted list, a numbered spec, a
// page of prose — into draft acceptance criteria, and says plainly which ones are not testable
// yet. Deciding what a vague line should become is /clarify's job; this finds them.

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const HEADING = /^\s*#{1,6}\s+(.*\S)\s*$/;
const MODAL = /\b(?:must|shall|should|needs? to|has to|will|is able to|can)\b/i;

// A criterion is testable when a reader can tell who does what, and what is then observable.
const HAS_ACTOR = /\b(?:user|users|admin|administrator|operator|staff|customer|system|api|service|agent|visitor|member|manager|reviewer|caller|client|finance|auditor|developer|engineer|owner|lead|support|team|guest|anyone|everyone)\b/i;
const HAS_OUTCOME = /\b(?:then|so that|results? in|returns?|shows?|displays?|records?|rejects?|prevents?|sends?|creates?|updates?|deletes?|blocks?|logs?)\b/i;
const VAGUE_WORDS = /\b(?:fast|quick|slow|easy|simple|intuitive|nice|good|better|robust|scalable|secure|user-friendly|seamless|modern|etc)\b/i;
const UNDECIDED = /\bTODO\b|\bTBD\b|\bFIXME\b|\?\?\?/i;

const clean = (text) => text.replace(/\s+/g, ' ').trim();

function assess(statement) {
  const problems = [];
  if (UNDECIDED.test(statement)) problems.push('not decided yet');
  if (!HAS_ACTOR.test(statement)) problems.push('no actor — who does this?');
  if (!HAS_OUTCOME.test(statement)) problems.push('no observable outcome — what is true afterwards?');
  if (VAGUE_WORDS.test(statement)) problems.push('unmeasurable wording — needs a number or a definition');
  return { testable: problems.length === 0, problems };
}

/** Every line that reads like a requirement, with the heading it sat under. */
export function extractRequirements(text) {
  if (!text?.trim()) return [];
  let section = '';
  const found = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const heading = raw.match(HEADING);
    if (heading) {
      section = clean(heading[1]);
      return;
    }
    const bullet = raw.match(BULLET);
    const sentence = !bullet && MODAL.test(raw) && raw.trim().length > 25 ? clean(raw) : '';
    const statement = bullet ? clean(bullet[1]) : sentence;
    if (!statement || statement.length < 8) return;
    found.push({ statement, section, line: index + 1, ...assess(statement) });
  });

  return found;
}

/** What the document is missing, phrased so a person can act on it. */
export function readiness(requirements) {
  const testable = requirements.filter((requirement) => requirement.testable);
  return {
    total: requirements.length,
    testable: testable.length,
    gaps: requirements.filter((requirement) => !requirement.testable),
    // Below this, the menus and /clarify are a better starting point than the document.
    detailed: requirements.length >= 3 && testable.length >= Math.ceil(requirements.length / 2),
  };
}

const criterion = (requirement, index) => {
  const note = requirement.testable ? '' : `  <!-- TODO(unknown): ${requirement.problems.join('; ')} -->`;
  return `- [ ] AC-${index + 1}: ${requirement.statement}${note}`;
};

export const renderCriteria = (requirements) => requirements.map(criterion).join('\n');

export function summarise(requirements, source) {
  const report = readiness(requirements);
  const lines = [`Read ${report.total} requirement(s) from ${source}: ${report.testable} testable as written.`];
  if (report.gaps.length) {
    lines.push('', 'These need a decision before they can be tested:');
    for (const gap of report.gaps.slice(0, 12)) {
      lines.push(`  line ${gap.line}: ${gap.statement.slice(0, 70)}`);
      lines.push(`    ${gap.problems.join('; ')}`);
    }
    if (report.gaps.length > 12) lines.push(`  … and ${report.gaps.length - 12} more`);
  }
  lines.push('', report.detailed
    ? 'Enough to start from. Run /vibe-check-cli:clarify to settle what is left.'
    : 'Thin as a starting point — run /vibe-check-cli:clarify, which asks about the gaps by menu.');
  return lines.join('\n');
}
