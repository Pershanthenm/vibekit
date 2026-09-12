// "A stock management app" is not a brief — but neither is "a recipe app" or "a tool for our
// band". Whatever the domain, the same few things decide what gets built, and they are what
// this asks about.
//
// Deliberately no catalogue of app types. Encoding stock apps, booking apps and CRMs would
// make those three good and everything else second-class, and the list would never end. The
// dimensions below are universal; the concrete options are generated from the user's own words
// at the time of asking, which is judgement a model does well and a lookup table cannot.

/**
 * What has to be known before a stack, a data model or a screen can be chosen. Each carries
 * the question, why it matters, and how to turn it into options in the user's own vocabulary.
 * `fallback` is only for when the idea is too thin to generate anything concrete from.
 */
export const DIMENSIONS = [
  {
    id: 'subject',
    header: 'Subject',
    question: 'What does the system mostly keep track of?',
    why: 'Everything else — the data model, the screens, the reports — hangs off the main entity.',
    guidance: 'Offer the concrete kinds of thing this idea might be about, in the user\'s own words. '
      + 'For "a stock management app": IT equipment and devices; stationery and consumables; parts and raw materials; goods for sale. '
      + 'For "a recipe app": recipes; ingredients and pantry stock; meal plans; shopping lists. '
      + 'Name real, distinguishable kinds — never "items" or "records".',
    fallback: [
      ['things', 'Physical things', 'Items that exist somewhere and move around'],
      ['people', 'People and their records', 'Customers, staff, members, patients'],
      ['work', 'Work moving through stages', 'Tasks, cases, orders, requests'],
      ['content', 'Content or documents', 'Things written, published or filed'],
    ],
  },
  {
    id: 'identity',
    header: 'Identity',
    question: 'Is each one tracked individually, or counted in bulk?',
    why: 'Individually identified things need their own history and lifecycle; bulk things need a count and a threshold. These are different data models, and it is expensive to change later.',
    guidance: 'Phrase both options in terms of the subject just chosen — "each laptop has a serial and its own history" against "you care how many boxes are left".',
    fallback: [
      ['individual', 'Individually', 'Each has a unique id and its own history'],
      ['bulk', 'Counted in bulk', 'You care how many there are, not which is which'],
      ['mixed', 'Both', 'Some are identified, others are counted'],
    ],
  },
  {
    id: 'lifecycle',
    header: 'Lifecycle',
    question: 'What states does one of those move through?',
    why: 'The states are the workflow. They decide the screens, the permissions and most of the reports.',
    guidance: 'Offer states that are real for this subject — for devices: in stock, assigned, in repair, written off; for a job application: received, screening, interview, offer, rejected. '
      + 'Ask which ones must exist, not whether a lifecycle exists at all.',
    fallback: [
      ['simple', 'Active or inactive', 'Little more than exists or does not'],
      ['staged', 'A fixed sequence of stages', 'Everyone follows the same order'],
      ['status', 'A status, no fixed order', 'Open, on hold, closed — set as needed'],
      ['custody', 'Who holds it changes over time', 'It moves between people or places'],
    ],
  },
  {
    id: 'actors',
    header: 'Who uses it',
    question: 'Who uses this, and who must be kept out?',
    why: 'Roles decide authorisation, which is the most expensive thing to retrofit and the most common source of real breaches.',
    guidance: 'Name the actual roles for this domain — stockroom staff, finance, a repair vendor — and include any role that must be able to read but not change.',
    fallback: [
      ['one-team', 'One team, all trusted equally', 'No meaningful roles inside it'],
      ['roles', 'Several roles with different powers', 'Some can change what others only read'],
      ['customers', 'People outside the organisation', 'Customers or the public sign in'],
      ['public', 'Partly public', 'Some of it is readable without signing in'],
    ],
  },
  {
    id: 'proof',
    header: 'Proof',
    question: 'What must this be able to prove later?',
    multi: true,
    why: 'This decides auditing, retention and how much of the security baseline applies. It is the question people regret not asking.',
    guidance: 'Keep these general; they are already domain-neutral. Drop any that plainly cannot apply.',
    fallback: [
      ['history', 'Who changed what, and when', 'An audit trail of every change'],
      ['custody', 'Who had what, and when', 'A defensible chain of custody'],
      ['counts', 'That the numbers are right', 'Records reconcile against a real count'],
      ['money', 'That the money is right', 'Costs, value or billing must reconcile'],
    ],
  },
];

const option = ([id, label, description]) => ({ id, label, description });

const MAX_PER_ROUND = 4;

/**
 * The next dimensions still to ask about, at most a menu's worth. Returns null once the
 * subject is pinned down. The same dimensions are asked whatever the idea: only the options
 * put in front of the user differ, and those are generated, not looked up.
 */
export function nextDomainRound(idea, answers = {}) {
  const remaining = DIMENSIONS.filter((dimension) => answers[dimension.id] === undefined);
  if (!remaining.length) return null;

  const asking = remaining.slice(0, MAX_PER_ROUND);
  return {
    idea: String(idea ?? '').trim(),
    title: asking.some((dimension) => dimension.id === 'subject') ? 'What you are building' : 'How it behaves',
    questions: asking.map((dimension) => ({
      id: dimension.id,
      header: dimension.header,
      question: dimension.question,
      multi: Boolean(dimension.multi),
      why: dimension.why,
      guidance: dimension.guidance,
      options: dimension.fallback.map(option),
    })),
  };
}

/** Everything still unanswered, for a caller that would rather see the whole shape at once. */
export const remainingDimensions = (answers = {}) => DIMENSIONS.filter((dimension) => answers[dimension.id] === undefined).map((dimension) => dimension.id);
