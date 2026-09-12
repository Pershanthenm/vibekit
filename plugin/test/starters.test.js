import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProject, renderSelectionAdr } from '../src/advisor/apply.js';
import { findComponent } from '../src/advisor/components.js';
import { nextRound, recommend, starterQuestion } from '../src/advisor/recommend.js';
import { STARTERS, fitsStack, rankStarters } from '../src/advisor/starters.js';
import { normalize } from '../src/schema.js';

console.log = () => {};

const choices = (byLayer) => Object.fromEntries(Object.entries(byLayer).map(([layer, id]) => [layer, findComponent(id)]));
const ids = (ranking) => ranking.ranked.map((item) => item.id);

// The whole point of the question: someone building a .NET app is told ABP and ASP.NET Zero
// exist, rather than being handed an empty solution and finding out months later.
test('a .NET backend is offered the .NET boilerplates', () => {
  const ranked = ids(rankStarters(choices({ backend: 'aspnetcore' }), { licensing: 'commercial-ok' }));

  assert.ok(ranked.includes('abp'), ranked.join(', '));
  assert.ok(ranked.includes('aspnet-zero'), ranked.join(', '));
  assert.ok(ranked.includes('clean-architecture-sln'), ranked.join(', '));
});

test('starters are offered by stack, never by what the app is for', () => {
  const words = /\b(stock|inventory|booking|crm|laptop|warehouse|patient|invoice)\b/i;
  for (const item of STARTERS) {
    const text = [item.summary, ...item.gives, ...item.caveats].join(' ');
    assert.doesNotMatch(text, words, `${item.id} describes itself in terms of a domain`);
    assert.ok(Object.keys(item.fits).length, `${item.id} fits no layer, so it can never be matched to a stack`);
    assert.ok(item.docs, `${item.id} has nowhere for a person to go and read about it`);
  }
});

test('a starter for another stack is never offered', () => {
  assert.deepEqual(ids(rankStarters(choices({ backend: 'django' }), {})), ['cookiecutter-django']);
  assert.equal(ids(rankStarters(choices({ backend: 'go' }), {})).length, 0, 'Go has no boilerplate here, so none should be claimed');
});

// The Supabase + Next.js starter is only a starter if both halves are actually being built.
test('a starter that names two layers needs both of them to match', () => {
  const item = STARTERS.find((entry) => entry.id === 'next-supabase');

  assert.ok(fitsStack(item, choices({ backend: 'supabase', web: 'react-next' })));
  assert.ok(!fitsStack(item, choices({ backend: 'supabase', web: 'angular' })), 'a different front end is not this starter');
  assert.ok(!fitsStack(item, choices({ backend: 'supabase' })), 'an API-only project has no Next.js to start from');
});

// Licensing was already answered; a starter that contradicts it must not be quietly listed.
test('the licensing answer rules starters out, and says why', () => {
  const permissive = rankStarters(choices({ backend: 'aspnetcore' }), { licensing: 'permissive' });

  assert.ok(!ids(permissive).includes('abp'), 'LGPL is not permissive-only');
  assert.ok(!ids(permissive).includes('aspnet-zero'), 'a paid product is not open source');
  assert.ok(ids(permissive).includes('clean-architecture-sln'), 'the MIT template survives');

  const abp = permissive.excluded.find((item) => item.id === 'abp');
  assert.match(abp.reason, /LGPL-3\.0 is weak copyleft/);
  assert.match(abp.reason, /permissive open source only/);

  const ossOnly = rankStarters(choices({ backend: 'aspnetcore' }), { licensing: 'oss-only' });
  assert.ok(ids(ossOnly).includes('abp'), 'LGPL is open source, so "any open source" allows it');
  assert.ok(!ids(ossOnly).includes('aspnet-zero'));
});

test('the recommendation shifts with the answers, and gives its reasons', () => {
  const enterprise = rankStarters(choices({ backend: 'aspnetcore' }), {
    licensing: 'commercial-ok', signin: 'sso', compliance: 'strict', architecture: 'modular-clean', scale: 'large',
  });

  assert.equal(enterprise.ranked[0].id, 'abp', ids(enterprise).join(' > '));
  const reasons = enterprise.ranked[0].reasons.map((reason) => reason.text).join('; ');
  assert.match(reasons, /audit logging/);
  assert.match(reasons, /modular monolith/);

  const bare = rankStarters(choices({ backend: 'aspnetcore' }), { licensing: 'permissive', scale: 'small' });
  assert.equal(bare.ranked[0].id, 'clean-architecture-sln', 'with no identity or compliance pressure the plain template wins');
});

test('the question offers the best few plus a recorded "from scratch"', () => {
  const question = starterQuestion(rankStarters(choices({ backend: 'aspnetcore' }), { licensing: 'commercial-ok', signin: 'sso', compliance: 'strict' }));

  assert.equal(question.id, 'starter');
  assert.ok(question.header.length <= 12, `header "${question.header}" exceeds the AskUserQuestion chip limit`);
  assert.ok(question.options.length <= 4, `asked ${question.options.length} options`);
  assert.equal(question.options.at(-1).id, 'none', 'building from scratch is always an answer');
  assert.match(question.options[0].label, /\(Recommended\)$/);
  for (const option of question.options) assert.ok(option.description, `${option.id} has no description`);
});

test('with nothing strong on offer, from scratch is the recommendation', () => {
  const question = starterQuestion(rankStarters(choices({ backend: 'nestjs' }), { licensing: 'permissive', scale: 'small' }));

  assert.equal(question.options.at(-1).id, 'none');
  assert.match(question.options.at(-1).label, /\(Recommended\)$/);
  assert.doesNotMatch(question.options[0].label, /\(Recommended\)/);
});

test('no question at all when no boilerplate fits the stack', () => {
  assert.equal(starterQuestion(rankStarters(choices({ backend: 'go' }), {})), null);
});

// The wizard must not stall on a question it cannot show, nor skip past it silently.
test('the wizard asks about the starting point once the stack is known', () => {
  const base = {
    platform: 'backend', appType: 'internal', scale: 'medium', clients: [],
    licensing: 'commercial-ok', ecosystem: 'microsoft', team: ['csharp'], data: 'relational',
    architecture: 'modular-clean', signin: 'sso', security: ['rbac-audit'], compliance: 'elevated',
    backend: 'aspnetcore', database: 'postgres',
  };

  const round = nextRound(base);
  assert.equal(round.title, 'Starting point', `got "${round.title}" instead`);
  assert.equal(round.questions[0].id, 'starter');

  assert.notEqual(nextRound({ ...base, starter: 'abp' }).title, 'Starting point', 'an answered starter is not asked again');
  assert.notEqual(nextRound({ ...base, starter: 'none' }).title, 'Starting point', '"from scratch" is an answer, not a blank');
});

test('a Go project is never asked the question', () => {
  const round = nextRound({
    platform: 'backend', appType: 'integration', scale: 'huge', clients: [],
    licensing: 'permissive', ecosystem: 'opensource', team: { other: 'Go' }, data: 'relational',
    architecture: 'clean', signin: 'sso', security: [], compliance: 'standard',
    backend: 'go', database: 'postgres',
  });
  assert.notEqual(round.title, 'Starting point');
});

test('the choice is recorded in the project, with its conventions taking precedence', () => {
  const result = recommend({ platform: 'backend', backend: 'aspnetcore', database: 'postgres', licensing: 'commercial-ok', starter: 'abp' });
  const project = buildProject(normalize({ project: { name: 'device-register' } }), result.answers, { backend: findComponent('aspnetcore'), database: findComponent('postgres') });

  assert.equal(project.starter.id, 'abp');
  assert.equal(project.starter.licence, 'LGPL-3.0');
  assert.match(project.starter.scaffold, /abp new/);
  assert.match(project.architecture.notes.join('\n'), /follow its conventions and directory layout/);
});

test('from scratch leaves the project clean of starter notes', () => {
  const result = recommend({ platform: 'backend', backend: 'aspnetcore', database: 'postgres', licensing: 'commercial-ok', starter: 'none' });
  const project = buildProject(normalize({ project: { name: 'device-register' } }), result.answers, { backend: findComponent('aspnetcore'), database: findComponent('postgres') });

  assert.equal(project.starter.id, '');
  assert.doesNotMatch(project.architecture.notes.join('\n'), /follow its conventions/);
});

test('the ADR records the boilerplate, its trade-offs and what was ruled out', () => {
  const result = recommend({ platform: 'backend', backend: 'aspnetcore', database: 'postgres', licensing: 'permissive', signin: 'sso', starter: 'clean-architecture-sln' });
  const adr = renderSelectionAdr({
    number: 1, date: '2026-09-12', result,
    choices: { backend: findComponent('aspnetcore'), database: findComponent('postgres') },
  });

  assert.match(adr, /### Starting point/);
  assert.match(adr, /Clean Architecture solution template/);
  assert.match(adr, /Known trade-offs:/);
  assert.match(adr, /ABP Framework — excluded: LGPL-3\.0 is weak copyleft/, 'the reader must see what the licensing answer removed');
});
