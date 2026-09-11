import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { exists, readText, writeText } from '../fsutil.js';
import { PROJECT_FILE, assertValid, loadProject, saveProject } from '../project.js';
import { normalize } from '../schema.js';
import { buildProject, renderSelectionAdr, resolveChoices } from './apply.js';
import { PRESETS } from './components.js';
import { loadPreferred } from './preferences.js';
import { nextRound, recommend } from './recommend.js';

export const REQUIREMENTS_FILE = 'specs/requirements.json';
const DECISIONS_DIR = 'specs/decisions';

export async function readRequirements(root, from, { optional = false } = {}) {
  const path = from ?? join(root, REQUIREMENTS_FILE);
  const text = await readText(path);
  if (text === null && optional) return {};
  if (text === null) throw new Error(`No requirements at ${path}. Answer the questions first (vibecheck advise).`);
  return JSON.parse(text);
}

export const recommendFor = async (raw) => recommend(raw, { preferred: await loadPreferred() });
export const nextRoundFor = async (raw) => nextRound(raw, { preferred: await loadPreferred() });

function withPreset(raw, presetId) {
  if (!presetId) return raw;
  if (!PRESETS[presetId]) throw new Error(`Unknown preset "${presetId}". Presets: ${Object.keys(PRESETS).join(', ')}`);
  return { ...raw, ...PRESETS[presetId] };
}

async function nextDecisionNumber(root) {
  const dir = join(root, DECISIONS_DIR);
  const files = (await exists(dir)) ? await readdir(dir) : [];
  return Math.max(0, ...files.map((file) => parseInt(file, 10)).filter(Number.isFinite)) + 1;
}

async function baseProject(root) {
  return (await exists(join(root, PROJECT_FILE))) ? loadProject(root) : normalize({ project: { name: basename(root) } });
}

export async function applySelection(root, raw, presetId) {
  const result = await recommendFor(withPreset(raw, presetId));
  const choices = resolveChoices(result.answers, result);
  const project = normalize(buildProject(await baseProject(root), result.answers, choices));
  assertValid(project);
  await saveProject(root, project);
  const recorded = { ...result.answers, ...Object.fromEntries(Object.entries(choices).map(([layer, item]) => [layer, item.custom ? { other: item.label } : item.id])) };
  await writeText(join(root, REQUIREMENTS_FILE), `${JSON.stringify(recorded, null, 2)}\n`);
  const number = await nextDecisionNumber(root);
  const adrPath = `${DECISIONS_DIR}/${String(number).padStart(4, '0')}-technology-selection.md`;
  await writeText(join(root, adrPath), renderSelectionAdr({ number, date: new Date().toISOString().slice(0, 10), result, choices }));
  return { project, adrPath, choices };
}
