import { loadPolicy, tierFor } from './models/policy.js';
import { callModel, missingCredential, modelForTier, providerFor } from './models/provider.js';
import { DEFAULT_FOLDER } from './folder/layout.js';

/**
 * Running a prompt and getting an answer back in a shape this code can check.
 *
 * The two commands that need a model — `test-skills` running a skill against its fixture, and
 * `replay` re-raising the asks a prompt would produce — both want the same thing: a real call at
 * the tier the policy names, and an answer that is data rather than prose.
 *
 * Why the JSON is asked for rather than parsed out of prose: the point of both commands is to
 * compare one run against another, and a comparison of two paragraphs is a judgement. A model
 * that will not produce the shape is a failed run, reported as one, not a run whose output was
 * interpreted generously.
 */

/** Why a model run cannot happen here, or null when it can. */
export async function unavailable(root, { role = 'implementer', size = null, folder = DEFAULT_FOLDER } = {}) {
  const { rules } = await loadPolicy(root, folder);
  const { tier } = tierFor(rules, { role, size });
  if (!tier) return `${folder}/agents/humans.md has no model policy line for ${role}.`;

  let model;
  try {
    model = await modelForTier(tier);
  } catch (error) {
    return error.message;
  }
  return missingCredential(providerFor(model));
}

export async function modelFor(root, { role = 'implementer', size = null, folder = DEFAULT_FOLDER } = {}) {
  const { rules } = await loadPolicy(root, folder);
  const { tier, reasons } = tierFor(rules, { role, size });
  return { tier, model: await modelForTier(tier), reasons };
}

/** The first JSON object or array in a reply, or null. Models wrap it in prose and in fences. */
export function jsonFrom(text) {
  const body = String(text ?? '');
  const fenced = body.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidates = [fenced?.[1], body];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    // Walk to the matching bracket rather than taking the last one in the string: a model that
    // adds a sentence afterwards would otherwise produce a slice that does not parse.
    const open = candidate[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const character = candidate[index];
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (character === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (character === open) depth += 1;
      else if (character === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * One run: the prompt, the answer, the tokens it cost.
 *
 * The usage comes back on every call so it can be recorded in `sessions.json` (§60) and priced
 * (§63). A run nobody recorded is a run nobody can account for, and these two commands are
 * exactly the kind that get run in a loop.
 */
export async function ask(root, { system, prompt, role = 'implementer', size = null, folder = DEFAULT_FOLDER, maxTokens = 4096, call = callModel } = {}) {
  const { tier, model, reasons } = await modelFor(root, { role, size, folder });
  const result = await call({
    model,
    role,
    system,
    maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  return {
    tier,
    model,
    reasons,
    text: result.text,
    json: jsonFrom(result.text),
    usage: { input: result.input, output: result.output, cached: result.cached },
  };
}
