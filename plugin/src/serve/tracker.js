import { ACTION_ROLES, refuseAction, refusePath } from '../humans.js';
import { accessPolicyFor, keyStore, openSession, sessionRefusal, tokenFrom, trailersFor } from '../access.js';
import { DEFAULT_FOLDER } from '../folder/layout.js';

/**
 * The tracker, served from the same process as the MCP runner. Specification §57.
 *
 * What this module is for is narrow: turning a request into a person, and deciding whether that
 * person may do the thing they asked for. The page, the cards and the SSE stream already exist —
 * the tracker is the §24 status view made portable, not a second application.
 *
 * The rule that shapes it: **read-only unless named.** "The QR code can safely be on a wall:
 * scanning it gets a login, not access." So an unrecognised email is not an error and not a
 * guess; it is a reader.
 */

/** §57 — twelve-hour sessions, so a few hundred is more than a team ever has open at once. */
export const MAX_SESSIONS = 500;

/** The tracker's action id, as the page sends it, to the verb §57's role table is written in. */
export function verbFor(body = {}) {
  const action = String(body.action ?? '');
  if (action === 'req.status') {
    const status = String(body.status ?? '');
    if (status === 'done') return 'done';
    if (status === 'review') return 'review';
    return status ? 'size' : null;
  }
  // §57's action table, one verb each. Starting work and setting severity are the tech lead's, like
  // a quick fix and a size; approving a gate is whichever role humans.md names for it.
  return {
    'req.release': 'unhold',
    'req.start': 'quick',
    'req.add': 'add',
    'req.hotfix': 'quick',
    'req.size': 'size',
    'bug.severity': 'size',
    'ask.answer': 'answer',
    'ask.reject': 'reject',
    'memory.accept': 'memory',
    'gate.approve': 'approve',
    'plan.reorder': 'reorder',
    'note.add': 'note',
    'tunnel.start': 'unhold',
    'tunnel.stop': 'unhold',
  }[action] ?? null;
}

export function accessFor(root, {
  teamDomain, audience, folder = DEFAULT_FOLDER,
  fetchJson = undefined, now = () => Date.now(),
} = {}) {
  if (!teamDomain) return null;
  const store = keyStore({ teamDomain, ...(fetchJson ? { fetchJson } : {}), now });
  // Bounded. Keyed by token, so a client sending a fresh token per request would otherwise grow
  // this without limit — the cheapest denial of service there is against a long-running server.
  const sessions = new Map();
  const remember = (token, session) => {
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    sessions.set(token, session);
  };

  return {
    teamDomain,
    audience,

    async sessionFor(request) {
      const token = tokenFrom(request.headers ?? {});
      if (!token) throw new Error('No Cloudflare Access token on this request. The tracker is only reachable through the tunnel, and Access is what puts the token there.');

      const cached = sessions.get(token);
      if (cached && !(await sessionRefusal(root, cached, { folder, now }))) return cached;

      const session = await openSession(root, { token, keys: await store.keys(), audience, folder, now });
      remember(token, session);
      return session;
    },

    /** Why this action is refused, or null. */
    async refuse(session, body = {}) {
      const stale = await sessionRefusal(root, session, { folder, now });
      if (stale) return stale;
      if (session.readOnly) {
        return 'Your email is not in agents/humans.md, so this page is read-only for you. Someone named there can add you.';
      }

      const pathRefusal = refusePath(body.path ?? body.file ?? '');
      if (pathRefusal) return pathRefusal;

      // The page sends `req.status`, `ask.answer`, `tunnel.start`; §57's table is written in
      // verbs. The mapping is explicit, and an action it does not name is refused rather than
      // allowed by omission — a new action that silently accepted anybody would be the quietest
      // possible hole. It was, briefly: the gate checked for verbs and refused every real action.
      const verb = verbFor(body);
      if (!verb || !ACTION_ROLES[verb]) {
        return `"${body.action ?? 'that'}" is not an action the tracker offers. Adding one means giving it a role in §57's table first.`;
      }
      return refuseAction(session.person, verb);
    },

    trailers: (session) => trailersFor(session),
    size: () => sessions.size,
  };
}

/**
 * §57 — "`serve` refuses to start the tunnel if the hostname has no Access policy."
 *
 * Returns the reason to refuse, or null. A hostname that could not be checked is also a refusal:
 * an unprotected tunnel is the failure where the page works perfectly for anybody who finds it,
 * so "we could not tell" has to behave like "no".
 */
export async function refuseTunnel(hostname, { accountId, apiToken, fetchJson, force = false } = {}) {
  if (!hostname) return null;

  const policy = await accessPolicyFor(hostname, { accountId, apiToken, ...(fetchJson ? { fetchJson } : {}) });
  if (policy.ok) return null;
  if (force) return null;

  return [
    policy.why,
    '',
    'Bind the hostname to an Access application with at least a one-time-PIN policy for your email domain,',
    'or run `vibekit dashboard --serve --tunnel` for a throwaway address behind a secret path instead.',
  ].join('\n');
}

/** What crosses the tunnel, and what never does. §57. */
export const NEVER_CROSSES = Object.freeze(['a repository clone', 'secrets', '.env']);
