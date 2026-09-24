import { join } from 'node:path';
import { readFrontMatter } from '../frontmatter.js';
import { readText, writeAtomic } from '../fsutil.js';
import { checkpointProblems } from './checkpoint.js';
import { checkpointDrift, reconcile, verifyCheckpoint } from './reconcile.js';
import { DEFAULT_FOLDER } from './layout.js';
import { appendLog, listRequirements, readTasksState, release, requirementPath } from './requirements.js';
import { isOpen, listAsks } from './asks.js';
import { setFrontMatterValue } from '../frontmatter.js';

/**
 * Pausing and resuming a project. Specification §60.
 *
 * Session-level interruption is the checkpoint's job. This is the deliberate kind: stop for the
 * weekend, for a month, for a budget freeze.
 *
 * `paused` is its own state, distinct from `blocked`: blocked means waiting on a person, paused
 * means waiting on the project to restart. Setting paused work back to `ready` would be the one
 * mistake that matters here — something would auto-start against a plan nobody has re-checked.
 *
 * And resume "re-establishes ground truth rather than trusting the note". Everything below is
 * about not believing what the folder said three months ago.
 */

/** §60 — a pause over this many days means the code has probably moved under the project. */
export const STALE_AFTER_DAYS = 30;

export const RESUME_HEADING = '## Resume note';

export async function pause(root, { reason = null, folder = DEFAULT_FOLDER, now = () => new Date() } = {}) {
  const requirements = await listRequirements(root, folder);
  const held = (await readTasksState(root, folder)).held;
  const asks = (await listAsks(root, folder)).filter(isOpen);

  const inFlight = requirements.filter((requirement) => ['in-progress', 'blocked'].includes(requirement.status));
  const paused = [];
  const withoutCheckpoint = [];

  for (const requirement of inFlight) {
    if (checkpointProblems(requirement.checkpoint).length) withoutCheckpoint.push(requirement.id);

    // Holds are released so no requirement is stuck to a session that no longer exists — but
    // the status becomes `paused`, never `ready`, so nothing auto-starts on restart.
    await release(root, requirement.id, folder);
    await setStatusRaw(root, requirement.id, 'paused', folder);
    await appendLog(root, requirement.id, `paused${reason ? ` — ${reason}` : ''}`, folder);
    paused.push(requirement.id);
  }

  const note = renderResumeNote({ at: now(), reason, paused, requirements, asks, held, withoutCheckpoint });
  await writeResumeNote(root, note, folder);

  return { paused, asks: asks.length, withoutCheckpoint, note };
}

/**
 * Status is written directly rather than through `setStatus`.
 *
 * `setStatus` refuses moves that do not make sense for an agent mid-flow, and correctly so. A
 * pause is not that: it is the project owner stopping everything at once, and it has to work on
 * a requirement in any state.
 */
async function setStatusRaw(root, id, next, folder) {
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text !== null) await writeAtomic(path, setFrontMatterValue(text, 'status', next));
}

export function renderResumeNote({ at, reason, paused, requirements, asks, held, withoutCheckpoint }) {
  const blocked = requirements.filter((requirement) => requirement.status === 'blocked');
  const lines = [
    RESUME_HEADING,
    '',
    `Paused ${at.toISOString().slice(0, 10)}${reason ? ` — ${reason}` : ''}.`,
    '',
    `**In flight.** ${paused.length ? paused.join(', ') : 'nothing'}. Each is \`paused\`, not \`ready\`, so nothing starts itself.`,
    `**Blocked, and on whom.** ${blocked.length ? blocked.map((requirement) => `${requirement.id} (${requirement.status})`).join(', ') : 'nothing'}`,
    `**Open asks.** ${asks.length ? asks.map((ask) => `${ask.id}${ask.blocking ? ' (blocking)' : ''}`).join(', ') : 'none'}`,
    `**Holds released.** ${Object.keys(held).length ? Object.keys(held).join(', ') : 'none were held'}`,
  ];

  if (withoutCheckpoint.length) {
    // Worth naming rather than hiding: on restart these are the ones whose state has to be read
    // out of the diff, which is the expensive case §60 exists to avoid.
    lines.push('', `**No usable checkpoint.** ${withoutCheckpoint.join(', ')} — on resume their state has to be reconstructed from the worktree.`);
  }

  lines.push('', 'A paused project costs nothing: no sessions run and no caps tick. `vibekit resume` re-checks ground truth before anything restarts.', '');
  return lines.join('\n');
}

const statusPath = (root, folder) => join(root, folder, 'workflow/status.md');

async function writeResumeNote(root, note, folder) {
  const path = statusPath(root, folder);
  const text = (await readText(path)) ?? '';
  const pattern = new RegExp(`^${RESUME_HEADING}[\\s\\S]*?(?=\\n##[ \\t]|(?![\\s\\S]))`, 'm');
  const next = pattern.test(text) ? text.replace(pattern, note.trimEnd()) : `${text.trimEnd()}\n\n${note}`;
  await writeAtomic(path, next.endsWith('\n') ? next : `${next}\n`);
}

export const readResumeNote = async (root, folder = DEFAULT_FOLDER) => {
  const text = (await readText(statusPath(root, folder))) ?? '';
  return text.match(new RegExp(`^${RESUME_HEADING}([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'm'))?.[1]?.trim() ?? '';
};

export const isPaused = async (root, folder = DEFAULT_FOLDER) =>
  (await listRequirements(root, folder)).some((requirement) => requirement.status === 'paused');

/**
 * §60's resume table. Each row is something that may have changed while the project was cold,
 * and every one of them is a reason not to trust the note.
 *
 * This reports; it does not restart. A requirement returns to `in-progress` only where its
 * checkpoint and its criteria still stand, and anything that fails goes to `ready` with a log
 * line saying why — because re-planning is cheap and building on a stale plan is not.
 */
export async function resumeReport(root, { folder = DEFAULT_FOLDER, now = () => new Date(), checks = null, prove = null } = {}) {
  const [requirements, asks, profile, note] = await Promise.all([
    listRequirements(root, folder),
    listAsks(root, folder).then((all) => all.filter(isOpen)),
    readText(join(root, folder, 'profile.md')).then((text) => readFrontMatter(text ?? '')),
    readResumeNote(root, folder),
  ]);

  const pausedAt = note.match(/Paused (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  // Whole days only: a project stopped an hour ago has been cold for 0 days, not 1.
  const coldDays = pausedAt ? Math.max(0, Math.floor((now().valueOf() - new Date(pausedAt).valueOf()) / 86400000)) : null;
  const paused = requirements.filter((requirement) => requirement.status === 'paused');

  const rows = [
    {
      what: 'check and the test suite on main',
      why: 'the repo may have moved; somebody may have merged by hand',
      state: checks ? (checks.findings.some((finding) => finding.severity === 'error') ? 'problems to read first' : 'green') : 'not run',
    },
    {
      what: 'worktree reconciliation per paused requirement',
      why: 'uncommitted work is described before it is built on',
      state: paused.length ? `${paused.length} to reconcile` : 'nothing paused',
    },
    {
      what: 'checkpoint claims against verify',
      why: 'a done: line may only claim what verify can confirm; the agent never inherits its own optimism',
      state: prove ? 'checked' : 'run `vibekit verify --quick` to check them',
    },
    { what: 'dependencies', why: 'one may be stale, yanked, or newly vulnerable', state: 'run `vibekit check --deps`' },
    {
      what: 'prompt and spec versions',
      why: 'VibeKit may have upgraded; a prompt diff is shown before it is applied',
      state: `prompts ${profile.prompts ?? 'unrecorded'} · spec ${profile.spec ?? 'unrecorded'}`,
    },
    { what: 'source documents', why: 'a BRS may have been re-ingested; affected requirements go to review', state: 'check product/sources/' },
    {
      what: 'open asks',
      why: 'still open, and now older than the threshold',
      state: asks.length ? `${asks.length} open, oldest ${Math.max(...asks.map((ask) => ask.waitingDays ?? 0))} days` : 'none',
    },
    { what: 'tier mapping', why: 'strong, mid and cheap may point at different models than they did', state: 'run `vibekit tools rates`' },
  ];

  // §60's hardening, on the way back in. The order matters: a checkpoint is verified before it
  // is believed, the worktree is reconciled before anything is built on it, and a requirement
  // that changed underneath makes the checkpoint stale whatever it claims.
  const perRequirement = [];
  for (const requirement of paused) {
    const problems = checkpointProblems(requirement.checkpoint);
    const drift = checkpointDrift(requirement);
    const worktree = await reconcile(root, requirement.id, { folder }).catch(() => ({ undescribed: [], reverted: [], instruction: null }));

    const claims = prove
      ? await verifyCheckpoint(root, requirement.id, { folder, prove }).catch(() => null)
      : null;

    const blocked = problems.length || drift.stale || worktree.undescribed.length || claims?.overclaimed.length;
    perRequirement.push({
      id: requirement.id,
      title: requirement.title,
      // A checkpoint that verifies, a worktree that reconciles and criteria that have not changed
      // mean this continues from `next:`. Anything else re-plans from `## Approach`, which is the
      // cheap half of the work.
      continues: !blocked,
      why: problems.length ? `its checkpoint ${problems[0]}`
        : drift.stale ? drift.instruction
          : claims?.overclaimed.length ? `its checkpoint claimed ${claims.overclaimed.join(', ')} done and verify did not confirm ${claims.overclaimed.length === 1 ? 'it' : 'them'}; it has been rewritten to what passed`
            : worktree.undescribed.length ? worktree.instruction
              : 'its checkpoint stands; continue from `next:`',
      reverted: worktree.reverted,
      verified: claims ? { claimed: claims.claimed, passed: claims.passed, overclaimed: claims.overclaimed } : null,
    });
  }

  return {
    pausedAt,
    coldDays,
    stale: coldDays !== null && coldDays > STALE_AFTER_DAYS,
    note,
    rows,
    requirements: perRequirement,
  };
}
