import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMAINS, GENERIC_ROUND, matchDomain, nextDomainRound } from '../src/advisor/domain.js';

console.log = () => {};

const ids = (round) => round.questions.map((question) => question.id);

// The whole point: "a stock management app" must not go straight to platforms and frameworks.
test('a vague stock idea is asked what it actually tracks', () => {
  const round = nextDomainRound('I want to build a stock management app', {});

  assert.equal(round.domain, 'inventory');
  assert.deepEqual(ids(round), ['stockKind', 'identity', 'movement']);

  const kinds = round.questions[0].options.map((option) => option.id);
  assert.deepEqual(kinds, ['it-equipment', 'stationery', 'parts', 'goods'], 'IT equipment and stationery are offered as distinct answers');
});

test('the rounds adapt once the subject is known', () => {
  const idea = 'stock management app';
  const first = { stockKind: 'it-equipment', identity: 'individual', movement: ['assigned'] };

  assert.deepEqual(ids(nextDomainRound(idea, first)), ['states', 'reorder', 'audit']);
  assert.equal(nextDomainRound(idea, { ...first, states: ['in-stock'], reorder: 'threshold', audit: ['custody'] }), null, 'asking stops once the subject is pinned down');
});

test('the lifecycle round waits until the kind of item is known', () => {
  const round = DOMAINS.find((domain) => domain.id === 'inventory').rounds[1];
  assert.equal(round.when({}), false);
  assert.equal(round.when({ stockKind: 'stationery' }), true);
});

test('other domains have their own discriminating questions', () => {
  assert.deepEqual(ids(nextDomainRound('a room booking app', {})), ['resource', 'conflict', 'audit']);
  assert.deepEqual(ids(nextDomainRound('a CRM for our clients', {})), ['subject', 'progression', 'audit']);
});

// An unknown domain must still be interrogated, not waved through.
test('an idea in no known family still gets structural questions', () => {
  const round = nextDomainRound('something for my band', {});

  assert.equal(round.domain, 'generic');
  assert.deepEqual(ids(round), ids(GENERIC_ROUND));
  assert.ok(ids(round).includes('identity'), 'individually tracked vs counted in bulk changes the data model in any domain');
});

test('matching is on words, not loose substrings', () => {
  assert.equal(matchDomain('laptop asset tracker').id, 'inventory');
  assert.equal(matchDomain('shift rota planner').id, 'booking');
  assert.equal(matchDomain('a blog'), null);
  assert.equal(matchDomain(''), null);
  assert.equal(matchDomain(undefined), null);
});

test('every question fits the menus: at most 4 per round, 2 to 4 options each', () => {
  const rounds = [...DOMAINS.flatMap((domain) => domain.rounds), GENERIC_ROUND];
  for (const round of rounds) {
    assert.ok(round.questions.length <= 4, `${round.title} asks ${round.questions.length} questions at once`);
    for (const question of round.questions) {
      assert.ok(question.options.length >= 2 && question.options.length <= 4, `${question.id} has ${question.options.length} options`);
      for (const option of question.options) {
        assert.ok(option.label && option.description, `${question.id}/${option.id} needs a label and a description`);
      }
    }
  }
});
