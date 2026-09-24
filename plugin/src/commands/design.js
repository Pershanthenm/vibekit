import { join } from 'node:path';
import { generateFolder } from '../folder/generate.js';
import { exists, readText, writeText } from '../fsutil.js';
import { FEEDBACK, addReference, applyChange, describeLook, interpretFeedback, listReferences, renderPreview } from '../inspiration.js';
import { loadProject, saveProject } from '../project.js';
import { folderConfig, folderName } from './folder.js';

/**
 * `vibekit design`. Specification §69.
 *
 *   design                     what the app looks like now, and the intent behind it
 *   design add <url|image|pdf> add a reference; it says what it took and asks what it could not tell
 *   design refs                every reference and what was taken from each
 *   design preview [screen]    render your real screens with the current design
 *   design apply               turn accepted references into tokens
 *   design feedback "<text>"   say what is wrong, against something specific
 *
 * Skipped entirely for a project without an interface; nothing here runs when architecture.md
 * records `api: none` and no platform with a screen.
 */

const usage = () => [
  'Usage',
  '  vibekit design                                  the current look and the intent behind it',
  '  vibekit design add <url | image | pdf> [--allow-private]',
  '  vibekit design refs',
  '  vibekit design preview [screen] [--out <file>]',
  '  vibekit design apply [--from <ask id>]          answered questions and extracted values → tokens',
  '  vibekit design feedback "<text>" [--about everywhere|<screen>|<component>] [--choice N]',
].join('\n');

export async function design(options) {
  const { root, args, folder: chosen, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [verb, ...rest] = args;

  if (verb === 'add') return add(root, folder, rest, options);
  if (verb === 'refs') return refs(root, folder, options);
  if (verb === 'preview') return preview(root, folder, rest, options);
  if (verb === 'apply') return apply(root, folder, options);
  if (verb === 'feedback') return feedback(root, folder, rest, options);
  if (verb) throw new Error(`"${verb}" is not something design does.\n${usage()}`);

  const [tokens, components, flows, refsNow] = await Promise.all([
    readText(join(root, folder, 'product/design/tokens.md')),
    readText(join(root, folder, 'product/design/components.md')),
    readText(join(root, folder, 'product/design/flows.md')),
    listReferences(root, folder),
  ]);
  const project = await loadProject(root).catch(() => null);
  const view = { design: project?.design ?? {}, references: refsNow.rows.length, intent: refsNow.intent, components: bullets(components).length, screens: bullets(flows).length, hasTokens: Boolean(tokens) };
  if (json) return void console.log(JSON.stringify(view, null, 2));
  console.log(`Design · ${view.references} reference(s) · ${view.components} component(s) · ${view.screens} screen(s)`);
  console.log('');
  console.log(`  Intent: ${view.intent && !/^TODO/.test(view.intent) ? view.intent.split('\n')[0] : 'not written yet — ## Intent in product/design/inspiration.md is the file a designer or a founder actually reads'}`);
  const tokensNow = view.design;
  console.log(`  Tokens: brand ${tokensNow.brand ?? '—'} · density ${tokensNow.density ?? 'comfortable'} · spacing ${tokensNow.spacing ?? 'regular'} · corners ${tokensNow.radius ?? 'soft'} · surfaces ${tokensNow.surfaces ?? 'borders'}`);
  console.log('');
  console.log(usage().split('\n').slice(2).join('\n'));
}

const bullets = (text) => String(text ?? '').split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line) && !/TODO/.test(line)).map((line) => line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').split(/\s+—\s+|:\s/)[0].trim());

async function add(root, folder, rest, options) {
  const [source] = rest;
  if (!source) throw new Error(usage());
  const result = await addReference(root, source, { folder, allowPrivate: Boolean(options['allow-private']) });
  if (options.json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`✔ ${source} → ${result.saved}`);
  console.log('');
  console.log('  Took from this:');
  if (!result.took.length) console.log('    nothing readable — a picture carries no stylesheet; the six values are asked instead');
  for (const row of result.took) console.log(`    ${row.key.padEnd(10)} ${describeLook(row)}${row.confidence === 'low' ? '   (low confidence)' : ''}`);
  console.log('');
  console.log('  Couldn\'t tell from this:');
  for (const ask of result.asks) console.log(`    · ${ask.ask.padEnd(44)} [${ask.options.join('] [')}]   → vibekit ask answer ${ask.id} "<choice>"`);
  console.log('');
  console.log(`  ${result.asks.length} question(s) · answer now or later; nothing is applied until you do (vibekit design apply).`);
  console.log('  Spacing, density, type scale and colour relationships are borrowed as design always has; a logo or a layout is not.');
}

async function refs(root, folder, options) {
  const result = await listReferences(root, folder);
  if (options.json) return void console.log(JSON.stringify(result, null, 2));
  if (!result.rows.length) return void console.log('No references yet. `vibekit design add <url>` starts with one you admire.');
  for (const row of result.rows) console.log(`  ${row.source.padEnd(32)} ${row.took}   added ${row.added}`);
}

async function preview(root, folder, rest, options) {
  const [screen] = rest;
  const project = await loadProject(root).catch(() => null);
  const flows = bullets(await readText(join(root, folder, 'product/design/flows.md')));
  const components = bullets(await readText(join(root, folder, 'product/design/components.md')));
  const html = renderPreview({ name: project?.project?.name ?? 'project', tokens: project?.design ?? {}, flows, components, screen: screen ?? null });
  // Outside the folder and outside the working tree where there is a git directory: a preview is
  // something to look at, and a generated file inside the tree dirties the repository it is about.
  const target = options.out ?? ((await exists(join(root, '.git'))) ? join(root, '.git/vibekit/design-preview.html') : join(root, 'design-preview.html'));
  await writeText(target, html);
  if (options.json) return void console.log(JSON.stringify({ path: target, screens: flows.length }, null, 2));
  console.log(`✔ ${target}`);
  console.log(flows.length ? `  ${flows.length} screen(s) from flows.md, light and dark, phone and desktop width. Open it in a browser.` : '  flows.md names no screens yet, so the page says so instead of showing somebody else\'s.');
}

/**
 * Answered design questions and extracted values become tokens in project.json — the source that
 * tokens.md is generated from — and the folder is regenerated. A design change is a normal commit
 * with a before and after, so it can be reverted like anything else.
 */
async function apply(root, folder, options) {
  const project = await loadProject(root).catch(() => null);
  if (!project) throw new Error('No specs/project.json here; `vibekit init` first.');
  const { listAsks } = await import('../folder/asks.js');
  const answered = (await listAsks(root, folder)).filter((ask) => ['answered', 'accepted'].includes(ask.status) && /\bdesign\b/.test(String(ask.topic ?? '')));
  const before = { ...(project.design ?? {}) };
  const design = { ...before };

  for (const ask of answered) {
    const answer = String(ask.answer ?? '').toLowerCase();
    if (/table/.test(ask.ask)) design.density = /compact/.test(answer) ? 'compact' : /roomy/.test(answer) ? 'roomy' : 'comfortable';
    if (/sidebar/.test(ask.ask)) design.sidebar = /always/.test(answer) ? 'always' : /hidden/.test(answer) ? 'hidden' : 'collapsible';
    if (/empty/i.test(ask.ask)) design.emptyStates = /illustrat/.test(answer) ? 'illustrated' : 'plain';
  }
  const references = await listReferences(root, folder);
  for (const row of references.rows) {
    const brand = row.took.match(/brand (#[0-9A-F]{6})/i)?.[1];
    if (brand && !design.brand) design.brand = brand;
    if (/borders instead of shadows/.test(row.took)) design.surfaces = 'borders';
    else if (/\bshadows\b/.test(row.took) && !design.surfaces) design.surfaces = 'shadows';
    const rhythm = row.took.match(/base rhythm, (tight|regular|roomy)/)?.[1];
    if (rhythm) design.spacing = rhythm;
    const corners = row.took.match(/nothing over (\d+)px/)?.[1];
    if (corners) design.radius = Number(corners) <= 4 ? 'sharp' : Number(corners) <= 8 ? 'soft' : 'round';
  }

  const changed = Object.keys(design).filter((key) => design[key] !== before[key]);
  if (!changed.length) {
    if (options.json) return void console.log(JSON.stringify({ changed: [] }, null, 2));
    console.log('Nothing to apply: no answered design question and no reference with a readable value beyond what tokens already say.');
    return;
  }
  await saveProject(root, { ...project, design });
  await generateFolder(root, await folderConfig(root), { folder });
  if (options.json) return void console.log(JSON.stringify({ changed, design }, null, 2));
  console.log(`✔ ${changed.length} token(s) changed: ${changed.map((key) => `${key} ${before[key] ?? '—'} → ${design[key]}`).join(', ')}`);
  console.log(`  ${folder}/product/design/tokens.md regenerated. A design change is a piece of work like any other: commit it, and preview before and after.`);
}

async function feedback(root, folder, rest, options) {
  const text = rest.join(' ').trim();
  if (!text) throw new Error(usage());
  const meaning = interpretFeedback(text);
  if (!meaning) {
    if (options.json) return void console.log(JSON.stringify({ text, understood: false, known: Object.keys(FEEDBACK) }, null, 2));
    console.log(`"${text}" is not something the tokens can act on yet. Try one of: ${Object.keys(FEEDBACK).map((word) => `"too ${word}"`).join(', ')} — or name the screen or component with --about.`);
    return;
  }
  const about = options.about ?? 'everywhere';
  const choice = options.choice ? Number.parseInt(options.choice, 10) : null;

  if (!choice) {
    if (options.json) return void console.log(JSON.stringify({ text, about, options: meaning.options }, null, 2));
    console.log(`"${text}" · about: ${about}`);
    console.log('');
    console.log(`  ${meaning.key[0].toUpperCase()}${meaning.key.slice(1)} usually means one of these. Which is closest?`);
    for (const option of meaning.options) console.log(`    [${option.id}] ${option.label.padEnd(40)} → ${Object.entries(option.change).map(([key, value]) => `${key} ${value}`).join(', ')}`);
    console.log(`    [${meaning.options.length + 1}] Not sure — show me all of them        → vibekit design preview renders each`);
    console.log('');
    console.log(`  vibekit design feedback "${text}" --choice <n>`);
    return;
  }

  const option = meaning.options.find((entry) => entry.id === choice);
  if (!option) throw new Error(`--choice ${choice} is not one of the options shown.`);
  const project = await loadProject(root).catch(() => null);
  if (!project) throw new Error('No specs/project.json here; `vibekit init` first.');
  const design = applyChange(project.design ?? {}, option.change);
  await saveProject(root, { ...project, design });
  await generateFolder(root, await folderConfig(root), { folder });
  if (options.json) return void console.log(JSON.stringify({ text, about, applied: option, design }, null, 2));
  console.log(`✔ ${option.label} → ${Object.entries(option.change).map(([key, value]) => `${key} ${value}`).join(', ')}${about !== 'everywhere' ? ` (noted against ${about}; tokens are global, so the change is too)` : ''}`);
  console.log('  tokens.md regenerated. This is a normal commit with a before and after; `vibekit design preview` to look.');
}
