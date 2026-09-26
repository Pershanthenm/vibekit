/**
 * Which surface the terminal UI is drawing on. Init Spec §6: a coding agent sits between the
 * person and the terminal, so an interactive prompt does not degrade there — it hangs. Detection
 * runs before anything is printed, and `--mode` forces it so a person can see what an agent sees.
 *
 *   stdout not a TTY                      → plain
 *   CLAUDECODE / CURSOR_AGENT / AGENT set → agent
 *   NO_COLOR                              → colour off, layout kept
 *   TERM=dumb or CI=true                  → plain
 *   otherwise                             → full
 */

export const SURFACES = Object.freeze(['full', 'agent', 'plain']);

export function detectSurface({ env = process.env, isTTY = Boolean(process.stdout.isTTY), mode = null } = {}) {
  if (mode) {
    if (!SURFACES.includes(mode)) throw new Error(`--mode is one of ${SURFACES.join(', ')}, not "${mode}".`);
    return mode;
  }
  // An agent's shell is not a TTY either, so the agent markers are read first: a model relaying
  // plain facts is worse than a model relaying Markdown written for it. `AGENT` is a generic
  // name that other software sets, so on a real terminal it does not count on its own.
  if (agentMarker(env, isTTY)) return 'agent';
  if (!isTTY) return 'plain';
  if (env.TERM === 'dumb' || (env.CI && env.CI !== 'false' && env.CI !== '0')) return 'plain';
  return 'full';
}

/** Which variable made this an agent surface, so the output can say so; null when none did. */
export function agentMarker(env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
  if (env.CLAUDECODE) return 'CLAUDECODE';
  if (env.CURSOR_AGENT) return 'CURSOR_AGENT';
  if (env.AGENT && !isTTY) return 'AGENT';
  return null;
}

/**
 * Init Spec §5: typographic, not decorative. Space, weight and one accent. Teal for the cursor
 * and the input gutter, mint for a determinate bar, muted for consequences and keys, brick for
 * the first line of an error. Nothing else is coloured, and nothing is boxed.
 */
export function palette({ env = process.env, surface = 'full' } = {}) {
  const on = surface === 'full' && !env.NO_COLOR;
  const colour = (code) => (text) => (on ? `\x1b[38;5;${code}m${text}\x1b[39m` : String(text));
  return {
    on,
    teal: colour(37),
    mint: colour(121),
    muted: colour(245),
    brick: colour(166),
    bold: (text) => (on ? `\x1b[1m${text}\x1b[22m` : String(text)),
  };
}

/** A determinate bar, twenty cells, mint where filled. Plain surfaces get the fraction as text. */
export function bar(fraction, { palette: colours, width = 20 } = {}) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const cells = '█'.repeat(filled) + '░'.repeat(width - filled);
  return colours?.on ? colours.mint('█'.repeat(filled)) + colours.muted('░'.repeat(width - filled)) : cells;
}
