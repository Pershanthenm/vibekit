import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { generateFolder } from '../folder/generate.js';
import { listAsks } from '../folder/asks.js';
import { STAGE_PROMPTS } from '../folder/stages.js';
import { ask, unavailable } from '../agent.js';
import { CONFIG_KEYS, readConfig, replay as replayStage, upgrade, upgradePlan, writeConfig } from '../prompts.js';
import { convertSource, detect, extractStatements, extractTerms, redact, splitSections, briefGaps } from '../sources.js';
import { importSkill, listSkills, loadFor, overlaps, overrideChain, promote, testSkills } from '../skills.js';
import { exists, readText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `clarify`, `upgrade-prompts`, `replay`, `config` and `skills`.
 * Specification §16, §5, §42, §30 and §56.
 *
 * What these have in common is that each is a way of looking before leaping: at what a brief
 * would produce before it is in the repository, at what a prompt upgrade would change before the
 * agents change behaviour, at what a skill does before it loads into everyone's session.
 */

// ---------------------------------------------------------------- clarify (§16)

/**
 * §16 — "Stages 0 and 1 in a temp folder; prints the asks. Writes nothing in the repo."
 *
 * The point is to try a brief on before committing to it. A team can run this against three real
 * BRS documents in an afternoon and see what VibeKit would ask, which is the cheapest possible
 * way to find out whether the brief is decided enough to build from.
 */
export async function clarify(options) {
  const { root, args, json } = options;
  const [target] = args.filter((argument) => !argument.startsWith('-'));
  if (!target) throw new Error('Usage: vibekit clarify <file> [--dry-run]   — what this brief would be asked about, without touching the repo.');

  const path = resolve(root, target);
  if (!(await exists(path))) throw new Error(`No such file: ${path}`);

  const converted = convertSource(path);
  if (!converted.ok) throw new Error(converted.reason);
  const text = converted.native ? await readText(path) : converted.text;

  const found = detect(text);
  const { preamble, sections } = splitSections(redact(text, found));
  const statements = extractStatements(sections);
  const terms = extractTerms(text);

  // The questions stage 1 would raise, from what the document does not settle — the same list the
  // fixture runs are held to, so a change here is a diff against the golden outputs.
  const gaps = briefGaps(text, { sections, statements, found });

  const result = {
    file: target,
    sections: sections.length,
    statements: statements.length,
    terms: terms.slice(0, 8).map((term) => term.term),
    detected: found.map((hit) => `${hit.kind}: ${hit.placeholder}`),
    gaps,
  };

  if (json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`${basename(target)} · ${sections.length} section(s) · ${statements.length} explicit obligation(s)`);
  if (preamble) console.log(`\n  ${preamble.replace(/\s+/g, ' ').slice(0, 160)}`);

  console.log('');
  console.log(gaps.length ? `${gaps.length} thing(s) this brief does not settle:` : 'This brief settles everything stage 1 asks about, which is rare.');
  for (const gap of gaps) console.log(`  - ${gap}`);

  if (terms.length) {
    console.log('');
    console.log(`Words that would need defining: ${terms.slice(0, 8).map((term) => term.term).join(', ')}`);
  }

  console.log('');
  console.log('  Nothing was written. `vibekit ingest` is the same reading, kept.');
}

// ---------------------------------------------------------------- prompts (§5, §42)

export async function upgradePrompts(options) {
  const { root, folder: chosen, yes, json } = options;
  const folder = chosen ?? (await folderName(root));
  const planned = await upgradePlan(root, { folder });

  if (json) return void console.log(JSON.stringify(planned, null, 2));

  console.log(`prompts ${planned.project ?? 'unrecorded'} in this project · ${planned.installed} installed`);

  if (!planned.changes.length) {
    console.log('');
    console.log('Nothing to upgrade: every stage prompt already matches the installed version.');
    return;
  }

  console.log('');
  for (const change of planned.changes) {
    if (change.kind === 'edited') {
      console.log(`  ! ${change.path} is at the installed version and differs from it — the team edited it. It is left alone.`);
      console.log(`      ${change.diff.changed} line(s) differ, if you want to merge them by hand.`);
      continue;
    }
    console.log(`  ${change.path}  ${change.kind === 'missing' ? 'missing, would be written' : `prompts ${change.version ?? 'unrecorded'} → ${planned.installed}, ${change.diff.changed} line(s) change`}`);
    for (const line of change.diff.removed.slice(0, 3)) console.log(`      - ${line.trim().slice(0, 100)}`);
    for (const line of change.diff.added.slice(0, 3)) console.log(`      + ${line.trim().slice(0, 100)}`);
  }

  if (!yes) {
    console.log('');
    console.log('  Nothing written. `vibekit upgrade-prompts --yes` applies it.');
    console.log('  A project\'s agents never change behaviour because of an update the team did not see.');
    return;
  }

  const applied = await upgrade(root, { folder });
  console.log('');
  console.log(`✔ ${applied.written.length} prompt(s) upgraded · profile.md now records prompts: ${applied.installed}`);
  for (const change of applied.edited) console.log(`  · left alone (yours) ${change.path}`);
}

export async function replay(options) {
  const { root, folder: chosen, stage, project, run: wantRun, json } = options;

  // §60 — "Teams can run the same fixture against their own template with `vibekit tools replay
  // --recovery`." The fixture is self-contained: it builds its own repo, so nothing here is read.
  if (options.recovery) {
    const { runRecovery } = await import('../recovery.js');
    const outcome = await runRecovery({ log: console.log, variants: options.variant ? [options.variant] : undefined });
    if (!outcome.ok) process.exitCode = 1;
    return;
  }

  const folder = chosen ?? (await folderName(root));

  // The re-run is the half that needs a model, and it is asked for rather than assumed: a
  // command that quietly spends tokens is one nobody runs twice.
  let runner = null;
  if (wantRun) {
    const why = await unavailable(root, { role: 'analyst', folder });
    if (why) throw new Error(`--run needs a model: ${why}`);
    runner = ask;
  }

  const result = await replayStage(root, { stage, project: project ? resolve(root, project) : null, folder, ask: runner });

  if (json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`stage ${result.stage} · ${result.prompt} · prompts ${result.version}`);
  console.log(`against ${result.project}`);
  console.log('');
  console.log(`${result.asksThen.length} ask(s) were raised at this stage on that project${result.answered ? ', and the answers are recorded' : ''}:`);
  for (const ask of result.asksThen.slice(0, 12)) {
    console.log(`  ${ask.id}  ${ask.blocking ? '[blocking] ' : ''}${ask.ask.slice(0, 84)}`);
  }
  if (result.topicsThen.length) {
    console.log('');
    console.log(`  Topics then: ${result.topicsThen.join(', ')}`);
    console.log(`  The prompt now loads: ${result.loadsNow.join(', ') || 'nothing it names as a file'}`);
  }
  if (result.rerun) {
    console.log('');
    console.log(`Re-run on ${result.rerun.model}: ${result.rerun.asksNow.length} ask(s)`);
    for (const question of result.rerun.asksNow.slice(0, 12)) console.log(`  ${question.blocking ? '[blocking] ' : ''}${question.question.slice(0, 92)}`);

    if (result.rerun.noLongerAsked.length) {
      console.log('');
      console.log(`  ! ${result.rerun.noLongerAsked.length} question(s) the old prompt raised and this one does not:`);
      for (const question of result.rerun.noLongerAsked) console.log(`      ${question.slice(0, 92)}`);
      console.log('    Each was raised once for a reason, and nothing now records that reason. That is the regression this catches.');
    }
    if (result.rerun.newlyAsked.length) {
      console.log('');
      console.log(`  ${result.rerun.newlyAsked.length} question(s) this prompt raises that the old one did not:`);
      for (const question of result.rerun.newlyAsked) console.log(`      ${question.slice(0, 92)}`);
    }
    return;
  }

  console.log('');
  console.log(`  ${result.unrun}`);
}

export async function config(options) {
  const { args, json } = options;
  const [key, ...rest] = args;
  const value = rest.join(' ').trim();

  if (!key) {
    const current = await readConfig();
    if (json) return void console.log(JSON.stringify(current, null, 2));
    console.log('Machine settings — per install, never in the folder.');
    console.log('');
    for (const [name, description] of Object.entries(CONFIG_KEYS)) {
      console.log(`  ${name.padEnd(14)} ${current[name] ?? 'not set'}`);
      console.log(`  ${''.padEnd(14)} ${description}`);
    }
    console.log('');
    console.log('  A URL in the repository would be one a fork inherits, which is why these live here.');
    return;
  }

  if (!value) {
    const current = await readConfig();
    console.log(current[key] ?? `${key} is not set.`);
    return;
  }

  await writeConfig(key, value);
  console.log(`✔ ${key} = ${value}`);
}

// ---------------------------------------------------------------- skills (§56)

export async function skills(options) {
  const { root, args, folder: chosen, to, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [action, name] = args;

  if (action === 'promote') {
    if (!name) throw new Error('Usage: vibekit skills promote <name> --to team');
    const result = await promote(root, name, { folder, to: to ?? 'team' });
    console.log(`✔ ${result.name} prepared for ${result.to} scope at ${result.dir}`);
    for (const file of result.files) console.log(`    ${file}`);
    console.log('');
    console.log('  Open it as a pull request against your team skills repository. The promotion note needs');
    console.log('  the sessions that matched it: that is what a reviewer uses to agree it belongs in everyone\'s context.');
    return;
  }

  if (action === 'import') {
    if (!name) throw new Error('Usage: vibekit skills import <path to a SKILL.md or its folder>');
    const result = await importSkill(root, resolve(root, name), { folder });
    console.log(`✔ ${result.path}`);
    console.log(`    triggers: [${result.triggers.join(', ')}]  · confidence: low`);
    console.log('');
    console.log('  The triggers were inferred from its description, which says what a skill is for and not');
    console.log('  the words that should fetch it. Edit them before relying on it.');
    return;
  }

  const { skills: found, orphans } = await listSkills(root, { folder });
  if (json) return void console.log(JSON.stringify({ skills: found, orphans, overlaps: overlaps(found), chain: overrideChain(found) }, null, 2));

  if (!found.length) {
    console.log(`No skills in ${folder}/skills/index.yml.`);
    console.log('  A skill nobody asked for is not written — they arrive from the template, from memory promotion, or from a reviewer finding raised three times.');
    return;
  }

  const width = Math.max(...found.map((skill) => skill.name.length));
  for (const skill of found) {
    const state = skill.missing ? 'no body' : `${skill.tokens} tokens`;
    console.log(`${skill.name.padEnd(width)}  ${skill.scope.padEnd(7)} ${state.padEnd(11)} ${skill.test ? 'tested' : 'NO TEST'}  [${skill.triggers.join(', ')}]`);
  }

  for (const clash of overlaps(found)) {
    console.log('');
    console.log(`  ! ${clash.a} and ${clash.b} share ${clash.shared} trigger(s) — ${Math.round(clash.share * 100)}% overlap.`);
    console.log('    Merge them or make the triggers disjoint: overlapping skills are how an agent gets two instructions for one task.');
  }
  for (const entry of overrideChain(found)) {
    console.log(`  · ${entry.name} exists at ${entry.scopes.join(' and ')}; ${entry.wins} wins`);
  }
  for (const orphan of orphans) {
    console.log(`  ! ${orphan} is in lib/ and not in index.yml, so nothing can ever fetch it`);
  }

  if (args.includes('--for') || options.for) {
    const task = options.for;
    const { loaded, leftOut } = loadFor(found, task);
    console.log('');
    console.log(`For "${task}": ${loaded.join(', ') || 'nothing fires'}`);
    if (leftOut.length) console.log(`  left out (three bodies is the budget): ${leftOut.join(', ')}`);
  }
}

export async function testSkillsCommand(options) {
  const { root, args, folder: chosen, run: wantRun, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [only] = args.filter((argument) => !argument.startsWith('-'));

  let runner = null;
  if (wantRun) {
    const why = await unavailable(root, { role: 'implementer', folder });
    if (why) throw new Error(`--run needs a model: ${why}`);
    runner = ask;
  }

  const result = await testSkills(root, { folder, only: only ?? null, ask: runner });
  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (!result.results.length) {
    console.log('No skills to test.');
    return;
  }

  for (const entry of result.results) {
    console.log(`${entry.ok ? '✔' : entry.untested ? '!' : '✖'} ${entry.name}`);
    for (const problem of entry.problems) console.log(`    ${problem}`);
    for (const note of entry.unchecked) console.log(`    · ${note}`);
  }

  console.log('');
  console.log(`${result.passed} passed · ${result.failed.length} failed · ${result.untested.length} without a test`);
  if (result.untested.length) {
    console.log('  A skill is a prompt fragment, and prompt fragments regress silently. One without a test');
    console.log('  loads with a warning and cannot be promoted to team scope.');
  }
  if (result.failed.length) process.exitCode = 1;
}

export { generateFolder, mkdtemp, rm, tmpdir, join, STAGE_PROMPTS, listAsks };
