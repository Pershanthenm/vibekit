import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Where a fetch may go. Specification §52, and the rule that a tool which reaches the network on
 * request must not be a way to reach the network's inside.
 *
 * Two commands take a URL from a person: `arch-docs --brand <url>` and `ship smoke --url`. Both
 * are legitimate against a public address and both were also a way to make the tool fetch
 * `http://169.254.169.254/` or `http://10.0.0.5/admin` from inside whatever network it ran on,
 * and to follow a redirect there from a page that looked public. This module refuses that by
 * default: every hop is resolved and checked, and the private ranges are refused unless the
 * caller said, explicitly, that an internal address is the point.
 */

/** RFC 1918, loopback, link-local (including the cloud metadata address), and their IPv6 kin. */
const PRIVATE_V4 = [
  [/^10\./, '10.0.0.0/8'],
  [/^172\.(1[6-9]|2\d|3[01])\./, '172.16.0.0/12'],
  [/^192\.168\./, '192.168.0.0/16'],
  [/^127\./, '127.0.0.0/8 (loopback)'],
  [/^169\.254\./, '169.254.0.0/16 (link-local; the cloud metadata address lives here)'],
  [/^0\./, '0.0.0.0/8'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, '100.64.0.0/10 (carrier NAT)'],
];

export function privateRange(address) {
  const text = String(address ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(text) === 4) return PRIVATE_V4.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  if (isIP(text) === 6) {
    if (text === '::1' || text === '::') return '::1 (loopback)';
    if (/^f[cd]/.test(text)) return 'fc00::/7 (unique local)';
    if (/^fe[89ab]/.test(text)) return 'fe80::/10 (link-local)';
    // An IPv4 address carried inside IPv6 is the IPv4 address, and is checked as one.
    const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateRange(mapped[1]);
  }
  return null;
}

export const isLocalName = (hostname) => /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(String(hostname ?? ''));

/**
 * Why this URL may not be fetched, or null when it may.
 *
 * The hostname is resolved and every address it resolves to is checked, because a public-looking
 * name that resolves to 10.0.0.5 is the whole attack. Resolution is done here rather than left to
 * `fetch` so the decision is made before any connection is attempted.
 */
export async function refuseUrl(url, { allowPrivate = false, resolve = lookup } = {}) {
  let target;
  try {
    target = new URL(String(url));
  } catch {
    return `"${url}" is not a URL.`;
  }
  if (!/^https?:$/.test(target.protocol)) return `${target.protocol}// is not fetched. Only http and https are.`;
  if (target.username || target.password) return 'A URL carrying credentials is refused; put them in a header or the environment.';
  if (allowPrivate) return null;

  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (isLocalName(host)) return `${host} is a local name. Pass --allow-private if an internal address is genuinely the target.`;

  const literal = privateRange(host);
  if (literal) return `${host} is in ${literal}. Pass --allow-private if an internal address is genuinely the target.`;

  if (!isIP(host)) {
    let addresses = [];
    try {
      addresses = await resolve(host, { all: true });
    } catch (error) {
      return `${host} does not resolve: ${error.code ?? error.message}.`;
    }
    for (const entry of addresses) {
      const range = privateRange(entry.address);
      if (range) return `${host} resolves to ${entry.address}, which is in ${range}. A public name pointing at a private address is refused; pass --allow-private only if that is genuinely the target.`;
    }
  }
  return null;
}

/** §52 — the hops a redirect chain may take before it is treated as going nowhere honest. */
export const MAX_REDIRECTS = 5;

/**
 * `fetch`, with every redirect hop checked the same way as the first URL.
 *
 * Redirects are followed by hand rather than by `redirect: 'follow'`, because the check on the
 * first address says nothing about the second: a public page that 302s to the metadata service
 * is exactly what the guard exists to stop.
 */
export async function safeFetch(url, { allowPrivate = false, resolve = lookup, fetchImpl = fetch, ...init } = {}) {
  let current = String(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const why = await refuseUrl(current, { allowPrivate, resolve });
    if (why) throw new Error(why);

    const response = await fetchImpl(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers?.get?.('location');
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times.`);
}
