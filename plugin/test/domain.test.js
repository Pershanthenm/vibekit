import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIMENSIONS, nextDomainRound, remainingDimensions } from '../src/advisor/domain.js';

console.log = () => {};

const ids = (round) => round.questions.map((question) => question.id);

// The tool must not know anything about stock, or booking, or any other kind of app.
// A catalogue of app types would make the listed ones good and everything else second-class.
test('the same dimensions are asked whatever the app is', () => {
  const ideas = [
    'a stock management app',
    'a recipe app for my family',
    'something for my band to plan gigs',
    'a tool for tracking grant applications',
    'a wedding seating planner',
  ];

  const first = ids(nextDomainRound(ideas[0], {}));
  for (const idea of ideas.slice(1)) {
    assert.deepEqual(ids(nextDomainRound(idea, {})), first, `"${idea}" was asked something different`);
  }
});

test('no dimension mentions a specific kind of app', () => {
  const words = /\b(stock|inventory|booking|crm|laptop|warehouse|patient|invoice)\b/i;
  for (const dimension of DIMENSIONS) {
    assert.doesNotMatch(dimension.question, words, `${dimension.id} question names a domain`);
    for (const [, label, description] of dimension.fallback) {
      assert.doesNotMatch(`${label} ${description}`, words, `${dimension.id} fallback names a domain`);
    }
  }
});

test('the idea is carried through so options can be generated from it', () => {
  const round = nextDomainRound('a stock management app', {});

  assert.equal(round.idea, 'a stock management app');
  for (const question of round.questions) {
    assert.ok(question.guidance, `${question.id} has no guidance for generating options`);
    assert.ok(question.why, `${question.id} does not say why it matters`);
  }
});

// Guidance is where the domain-specific examples belong: instructions to the agent, not a lookup.
test('guidance shows how to make options concrete, using more than one domain as an example', () => {
  const subject = DIMENSIONS.find((dimension) => dimension.id === 'subject');
  assert.match(subject.guidance, /recipe/i, 'a second, unrelated example keeps the guidance from reading as a stock tool');
  assert.match(subject.guidance, /never "items" or "records"/i);
});

test('asking continues until every dimension is answered, then stops', () => {
  const idea = 'anything at all';
  assert.deepEqual(remainingDimensions({}), DIMENSIONS.map((dimension) => dimension.id));

  const partial = { subject: 'devices', identity: 'individual' };
  const round = nextDomainRound(idea, partial);
  assert.ok(!ids(round).includes('subject'), 'an answered dimension is not asked again');
  assert.deepEqual(ids(round), remainingDimensions(partial).slice(0, 4));

  const answered = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.id, 'x']));
  assert.equal(nextDomainRound(idea, answered), null);
});

test('a round never exceeds what the menus can show', () => {
  const round = nextDomainRound('anything', {});
  assert.ok(round.questions.length <= 4, `asked ${round.questions.length} at once`);
  for (const question of round.questions) {
    assert.ok(question.options.length >= 2 && question.options.length <= 4, `${question.id} has ${question.options.length} options`);
    for (const option of question.options) assert.ok(option.label && option.description, `${question.id}/${option.id} is incomplete`);
  }
});

test('identity is always asked, because it decides the data model in any domain', () => {
  assert.ok(remainingDimensions({}).includes('identity'));
  const identity = DIMENSIONS.find((dimension) => dimension.id === 'identity');
  assert.match(identity.why, /different data models/i);
});
