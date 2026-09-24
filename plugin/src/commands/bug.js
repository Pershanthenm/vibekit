import { SEVERITIES, VERDICTS, assess as assessBug, bugBlockers, createBug, placementFor, readBug, test as testBug } from '../folder/bugs.js';
import { listRequirements } from '../folder/requirements.js';
import { folderName, req } from './folder.js';

/**
 * `vibekit bug`. Specification §23 and §68.
 *
 *   vibekit bug "<text>" --test <path> [--severity high|medium|low] [--found-on REQ] [--criterion "…"]
 *   vibekit bug assess BUG-001 --cause "…" [--evidence "…"] [--test <path>]
 *   vibekit bug fix BUG-001 [--as implementer]
 *   vibekit bug test BUG-001
 *   vibekit bug list
 *
 * Three jobs kept apart on purpose: the assistant that fixes reads the assessment as a given and
 * cannot redefine the problem to one it finds easier, and the assistant that verifies tests the
 * symptom the person reported rather than the one the fixer decided to solve.
 */

const usage = () => [
  'Usage',
  '  vibekit bug "<what is wrong>" --test <path to the failing test> [--severity medium] [--found-on REQ-014]',
  '  vibekit bug assess BUG-001 --cause "<what is actually wrong and why>" [--evidence "…"]',
  '  vibekit bug fix BUG-001 [--as implementer]        start the repair on its own branch',
  '  vibekit bug test BUG-001                          run it and record the verdict: verified · partial · failed',
  '  vibekit bug list',
  '',
  '  A bug is a requirement: it goes through the same build loop, the same review and the same',
  '  definition of done. What makes it a bug is the failing test it carries — no test, no bug.',
].join('\n');

export async function bug(options) {
  const { root, args, folder: chosen, json, as: role } = options;
  const folder = chosen ?? (await folderName(root));
  const [first, ...rest] = args;
  const by = role ? 'agent' : 'human';

  if (!first) return void console.log(usage());

  if (first === 'list') {
    const bugs = (await listRequirements(root, folder)).filter((entry) => entry.kind === 'bug');
    if (json) return void console.log(JSON.stringify(bugs.map(({ id, title, severity, status, foundBy, test }) => ({ id, title, severity, status, foundBy, test })), null, 2));
    if (!bugs.length) return void console.log('No bugs. A finding inside a requirement\'s own scope is fixed there and never becomes one.');
    for (const entry of bugs) {
      console.log(`${entry.id}  ${(entry.severity ?? '-').padEnd(6)} ${entry.status.padEnd(11)} ${entry.title}${entry.test ? '' : '   ! no reproducing test'}`);
    }
    return;
  }

  if (first === 'assess') {
    const [id] = rest;
    if (!id) throw new Error(usage());
    const result = await assessBug(root, id, { cause: options.cause, evidence: options.evidence ?? null, test: options.test ?? null, by: role ?? 'human' }, folder);
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`✔ ${id} assessed. Cause: ${result.cause}`);
    console.log(`  Reproduced by: ${result.test ?? 'nothing yet — name the failing test with --test before fixing'}`);
    console.log(`  Next: vibekit bug fix ${id}`);
    return;
  }

  if (first === 'fix') {
    const [id] = rest;
    if (!id) throw new Error(usage());
    const entry = await readBug(root, id, folder);
    const blockers = bugBlockers(entry);
    if (blockers.length) throw new Error(`${id} is not work yet:\n${blockers.map((line) => `  - ${line}`).join('\n')}`);
    if (!entry.assessment?.trim() && !/## Assessment/.test(entry.text)) {
      console.log(`  ! ${id} has no assessment. Fixing an unassessed bug is fixing a nearby symptom; run \`vibekit bug assess ${id} --cause "…"\` first.`);
    }
    if (entry.status === 'draft') await req({ ...options, args: ['ready', id] });
    return req({ ...options, args: ['start', id], as: role ?? 'implementer' });
  }

  if (first === 'test') {
    const [id] = rest;
    if (!id) throw new Error(usage());
    const { recordEvidence } = await import('../folder/evidence.js');
    const result = await testBug(root, id, { by: role ?? 'human', run: (target, bugId, { folder: inFolder }) => recordEvidence(target, bugId, { folder: inFolder }) }, folder);
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`${result.verdict === 'verified' ? '✔' : '✖'} ${id}: ${result.verdict.toUpperCase()} — ${result.why}`);
    if (result.verdict !== 'verified') {
      console.log(`  Back to the board with the verdict attached. One of: ${VERDICTS.join(' · ')}; a bug closes only on verified.`);
      process.exitCode = 1;
    } else {
      console.log(`  Next: a reviewer approves, then a person sets \`vibekit req done ${id}\`.`);
    }
    return;
  }

  // vibekit bug "<text>": open, assess and test in one go when the flags allow; open only otherwise.
  const title = [first, ...rest].join(' ').trim();
  const severity = options.severity ?? 'medium';
  if (!SEVERITIES.includes(String(severity).toLowerCase())) throw new Error(`--severity takes one of ${SEVERITIES.join(', ')}.`);
  const created = await createBug(root, {
    title, severity, by,
    foundBy: options['found-by'] ?? (role ? `${role}` : 'human'),
    foundOn: options['found-on'] ?? null,
    introducedBy: options['introduced-by'] ?? null,
    test: options.test ?? null,
    criterion: options.criterion ?? null,
  }, folder);

  if (json) return void console.log(JSON.stringify(created, null, 2));
  console.log(`✔ ${created.id} opened · severity ${severity} · ${created.placement.why}`);
  const blockers = bugBlockers(await readBug(root, created.id, folder));
  if (blockers.length) {
    console.log('  Not work yet:');
    for (const line of blockers) console.log(`    - ${line}`);
  }
  console.log(`  Then: vibekit bug assess ${created.id} --cause "…" → vibekit bug fix ${created.id} → vibekit bug test ${created.id}`);
  if (options.cause) await assessBug(root, created.id, { cause: options.cause, evidence: options.evidence ?? null, by: role ?? 'human' }, folder);
  return created;
}

export { placementFor };
