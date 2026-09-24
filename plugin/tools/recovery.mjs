/**
 * The recovery fixture. §60.  `npm run recovery [-- --seed N] [-- --variant after-checkpoint]`
 *
 * Start a requirement on a fixture repo, kill the session, resume, require `tested` with the same
 * evidence a straight run produces. Three variants; a release that fails this does not ship.
 * The logic lives in src/recovery.js so `vibekit replay --recovery` runs the same thing.
 *
 * With `--implement <root>` this file is the child the parent kills: the scripted implementer,
 * reporting each step on stdout so the parent knows when to pull the plug.
 */
import { implement, runRecovery, VARIANTS } from '../src/recovery.js';

const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); return at === -1 ? null : args[at + 1] ?? null; };

if (flag('--implement')) {
  const root = flag('--implement');
  const report = (kind, step) => process.stdout.write(kind === 'step' ? `step ${step}\n` : `${kind} ${step}\n`);
  await implement(root, {
    home: flag('--home'),
    runner: flag('--runner') ?? 'claude-code',
    from: Number.parseInt(flag('--from') ?? '1', 10),
    breakAt: flag('--break-at') ? Number.parseInt(flag('--break-at'), 10) : null,
    report,
  });
  process.exit(0);
}

const variant = flag('--variant');
if (variant && !VARIANTS.includes(variant)) {
  console.error(`--variant takes one of: ${VARIANTS.join(', ')}`);
  process.exit(2);
}
const outcome = await runRecovery({
  seed: flag('--seed') ? Number.parseInt(flag('--seed'), 10) : undefined,
  variants: variant ? [variant] : undefined,
  log: console.log,
});
process.exit(outcome.ok ? 0 : 1);
