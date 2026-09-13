import { ARCHITECTURES } from '../architectures.js';
import { GENERATED_NOTICE, bullets, file, markdown } from './shared.js';

// Windsurf caps each rule file at 6,000 characters AND all rules combined at 12,000
// (docs.windsurf.com/windsurf/cascade/agents-md). That is far tighter than Cursor or
// Antigravity, so this adapter does not mirror the full rule set: the root AGENTS.md is
// already treated as an always-on rule, and these files point at it instead of repeating it.
export const RULE_CHARACTER_LIMIT = 6000;
export const RULES_TOTAL_LIMIT = 12000;
const RULES_DIR = '.windsurf/rules';

const rule = (name, body) => file(`${RULES_DIR}/${name}.md`, markdown(GENERATED_NOTICE, body));

const GATE = bullets([
  '`AGENTS.md` in the repository root is the full brief: stack, standards, testing, security and the workflow. Cascade loads it on every message — follow it.',
  'Before editing code, find the feature in `specs/features/` and confirm its status is `approved`, `planned` or `in-progress`. If there is none, write the spec first.',
  'Work one task from `tasks.md` at a time; tick it only when lint, typecheck and tests pass.',
  'Tick an acceptance criterion only when a passing test proves it.',
  'If the spec is wrong, stop and propose a spec change rather than diverging.',
  'Never hand-edit generated files: change `specs/project.json` and run `vibekit sync`.',
]);

const STANDARDS = bullets([
  'Project standards live in `standards/`, indexed by `standards/index.yml`.',
  'Read the index first, then open only the standards that match the task — not the whole library.',
  '`vibekit standards inject "<task>"` lists the relevant ones.',
  'If nothing matches, say so rather than inventing a convention.',
]);

export function windsurfFiles(project) {
  const style = ARCHITECTURES[project.architecture.style];
  return [
    rule('vibekit-workflow', GATE),
    rule('vibekit-architecture', `**${style.label}** — ${style.summary}\n\nBoundaries, modules and data flow: \`specs/01-architecture.md\`. Decisions: \`specs/decisions/\`.`),
    rule('vibekit-standards', STANDARDS),
  ];
}
