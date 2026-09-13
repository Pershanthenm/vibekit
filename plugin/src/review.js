import { join } from 'node:path';
import { repoState } from './evidence.js';
import { git } from './git.js';
import { readFrontMatter } from './features.js';
import { readText } from './fsutil.js';

export const REVIEW_FILE = 'review.md';
export const VERDICTS = ['approved', 'changes-requested'];

export const reviewPath = (root, featureId) => join(root, 'specs', 'features', featureId, REVIEW_FILE);

/**
 * A review is only meaningful for the code it actually read, so it records the commit it
 * reviewed. A review of an earlier commit is treated the way stale evidence is: it does not
 * count, and the gate says which commit it was for.
 */
// An unticked BLOCKER or MAJOR blocks `done` — but only when something is written after the
// label. The template ships empty placeholders, and those are not findings.
const FINDING = /^-\s*\[ \]\s*(BLOCKER|MAJOR)\b/i;
const openFindings = (text) => text
  .split(/\r?\n/)
  .filter((line) => FINDING.test(line) && line.replace(FINDING, '').replace(/^\s*:/, '').trim().length > 0)
  .length;

export function parseReview(text) {
  if (!text?.trim()) return null;
  const meta = readFrontMatter(text);
  return {
    verdict: (meta.verdict ?? '').trim(),
    commit: (meta.commit ?? '').trim(),
    reviewer: (meta.reviewer ?? '').trim(),
    open: openFindings(text),
  };
}

export async function loadReview(root, featureId) {
  return parseReview(await readText(reviewPath(root, featureId)));
}

/**
 * Recording the review is itself a commit, so HEAD moves the moment a reviewer writes their
 * verdict down. A review therefore still counts when the only thing that changed since is the
 * review file: anything else means code moved on and was not looked at.
 */
function onlyTheReviewChanged(root, from, to, featureId) {
  try {
    const changed = git(root, 'diff', '--name-only', `${from}..${to}`).split(/\r?\n/).filter(Boolean);
    return changed.length > 0 && changed.every((path) => path === `specs/features/${featureId}/${REVIEW_FILE}`);
  } catch {
    return false;
  }
}

export async function reviewProblems(root, project, feature) {
  if (!project.workflow.review) return [];
  const rerun = `run /vibekit:review-feature on ${feature.id.slice(0, 3)} and record the verdict in specs/features/${feature.id}/review.md`;
  const review = await loadReview(root, feature.id);
  if (!review) return [`review: no code review recorded — ${rerun}`];
  if (!VERDICTS.includes(review.verdict)) {
    return [`review: review.md has no verdict (front matter needs \`verdict: ${VERDICTS.join('` or `')}\`) — ${rerun}`];
  }
  if (review.verdict === 'changes-requested') {
    return [`review: the reviewer asked for changes${review.open ? ` (${review.open} unresolved)` : ''} — address them, then ${rerun}`];
  }
  if (review.open) return [`review: ${review.open} blocking finding(s) still unticked in review.md`];

  const state = repoState(root);
  if (!state) return [];
  if (!review.commit) return [`review: review.md does not say which commit was reviewed (front matter needs \`commit: <sha>\`) — ${rerun}`];
  if (review.commit !== state.commit && !onlyTheReviewChanged(root, review.commit, state.commit, feature.id)) {
    return [`review: code changed since it was reviewed (${review.commit.slice(0, 8)} → ${state.commit.slice(0, 8)}) — ${rerun}`];
  }
  return [];
}

export const reviewTemplate = (featureId) => `---
verdict: changes-requested
commit:
reviewer:
---

# Review — ${featureId}

The verdict stays \`changes-requested\` until a reviewer changes it to \`approved\`. \`commit\` must be
the commit that was actually read: a review of older code does not satisfy the done gate.

## Findings

Tick an item once it is resolved. A \`BLOCKER\` or \`MAJOR\` left unticked blocks \`done\`.

- [ ] BLOCKER:
- [ ] MAJOR:
- [ ] MINOR:

## Checked

- [ ] Every acceptance criterion has a test that fails without the change
- [ ] No dependency points the wrong way across architecture boundaries
- [ ] Inputs validated at boundaries; authorisation checked server-side; no secrets committed
- [ ] Errors are handled and surfaced meaningfully
- [ ] The security baseline controls that apply to this feature are implemented
- [ ] Specs, plan and tasks reflect what was actually built
`;
