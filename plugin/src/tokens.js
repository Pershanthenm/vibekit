/**
 * Token estimates, in two flavours, because the two callers want to be wrong in opposite
 * directions.
 *
 * A budget planner deciding what fits in a model window must never underestimate: one unit too
 * few costs a little quality, one token too many fails the call outright.
 *
 * A budget *report* — "your always-loaded folder costs 2,300 tokens" — must not overestimate,
 * because the number is shown to a team and a check fails on it. Telling people they are over
 * budget when they are not is how a useful limit gets switched off.
 *
 * Neither is a tokenizer. When a real one is available for the target model it should be used
 * instead; these are what stands in when it is not.
 */

const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/** Conservative. Code tokenises densely: short identifiers, punctuation, little whitespace. */
export const estimateCodeTokens = (text) => Math.ceil(normalize(text).length / 3);

/** Calibrated for prose and Markdown, which run close to four characters per token. */
export const estimateProseTokens = (text) => Math.ceil(normalize(text).length / 4);
