import { join } from 'node:path';
import {
  doneBetween, evidence as buildEvidence, lastTag, release as cutRelease,
  renderChangelog, revert as revertRequirement, rollback, tagRelease,
} from '../release.js';
import { writeText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit release`, `ship`, `changelog`, `revert` and `evidence`.
 * Specification §43, §47 and §50.
 *
 * `ship` is the verb the spec uses for the deploy half (`ship rollback`, smoke after deploy) and
 * `release` for the tag half. They share this file because they share the refusal: neither puts a
 * version number on work that is not done.
 */

export async function release(options) {
  const { root, args, folder: chosen, rollback: rollbackTo, phase, force, why, json } = options;
  const folder = chosen ?? (await folderName(root));

  if (rollbackTo) {
    const result = await rollback(root, rollbackTo, { folder, note: why ?? null });
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ rolled back to ${result.tag}`);
    console.log(`    ${result.requirement} opened: ${result.title}`);
    console.log('');
    console.log('  Redeploying is the pipeline\'s job. This recorded the rollback and opened the hotfix,');
    console.log('  so the incident is in the repository rather than in somebody\'s memory.');
    return;
  }

  const [version] = args.filter((argument) => !argument.startsWith('-'));
  const result = await cutRelease(root, { folder, version: version ?? null, phase: phase ?? null, force });

  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.log('✖ Not cutting a release:');
    for (const blocker of result.blockers) console.log(`  - ${blocker}`);
    console.log('');
    console.log('  A version number over unfinished work is a claim somebody acts on, and by the time it is');
    console.log('  contradicted it is in production. --force overrides this and records that it was forced.');
    process.exitCode = 1;
    return;
  }

  console.log(`✔ ${result.version}  (${result.bump.level}: ${result.bump.why})`);
  console.log(`    ${result.requirements.length} requirement(s) since ${result.previous ?? 'the beginning'}`);
  for (const requirement of result.requirements) console.log(`      ${requirement.id} ${requirement.title}`);
  console.log('    CHANGELOG.md updated');
  console.log(`    ${folder}/.state/releases.json recorded`);

  // Tagging is the last step and it is separate: everything above is reversible with an edit,
  // and a tag is not.
  try {
    tagRelease(root, result.version, result.entry);
    console.log(`    tagged ${result.version} (annotated, carrying the changelog)`);
  } catch (error) {
    console.log(`  ! not tagged: ${String(error.message).split('\n')[0]}`);
    console.log('    Everything else is written. Tag it by hand, or fix the repository and run this again.');
  }

  console.log('');
  console.log('  Next: vibekit report --all, which is what a phase gate produces alongside the evidence bundle.');
}

/**
 * §23 — `ship` is the deploy half: smoke against what is deployed, and rollback when it is red.
 *
 * It does not deploy. That is the pipeline's job, and a tool that deployed from a laptop would
 * bypass the checks the pipeline exists to run. What it does is the part that decides whether the
 * deploy worked, and what to do when it did not.
 */
export async function ship(options) {
  const { root, args, folder: chosen, url, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [action] = args;

  if (action === 'rollback') {
    return release({ ...options, args: [], rollback: args[1] ?? lastTag(root), why: options.why ?? 'smoke failed against the deployed application' });
  }
  if (action === 'release') return release({ ...options, args: args.slice(1) });

  const { smoke, smokeCommand, verdict } = await import('../smoke.js');
  const tag = lastTag(root);

  if (action === 'smoke' || url) {
    const results = await smoke(root, { folder, url: url ?? null, allowPrivate: Boolean(options['allow-private']) });
    const said = verdict(results, { tag });

    if (json) return void console.log(JSON.stringify({ results, verdict: said }, null, 2));

    if (results.command) {
      console.log(`${results.command.ok ? '✔' : '✖'} ${results.command.command}  (exit ${results.command.code})`);
      if (!results.command.ok) {
        for (const line of String(results.command.output).trim().split('\n').slice(-8)) console.log(`    ${line}`);
      }
    }
    for (const probed of results.probes) {
      console.log(`${probed.ok ? '✔' : '✖'} ${probed.url}  ${probed.status ?? '—'}  ${probed.ms}ms  · ${probed.means}`);
      if (!probed.ok) console.log(`    ${probed.why}`);
    }

    console.log('');
    console.log(`  ${said.line}`);
    if (said.next) console.log(`  ${said.next}`);
    if (said.ok === false) process.exitCode = 1;
    return;
  }

  const command = await smokeCommand(root, folder);
  console.log(`vibekit ship · ${tag ? `last release ${tag}` : 'nothing released yet'}`);
  console.log('');
  console.log('  ship release [version]        cut and tag a release from the base branch');
  console.log('  ship smoke --url <address>    run the smoke against what is deployed there');
  console.log('  ship rollback [tag]           record a rollback and open a pre-filled hotfix requirement');
  console.log('');
  console.log(`  smoke command: ${command ?? `none in ${folder}/product/map.md — add a \`smoke\` line to the Commands block`}`);
  console.log('');
  console.log('  Smoke runs against the deployed application, not the built one: a green build with a red');
  console.log('  smoke is a deploy problem, and a rollback is the response. Deploying is your pipeline\'s job.');
}

export async function changelog(options) {
  const { root, args, folder: chosen, out, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [from, to] = args.filter((argument) => !argument.startsWith('-'));

  const shipped = await doneBetween(root, from ?? lastTag(root), to ?? 'HEAD', folder);
  const entry = renderChangelog(to ?? 'unreleased', shipped, { from: from ?? lastTag(root) });

  if (json) return void console.log(JSON.stringify({ from: from ?? lastTag(root), to: to ?? 'HEAD', requirements: shipped.map((requirement) => requirement.id) }, null, 2));
  if (out) {
    await writeText(out, entry);
    console.log(`✔ ${out}`);
    return;
  }
  console.log(entry);
  if (shipped.some((requirement) => !requirement.source)) {
    console.log('  ! A line with no source cited is a change nobody can answer "who asked for that" about.');
  }
}

export async function revert(options) {
  const { root, args, folder: chosen, why, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [id] = args.filter((argument) => !argument.startsWith('-'));
  if (!id) throw new Error('Usage: vibekit revert REQ-014 [--why "<reason>"]');

  const result = await revertRequirement(root, id, { folder, reason: why ?? null });
  if (json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`✔ ${result.id} back to ready${result.merge ? ` (its merge was ${result.merge.slice(0, 7)})` : ''}`);
  if (result.dependents.length) {
    console.log(`    ${result.dependents.join(', ')} set to review: each waits on ${result.id}, and what it was built on is no longer there`);
  }
  console.log('');
  console.log(`  The revert of the code itself is a git operation you run: \`git revert -m 1 ${result.merge ? result.merge.slice(0, 7) : '<merge>'}\`.`);
  console.log('  This moved the spec, which is the half that is usually forgotten.');
}

export async function evidence(options) {
  const { root, args, folder: chosen, phase, out, json } = options;
  const folder = chosen ?? (await folderName(root));
  const [id] = args.filter((argument) => !argument.startsWith('-'));

  const bundle = await buildEvidence(root, { folder, id: id ?? null, phase: phase ?? null });
  if (json) return void console.log(JSON.stringify(bundle, null, 2));

  const target = out ?? join(root, `evidence-${id ?? (phase === undefined || phase === null ? 'all' : `phase-${phase}`)}.md`);
  await writeText(target, bundle.markdown);
  console.log(`✔ ${target}`);
  console.log(`    ${bundle.requirements.length} requirement(s), ${bundle.approvals.length} gate approval(s)`);
  console.log('');
  console.log('  Written outside the folder on purpose: it is a bundle of what the folder already says,');
  console.log('  and a copy inside it would be one more thing that can disagree with the originals.');
}
