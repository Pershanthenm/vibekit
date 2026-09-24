import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exists, readText, writeText } from '../fsutil.js';

/**
 * The price registry. Specification §63.
 *
 * Per install, shared across projects, because a price list is a property of the account rather
 * than of one repository. Four rules from §63, all of them about not corrupting a forecast:
 *
 *   * **First-party sources only.** Aggregator sites and blogs are frequently stale and
 *     sometimes wrong, and a wrong price silently corrupts every forecast that uses it.
 *   * **Write only if validation passes.** A failed fetch keeps the last good file and reports
 *     its age; nothing ever blocks on the network.
 *   * **A negotiated rate wins, and the report says which was used.** `overrides.yml` is the
 *     team's, and the registry never touches it.
 *   * **Every change is dated in history**, so a cost report from three months ago can be
 *     re-priced at the rates that applied then.
 */

export const registryDir = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'registry');
export const providerPath = (provider) => join(registryDir(), `${provider}.yml`);
export const overridesPath = () => join(registryDir(), 'overrides.yml');
export const historyPath = () => join(registryDir(), 'history.yml');
export const tiersPath = () => join(registryDir(), 'tiers.yml');

/** §63 — the only addresses a refresh is allowed to read from. */
export const FIRST_PARTY = Object.freeze({
  anthropic: 'https://www.anthropic.com/pricing',
  openai: 'https://openai.com/api/pricing',
  google: 'https://ai.google.dev/pricing',
  mistral: 'https://mistral.ai/technology/#pricing',
});

export const isFirstParty = (provider, url) => Boolean(FIRST_PARTY[provider]) && String(url ?? '').startsWith(new URL(FIRST_PARTY[provider]).origin);

const NUMERIC = new Set(['input', 'output', 'cache_read', 'cache_write', 'context']);

/**
 * The registry's flat YAML, parsed here rather than with a library for the same reason the rest
 * of the folder is: one dependency for one file shape is a dependency to keep current forever.
 */
export function parseProvider(text) {
  const file = { fetched: null, source: null, checksum: null, models: [], discounts: {}, manual: false };
  let region = null;
  let current = null;

  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trimEnd();
    if (!line.trim()) continue;

    const heading = line.match(/^(models|discounts):\s*$/);
    if (heading) {
      region = heading[1];
      current = null;
      continue;
    }

    const entry = line.match(/^\s*-\s*id:\s*(.+)$/);
    if (entry) {
      current = { id: entry[1].trim(), status: 'current' };
      file.models.push(current);
      continue;
    }

    const pair = line.match(/^(\s*)([\w.-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, indent, key, value] = pair;
    const parsed = NUMERIC.has(key) ? Number.parseFloat(value) : value.trim();

    if (region === 'models' && current && indent.length) current[key] = parsed;
    else if (region === 'discounts') file.discounts[key] = Number.parseFloat(value);
    else if (key in file) file[key] = key === 'manual' ? value.trim() === 'true' : parsed;
  }
  return file;
}

export function renderProvider(file) {
  const lines = [`# registry/${file.provider ?? 'provider'}.yml`];
  if (file.fetched) lines.push(`fetched: ${file.fetched}`);
  if (file.source) lines.push(`source: ${file.source}`);
  if (file.checksum) lines.push(`checksum: ${file.checksum}`);
  if (file.manual) lines.push('manual: true');
  lines.push('models:');
  for (const model of file.models) {
    lines.push(`  - id: ${model.id}`);
    for (const key of ['input', 'output', 'cache_read', 'context', 'status', 'first_seen']) {
      if (model[key] !== undefined && model[key] !== null) lines.push(`    ${key}: ${model[key]}`);
    }
  }
  if (Object.keys(file.discounts ?? {}).length) {
    lines.push('discounts:');
    for (const [key, value] of Object.entries(file.discounts)) lines.push(`  ${key}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Why this file may not be written, or an empty list when it may.
 *
 * §63's validation, and each rule is here because the failure it prevents is silent: a zero rate
 * makes everything look free, an absurd one makes a forecast meaningless, and a model that
 * vanished without being retired means the parse went wrong rather than the price list changing.
 */
export function validateProvider(next, previous = null) {
  const problems = [];
  const current = next.models.filter((model) => model.status !== 'retired');
  if (!current.length) problems.push('it lists no current model');

  for (const model of current) {
    for (const side of ['input', 'output']) {
      const rate = model[side];
      if (!Number.isFinite(rate)) problems.push(`${model.id} has no ${side} rate`);
      else if (rate <= 0) problems.push(`${model.id} has a ${side} rate of ${rate} — a zero rate makes every forecast free`);
      else if (rate > 1000) problems.push(`${model.id} has a ${side} rate of ${rate}, which is not a price per million tokens`);
    }
  }

  for (const model of previous?.models ?? []) {
    if (model.status === 'retired') continue;
    const still = next.models.find((entry) => entry.id === model.id);
    if (!still) problems.push(`${model.id} disappeared without being marked retired — that is a parse failure, not a price change`);
  }
  return problems;
}

export async function readProvider(provider) {
  const text = await readText(providerPath(provider));
  return text === null ? null : { ...parseProvider(text), provider };
}

export async function readOverrides() {
  const text = await readText(overridesPath());
  return text === null ? { models: [], currency: null } : { ...parseProvider(text), currency: parseProvider(text).currency ?? null };
}

/**
 * The effective rate for a model: the negotiated one where a team entered it, otherwise the
 * public one. Which was used is returned, because §63 requires the report to say.
 */
export async function rateFor(provider, id) {
  const [file, overrides] = await Promise.all([readProvider(provider), readOverrides()]);
  const override = overrides.models.find((model) => model.id === id);
  const listed = file?.models.find((model) => model.id === id) ?? null;
  if (override) return { ...listed, ...override, from: 'overrides.yml' };
  return listed ? { ...listed, from: `registry/${provider}.yml` } : null;
}

/** What a session cost, with the cache and batch discounts §63 records. */
export function costOf(rate, { input = 0, output = 0, cached = 0, batch = false }, discounts = {}) {
  if (!rate) return null;
  const million = 1_000_000;
  const cacheRate = rate.cache_read ?? (rate.input * (discounts.cache_hit ?? 0.1));
  const factor = batch ? (discounts.batch ?? 0.5) : 1;
  const fresh = Math.max(0, input - cached);
  return ((fresh * rate.input) + (cached * cacheRate) + (output * rate.output)) / million * factor;
}

export const providersInUse = async () => (await readdir(registryDir()).catch(() => []))
  .filter((name) => name.endsWith('.yml') && !['overrides.yml', 'history.yml'].includes(name))
  .map((name) => name.replace(/\.yml$/, ''))
  .sort();

export const checksumOf = (text) => `sha256:${createHash('sha256').update(String(text)).digest('hex')}`;

/**
 * Replace a provider's file, but only if it validates, and record what changed.
 *
 * `fetch` is injected: nothing in the default path reaches the network unless a caller asked for
 * a refresh, and a test never does.
 */
export async function refresh(provider, { fetchPricing, now = () => new Date() } = {}) {
  const url = FIRST_PARTY[provider];
  if (!url) {
    throw new Error(`No first-party pricing source is known for "${provider}". Add its rates to registry/overrides.yml by hand; aggregator sites are never a source of truth.`);
  }
  const previous = await readProvider(provider);

  let next;
  try {
    const body = await fetchPricing(url);
    next = { ...parseProvider(body), provider, source: url, checksum: checksumOf(body), fetched: now().toISOString() };
  } catch (error) {
    // §63: nothing ever blocks on the network. The last good file stands and its age is reported.
    return { ok: false, kept: true, provider, reason: error.message, age: previous?.fetched ?? null, changes: [] };
  }

  const problems = validateProvider(next, previous);
  if (problems.length) return { ok: false, kept: true, provider, reason: problems[0], problems, age: previous?.fetched ?? null, changes: [] };

  const changes = diffProviders(previous, next);
  await writeText(providerPath(provider), renderProvider(next));
  if (changes.length) await appendHistory(provider, changes, now());
  return { ok: true, kept: false, provider, changes, fetched: next.fetched };
}

/** What a human should look at: new models, price moves, retirements. */
export function diffProviders(previous, next) {
  const changes = [];
  const before = new Map((previous?.models ?? []).map((model) => [model.id, model]));

  for (const model of next.models) {
    const was = before.get(model.id);
    if (!was) {
      changes.push({ kind: 'new', id: model.id, input: model.input, output: model.output });
      continue;
    }
    if (was.input !== model.input || was.output !== model.output) {
      changes.push({ kind: 'price', id: model.id, from: { input: was.input, output: was.output }, to: { input: model.input, output: model.output } });
    }
    if (was.status !== model.status && model.status === 'retired') changes.push({ kind: 'retired', id: model.id });
  }
  return changes;
}

async function appendHistory(provider, changes, at) {
  const existing = (await readText(historyPath())) ?? '# registry/history.yml\n';
  const lines = changes.map((change) => `  - ${change.kind}: ${change.id}${change.kind === 'price' ? ` (${change.from.input}/${change.from.output} → ${change.to.input}/${change.to.output})` : ''}`);
  await writeText(historyPath(), `${existing.trimEnd()}\n- at: ${at.toISOString()}\n  provider: ${provider}\n  changes:\n${lines.join('\n')}\n`);
}

/**
 * The tier mapping. §61: "App settings map tiers to models and the mapping changes without
 * touching the repo." So it lives here, per install, and not in the folder — that is what makes
 * a repository outlive the model it was built with.
 */
export async function readTiers() {
  const text = await readText(tiersPath());
  if (text === null) return { tiers: {}, declared: false };
  const tiers = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const pair = line.replace(/\s+#.*$/, '').match(/^\s*(local|cheap|mid|strong):\s*(.+)$/);
    if (pair) tiers[pair[1]] = pair[2].trim();
  }
  return { tiers, declared: Object.keys(tiers).length > 0 };
}

export const renderTiers = (tiers) => [
  '# registry/tiers.yml',
  '#',
  '# Which model each tier means, for this install. The repository names tiers, never models,',
  '# so changing this line is how a project follows a better model without a commit.',
  '',
  ...Object.entries(tiers).map(([tier, id]) => `${tier}: ${id}`),
  '',
].join('\n');

export const writeTiers = (tiers) => writeText(tiersPath(), renderTiers(tiers));

/** An install that maintains its own prices says so, rather than looking like a stale fetch. */
export async function registryState() {
  const providers = await providersInUse();
  const files = await Promise.all(providers.map((provider) => readProvider(provider)));
  return {
    dir: registryDir(),
    manual: files.some((file) => file?.manual) || (providers.length > 0 && files.every((file) => !file?.fetched)),
    providers: files.filter(Boolean).map((file) => ({ provider: file.provider, fetched: file.fetched, models: file.models.length, source: file.source })),
    empty: !(await exists(registryDir())) || providers.length === 0,
    tiers: (await readTiers()).tiers,
  };
}


/**
 * Tokens to currency. §48: "Tokens are converted to currency with a `rates.yml` in app settings,
 * never in the folder."
 *
 *   currency: ZAR
 *   per-usd: 18.20            # how many of the currency one US dollar buys
 *   models:                   # optional: a negotiated price per million, in the currency
 *     claude-sonnet-5:
 *       input: 36.40
 *       output: 182.00
 *
 * The registry's prices are USD per million tokens. Without a `per-usd` line the report stays in
 * tokens — a number in a currency nobody set the rate for would be believed.
 */
export const ratesPath = () => process.env.VIBEKIT_RATES_FILE ?? join(registryDir(), 'rates.yml');

export function parseRates(text) {
  const rates = { currency: null, perUsd: null, models: {} };
  let current = null;
  let inModels = false;
  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (/^models:\s*$/.test(line)) { inModels = true; current = null; continue; }
    const top = line.match(/^(currency|per-usd):\s*(.+)$/);
    if (top) {
      if (top[1] === 'currency') rates.currency = top[2].trim().toUpperCase();
      else rates.perUsd = Number.parseFloat(top[2]) || null;
      inModels = false;
      continue;
    }
    if (!inModels) continue;
    const model = line.match(/^  ([\w.-]+):\s*$/);
    if (model) { current = model[1]; rates.models[current] = {}; continue; }
    const pair = line.match(/^\s+(input|output|cache_read):\s*([\d.]+)/);
    if (pair && current) rates.models[current][pair[1]] = Number.parseFloat(pair[2]);
  }
  return rates;
}

export async function readRates() {
  const text = await readText(ratesPath());
  return text === null ? { currency: null, perUsd: null, models: {}, declared: false } : { ...parseRates(text), declared: true };
}

/** What a session cost in the team's currency, or null when no rate makes that honest. */
export async function priceInCurrency(provider, model, usage, rates = null) {
  const rate = rates ?? (await readRates());
  if (!rate.currency) return null;
  const own = rate.models[model];
  if (own?.input !== undefined && own?.output !== undefined) {
    return { currency: rate.currency, amount: costOf({ input: own.input, output: own.output, cache_read: own.cache_read }, usage), from: 'rates.yml' };
  }
  if (!rate.perUsd) return null;
  const listed = await rateFor(provider, model);
  if (!listed) return null;
  const usd = costOf(listed, usage);
  return usd === null ? null : { currency: rate.currency, amount: usd * rate.perUsd, from: `${listed.from} × per-usd` };
}
