import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { readFrontMatter } from './frontmatter.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { humansPath, identify, loadHumans } from './humans.js';
import { readText } from './fsutil.js';

/**
 * Cloudflare Access in front of the tracker. Specification §57.
 *
 * "The tracker is never exposed by opening a port." The tunnel is the only route in, and Access
 * is what decides who reaches it — so this module is the one place that turns a request into a
 * person, and it is deliberately strict in every direction.
 *
 * Three rules, and each of them rules out a shortcut that would look like it worked:
 *
 *   * **Verify the signature, against Cloudflare's keys.** An Access JWT is easy to read and
 *     trivial to forge if nobody checks it. Reading the email out of an unverified token would
 *     make the QR code on the wall an authentication method.
 *   * **Refuse to start the tunnel with no Access policy.** A hostname without one is a public
 *     URL, and the page would work perfectly, which is the worst possible failure mode.
 *   * **Expire on a change to `humans.md`.** Somebody removed from that file must stop being able
 *     to act, and a twelve-hour session would otherwise outlive their authority.
 */

/** §57 — `serve` expires its own session after this, whatever Cloudflare's own length is. */
export const SESSION_HOURS = 12;

export const ACCESS_HEADER = 'cf-access-jwt-assertion';
export const ACCESS_COOKIE = 'CF_Authorization';

export const certsUrl = (teamDomain) => `https://${String(teamDomain).replace(/^https?:\/\//, '').replace(/\/$/, '')}/cdn-cgi/access/certs`;

const decodeSegment = (segment) => Buffer.from(String(segment).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** The claims, unverified. Only ever used to find which key to check the signature with. */
export function decodeToken(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('That is not a JWT.');
  try {
    return {
      header: JSON.parse(decodeSegment(parts[0])),
      payload: JSON.parse(decodeSegment(parts[1])),
      signed: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    };
  } catch {
    throw new Error('That JWT is not readable.');
  }
}

const ALGORITHMS = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' };

/**
 * Verify an Access token against a JWKS.
 *
 * Returns the email, or throws with the reason. The audience is checked because a token minted
 * for a different Access application in the same account is a valid signature over the wrong
 * claim — the commonest real misconfiguration, and one that silently grants access.
 */
export function verifyToken(token, { keys, audience, now = () => Date.now() }) {
  const { header, payload, signed, signature } = decodeToken(token);

  const algorithm = ALGORITHMS[header.alg];
  if (!algorithm) throw new Error(`Unsupported token algorithm "${header.alg}". Cloudflare Access signs with RS256.`);

  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('The token was signed with a key Cloudflare does not currently publish.');
  // Only an RSA public key verifies an RS256 signature. A symmetric key that somehow reached the
  // set would otherwise be handed to createPublicKey, and the failure mode there is a thrown
  // error rather than a refusal — this makes it a refusal with a reason.
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new Error('The published key for this token is not an RSA public key, so the signature cannot be verified.');

  const ok = verifySignature(algorithm, Buffer.from(signed), createPublicKey({ key: jwk, format: 'jwk' }), signature);
  if (!ok) throw new Error('The token signature does not verify.');

  const seconds = Math.floor(now() / 1000);
  if (payload.exp && seconds >= payload.exp) throw new Error('The Access token has expired. Reload the page to get a new one.');
  if (payload.nbf && seconds < payload.nbf) throw new Error('The Access token is not valid yet.');

  if (audience) {
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    if (!auds.includes(audience)) {
      throw new Error('That token was issued for a different Access application. It is a valid signature over the wrong claim.');
    }
  }

  const email = String(payload.email ?? '').toLowerCase();
  if (!email) throw new Error('The Access token carries no email, so there is no identity to map.');
  return { email, expiresAt: payload.exp ? payload.exp * 1000 : null, claims: payload };
}

/** Cloudflare's public keys. Cached, because a JWKS fetch per request is a request per request. */
export function keyStore({ teamDomain, fetchJson = defaultFetchJson, ttlMs = 3600_000, now = () => Date.now() } = {}) {
  let cached = null;
  return {
    async keys() {
      if (cached && now() - cached.at < ttlMs) return cached.keys;
      const body = await fetchJson(certsUrl(teamDomain));
      const keys = body?.keys ?? [];
      if (!keys.length) throw new Error(`${certsUrl(teamDomain)} published no keys, so no token can be verified.`);
      cached = { keys, at: now() };
      return keys;
    },
    // A fetch that fails must not fall back to trusting the token; it falls back to the last
    // good key set, and to refusing when there has never been one.
    peek: () => cached?.keys ?? null,
  };
}

async function defaultFetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'vibekit/1.0 (+tracker access)' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export const tokenFrom = (headers = {}) => {
  const direct = headers[ACCESS_HEADER] ?? headers[ACCESS_HEADER.toUpperCase()];
  if (direct) return String(direct);
  const cookie = String(headers.cookie ?? '');
  return cookie.match(new RegExp(`${ACCESS_COOKIE}=([^;]+)`))?.[1] ?? null;
};

/**
 * §57 — "`serve` refuses to start the tunnel if the hostname has no Access policy, checked
 * through the Cloudflare API."
 *
 * The check is skipped only when the caller has no API token to check with, and then it is
 * *reported* as unchecked rather than assumed to be fine. An unchecked hostname is the one the
 * page works perfectly on and anybody can reach.
 */
export async function accessPolicyFor(hostname, { accountId, apiToken, fetchJson = defaultFetchJson } = {}) {
  if (!apiToken || !accountId) {
    return {
      checked: false,
      ok: false,
      why: 'No Cloudflare API token is set, so whether this hostname has an Access policy could not be checked. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or serve on localhost.',
    };
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps`;
  const body = await fetchJson(url, { headers: { authorization: `Bearer ${apiToken}` } }).catch((error) => ({ error: error.message }));
  if (body.error) return { checked: false, ok: false, why: `Could not reach the Cloudflare API: ${body.error}` };

  const apps = body.result ?? [];
  const app = apps.find((entry) => String(entry.domain ?? '').toLowerCase() === String(hostname).toLowerCase());
  if (!app) {
    return { checked: true, ok: false, why: `${hostname} has no Access application. Without one the tunnel is a public URL, and the page would work perfectly for anybody who found it.` };
  }

  const policies = await fetchJson(`${url}/${app.id}/policies`, { headers: { authorization: `Bearer ${apiToken}` } }).catch(() => ({ result: [] }));
  const allowing = (policies.result ?? []).filter((policy) => policy.decision === 'allow');
  if (!allowing.length) {
    return { checked: true, ok: false, why: `${hostname} has an Access application with no allow policy, which lets nobody in and protects nothing.` };
  }
  return { checked: true, ok: true, app: app.id, policies: allowing.length, why: null };
}

/**
 * A session, from a verified token.
 *
 * Expiry is the earlier of Cloudflare's own expiry, our `tracker-session` window, and the moment
 * `humans.md` last changed — that last one because authority is read from that file, and a
 * session that outlives a change to it is a person acting on authority they no longer have.
 */
export async function openSession(root, { token, keys, audience, folder = DEFAULT_FOLDER, now = () => Date.now() }) {
  const verified = verifyToken(token, { keys, audience, now });
  const humans = await loadHumans(root, folder);
  const person = identify(humans, verified.email);

  const profile = readFrontMatter((await readText(`${root}/${folder}/profile.md`)) ?? '');
  const hours = Number.parseFloat(String(profile['tracker-session'] ?? SESSION_HOURS).replace(/h$/i, '')) || SESSION_HOURS;
  const humansChangedAt = await stat(humansPath(root, folder)).then((info) => info.mtimeMs).catch(() => 0);

  const ours = now() + hours * 3600_000;
  return {
    email: verified.email,
    person,
    roles: person?.roles ?? [],
    // Not named in humans.md is read-only, never an error: §57 makes that a setting, not a fault.
    readOnly: !person,
    expiresAt: Math.min(ours, verified.expiresAt ?? Infinity),
    humansChangedAt,
    securityHeldByTechLead: humans.securityHeldByTechLead,
  };
}

/** Why this session is no longer good, or null while it is. */
export async function sessionRefusal(root, session, { folder = DEFAULT_FOLDER, now = () => Date.now() } = {}) {
  if (!session) return 'There is no session. Reload the page to sign in through Access.';
  if (now() >= session.expiresAt) return 'This session has expired. Reload the page to sign in again.';

  const changedAt = await stat(humansPath(root, folder)).then((info) => info.mtimeMs).catch(() => 0);
  if (changedAt > session.humansChangedAt) {
    return 'agents/humans.md changed since you signed in, so your authority has been re-read. Reload the page.';
  }
  return null;
}

/**
 * §51 — the trailers that record who did this and how, so an action taken from a phone is as
 * attributable as one taken from a terminal.
 */
export const trailersFor = (session) => [
  'VibeKit-Role: human',
  'VibeKit-Via: tracker',
  session?.person?.name ? `VibeKit-By: ${session.person.name} <${session.email}>` : `VibeKit-By: ${session?.email ?? 'unknown'}`,
];
