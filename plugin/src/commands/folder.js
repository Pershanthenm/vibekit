import { join } from 'node:path';
import { answerAsk, blastRadius, isOpen, listAsks, openAsk, rejectAsk } from '../folder/asks.js';
import { renderBudget } from '../folder/budget.js';
import { CHECKPOINT_CAP, RESUMABLE, checkpointTokens, parseCheckpoint, readCheckpoint, writeCheckpoint } from '../folder/checkpoint.js';
import { renderChecks, runChecks } from '../folder/checks.js';
import { generateFolder } from '../folder/generate.js';
import { DEFAULT_FOLDER, FOLDER_NAMES } from '../folder/layout.js';
import {
  appendLog, claim, createRequirement, findRequirement, holdAgeHours, listRequirements,
  nextRequirementId, readTasksState, readyBlockers, release, setStatus,
} from '../folder/requirements.js';
import { ROLE_NAMES } from '../folder/templates.js';
import { currentStage, nextAction, readAssumptions, renderStatus, stageByNumber } from '../folder/workflow.js';
import { exists, readText, writeAtomic } from '../fsutil.js';
import { readFrontMatter } from '../frontmatter.js';
import { PROJECT_FILE, loadProject, saveProject } from '../project.js';
import { normalize } from '../schema.js';
import { basename } from 'node:path';

/**
 * The folder's commands. Appendix A.
 *
 * Each one is thin: resolve the folder, call into src/folder/, print. The rules live with the
 * model rather than here, so the page and the CLI enforce the same ones — an agent that could get
 * a different answer from a different door would only have to find the other door.
 */

export const folderName = async (root) => {
  const configured = (await loadProject(root).catch(() => null))?.folder;
  if (configured) return configured;
  for (const name of FOLDER_NAMES) if (await exists(join(root, name))) return name;
  return DEFAULT_FOLDER;
};

const profileOf = async (root, folder) => readFrontMatter((await readText(join(root, folder, 'profile.md'))) ?? '');

/**
 * The config the folder is regenerated from.
 *
 * `product/entities.md` is a generated file, so a regeneration rewrites it from here — which
 * means an entity somebody added by editing that file was silently discarded on the next
 * `vibekit add`. The vocabulary is the one thing in the folder an agent is refused for not
 * matching, so losing an entry is expensive and invisible.
 *
 * So the file is read back and merged: `specs/project.json` still wins where it names an entity,
 * and anything only in `entities.md` survives instead of being dropped.
 */
async function entityVocabulary(root, fromProject = []) {
  const { entitiesFrom } = await import('../docs/arch/model.js');
  const folder = await folderName(root);
  const written = entitiesFrom((await readText(join(root, folder, 'product/entities.md'))) ?? '');
  const byName = new Map(written.map((entity) => [entity.name, {
    name: entity.name,
    class: entity.class,
    fields: entity.fields.map((field) => ({ name: field.name, type: field.type, class: field.class, notes: field.notes })),
    relations: entity.relations,
  }]));
  for (const entity of fromProject) byName.set(entity.name, entity);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function folderConfig(root) {
  const project = await loadProject(root).catch(() => null);
  if (!project) return { name: 'project', description: null, stack: {}, commands: {}, entities: await entityVocabulary(root) };
  return {
    name: project.project?.name ?? 'project',
    description: project.project?.description ?? null,
    users: project.project?.users ?? [],
    architecture: project.architecture?.style ?? project.architecture ?? 'clean',
    stack: project.stack ?? {},
    commands: project.commands ?? {},
    entities: await entityVocabulary(root, project.entities ?? []),
    delivery: project.delivery ?? {},
    // design/tokens.md is generated from here (brand, theme, density); without this line the
    // template never saw a brand a team had set and printed its TODO forever.
    design: project.design ?? {},
    template: project.template ?? null,
    // §56 — the shipped skills library, on unless the project file says `"library": false`.
    library: project.library !== false,
    // Catalogue domains or skill names the project enabled (`vibekit skills enable …`).
    catalogue: Array.isArray(project.catalogue) ? project.catalogue : [],
  };
}

/** Regenerate the derived files after anything that changes what they derive from. */
const refresh = async (root, folder) => generateFolder(root, await folderConfig(root), { folder });

/**
 * The two closed vocabularies a requirement is checked against: the entities it may name and the
 * assumptions it may stand on.
 *
 * One function, because `req why` and `req ready` reading different ones is how a requirement
 * gets declared ready by the command whose whole job is to say whether it is.
 */
async function vocabularyFor(root, folder) {
  const [entitiesText, assumptions] = await Promise.all([
    readText(join(root, folder, 'product/entities.md')),
    readAssumptions(root, folder),
  ]);
  return {
    entities: [...String(entitiesText ?? '').matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim()),
    assumptions: assumptions.map((assumption) => assumption.id),
  };
}

const requireOne = async (root, folder, query) => {
  const found = findRequirement(await listRequirements(root, folder), query);
  if (!found) throw new Error(`No requirement matching "${query}".`);
  return found;
};

// ---------------------------------------------------------------- vibekit init

export async function init(options) {
  const { root, folder: chosen, delivery, adopt } = options;
  const folder = chosen ?? (await folderName(root));

  // §35 — importing a Spec Kit repository. Reported before anything is written, because the
  // conversion's real output is the list of things the original spec never settled.
  if (options['from-speckit']) {
    const { convertPlan, LAYOUT, looksLikeSpecKit, readSpecKit } = await import('../speckit.js');
    if (!(await looksLikeSpecKit(root))) {
      throw new Error('This does not look like a Spec Kit repository: no memory/constitution.md, no .specify/, and no numbered folder under specs/.');
    }

    const read = await readSpecKit(root);
    const planned = convertPlan(read);

    console.log(`${planned.features} feature(s) · ${planned.criteria} acceptance criteria, ${planned.usable} already in EARS form`);
    console.log('');
    for (const row of LAYOUT) console.log(`  ${row.from.padEnd(30)} → ${row.to}`);
    console.log('');
    console.log(`${planned.asks.length} question(s) the conversion cannot answer:`);
    for (const ask of planned.asks) console.log(`  - ${ask.plain}`);
    console.log('');
    console.log('  Most of these are things the original spec never settled, which is the point, and');
    console.log('  usually the first time anyone notices. Run `vibekit init` to write the folder, then');
    console.log('  answer them: everything inferred arrives as an ask, never as a silent fact.');
    if (!options.yes) return;

    // §35 — with --yes the folder is written from what the Spec Kit files say, conservatively:
    // criteria that already parse as EARS are carried, the rest become asks; principles become
    // rules; nothing is inferred and presented as fact.
    const { convertSpecKit } = await import('../speckit.js');
    const converted = await convertSpecKit(root, read, { folder });
    console.log('');
    console.log(`✔ ${folder}/ written from the Spec Kit files · ${converted.requirements.length} requirement(s), ${converted.rules} rule(s)`);
    for (const line of converted.notes) console.log(`  · ${line}`);

    const { openAsk } = await import('../folder/asks.js');
    for (const ask of planned.asks) await openAsk(root, { ask: ask.ask, plain: ask.plain }, folder).catch(() => null);
    console.log(`✔ ${planned.asks.length} ask(s) written to ${folder}/workflow/asks/`);
  }

  // The folder needs a stack, real commands and an entity model, and those are the answers the
  // project scaffold collects (spec §19). Writing the folder from an empty config would produce a
  // map.md whose test command does not run, which is the one thing §6 says it must never do.
  if (!(await exists(join(root, PROJECT_FILE)))) {
    // The config the folder is generated from. Nothing is asked here: `vibekit project new` is
    // the conversation, and `init --yes` is what a script or a test wants — a name and nothing invented.
    await saveProject(root, normalize({ project: { name: options.name ?? basename(root), description: options.describe ?? null } }));
  }

  if (options['no-library']) {
    const project = await loadProject(root);
    await saveProject(root, { ...project, library: false });
  }
  const config = await folderConfig(root);
  const result = await generateFolder(root, config, { folder, delivery: delivery ?? (adopt ? 'none' : undefined) });

  console.log(`✔ ${result.folder}/ written · delivery ${result.delivery}`);
  if (result.written.length) console.log(`  ${result.written.length} file(s) created`);

  // §50 — the commit rules are hooks, versioned in the repo. Installed here so the first commit
  // after init already carries a trailer or is told why it does not.
  const { installHooks } = await import('../githooks.js');
  const hooks = await installHooks(root);
  if (hooks.installed?.length) console.log(`  ${hooks.installed.length} git hook(s) in ${hooks.hooksPath}/ · commits on req/* need a VibeKit-Requirement trailer; commits on main are refused`);
  for (const path of result.kept) console.log(`  · kept (yours) ${path}`);
  for (const path of result.skipped) console.log(`  ! skipped, no generated header: ${path}`);
  if (adopt) console.log('  rules-only: no application code was generated.');
  console.log('');
  console.log(renderBudget(result.budget, result.folder));
  console.log('');
  console.log('Next: vibekit run');
}

// ---------------------------------------------------------------- vibekit sprint run

/**
 * §24 — reads the gate, regenerates status.md, prints the prompt to run. It never writes a gate
 * line: "no stage advances itself" only stays true if the code has no way to pass one.
 */
export async function next({ root, folder: chosen, json }) {
  const folder = chosen ?? (await folderName(root));
  const profile = await profileOf(root, folder);
  const holdTimeout = Number.parseFloat(String(profile['hold-timeout'] ?? '4').replace(/h$/i, '')) || 4;

  const status = await renderStatus(root, folder, { holdTimeout });
  const path = join(root, folder, 'workflow/status.md');
  const existing = await readText(path);
  if (existing !== null) {
    const header = existing.split('\n', 1)[0];
    await writeAtomic(path, `${header}\n${status}`);
  }

  const action = await nextAction(root, folder, { holdTimeout });
  const stage = await currentStage(root, folder);

  // §60 — whatever else `next` says, a session that is resuming work reads the checkpoint
  // first. Printing it here is the difference between resuming and starting again.
  const held = Object.keys((await readTasksState(root, folder)).held);
  const resuming = held.length ? await readCheckpoint(root, held[0], folder).catch(() => '') : '';

  if (json) {
    console.log(JSON.stringify({ stage: stage.n, name: stage.name, prompt: `${folder}/${stage.prompt}`, action, held, checkpoint: resuming || null }, null, 2));
    return;
  }

  console.log(`stage ${stage.n} · ${stage.name}`);
  if (resuming) {
    console.log('');
    console.log(`Resuming ${held[0]}:`);
    console.log(resuming.split('\n').map((line) => `  ${line}`).join('\n'));
  }
  if (!action) {
    console.log('Nothing outstanding.');
    return;
  }
  console.log('');
  console.log(action.forHuman ? `Waiting on you: ${action.detail ?? ''}` : `Next: ${action.detail ?? ''}`);
  console.log(`  ${action.command}`);
  if (action.kind === 'stage') console.log(`  prompt: ${action.prompt}`);
}

// ---------------------------------------------------------------- vibekit check

export async function check(options) {
  const { root, folder: chosen, budget, ci, done, json, runners: wantRunners, deps: wantDeps, offline } = options;
  const folder = chosen ?? (await folderName(root));
  const result = await runChecks(root, { folder });

  // §39, §52 — `--security`: the scan's read pass, as a check. Secrets, classified fields in log
  // calls, the access matrix, retention for personal data, threat models on high-risk work.
  if (options.security) {
    const { securityRead } = await import('../security/scan.js');
    const read = await securityRead(root, { folder, offline: Boolean(offline) });
    result.findings.push(...read.findings.map((finding) => ({ code: `security.${finding.check}`, message: finding.message, fix: finding.where ?? null, severity: finding.severity === 'low' ? 'warning' : 'error' })));
    result.passes = result.findings.every((entry) => entry.severity !== 'error');
    if (!json) console.log(`Security · ${read.high.length} high · ${read.medium.length} medium · ${read.low.length} low${read.findings.length ? '' : ' · clean'}\n`);
  }

  // Integration spec §2 — `--servers`: every declared MCP server is declared well, has a credential
  // on this machine, and answers. Run before a sprint starts, so a broken integration is found at
  // the gate rather than halfway through a lane.
  if (options.servers) {
    const { checkServers } = await import('../servers.js');
    const report = await checkServers(root, { folder });
    for (const row of report.rows.filter((entry) => !entry.ok)) result.findings.push({ code: 'server.unavailable', message: `${row.id}: ${row.why}`, fix: `${folder}/agents/servers.yml`, severity: 'error' });
    result.passes = result.findings.every((entry) => entry.severity !== 'error');
    if (!json) {
      console.log(`Servers · ${report.servers.length} declared in ${folder}/agents/servers.yml`);
      for (const row of report.rows) console.log(`  ${row.ok ? '✔' : '✖'} ${row.id.padEnd(16)} ${row.why}`);
      if (!report.servers.length) console.log('  none declared — an agent can reach nothing outside the repository through vibekit serve');
      console.log('');
    }
  }

  // Integration spec §5.2 — `--budget` reports the always-loaded cost by source: core, each
  // extension (declared and measured), imported skills. One total is unaccountable.
  if (budget && !json) {
    const { budgetBySource } = await import('../extensions.js');
    const { readText: readFile } = await import('../fsutil.js');
    const index = (await readFile(join(root, folder, 'skills/index.yml'))) ?? '';
    const importedEntries = (index.match(/^  path: lib\/imported\//gm) ?? []).length;
    const rows = await budgetBySource().catch(() => []);
    console.log('Always-loaded context by source');
    console.log(`  ${'core (the folder)'.padEnd(34)} ${String(result.budget?.alwaysLoaded ?? 0).padStart(7)} tokens`);
    if (importedEntries) console.log(`  ${'imported skills (index lines)'.padEnd(34)} ${String(importedEntries * 20).padStart(7)} tokens · ${importedEntries} skill(s), bodies load on trigger only`);
    for (const row of rows) {
      console.log(`  ${row.source.padEnd(34)} ${String(row.measured).padStart(7)} tokens · declared ${row.declared}${row.off ? '  ! off by more than 20%' : ''}`);
      if (row.off) result.findings.push({ code: 'ext.budgetDeclared', message: `${row.source} declares ${row.declared} always-loaded tokens and measures ${row.measured}; a manifest may not understate what it adds.`, fix: null, severity: 'warning' });
    }
    console.log('');
  }

  // §28, §52 — `--deps` re-runs the planner's lookup: a dependency that went stale, was yanked or
  // published a vulnerability after it was approved is reported here rather than in an incident.
  if (wantDeps) {
    const { auditDependencies } = await import('../deps.js');
    const audit = await auditDependencies(root, { folder, offline: Boolean(offline) });
    result.findings.push(...audit.findings.map((finding) => ({ ...finding, fix: finding.fix ?? null })));
    result.passes = result.findings.every((entry) => entry.severity !== 'error');

    if (!json) {
      console.log(`Dependencies · ${audit.declared.length} declared in manifests, ${audit.recorded.length} recorded in ${folder}/workflow/architecture.md${audit.online ? '' : ' · offline'}`);
      if (audit.policy.licences.length) console.log(`  licences allowed: ${audit.policy.licences.join(', ')}`);
      if (audit.policy.registries.length) console.log(`  registries allowed: ${audit.policy.registries.join(', ')}`);
      // What was not checked is said, never implied clean.
      for (const note of audit.unchecked) console.log(`  · not checked: ${note}`);
      console.log('');
    }
  }

  // §62 — `--runners` verifies each entry can reach the folder, reports which are unsandboxed,
  // and reports seat utilisation, so you can see whether you are paying for seats you do not use.
  if (wantRunners) {
    const { checkRunners } = await import('../runners.js');
    const { readSessions } = await import('../session.js');
    const report = await checkRunners(root, { folder, sessions: await readSessions(root, folder) });
    result.findings.push(...report.findings.map((finding) => ({ ...finding, fix: finding.fix ?? `${folder}/agents/runners.md` })));
    result.passes = result.findings.every((entry) => entry.severity !== 'error');

    if (!json) {
      console.log(`Runners · mode ${report.mode}${report.calibrate ? ' · calibrating' : ''}`);
      for (const row of report.utilisation) {
        console.log(`  ${row.id.padEnd(14)} ${row.kind.padEnd(5)} ${row.seats ? `${row.seats} seat(s)` : 'metered'}  ${row.sessions} session(s)${row.idle ? '  idle' : ''}`);
      }
      console.log('');
    }
  }

  // §70 — `--parity`: every command has a matching action on the page, or the list says which do not.
  if (options.parity) {
    const { parityReport } = await import('../parity.js');
    const parity = await parityReport();
    for (const missing of parity.missing) result.findings.push({ code: 'parity.missing', message: `\`vibekit ${missing}\` has no matching action on the tracker page`, fix: 'src/control.js ACTIONS', severity: 'warning' });
    if (!json) console.log(`Parity · ${parity.covered.length} command(s) with a page action, ${parity.missing.length} without${parity.missing.length ? `: ${parity.missing.join(', ')}` : ''}\n`);
  }

  // CLI Spec §6 — stale completion is worse than none, so `run check` reports a mismatch.
  const { completionStatus } = await import('../completion.js');
  const completion = await completionStatus().catch(() => ({ stale: [] }));
  for (const stale of completion.stale) result.findings.push({ code: 'completion.stale', message: `${stale.path} is completion for vibekit ${stale.version ?? 'unknown'}, and this is ${completion.version}. Stale completion is worse than none.`, fix: `vibekit completion install ${stale.shell}`, severity: 'warning' });

  if (done) {
    const requirement = await requireOne(root, folder, done);
    const { migrationBlockers } = await import('../migration.js');
    const reasons = [...doneBlockers(requirement, result), ...(await migrationBlockers(root, requirement.id, folder))];
    if (reasons.length) {
      console.log(`✖ ${requirement.id} is not done:`);
      for (const reason of reasons) console.log(`  - ${reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✔ ${requirement.id} meets the definition of done. A human sets the status.`);
    return;
  }

  if (json) {
    console.log(JSON.stringify({ passes: result.passes, findings: result.findings, budget: result.budget }, null, 2));
    if (!result.passes) process.exitCode = 1;
    return;
  }

  console.log(renderChecks(result));
  if (budget) {
    console.log('');
    console.log(renderBudget(result.budget, folder));
  }
  // In CI a warning is information; an error fails the build.
  if (!result.passes) process.exitCode = 1;
  else if (ci) console.log(`  (${result.findings.length} warning(s))`);
}

/** §23 — the definition of done, checked rather than asserted. */
export function doneBlockers(requirement, checkResult) {
  const reasons = [];
  if (!requirement.acceptance.length) reasons.push('it has no acceptance criteria');
  for (const criterion of requirement.acceptance) {
    if (!requirement.verification.includes(criterion.id)) reasons.push(`${criterion.id} has no named test in ## Verification`);
  }
  for (const section of ['approach', 'verification', 'review', 'log']) {
    if (!requirement[section].trim()) reasons.push(`## ${section[0].toUpperCase()}${section.slice(1)} is empty`);
  }
  if (!requirement.evidence.trim()) reasons.push('## Evidence is empty — "tests pass" is a claim until an exit code is captured');
  if (/changes-requested|finding/i.test(requirement.review) && !/approved/i.test(requirement.review)) {
    reasons.push('the reviewer asked for changes');
  }
  const open = (checkResult?.asks ?? []).filter((ask) => isOpen(ask) && ask.for === requirement.id);
  for (const ask of open) reasons.push(`${ask.id} is still open`);
  return reasons;
}

// ---------------------------------------------------------------- vibekit req

export async function req(options) {
  const { root, args, folder: chosen, as: role, runner, size, kind, source } = options;
  const [action, ...rest] = args;
  const folder = chosen ?? (await folderName(root));
  const query = rest.join(' ').trim();

  if (action === 'new') {
    if (!query) throw new Error('Usage: vibekit req new "<title>"');
    const id = nextRequirementId(await listRequirements(root, folder), kind ?? 'requirement');
    await createRequirement(root, { id, title: query, kind: kind ?? 'requirement', size: size ?? null, source: source ?? null }, folder);
    await refresh(root, folder);
    console.log(`✔ Created ${folder}/product/requirements/${id}.md`);
    console.log('  Write its acceptance criteria in EARS form, then: vibekit req ready ' + id);
    return;
  }

  if (action === 'list' || !action) {
    const requirements = await listRequirements(root, folder);
    const held = (await readTasksState(root, folder)).held;
    if (!requirements.length) return void console.log(`No requirements yet. Add one with \`vibekit req new "<title>"\`.`);
    const width = Math.max(...requirements.map((entry) => entry.id.length));
    for (const entry of requirements) {
      const holder = held[entry.id] ? `  ${held[entry.id].role}@${held[entry.id].runner}` : '';
      console.log(`${entry.id.padEnd(width)}  ${(entry.size ?? '-').padEnd(2)} ${entry.status.padEnd(11)} ${entry.title}${holder}`);
    }
    return;
  }

  if (action === 'show') {
    console.log((await requireOne(root, folder, query)).text);
    return;
  }

  if (action === 'why' || action === 'blockers') {
    const requirement = await requireOne(root, folder, query);
    // The same vocabulary `ready` checks against. Reading fewer of them here meant `why` said a
    // requirement was ready and `ready` then refused it, which is the one thing this must not do.
    const blockers = readyBlockers(requirement, await vocabularyFor(root, folder));
    if (!blockers.length) return void console.log(`${requirement.id} meets the definition of ready.`);
    console.log(`${requirement.id} is not ready:`);
    for (const reason of blockers) console.log(`  - ${reason}`);
    return;
  }

  if (action === 'checkpoint') {
    // §60. Reading takes no arguments on purpose: a resumed session should be able to type the
    // command it half-remembers and get the note, rather than first working out which
    // requirement it was holding.
    const held = Object.keys((await readTasksState(root, folder)).held);
    const wanted = rest[0] || held[0] || '';
    if (!wanted) {
      const resumable = (await listRequirements(root, folder)).filter((entry) => RESUMABLE.includes(entry.status));
      if (!resumable.length) throw new Error('Nothing is in progress, so there is nothing to check point. Start something with `vibekit req start <REQ> --as implementer`.');
      throw new Error(`You hold nothing. Name the requirement: ${resumable.map((entry) => entry.id).join(', ')}.`);
    }
    const requirement = await requireOne(root, folder, wanted);
    // `--ask` rather than `--open`, which is already the flag that opens a browser.
    const values = { done: options.done, hand: options['in-hand'], next: options.next, open: options.ask, read: options.read };
    const where = { session: options.runner ?? null, step: Number.parseInt(options.step ?? '', 10) || null, of: Number.parseInt(options.of ?? '', 10) || null };

    if (!Object.values(values).some(Boolean)) {
      const body = await readCheckpoint(root, requirement.id, folder);
      if (!body) {
        console.log(`${requirement.id} has no checkpoint. A session resuming it would have to reconstruct the work from the diff.`);
        console.log(`  vibekit req checkpoint ${requirement.id} --done "..." --in-hand "..." --next "..."`);
        return;
      }
      console.log(`${requirement.id} · ${requirement.title}`);
      console.log('');
      console.log(body);
      console.log('');
      console.log(`  ${checkpointTokens(body)}/${CHECKPOINT_CAP} tokens · this is what you read instead of the transcript`);
      return;
    }

    const written = await writeCheckpoint(root, requirement.id, values, { folder, ...where });
    console.log(`✔ ${requirement.id} checkpoint replaced · ${checkpointTokens(written)}/${CHECKPOINT_CAP} tokens`);
    console.log('  Commit it with the work; it is worth nothing in a tool the next session cannot open.');
    return;
  }

  if (action === 'log') {
    const [id, ...entry] = rest;
    const requirement = await requireOne(root, folder, id);
    console.log(`✔ ${requirement.id}${await appendLog(root, requirement.id, entry.join(' '), folder)}`);
    return;
  }

  if (action === 'start') {
    const requirement = await requireOne(root, folder, query);
    const as = role ?? 'implementer';
    if (!ROLE_NAMES.includes(as)) throw new Error(`"${as}" is not a role. One of: ${ROLE_NAMES.join(', ')}.`);
    const requirements = await listRequirements(root, folder);
    const waiting = requirement.after.filter((id) => requirements.find((entry) => entry.id === id)?.status !== 'done');
    if (waiting.length) throw new Error(`${requirement.id} waits on ${waiting.join(', ')}, which is not done.`);

    // §60 — an in-progress requirement nobody holds is one whose session died or timed out. The
    // next holder starts from the checkpoint and the worktree rather than from `ready`, and the
    // log records the change of hands — "start in Claude Code, resume in Cursor" is the case the
    // file-driven design exists for.
    const resuming = RESUMABLE.includes(requirement.status);
    if (!resuming) await setStatus(root, requirement.id, 'in-progress', { by: 'agent', folder });
    const holder = await claim(root, { id: requirement.id, role: as, runner: runner ?? 'cli' }, folder);
    if (resuming) {
      const checkpoint = parseCheckpoint(await readCheckpoint(root, requirement.id, folder));
      await appendLog(root, requirement.id, `resumed by ${as} on ${holder.runner}${checkpoint.step ? ` from checkpoint step ${checkpoint.step}` : checkpoint.next ? ' from the checkpoint' : ' with no checkpoint — reconcile the worktree first'}`, folder);
    }
    await refresh(root, folder);
    console.log(`✔ ${requirement.id} held by ${as} on branch ${holder.branch}${resuming ? ' — resumed; read the checkpoint before anything else' : ''}`);
    console.log(`  Read ${folder}/agents/${as}.md for what you may load and write.`);
    return;
  }

  if (action === 'release' || action === 'unhold') {
    const requirement = await requireOne(root, folder, query);
    const held = (await readTasksState(root, folder)).held[requirement.id];
    await release(root, requirement.id, folder);
    if (held) await appendLog(root, requirement.id, `unheld — was ${held.role} on ${held.runner ?? 'cli'} for ${Math.round(holdAgeHours(held))}h`, folder);
    await refresh(root, folder);
    console.log(`✔ ${requirement.id} released${held ? ` (was ${held.role})` : ''}`);
    return;
  }

  const STATUS_ACTIONS = ['draft', 'ready', 'in-progress', 'blocked', 'paused', 'tested', 'review', 'done'];
  if (STATUS_ACTIONS.includes(action)) {
    const requirement = await requireOne(root, folder, query);

    // §22 — handing work to the reviewer with a skipped test in the tree is handing over a green
    // suite that proves less than it says. Refused here, where the claim is being made.
    if (action === 'tested') {
      const { skippedTests } = await import('../folder/checks.js');
      const skipped = await skippedTests(root);
      if (skipped.length) {
        throw new Error([
          `${requirement.id} cannot be tested with ${skipped.length} skipped or focused test(s) in the tree:`,
          ...skipped.slice(0, 6).map((hit) => `  - ${hit.path}:${hit.line}  ${hit.text}`),
          'A test you cannot make pass is an ask against the criterion, not a test to skip.',
        ].join('\n'));
      }
    }
    // CLI Spec (`verify`) — a migration slice with an unresolved real difference cannot be marked done.
    if (action === 'done') {
      const { migrationBlockers } = await import('../migration.js');
      const blockers = await migrationBlockers(root, requirement.id, folder);
      if (blockers.length) throw new Error(`${requirement.id} cannot be done:\n${blockers.map((line) => `  - ${line}`).join('\n')}`);
    }
    const moved = await setStatus(root, requirement.id, action, {
      by: role ? 'agent' : 'human',
      folder,
      ...(await vocabularyFor(root, folder)),
    });
    await refresh(root, folder);
    console.log(`✔ ${moved.id}: ${moved.from} → ${moved.to}`);
    return;
  }

  throw new Error('Usage: vibekit req <list | new "<title>" | show <id> | why <id> | ready <id> | start <id> --as <role> | release <id> | log <id> "<entry>" | tested <id> | done <id>>');
}

// ---------------------------------------------------------------- vibekit ask

export async function ask({ root, args, folder: chosen, kind, for: forRequirement, about, blocking, why, plain, by, stage, option }) {
  const VERBS = ['list', 'show', 'answer', 'accept', 'reject'];
  const [first, ...rest] = args;
  const action = VERBS.includes(first) ? first : null;
  const folder = chosen ?? (await folderName(root));
  // A free-text ask is the whole of args: the first word is part of the question, not a verb.
  const body = (action ? rest : args).join(' ').trim();

  if (action === 'list' || !args.length) {
    const asks = await listAsks(root, folder);
    const requirements = await listRequirements(root, folder);
    const open = asks.filter(isOpen).sort((a, b) => blastRadius(b, requirements) - blastRadius(a, requirements));
    if (!open.length) return void console.log('No open asks. Nothing is waiting on you.');
    for (const entry of open) {
      const radius = blastRadius(entry, requirements);
      console.log(`${entry.id}  ${entry.kind.padEnd(9)} ${entry.blocking ? 'BLOCKING' : '        '} ${entry.waitingDays}d  ${radius ? `${radius} req waiting  ` : ''}${entry.plain.split('\n')[0] || entry.ask.split('\n')[0]}`);
    }
    return;
  }

  if (action === 'show') {
    const asks = await listAsks(root, folder);
    const found = asks.find((entry) => entry.id.toLowerCase() === rest[0]?.toLowerCase());
    if (!found) throw new Error(`No ask ${rest[0]}.`);
    console.log(found.text);
    return;
  }

  if (action === 'answer' || action === 'accept') {
    const [id, ...answer] = rest;
    const result = await answerAsk(root, id, { answer: answer.join(' '), by: by ?? 'human' }, folder);
    if (result.for) {
      await setStatus(root, result.for, 'ready', { by: 'human', folder }).catch(() => {});
      await appendLog(root, result.for, `${result.id} ${result.status}`, folder).catch(() => {});
    }
    await refresh(root, folder);
    console.log(`✔ ${result.id} ${result.status}${result.for ? ` · ${result.for} unblocked` : ''}`);
    if (result.kind === 'proposal') console.log('  Accepting records the decision. Now make the edit it asks for and run `vibekit init`.');
    return;
  }

  if (action === 'reject') {
    const [id, ...reason] = rest;
    const result = await rejectAsk(root, id, { reason: reason.join(' '), by: by ?? 'human' }, folder);
    await refresh(root, folder);
    console.log(`✔ ${result.id} rejected. It stays in the folder as a record of what was refused and why.`);
    return;
  }

  if (!body) throw new Error('Usage: vibekit ask [list | show <id> | answer <id> "<answer>" | reject <id> "<reason>"] or vibekit ask "<question>" --plain "<plain terms>" [--option "<choice>" …]  (both are required: plain language first, §12; options let a person pick instead of type)');
  const result = await openAsk(root, {
    kind: kind ?? 'question', ask: body, forRequirement: forRequirement ?? null, about,
    blocking: blocking ?? false, why, plain, by: by ?? 'agent', stage: stage ?? null, options: option ?? [],
  }, folder);
  if (forRequirement && blocking) {
    await setStatus(root, forRequirement, 'blocked', { by: 'agent', folder }).catch(() => {});
    await appendLog(root, forRequirement, `blocked on ${result.id}`, folder).catch(() => {});
  }
  await refresh(root, folder);
  console.log(`✔ ${result.id} opened.${blocking && forRequirement ? ` ${forRequirement} is blocked until somebody answers it.` : ''}`);
}

// ---------------------------------------------------------------- vibekit rescan

export async function rescan({ root, folder: chosen }) {
  const folder = chosen ?? (await folderName(root));
  const requirements = await listRequirements(root, folder);
  const state = await readTasksState(root, folder);

  let dropped = 0;
  for (const id of Object.keys(state.held)) {
    const requirement = requirements.find((entry) => entry.id === id);
    if (!requirement || !['in-progress', 'blocked'].includes(requirement.status)) {
      await release(root, id, folder);
      dropped += 1;
    }
  }

  const result = await refresh(root, folder);
  const count = (many, word) => `${many} ${word}${many === 1 ? '' : 's'}`;
  console.log(`✔ Rebuilt ${folder}/.state/ from the folder (${count(requirements.length, 'requirement')}, ${count(dropped, 'stale holder')} dropped)`);
  for (const path of result.skipped) console.log(`  ! skipped, no generated header: ${path}`);
}

export { stageByNumber };
