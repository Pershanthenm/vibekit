import { strict as assert } from 'node:assert';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ACCESS_COOKIE, SESSION_HOURS, accessPolicyFor, certsUrl, decodeToken, keyStore,
  openSession, sessionRefusal, tokenFrom, trailersFor, verifyToken,
} from '../src/access.js';
import { generateFolder } from '../src/folder/generate.js';
import { ACTION_ROLES, NEVER_FROM_TRACKER, identify, loadHumans, parseApprovers, refuseAction, refusePath, resolveRoles } from '../src/humans.js';
import { NEVER_CROSSES, accessFor, refuseTunnel } from '../src/serve/tracker.js';
import { PROVIDERS, SAMPLING, callModel, missingCredential, modelForTier, providerFor } from '../src/models/provider.js';
import { writeTiers } from '../src/models/registry.js';
import './helpers.js';

/**
 * The tracker's identity, and calling a model. Specification §57, §61 and §62.
 *
 * §57's rule is "read-only unless named", and the reason it has to hold is stated in the spec
 * itself: the QR code can safely be on a wall, because scanning it gets a login and not access.
 * Every test below is one way that could quietly stop being true.
 */

const CONFIG = {
  name: 'bookings', description: 'A booking system for gyms.', architecture: 'clean',
  stack: { language: '.NET 10' }, commands: { test: 'dotnet test' },
  entities: [{ name: 'Booking', class: 'internal', fields: [{ name: 'id', type: 'uuid' }] }],
};

const HUMANS = [
  '# Humans', '',
  '## Approvers', '',
  '| Role | Name | May approve |',
  '| --- | --- | --- |',
  '| product owner | Ada Lovelace <ada@example.com> | plan, scope |',
  '| tech lead | Grace Hopper <grace@example.com> | architecture, stale holds |',
  '| security | TODO | security.md |',
  '',
].join('\n');

async function project({ humans = HUMANS } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vibekit-access-'));
  await generateFolder(root, CONFIG);
  await writeFile(join(root, 'vibekit/agents/humans.md'), humans);
  return root;
}

/** A real RSA keypair and a real signed token: the verification is the thing under test. */
function issuer() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

  const sign = (payload, { kid = 'k1', key = privateKey } = {}) => {
    const header = b64({ alg: 'RS256', kid, typ: 'JWT' });
    const body = b64({ exp: Math.floor(Date.now() / 1000) + 600, ...payload });
    const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(key).toString('base64url');
    return `${header}.${body}.${signature}`;
  };
  return { jwk, sign, privateKey };
}

// ---------------------------------------------------------------- who may approve what (§57)

test('an approver is read with the email the tracker maps a login to', () => {
  const approvers = parseApprovers(HUMANS);
  assert.deepEqual(approvers.map((approver) => approver.role), ['product owner', 'tech lead', 'security']);
  assert.equal(approvers[0].name, 'Ada Lovelace');
  assert.equal(approvers[0].email, 'ada@example.com');
  assert.equal(approvers[2].unfilled, true, 'a cell still reading TODO is a role nobody has filled');
});

test('with no named security approver the tech lead holds the role, and it is recorded', () => {
  const humans = resolveRoles(parseApprovers(HUMANS));
  assert.equal(humans.securityHeldByTechLead, true);
  assert.deepEqual(humans.unfilled, ['security']);

  const grace = identify(humans, 'grace@example.com');
  assert.deepEqual(grace.roles, ['tech lead', 'security']);
});

test('an email is matched whatever case the identity provider sends it in', () => {
  const humans = resolveRoles(parseApprovers(HUMANS));
  assert.equal(identify(humans, 'ADA@EXAMPLE.COM').name, 'Ada Lovelace');
  assert.equal(identify(humans, '  grace@example.com  ').name, 'Grace Hopper');
  assert.equal(identify(humans, ''), null);
});

test('an email nobody wrote down gets no authority, rather than one guessed from its domain', () => {
  const humans = resolveRoles(parseApprovers(HUMANS));
  assert.equal(identify(humans, 'stranger@example.com'), null, 'authority is written down, never inferred from an address');
  assert.match(refuseAction(null, 'answer'), /read-only for you/);
});

test('each action needs the role §57 gives it', () => {
  const humans = resolveRoles(parseApprovers(HUMANS));
  const ada = identify(humans, 'ada@example.com');
  const grace = identify(humans, 'grace@example.com');

  assert.equal(refuseAction(ada, 'add'), null, 'the product owner adds requirements');
  assert.match(refuseAction(ada, 'unhold'), /needs the tech lead role/);
  assert.equal(refuseAction(grace, 'unhold'), null);
  assert.equal(refuseAction(grace, 'quick'), null);
  assert.match(refuseAction(grace, 'add'), /needs the product owner role/);

  // An action nobody mapped is refused rather than allowed by omission.
  assert.match(refuseAction(grace, 'deploy'), /not an action the tracker offers/);
  assert.ok(Object.keys(ACTION_ROLES).length >= 12);
});

test('nothing on the page can change code, standards, guardrails or the architecture', () => {
  for (const path of NEVER_FROM_TRACKER) {
    assert.match(refusePath(`vibekit/${path}x`), /That is a pull request/);
  }
  assert.equal(refusePath('vibekit/workflow/asks/Q-001.md'), null, 'answering an ask is the whole point of the page');
});

test('the folder ships a humans.md the tracker can actually read', async () => {
  const root = await project({ humans: undefined });
  const humans = await loadHumans(root);
  assert.equal(humans.declared, true, 'the generator writes the table');
  assert.ok(humans.unfilled.length, 'and leaves the names for a person to fill in');
});

// ---------------------------------------------------------------- the Access token (§57)

test('a token is verified against Cloudflare\'s published keys, not merely read', () => {
  const { jwk, sign } = issuer();
  const verified = verifyToken(sign({ email: 'Grace@Example.com', aud: ['aud-1'] }), { keys: [jwk], audience: 'aud-1' });
  assert.equal(verified.email, 'grace@example.com');

  // Reading the email out of an unverified token would make the QR code an authentication method.
  const tampered = sign({ email: 'grace@example.com', aud: ['aud-1'] }).slice(0, -6) + 'AAAAAA';
  assert.throws(() => verifyToken(tampered, { keys: [jwk], audience: 'aud-1' }), /signature does not verify/);
});

test('a token minted for another Access application is refused', () => {
  const { jwk, sign } = issuer();
  assert.throws(
    () => verifyToken(sign({ email: 'grace@example.com', aud: ['other-app'] }), { keys: [jwk], audience: 'aud-1' }),
    /valid signature over the wrong claim/,
  );
});

test('an expired or not-yet-valid token is refused, and one signed by an unknown key too', () => {
  const { jwk, sign } = issuer();
  const stale = sign({ email: 'grace@example.com', exp: Math.floor(Date.now() / 1000) - 10 });
  assert.throws(() => verifyToken(stale, { keys: [jwk] }), /has expired/);

  const early = sign({ email: 'grace@example.com', nbf: Math.floor(Date.now() / 1000) + 600 });
  assert.throws(() => verifyToken(early, { keys: [jwk] }), /not valid yet/);

  // A key id nobody publishes, and a key id that is published but signed by something else:
  // different failures, and both have to be refused.
  assert.throws(() => verifyToken(sign({ email: 'x@example.com' }, { kid: 'rotated-away' }), { keys: [jwk] }), /key Cloudflare does not currently publish/);
  const other = issuer();
  assert.throws(() => verifyToken(other.sign({ email: 'x@example.com' }), { keys: [jwk] }), /signature does not verify/);
});

test('a token with no email has no identity to map, and nonsense is named as nonsense', () => {
  const { jwk, sign } = issuer();
  assert.throws(() => verifyToken(sign({ aud: ['aud-1'] }), { keys: [jwk] }), /carries no email/);
  assert.throws(() => decodeToken('not.a'), /not a JWT/);
  assert.throws(() => decodeToken('a.b.c'), /not readable/);
});

test('the token is taken from the header or the cookie Access sets', () => {
  assert.equal(tokenFrom({ 'cf-access-jwt-assertion': 'a.b.c' }), 'a.b.c');
  assert.equal(tokenFrom({ cookie: `x=1; ${ACCESS_COOKIE}=d.e.f; y=2` }), 'd.e.f');
  assert.equal(tokenFrom({}), null);
});

test('the key set is fetched once and cached, and a failed refresh never becomes trust', async () => {
  let fetches = 0;
  const { jwk } = issuer();
  let now = 0;
  const store = keyStore({ teamDomain: 'team.cloudflareaccess.com', now: () => now, fetchJson: async () => { fetches += 1; return { keys: [jwk] }; } });

  await store.keys();
  await store.keys();
  assert.equal(fetches, 1, 'a JWKS fetch per request is a request per request');

  now = 7200_000;
  await store.keys();
  assert.equal(fetches, 2, 'and it does refresh eventually');

  const broken = keyStore({ teamDomain: 'team.cloudflareaccess.com', fetchJson: async () => ({ keys: [] }) });
  await assert.rejects(() => broken.keys(), /published no keys, so no token can be verified/);
  assert.equal(broken.peek(), null);
  assert.match(certsUrl('https://team.cloudflareaccess.com/'), /^https:\/\/team\.cloudflareaccess\.com\/cdn-cgi\/access\/certs$/);
});

// ---------------------------------------------------------------- sessions (§57)

test('a verified login becomes a session with the roles humans.md gives it', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const session = await openSession(root, { token: sign({ email: 'grace@example.com' }), keys: [jwk] });

  assert.equal(session.person.name, 'Grace Hopper');
  assert.deepEqual(session.roles, ['tech lead', 'security']);
  assert.equal(session.readOnly, false);
  assert.ok(session.expiresAt > Date.now());
});

test('an email not in humans.md gets a read-only session, not an error', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const session = await openSession(root, { token: sign({ email: 'stranger@example.com' }), keys: [jwk] });

  assert.equal(session.readOnly, true);
  assert.deepEqual(session.roles, []);
  assert.equal(await sessionRefusal(root, session), null, 'a reader is not an error; they simply cannot act');
});

test('a session expires on its own window as well as on Cloudflare\'s', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const session = await openSession(root, { token: sign({ email: 'grace@example.com' }), keys: [jwk] });

  const later = Date.now() + (SESSION_HOURS + 1) * 3600_000;
  assert.match(await sessionRefusal(root, session, { now: () => later }), /has expired/);
});

test('a change to humans.md ends every session, because authority is read from it', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const session = await openSession(root, { token: sign({ email: 'grace@example.com' }), keys: [jwk] });
  assert.equal(await sessionRefusal(root, session), null);

  // Somebody removed from that file must stop being able to act, and a twelve-hour session
  // would otherwise outlive their authority.
  await new Promise((wait) => setTimeout(wait, 10));
  await writeFile(join(root, 'vibekit/agents/humans.md'), HUMANS.replace('grace@example.com', 'someone-else@example.com'));
  assert.match(await sessionRefusal(root, session), /changed since you signed in/);
});

test('an action from the tracker is attributed in the commit trailers', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const session = await openSession(root, { token: sign({ email: 'ada@example.com' }), keys: [jwk] });

  const trailers = trailersFor(session);
  assert.ok(trailers.includes('VibeKit-Role: human'));
  assert.ok(trailers.includes('VibeKit-Via: tracker'));
  assert.ok(trailers.some((line) => /VibeKit-By: Ada Lovelace <ada@example\.com>/.test(line)));
});

// ---------------------------------------------------------------- the gate in front of the page

test('the tracker refuses a request with no Access token at all', async () => {
  const root = await project();
  const access = accessFor(root, { teamDomain: 'team.cloudflareaccess.com', fetchJson: async () => ({ keys: [] }) });
  await assert.rejects(() => access.sessionFor({ headers: {} }), /No Cloudflare Access token/);
});

test('a named person may do what their role allows and no more', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  const access = accessFor(root, { teamDomain: 'team.cloudflareaccess.com', fetchJson: async () => ({ keys: [jwk] }) });

  // The ids the page actually sends, not §57's verbs: the gate maps one to the other.
  const grace = await access.sessionFor({ headers: { 'cf-access-jwt-assertion': sign({ email: 'grace@example.com' }) } });
  assert.equal(await access.refuse(grace, { action: 'req.release', id: 'REQ-001' }), null);
  assert.match(await access.refuse(grace, { action: 'req.add', title: 'x' }), /needs the product owner role/);
  assert.match(await access.refuse(grace, { action: 'note.add', path: 'vibekit/standards/rules.md' }), /pull request/);

  const stranger = await access.sessionFor({ headers: { 'cf-access-jwt-assertion': sign({ email: 'nobody@example.com' }) } });
  assert.match(await access.refuse(stranger, { action: 'ask.answer' }), /read-only for you/);
});

test('a session is reused rather than re-verified on every request', async () => {
  const root = await project();
  const { jwk, sign } = issuer();
  let fetches = 0;
  const access = accessFor(root, { teamDomain: 'team.cloudflareaccess.com', fetchJson: async () => { fetches += 1; return { keys: [jwk] }; } });
  const headers = { 'cf-access-jwt-assertion': sign({ email: 'ada@example.com' }) };

  await access.sessionFor({ headers });
  await access.sessionFor({ headers });
  assert.equal(fetches, 1);
});

// ---------------------------------------------------------------- the tunnel precheck (§57)

test('a hostname with no Access application is refused rather than exposed', async () => {
  const why = await refuseTunnel('tracker.example.com', {
    accountId: 'acct',
    apiToken: 'token',
    fetchJson: async () => ({ result: [] }),
  });
  assert.match(why, /has no Access application/);
  assert.match(why, /the page would work perfectly for anybody who found it/);
});

test('an Access application with no allow policy protects nothing, and is refused', async () => {
  const why = await refuseTunnel('tracker.example.com', {
    accountId: 'acct',
    apiToken: 'token',
    fetchJson: async (url) => (url.endsWith('/policies')
      ? { result: [{ decision: 'deny' }] }
      : { result: [{ id: 'app-1', domain: 'tracker.example.com' }] }),
  });
  assert.match(why, /no allow policy/);
});

test('a hostname that is properly protected starts', async () => {
  const why = await refuseTunnel('tracker.example.com', {
    accountId: 'acct',
    apiToken: 'token',
    fetchJson: async (url) => (url.endsWith('/policies')
      ? { result: [{ decision: 'allow' }] }
      : { result: [{ id: 'app-1', domain: 'tracker.example.com' }] }),
  });
  assert.equal(why, null);
});

test('a hostname that could not be checked behaves like one with no policy', async () => {
  const unchecked = await accessPolicyFor('tracker.example.com', {});
  assert.equal(unchecked.checked, false);
  assert.equal(unchecked.ok, false);
  assert.match(unchecked.why, /could not be checked/);

  assert.match(await refuseTunnel('tracker.example.com', {}), /could not be checked/);
  // Explicitly forced is a decision somebody made, and it is theirs to make.
  assert.equal(await refuseTunnel('tracker.example.com', { force: true }), null);
});

test('what crosses the tunnel is named, and a clone and secrets are not among it', () => {
  assert.ok(NEVER_CROSSES.includes('secrets'));
  assert.ok(NEVER_CROSSES.includes('.env'));
});

// ---------------------------------------------------------------- calling a model (§61, §62)

test('a credential is read from the environment and never written down', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.match(missingCredential('anthropic'), /ANTHROPIC_API_KEY is not set/);
    assert.match(missingCredential('anthropic'), /never writes it anywhere/);
    process.env.ANTHROPIC_API_KEY = 'k';
    assert.equal(missingCredential('anthropic'), null);
    assert.match(missingCredential('nobody'), /No provider is configured/);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('the tier is resolved to a model from machine settings, never named by the caller', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vibekit-tiers-'));
  process.env.VIBEKIT_HOME = home;

  await assert.rejects(() => modelForTier('strong'), /No tier mapping yet/);
  await writeTiers({ strong: 'claude-opus-5', cheap: 'none' });

  assert.equal(await modelForTier('strong'), 'claude-opus-5');
  await assert.rejects(() => modelForTier('cheap'), /maps no model/);
  await assert.rejects(() => modelForTier('enormous'), /is not a tier/);
});

test('roles whose work has one right shape are sampled deterministically', () => {
  assert.equal(SAMPLING.implementer.temperature, 0);
  assert.equal(SAMPLING.implementer.seed, 1);
  assert.equal(SAMPLING.compliance.temperature, 0);
  assert.deepEqual(SAMPLING.planner, {}, 'a planner pinned to one path explores nothing');
});

test('a call returns the text and the token counts, so it can be priced', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    let sent = null;
    const result = await callModel({
      model: 'claude-sonnet-5',
      role: 'implementer',
      messages: [{ role: 'user', content: 'go' }],
      fetchJson: async (url, options) => {
        sent = { url, headers: options.headers, body: JSON.parse(options.body) };
        return { content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 120, output_tokens: 8, cache_read_input_tokens: 100 }, stop_reason: 'end_turn' };
      },
    });

    assert.equal(result.text, 'done');
    assert.equal(result.input, 120);
    assert.equal(result.cached, 100, 'a call whose usage is not recorded is a call that cannot be priced');
    assert.equal(sent.headers['x-api-key'], 'test-key');
    assert.equal(sent.body.temperature, 0, 'the implementer is deterministic');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('a caller that skipped the routing decision is refused', async () => {
  await assert.rejects(() => callModel({ messages: [{ role: 'user', content: 'x' }] }), /has skipped the routing decision/);
  await assert.rejects(() => callModel({ model: 'claude-sonnet-5', messages: [] }), /at least one message/);
});

test('both provider shapes are described, and a model routes to the right one', () => {
  assert.deepEqual(Object.keys(PROVIDERS), ['anthropic', 'openai']);
  assert.equal(providerFor('claude-opus-5'), 'anthropic');
  assert.equal(providerFor('gpt-5'), 'openai');
  for (const spec of Object.values(PROVIDERS)) assert.ok(spec.env && spec.url && spec.read);
});
