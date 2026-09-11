import { PRESETS, allComponents, findComponent, LAYERS, userComponentsPath } from '../advisor/components.js';
import { expandPreferred, savePreferred } from '../advisor/preferences.js';
import { applySelection, nextRoundFor, readRequirements, recommendFor } from '../advisor/selection.js';
import { formatRecommendation, runWizard } from '../advisor/wizard.js';
import { createAsker } from '../menu.js';
import { interactiveSecurity } from './security.js';
import { sync } from './sync.js';

const USAGE = 'Usage: vibecheck advise [next | recommend | apply [preset] | components [layer] | presets | prefer <component or preset...>] [--json] [--from <answers.json>]';

async function next(root, { json, from }) {
  const round = await nextRoundFor(await readRequirements(root, from, { optional: true }));
  if (json) return console.log(JSON.stringify(round, null, 2));
  if (round.complete) return console.log('✔ All questions answered. Next: vibecheck advise apply');
  console.log(round.title);
  round.questions.forEach((question) => console.log(`  ${question.id}${question.multi ? ' (multi)' : ''}: ${question.options.map((option) => option.id).join(' | ')}`));
}

async function recommendCommand(root, { json, from }) {
  const result = await recommendFor(await readRequirements(root, from));
  console.log(json ? JSON.stringify(result, null, 2) : formatRecommendation(result));
}

function report(choices, adrPath) {
  console.log(`✔ Stack: ${Object.entries(choices).map(([layer, item]) => `${layer} ${item.label}`).join(' · ')}`);
  console.log(`✔ specs/project.json, specs/requirements.json and ${adrPath} written`);
}

async function apply(root, { args, from, force }) {
  const { adrPath, choices } = await applySelection(root, await readRequirements(root, from), args[0]);
  report(choices, adrPath);
  await sync({ root, force });
}

function components(_root, { args }) {
  const layers = args[0] ? [args[0]] : LAYERS;
  layers.forEach((layer) => {
    console.log(`\n${layer}`);
    allComponents().filter((item) => item.layers.includes(layer)).forEach((item) => console.log(`  ${item.id.padEnd(16)} ${item.label} — ${item.licence.name}${item.custom ? ' (yours)' : ''}`));
  });
  console.log(`\nAdd your own stacks in ${userComponentsPath()} (see README).`);
}

function presets() {
  Object.entries(PRESETS).forEach(([id, layers]) => console.log(`${id.padEnd(17)} ${Object.entries(layers).map(([layer, component]) => `${layer}=${component}`).join(' ')}`));
}

async function prefer(_root, { args }) {
  const unknown = args.filter((id) => !PRESETS[id] && !findComponent(id));
  if (!args.length || unknown.length) throw new Error(`Unknown: ${unknown.join(', ') || '(none given)'}. Use component ids (vibecheck advise components) or presets (vibecheck advise presets).`);
  console.log(`✔ Preferred saved to ${await savePreferred(args)}: ${expandPreferred(args).join(', ')} (+3 in every recommendation)`);
}

export async function interactiveAdvice(root, { force, asker = createAsker() } = {}) {
  const raw = await runWizard(asker);
  console.log(`\n── Recommendation ──\n${formatRecommendation(await recommendFor(raw))}\n`);
  const { adrPath, choices } = await applySelection(root, raw);
  report(choices, adrPath);
  await sync({ root, force });
  await interactiveSecurity(root, { asker, force });
}

async function withAsker(work) {
  const asker = createAsker();
  try {
    return await work(asker);
  } finally {
    asker.close();
  }
}

const ACTIONS = { next, questions: next, recommend: recommendCommand, apply, components, presets, prefer };

export async function advise(options) {
  const [action, ...args] = options.args;
  if (!action) return withAsker((asker) => interactiveAdvice(options.root, { force: options.force, asker }));
  const run = ACTIONS[action];
  if (!run) throw new Error(USAGE);
  await run(options.root, { ...options, args });
}
