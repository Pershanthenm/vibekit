import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseGuardrails } from './checks.js';
import { parseCheckpoint, writeCheckpoint } from './checkpoint.js';
import { DEFAULT_FOLDER } from './layout.js';
import { appendLog, parseRequirement, requirementPath } from './requirements.js';
import { readText } from '../fsutil.js';

/**
 * Not trusting what the last session said about itself. Specification §60, "Hardening".
 *
 * Two mechanisms, and the reason for both is the same: an agent's own account of its progress is
 * the least reliable thing in the repository, because it was written by the thing being assessed.
 *
 *   * **Checkpoints are verified, not trusted.** A `done:` line may only claim what `verify` can
 *     confirm. On resume the claim is checked and rewritten to what actually passed, and a
 *     checkpoint that claimed more is logged as a `claim` finding against the session that wrote
 *     it. The agent never gets to inherit its own optimism.
 *   * **Worktree reconciliation.** Nothing in an unreconciled worktree is built upon. Files that
 *     changed since the checkpoint and are not described by it are listed to the agent with the
 *     diff, and the first instruction is to keep, revert or describe each one.
 */

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

/** The tests a checkpoint's `done:` line claims, by the ids it names. */
export const claimedCriteria = (checkpoint) => [
  ...new Set([...String(parseCheckpoint(checkpoint).done ?? '').matchAll(/\bAC-(\d+)\b/gi)].map((match) => `AC-${match[1]}`)),
];

/**
 * Check a checkpoint's claims against what passed, and rewrite it to the truth.
 *
 * `prove` is injected: it is `vibekit verify --quick` in practice, and a function in a test. That
 * is deliberate — a verification that could only run against a real build could not itself be
 * tested, and this is the mechanism the whole resume path rests on.
 */
export async function verifyCheckpoint(root, id, { folder = DEFAULT_FOLDER, prove } = {}) {
  const path = requirementPath(root, id, folder);
  const text = await readText(path);
  if (text === null) throw new Error(`No requirement ${id}.`);

  const requirement = parseRequirement(id, text);
  const checkpoint = requirement.checkpoint;
  if (!checkpoint.trim()) return { checked: false, claimed: [], passed: [], overclaimed: [], why: 'there is no checkpoint to check' };

  const claimed = claimedCriteria(checkpoint);
  if (!claimed.length) {
    return { checked: false, claimed: [], passed: [], overclaimed: [], why: 'the done: line names no criterion, so there is nothing to confirm' };
  }

  const passed = await prove(claimed);
  const overclaimed = claimed.filter((criterion) => !passed.includes(criterion));
  if (!overclaimed.length) return { checked: true, claimed, passed, overclaimed: [], why: null };

  // Rewritten rather than flagged and left: the next agent reads the checkpoint, not the report.
  const values = parseCheckpoint(checkpoint);
  const corrected = {
    ...values,
    done: passed.length ? `${passed.join(' · ')} (corrected on resume)` : 'nothing verified (corrected on resume)',
    open: [values.open, `${overclaimed.join(', ')} were claimed done and did not pass`].filter(Boolean).join('; '),
  };
  await writeCheckpoint(root, id, corrected, { folder });
  await appendLog(root, id, `claim: the checkpoint claimed ${overclaimed.join(', ')} done; verify did not confirm ${overclaimed.length === 1 ? 'it' : 'them'}`, folder);

  return {
    checked: true,
    claimed,
    passed,
    overclaimed,
    finding: {
      code: 'claim',
      severity: 'error',
      message: `${id}'s checkpoint claimed ${overclaimed.join(', ')} as done and verify did not confirm ${overclaimed.length === 1 ? 'it' : 'them'}.`,
    },
    why: 'the done: line has been rewritten to what actually passed',
  };
}

/**
 * What changed in the worktree since the checkpoint's commit, and is not described by it.
 *
 * A file the checkpoint's `in hand:` line already names is not a surprise; anything else is, and
 * the agent is told to reconcile it before continuing. Denied paths are not offered as a choice:
 * §60 reverts them automatically and logs it.
 */
export async function reconcile(root, id, { folder = DEFAULT_FOLDER, apply = false } = {}) {
  const text = await readText(requirementPath(root, id, folder));
  if (text === null) throw new Error(`No requirement ${id}.`);
  const requirement = parseRequirement(id, text);
  const checkpoint = parseCheckpoint(requirement.checkpoint);

  const changed = git(root, ['status', '--porcelain'])
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    // The folder's own state is not work in progress, and neither is the requirement file the
    // checkpoint was just written into.
    .filter((path) => !path.startsWith(`${folder}/.state/`) && !path.includes(`product/requirements/${id}.md`));

  const described = String(`${checkpoint.hand ?? ''} ${checkpoint.next ?? ''} ${checkpoint.read ?? ''}`);
  const guardrails = parseGuardrails((await readText(join(root, folder, 'standards/guardrails.md'))) ?? '');
  const denied = guardrails.deniedPaths
    .map((entry) => entry.path)
    .filter((path) => path && !/^TODO/i.test(path));

  const isDenied = (path) => denied.some((pattern) => {
    const prefix = pattern.replace(/\*+$/, '');
    return prefix && path.startsWith(prefix);
  });

  const reverted = [];
  const undescribed = [];
  for (const path of changed) {
    if (isDenied(path)) {
      // Automatic, and logged: a denied path is not a judgement call for the resumed agent.
      if (apply) git(root, ['checkout', '--', path]);
      reverted.push(path);
      continue;
    }
    if (!described.includes(path.split('/').pop())) undescribed.push(path);
  }

  if (apply && reverted.length) {
    await appendLog(root, id, `reverted on resume: ${reverted.join(', ')} — a denied path changed under the session`, folder);
  }

  return {
    changed,
    undescribed,
    reverted,
    clean: !changed.length,
    instruction: undescribed.length
      ? `${undescribed.length} file(s) changed since the checkpoint and are not described by it: ${undescribed.join(', ')}. Keep, revert or describe each one before continuing. Nothing in an unreconciled worktree is built upon.`
      : null,
    diff: undescribed.length ? git(root, ['diff', '--stat', '--', ...undescribed]).trim() : '',
  };
}

/**
 * §60 — if the requirement changed under a running session, the checkpoint is stale and the agent
 * re-plans from `## Approach` rather than continuing against criteria that no longer exist.
 *
 * Re-planning is the cheap half of the work. Continuing is the expensive mistake.
 */
export function checkpointDrift(requirement, { criteriaAt = null } = {}) {
  const checkpoint = parseCheckpoint(requirement.checkpoint);
  if (!requirement.checkpoint.trim()) return { stale: false, why: null };

  const now = requirement.acceptance.map((criterion) => `${criterion.id}:${criterion.text}`).join('|');
  if (criteriaAt && criteriaAt !== now) {
    return { stale: true, why: 'criteria changed', instruction: 'The criteria changed while the session was running. Re-plan from `## Approach`; the checkpoint describes work against criteria that no longer exist.' };
  }

  if (requirement.status === 'review') {
    return { stale: true, why: 'the requirement went to review', instruction: 'This went to review while the session was running. Read the review before continuing.' };
  }

  const named = claimedCriteria(requirement.checkpoint);
  const gone = named.filter((criterion) => !requirement.acceptance.some((entry) => entry.id === criterion));
  if (gone.length) {
    return { stale: true, why: `${gone.join(', ')} no longer exist`, instruction: `The checkpoint names ${gone.join(', ')}, which the requirement no longer has. Re-plan from \`## Approach\`.` };
  }
  return { stale: false, why: null, at: now, session: checkpoint.session };
}

/** The fingerprint a session records so drift can be detected on its next step. */
export const criteriaFingerprint = (requirement) =>
  requirement.acceptance.map((criterion) => `${criterion.id}:${criterion.text}`).join('|');
