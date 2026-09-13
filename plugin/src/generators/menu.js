/**
 * Which skills get a slash command of their own.
 *
 * Not a list of what VibeKit can do — that is `SKILLS`, and none of it goes away. This is only
 * about the menu, because a menu of forty entries is not a menu, it is a search problem, and the
 * cost of it falls on somebody trying to find the one thing they came for.
 *
 * So the ten steps of the everyday workflow are commands, and everything else is a playbook: the
 * same instructions, written by the same generator, printed on demand by `vibekit playbook <name>`.
 * The rule for which is which is whether a person reaches for it themselves. `docs`,
 * `implement-feature` and `clarify` are steps that another skill invokes; `rearchitect` and
 * `standards-discover` are reached once a project, not once a day.
 */
export const MENU = [
  'setup',
  'health',
  'new-project',
  'spec-feature',
  'plan-feature',
  'run',
  'dispatch',
  'merge-lanes',
  'review-feature',
  'scan',
];

const MENU_SET = new Set(MENU);

export const isMenuSkill = (name) => MENU_SET.has(name);

/**
 * How one skill refers to another in its own text.
 *
 * A skill in the menu is named by its command. One that is not is named by the command that
 * prints it — which an agent can run, and which returns the instructions themselves, so a
 * demoted skill is followed exactly as it was when it had a slash command of its own.
 */
export const commandIn = (prefix) => (name, arg) => (isMenuSkill(name)
  ? `/${prefix}${name}${arg ? ` ${arg}` : ''}`
  : `\`vibekit playbook ${name}\`${arg ? ` (for ${arg})` : ''}`);
