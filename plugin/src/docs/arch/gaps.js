/**
 * What the folder does not answer yet, as questions. Specification §59.
 *
 * "`spec` walks each section and, for any it cannot fill from the folder, raises an ask (§12,
 * plain language first, ten at most)."
 *
 * The important half is where the answer lands. §59: "Answers land in `quality.md`, `context.md`
 * or `architecture.md`, never only in the document, so the next generation has them." A gap
 * answered into the document alone is a gap again at the next release — and the document would
 * then be the only record, which is the failure this whole format exists to prevent.
 */

/** §12 — ten at most, because an inbox nobody can clear is an inbox nobody opens. */
export const ASK_LIMIT = 10;

/**
 * One entry per placeholder the two specifications can leave empty, in the order §59 lists them.
 * Anything not named here is a gap the document reports but does not ask about: it is either
 * genuinely not applicable (a project with no UI has no accessibility level to set) or it is
 * derived from work that has not happened yet.
 */
export const GAPS = Object.freeze([
  {
    placeholder: 'table.quality',
    plain: 'How fast does it have to be, and how often can it be down?',
    ask: 'Performance and availability targets are not set: response time at which percentile under what load, and availability measured how.',
    lands: 'product/quality.md',
  },
  {
    placeholder: 'table.retention',
    plain: 'How long do we keep personal data, and what happens when somebody asks us to delete it?',
    ask: 'No retention or erasure rule is recorded for the classified entities. A requirement creating that data without a rule is an ask.',
    lands: 'product/quality.md',
  },
  {
    placeholder: 'table.dependencies',
    plain: 'Which other systems does this talk to, and who owns them?',
    ask: 'The external interfaces are not recorded, so the specification cannot say who owns them or what happens when one is down.',
    lands: 'workflow/architecture.md',
  },
  {
    placeholder: 'table.environments',
    plain: 'Where does this run, and how does a change get from a laptop to customers?',
    ask: 'No environments are recorded, so the specification cannot describe deployment or promotion.',
    lands: 'delivery/environments.md',
  },
  {
    placeholder: 'table.access_matrix',
    plain: 'Who is allowed to do what?',
    ask: 'The access matrix is empty, so the specification cannot state user classes or authorisation.',
    lands: 'product/access.md',
  },
  {
    placeholder: 'table.invariants',
    plain: 'What must always be true, no matter what anybody does?',
    ask: 'No invariants are recorded, so the constraints section has nothing to state.',
    lands: 'product/invariants.md',
  },
  {
    placeholder: 'table.glossary',
    plain: 'Which words mean something specific here, and what do they mean?',
    ask: 'The glossary is empty, so the definitions section cannot be written and agents have no closed vocabulary.',
    lands: 'product/glossary.md',
  },
  {
    placeholder: 'table.sources',
    plain: 'What did we write this from?',
    ask: 'No source document is recorded, so no requirement can be checked against what was actually asked for.',
    lands: 'product/sources/index.md',
  },
  {
    placeholder: 'table.health',
    plain: 'How do we tell, from outside, whether it is working?',
    ask: 'No health or readiness endpoints are recorded, so the operations section cannot say how to tell it is up.',
    lands: 'delivery/observability.md',
  },
  {
    placeholder: 'product.out_of_scope',
    plain: 'What are we deliberately not doing?',
    ask: 'Out of scope is unwritten, so the deferred-scope section cannot distinguish "not yet" from "never".',
    lands: 'product/context.md',
  },
  {
    placeholder: 'narrative.flows',
    plain: 'What are the two or three journeys somebody actually takes through this?',
    ask: 'No flows are recorded, so the user-interface section has nothing to describe.',
    lands: 'product/flows.md',
  },
  {
    placeholder: 'table.secrets',
    plain: 'What credentials does this need, and where are they kept?',
    ask: 'No secret names are recorded, so the specification cannot say where credentials live.',
    lands: '.env.example',
  },
]);

/** The `<!-- vibekit · nothing to fill: … -->` line a generated document already carries. */
export function unfilled(document) {
  const note = String(document ?? '').match(/nothing to fill:\s*([^>]*?)(?:·|-->)/);
  if (!note) return [];
  return note[1].split(',').map((name) => name.trim()).filter(Boolean);
}

/**
 * The asks worth raising for these documents, capped and in specification order.
 *
 * `existing` is the open inbox: a question already waiting on somebody is not asked twice, which
 * is the difference between an inbox and a nag.
 */
export function gapsFor(documents, { existing = [] } = {}) {
  const empty = new Set(documents.flatMap((document) => unfilled(document)));
  const asked = new Set(existing.map((ask) => String(ask.ask ?? '').trim()));

  return GAPS
    .filter((gap) => empty.has(gap.placeholder))
    .filter((gap) => !asked.has(gap.ask))
    .slice(0, ASK_LIMIT);
}

/** What the documents left empty and nobody asks about, so the omission is at least visible. */
export function unaskedGaps(documents) {
  const named = new Set(GAPS.map((gap) => gap.placeholder));
  return [...new Set(documents.flatMap((document) => unfilled(document)))].filter((name) => !named.has(name)).sort();
}
