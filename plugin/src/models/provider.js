import { TIERS } from './policy.js';
import { readTiers } from './registry.js';

/**
 * Calling a model on an API runner. Specification §61 and §62.
 *
 * Only API runners reach this. On a seat the tool picks its own model on a subscription already
 * paid for, and VibeKit cannot reach inside it — §62's whole point — so there is nothing here for
 * Claude Code or Cursor to use.
 *
 * **Credentials are read from the environment and never written anywhere.** Not into the folder,
 * not into `.state/`, not into a config file this tool creates. A repository that can hold a key
 * is a repository that will eventually contain one, and §58's first finding on most brownfield
 * repos is exactly that. The environment is the only place a key belongs.
 */

export const PROVIDERS = Object.freeze({
  anthropic: {
    env: 'ANTHROPIC_API_KEY',
    url: 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }),
    body: ({ model, system, messages, maxTokens, temperature, seed }) => ({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      ...(seed === undefined ? {} : { metadata: { user_id: `seed-${seed}` } }),
      messages,
    }),
    read: (json) => ({
      text: (json.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join(''),
      input: json.usage?.input_tokens ?? 0,
      output: json.usage?.output_tokens ?? 0,
      cached: json.usage?.cache_read_input_tokens ?? 0,
      stop: json.stop_reason ?? null,
    }),
  },
  openai: {
    env: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
    body: ({ model, system, messages, maxTokens, temperature, seed }) => ({
      model,
      max_completion_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      ...(seed === undefined ? {} : { seed }),
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    }),
    read: (json) => ({
      text: json.choices?.[0]?.message?.content ?? '',
      input: json.usage?.prompt_tokens ?? 0,
      output: json.usage?.completion_tokens ?? 0,
      cached: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      stop: json.choices?.[0]?.finish_reason ?? null,
    }),
  },
});

/**
 * §55 — determinism per role. Low temperature and a fixed seed where the work has one right
 * shape; normal sampling where breadth is wanted.
 *
 * The distinction is not a preference. An implementer that samples differently on every run
 * produces a diff nobody can attribute to a decision, and a planner pinned to one path explores
 * nothing.
 */
export const SAMPLING = Object.freeze({
  implementer: { temperature: 0, seed: 1 },
  migrator: { temperature: 0, seed: 1 },
  compliance: { temperature: 0, seed: 1 },
  reviewer: { temperature: 0.2 },
  analyst: {},
  planner: {},
  designer: {},
});

/** Which model a tier means on this install, per §61's mapping in machine settings. */
export async function modelForTier(tier) {
  if (!TIERS.includes(tier)) throw new Error(`"${tier}" is not a tier. One of: ${TIERS.join(', ')}.`);
  const { tiers, declared } = await readTiers();
  if (!declared) throw new Error('No tier mapping yet. Run `vibekit tools rates map` to say which model each tier is — the repository names tiers, never models.');
  const model = tiers[tier];
  if (!model || model === 'none') throw new Error(`registry/tiers.yml maps no model to "${tier}".`);
  return model;
}

export const providerFor = (model) => (/^claude|^anthropic/.test(String(model)) ? 'anthropic' : 'openai');

/** Why a call cannot be made, or null. Reported rather than thrown so `serve` can say it plainly. */
export function missingCredential(provider) {
  const spec = PROVIDERS[provider];
  if (!spec) return `No provider is configured for "${provider}".`;
  if (!process.env[spec.env]) {
    return `${spec.env} is not set. VibeKit reads it from the environment and never writes it anywhere — a repository that can hold a key is one that will eventually contain one.`;
  }
  return null;
}

/**
 * One call to an API runner.
 *
 * Returns the text and the token counts, which go straight into `sessions.json` (§60) and from
 * there into the budget report and the effective-cost table (§63). A call whose usage is not
 * recorded is a call that cannot be priced, so the counts come back even on a refusal.
 */
export async function callModel({
  model, system = null, messages, role = 'implementer', maxTokens = 4096,
  fetchJson = defaultFetchJson,
} = {}) {
  if (!model) throw new Error('No model. Resolve the tier first: a caller that names a model has skipped the routing decision.');
  if (!Array.isArray(messages) || !messages.length) throw new Error('A call needs at least one message.');

  const provider = providerFor(model);
  const missing = missingCredential(provider);
  if (missing) throw new Error(missing);

  const spec = PROVIDERS[provider];
  const sampling = SAMPLING[role] ?? {};
  const json = await fetchJson(spec.url, {
    method: 'POST',
    headers: spec.headers(process.env[spec.env]),
    body: JSON.stringify(spec.body({ model, system, messages, maxTokens, ...sampling })),
  });

  return { provider, model, role, ...spec.read(json) };
}

async function defaultFetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    // The provider's own message, not a paraphrase: a rate-limit and a bad key need different
    // actions, and a generic failure hides which one happened.
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} returned ${response.status} with a body that is not JSON.`);
  }
}
