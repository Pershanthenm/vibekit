/**
 * The questions after setup (Init Spec §4). Each one changes something expensive to change
 * later, says so in two lines, and has options where options exist. "I don't know" is always
 * there and is not a failure: it is recorded as an assumption with a confidence and a blast
 * radius, which beats a silent guess or a random pick to get past a screen.
 *
 * These are the questions the analyst would ask first in any project; the analyst then asks
 * what is specific to this one. A picked answer is recorded exactly as if the person had typed
 * it in reply to an ask, so `vibekit show why` can trace a line of code back to it.
 */

const Q = (id, question, why, options, { shape = false, applies = () => true, topic = id, record = null } = {}) =>
  Object.freeze({ id, question, why, options: options.map(([value, label]) => ({ id: value, label })), shape, applies, topic, record });

export const SHAPE_QUESTIONS = Object.freeze([
  Q('platform', 'Where will people use it?',
    'This decides the architecture, the kinds of test, and whether there is a design stage at all. Changing it later means a different front end.',
    [['web', 'In a web browser'], ['mobile', 'On their phones (iOS and Android)'], ['web,mobile', 'Both: a browser and a phone app'], ['api', 'It is an API; something else has the screens'], ['cli', 'On the command line']],
    { shape: true, applies: (context) => !context.platformGiven, record: 'platforms' }),

  Q('tenancy', 'Do teams see each other\'s data?',
    'This decides whether every record carries a team, and whether the data layer filters by it. Changing it later means touching every query.',
    [['isolated', 'Each team sees only its own'], ['multi', 'People can belong to several teams and switch'], ['single', 'One team only — no separation needed']],
    { shape: true, applies: (context) => /\b(?:team|teams|company|companies|customer|customers|client|clients|store|stores|branch|tenant|organi[sz]ation|school|clinic)\b/i.test(context.description) }),

  Q('auth', 'Who can sign in?',
    'This decides whether there is an account system, an invite flow, or an identity provider to connect to. Each is a different first sprint.',
    [['open', 'Anyone who registers'], ['invited', 'Only people we invite'], ['sso', 'People with a company login (single sign-on)'], ['none', 'Nobody signs in — it is open']],
    { shape: true }),

  Q('roles', 'Are there different kinds of user?',
    'This decides whether every action checks who is asking, and how the access rules are written. Adding roles later means revisiting every screen.',
    [['same', 'Everyone can do the same things'], ['few', 'A few roles with different powers, such as an admin'], ['full', 'A full permissions model per record']],
    { shape: true }),

  Q('data', 'What is the most sensitive thing it stores?',
    'This sets the data classification: what must be encrypted, who may see it, and how long it can be kept.',
    [['none', 'Nothing personal'], ['contact', 'Names and contact details'], ['financial', 'Payment or financial data'], ['regulated', 'Health, identity or other regulated data']],
    { topic: 'data classification' }),

  Q('integrations', 'Does it need to talk to another system?',
    'Each integration is a contract to keep and a place things fail, so the plan needs to know early.',
    [['no', 'No'], ['reads', 'It reads from one'], ['both', 'It reads and writes'], ['several', 'Several systems']],
    { topic: 'integrations' }),

  Q('scale', 'How many people at once, roughly?',
    'A handful and thousands are different systems: this changes what is fine and what is a bottleneck.',
    [['handful', 'A handful'], ['hundreds', 'Hundreds'], ['thousands', 'Thousands'], ['unbounded', 'It must scale without a ceiling']],
    { topic: 'scale', applies: (context) => !context.tenancy }),

  Q('offline', 'Does it have to work without a connection?',
    'Offline capture means a local store and a sync that resolves conflicts, which is a different data layer.',
    [['no', 'No, it is always online'], ['read', 'Reading works offline; changes need a connection'], ['capture', 'People capture offline and it syncs later']],
    { topic: 'offline', applies: (context) => /\b(?:phone|mobile|field|warehouse|store|site|van|offline|tablet)\b/i.test(context.description) }),
]);

/** Up to six, in order; the counter is honest about how many change the shape. */
export function selectQuestions({ description = '', platformGiven = false, limit = 6 } = {}) {
  const context = { description: String(description ?? ''), platformGiven };
  context.tenancy = SHAPE_QUESTIONS.find((question) => question.id === 'tenancy').applies(context);
  const chosen = SHAPE_QUESTIONS.filter((question) => question.applies(context)).slice(0, limit);
  return { questions: chosen, shape: chosen.filter((question) => question.shape).length };
}

/** How a "don't know" is written down: the assumption the plan will proceed on, and what it touches. */
export function assumptionFor(question) {
  const first = question.options[0];
  return `Assumed "${first.label}" for "${question.question}" — not asked, not answered · checklist item: ${question.topic} · confidence: low · blast radius: ${question.why.split(/(?<=\.)\s/)[0]}`;
}
