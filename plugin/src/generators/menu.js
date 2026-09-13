/**
 * Which skills get a slash command of their own.
 *
 * Not a list of what VibeKit can do — that is `SKILLS`, and none of it goes away. This is only
 * about the menu, because a menu of forty entries is not a menu, it is a search problem, and the
 * cost of it falls on somebody trying to find the one thing they came for.
 *
 * Five commands, and the rule for which five is: would a person type this themselves, on a normal
 * day, without another skill telling them to? That gives two ways in (`setup` for the machine,
 * `new-project` for the work), one way to say what you want (`spec-feature`), one way to get it
 * built (`run`), and one way to ask how it is going (`scan`).
 *
 * Everything else is a playbook: the same instructions, written by the same generator, printed on
 * demand by `vibekit playbook <name>`. `plan-feature`, `dispatch`, `merge-lanes` and
 * `review-feature` come off the menu because `run` is what invokes them — it walks the whole loop
 * and calls each one by name, so having them on the menu as well only offers a person the chance
 * to run step four before step three. `health` comes off because the thing you actually want when
 * something is broken is the fix, which is `setup`; the check itself is one command, `vibekit
 * health`, and `setup` ends by running it either way.
 */
export const MENU = [
  'setup',
  'new-project',
  'spec-feature',
  'run',
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
