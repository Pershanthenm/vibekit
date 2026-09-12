// "A stock management app" is not a brief. Whether it tracks laptops with serial numbers or
// boxes of pens changes the data model, the lifecycle and half the screens. These rounds pin
// the subject down before anything is asked about platforms or frameworks.
//
// Only questions whose answer changes what gets built belong here. A question that merely
// colours the description wastes the user's attention.

const option = (id, label, description) => ({ id, label, description });

const IDENTITY = {
  id: 'identity',
  header: 'Identity',
  question: 'Is each item tracked individually, or counted in bulk?',
  options: [
    option('individual', 'Individually', 'Each one has a serial, asset tag or unique id, and its own history'),
    option('bulk', 'Counted in bulk', 'You care how many are left, not which one is which'),
    option('mixed', 'Both', 'Some things are serialised, others are counted'),
  ],
};

const AUDIT = {
  id: 'audit',
  header: 'Proof',
  question: 'What must this system be able to prove later?',
  multi: true,
  options: [
    option('custody', 'Who had what, and when', 'A defensible chain of custody per item'),
    option('counts', 'The count is right', 'Records reconcile against a physical or financial check'),
    option('access', 'Who changed what', 'An audit trail of every edit and who made it'),
    option('money', 'The money is right', 'Costs, value or billing must reconcile'),
  ],
};

export const DOMAINS = [
  {
    id: 'inventory',
    match: /\b(stock|inventory|asset|assets|equipment|warehouse|supplies|consumables)\b/i,
    label: 'stock and asset tracking',
    rounds: [
      {
        title: 'What you are tracking',
        questions: [
          {
            id: 'stockKind',
            header: 'Items',
            question: 'What kind of things does it track?',
            options: [
              option('it-equipment', 'IT equipment and devices', 'Laptops, phones, monitors — serial numbers, warranties, assigned to people'),
              option('stationery', 'Stationery and consumables', 'Pens, paper, toner — used up and reordered, not individually tracked'),
              option('parts', 'Parts, tools or raw materials', 'Components and materials consumed by production or repair'),
              option('goods', 'Goods for sale', 'Products held to sell or ship to customers'),
            ],
          },
          IDENTITY,
          {
            id: 'movement',
            header: 'Movement',
            question: 'How do items leave the store?',
            multi: true,
            options: [
              option('assigned', 'Assigned to a person', 'Someone holds it and is expected to return it'),
              option('consumed', 'Used up', 'It is issued and never comes back'),
              option('moved', 'Moved between locations', 'Sites, rooms or vans hold their own stock'),
              option('sold', 'Sold or shipped out', 'It leaves for a customer'),
            ],
          },
        ],
      },
      {
        title: 'Lifecycle and limits',
        when: (answers) => Boolean(answers.stockKind),
        questions: [
          {
            id: 'states',
            header: 'States',
            question: 'Which states must an item be able to be in?',
            multi: true,
            options: [
              option('in-stock', 'In stock', 'On the shelf and available'),
              option('out', 'Out — assigned, issued or in transit', 'Not available, but still yours'),
              option('repair', 'Being repaired or serviced', 'Temporarily unavailable, expected back'),
              option('retired', 'Written off, lost or disposed of', 'Gone, but the record must survive'),
            ],
          },
          {
            id: 'reorder',
            header: 'Running out',
            question: 'What should happen when stock runs low?',
            options: [
              option('threshold', 'Warn below a threshold', 'A level per item, flagged when it is crossed'),
              option('report', 'Show it in a report', 'Somebody reads it and decides'),
              option('nothing', 'Nothing for now', 'Running out is handled outside this system'),
            ],
          },
          AUDIT,
        ],
      },
    ],
  },
  {
    id: 'booking',
    match: /\b(booking|bookings|reservation|scheduling|appointment|appointments|calendar|rota|shifts?)\b/i,
    label: 'booking and scheduling',
    rounds: [
      {
        title: 'What is being booked',
        questions: [
          {
            id: 'resource',
            header: 'Resource',
            question: 'What is being booked?',
            options: [
              option('people', "People's time", 'Staff, practitioners or advisers with availability'),
              option('places', 'Rooms or spaces', 'A fixed set of places with capacity'),
              option('things', 'Equipment or vehicles', 'Items lent out for a period and returned'),
              option('events', 'Places at an event', 'Many people book onto one scheduled thing'),
            ],
          },
          {
            id: 'conflict',
            header: 'Clashes',
            question: 'What happens when two bookings collide?',
            options: [
              option('refuse', 'Refuse the second', 'The resource can only be held once'),
              option('overbook', 'Allow, up to a capacity', 'There is room for several at once'),
              option('queue', 'Put it on a waiting list', 'Somebody takes the place if it frees up'),
            ],
          },
          AUDIT,
        ],
      },
    ],
  },
  {
    id: 'records',
    match: /\b(crm|customers?|clients?|contacts?|patients?|students?|members?|cases?|applications?)\b/i,
    label: 'people and case records',
    rounds: [
      {
        title: 'Whose records',
        questions: [
          {
            id: 'subject',
            header: 'Records',
            question: 'Whose records does it hold?',
            options: [
              option('customers', 'Customers or clients', 'People or organisations you sell to or serve'),
              option('staff', 'Staff or members', 'People inside the organisation'),
              option('cases', 'Cases or applications', 'A piece of work that moves through stages'),
              option('mixed', 'People and the work about them', 'Both, linked together'),
            ],
          },
          {
            id: 'progression',
            header: 'Progress',
            question: 'Does a record move through defined stages?',
            options: [
              option('pipeline', 'Yes, a fixed pipeline', 'Stages everyone follows, in order'),
              option('status', 'Just a status', 'Open, closed, on hold — no fixed order'),
              option('none', 'No stages', 'Records are looked up and edited, not progressed'),
            ],
          },
          AUDIT,
        ],
      },
    ],
  },
];

/** The domain family an idea belongs to, or null when it is not one we have questions for. */
export const matchDomain = (idea) => DOMAINS.find((domain) => domain.match.test(String(idea ?? ''))) ?? null;

// Asked when the idea matches no known family. Deliberately structural rather than
// domain-specific: these shape the data model whatever the app turns out to be.
export const GENERIC_ROUND = {
  title: 'What this app is really about',
  questions: [
    {
      id: 'subjectKind',
      header: 'Subject',
      question: 'What does the system mostly keep track of?',
      options: [
        option('things', 'Physical things', 'Items that exist somewhere and move around'),
        option('people', 'People and their records', 'Customers, staff, members, patients'),
        option('work', 'Work moving through stages', 'Tasks, cases, orders, requests'),
        option('content', 'Content or documents', 'Things written, published or filed'),
      ],
    },
    IDENTITY,
    {
      id: 'driver',
      header: 'Rhythm',
      question: 'What makes someone open it on a normal day?',
      options: [
        option('queue', 'Something arrived to deal with', 'A queue or inbox drives the work'),
        option('lookup', 'They need to look something up', 'Search and read, occasionally edit'),
        option('record', 'They need to record what happened', 'Data entry after a real-world event'),
        option('schedule', 'Something is due', 'Time drives the work'),
      ],
    },
    AUDIT,
  ],
};

const answered = (round, answers) => round.questions.every((question) => answers[question.id] !== undefined);

/**
 * The next unanswered round for this idea, or null when the subject is pinned down.
 * Mirrors `advise next`: ask a little, record the answers, ask again.
 */
export function nextDomainRound(idea, answers = {}) {
  const domain = matchDomain(idea);
  const rounds = domain ? domain.rounds : [GENERIC_ROUND];
  for (const round of rounds) {
    if (round.when && !round.when(answers)) continue;
    if (!answered(round, answers)) return { domain: domain?.id ?? 'generic', title: round.title, questions: round.questions };
  }
  return null;
}
