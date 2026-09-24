import { join } from 'node:path';
import { entitiesFrom } from '../docs/arch/model.js';
import { PROMOTE_AFTER, distil as distilNotes, plan as planDistil } from '../distil.js';
import { planReverse, reverse as reverseRepo } from '../reverse.js';
import { readText } from '../fsutil.js';
import { folderName } from './folder.js';

/**
 * `vibekit reverse` and `vibekit distil`. Specification §41 and §30.
 *
 * Both turn something the repository already contains into something a human then decides about:
 * tests into draft requirements, session notes into proposed memories. Neither writes anything a
 * human has not been given the chance to read first, which is why both have a dry run.
 */

export async function reverse(options) {
  const { root, folder: chosen, 'dry-run': dryRun, json } = options;
  const folder = chosen ?? (await folderName(root));
  const entities = entitiesFrom((await readText(join(root, folder, 'product/entities.md'))) ?? '').map((entity) => entity.name);

  if (dryRun) {
    const planned = await planReverse(root, { folder, vocabulary: entities });
    if (json) return void console.log(JSON.stringify(planned, null, 2));

    console.log(`${planned.files} test file(s) · ${planned.drafts.length} would become a requirement`);
    for (const draft of planned.drafts) {
      console.log(`  ${draft.path}  →  ${draft.title}  (${draft.criteria.length} criteria)`);
    }
    for (const path of planned.unreadable) console.log(`  ! ${path} has no test case this can read`);
    console.log('');
    console.log('  Nothing written. Run without --dry-run to draft them.');
    return;
  }

  const result = await reverseRepo(root, { folder, vocabulary: entities });
  if (json) return void console.log(JSON.stringify(result, null, 2));

  if (!result.files) {
    console.log('No test files found, so there is nothing to reverse.');
    console.log('  `vibekit reverse` drafts a requirement per test class. A repo with no tests has no intent written down anywhere.');
    return;
  }

  console.log(`✔ ${result.written.length} requirement(s) drafted from ${result.files} test file(s)`);
  for (const draft of result.written) {
    console.log(`    ${draft.id}  ${draft.title}  (${draft.criteria.length} criteria from ${draft.path})`);
  }
  for (const path of result.unreadable) console.log(`  ! ${path} has no test case this can read`);

  if (result.written.length) {
    console.log('');
    console.log('  Every one is `status: draft` and `confidence: low`. Each criterion was inferred from a test');
    console.log('  name, which is the closest thing a legacy codebase has to a statement of intent and still');
    console.log('  only an approximation of one. Read each against its test before setting it ready.');
  }
}

export async function distil(options) {
  const { root, folder: chosen, 'dry-run': dryRun, json } = options;
  const folder = chosen ?? (await folderName(root));

  const result = dryRun ? await planDistil(root, { folder }) : await distilNotes(root, { folder });
  if (json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`${result.notes} session note(s) · ${result.remembered} remember: line(s)`);

  if (!result.proposals.length && !result.refused.length) {
    console.log('');
    console.log('Nothing new to propose. Agents leave notes in memory/sessions/; distil turns the repeated ones into proposals.');
  }

  if (dryRun) {
    for (const proposal of result.proposals) {
      console.log(`  ${String(proposal.witnesses.length).padStart(2)}×  ${proposal.text.slice(0, 88)}`);
    }
    console.log('');
    console.log('  Nothing written. Run without --dry-run to open them as proposals.');
  } else {
    for (const opened of result.opened) {
      console.log(`  ${opened.id}  ${String(opened.witnesses).padStart(2)}×  ${opened.text.slice(0, 80)}`);
    }
    if (result.opened.length) {
      console.log('');
      console.log('  Each is a proposal, not a memory. A human accepts it: `vibekit ask answer <id> "<decision>"`.');
    }
  }

  for (const refused of result.refused) {
    console.log(`  ! not proposed: ${refused.text.slice(0, 70)}`);
    console.log(`      ${refused.refused}`);
  }

  if (result.promote.length) {
    console.log('');
    console.log(`${result.promote.length} memory(ies) have matched more than ${PROMOTE_AFTER} times and belong in a rule rather than a hint:`);
    for (const memory of result.promote) {
      console.log(`  ${memory.id}  matched ${memory.matched}×  → promote into standards/, map.md or a skill`);
    }
  }

  for (const memory of result.dead) {
    console.log(`  ! ${memory.id} has no topic, so nothing can ever fetch it. It is weight in a file that is always loaded.`);
  }
}
