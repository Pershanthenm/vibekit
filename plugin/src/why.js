import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { listAsks } from './folder/asks.js';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { listRequirements } from './folder/requirements.js';
import { readAssumptions } from './folder/workflow.js';
import { allSections } from './sources.js';
import { readText } from './fsutil.js';

/**
 * Every line has a why. Specification §36.
 *
 * "Every statement in the folder traces to a source section, a human answer, an assumption, or a
 * memory." The chain already exists in the files — requirements carry `source:`, assumptions
 * carry their ask id, commits carry `VibeKit-Requirement` — so this walks it rather than keeping
 * a separate index that could disagree with them.
 *
 * The last link is the point of the whole command. §36: "a developer can see that a behaviour
 * rests on an unconfirmed assumption before they build on top of it." A chain that stopped at the
 * requirement would be a nicer `git blame`; stopping at the assumption is what makes it worth
 * running.
 */

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

/** The requirement a line was written for, from the commit that wrote it. */
export function requirementAt(root, path, line = null) {
  const blame = line
    ? git(root, ['blame', '-L', `${line},${line}`, '--porcelain', '--', path])
    : git(root, ['log', '-1', '--format=%H', '--', path]);
  const sha = line ? blame.split(/\s/)[0] : blame.trim();
  // Every field, always: a caller reading `commit.criteria.length` on the no-commit path is the
  // ordinary case, not an edge one — most files have no VibeKit commit behind them yet.
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return { sha: null, id: null, subject: null, criteria: [] };

  const message = git(root, ['show', '-s', '--format=%B', sha]);
  return {
    sha,
    id: message.match(/^VibeKit-Requirement:\s*([\w.-]+)/m)?.[1]
      // A commit written before the trailers existed still usually names the requirement.
      ?? message.match(/\b((?:REQ|MIG|BUG)-[\w.-]+)\b/)?.[1]
      ?? null,
    subject: message.split('\n')[0],
    criteria: [...new Set([...message.matchAll(/\b(AC-\d+)\b/g)].map((match) => match[1]))],
  };
}

/** Requirements whose `## Approach` names this path — the link before anything is committed. */
export const requirementsNaming = (requirements, path) => requirements.filter((requirement) => {
  const named = `${requirement.approach}\n${requirement.verification}`;
  return named.includes(path) || named.includes(path.split('/').pop());
});

/**
 * The chain for one path, optionally one line.
 *
 * Every link is returned even when the one above it is missing, because "this code belongs to no
 * requirement" is the most useful thing this command can tell you.
 */
export async function chainFor(root, target, { folder = DEFAULT_FOLDER, line = null } = {}) {
  const path = relative(root, join(root, target)).split('\\').join('/');
  const [requirements, asks, assumptions, sections] = await Promise.all([
    listRequirements(root, folder),
    listAsks(root, folder),
    readAssumptions(root, folder),
    allSections(root, folder),
  ]);

  const commit = requirementAt(root, path, line);
  const byApproach = requirementsNaming(requirements, path);
  const requirement = requirements.find((entry) => entry.id === commit.id) ?? byApproach[0] ?? null;

  const links = [{ kind: 'file', text: line ? `${path}:${line}` : path }];

  if (!requirement) {
    links.push({
      kind: 'none',
      text: commit.sha
        ? `written by ${commit.sha.slice(0, 7)} "${commit.subject}", which names no requirement`
        : 'no commit and no requirement names this file',
      warn: 'Nothing traces this to something the business asked for. That is the gap, not a missing feature of this command.',
    });
    return { path, line, requirement: null, links, commit };
  }

  // Which criterion. The commit's own AC ids are the most precise; the Verification mapping is
  // the fallback, and it is what the reviewer wrote rather than what an agent claimed.
  const named = commit.criteria.length
    ? requirement.acceptance.filter((criterion) => commit.criteria.includes(criterion.id))
    : requirement.acceptance.filter((criterion) => requirement.verification.split('\n')
      .some((row) => row.includes(criterion.id) && (row.includes(path) || row.includes(path.split('/').pop()))));

  links.push({
    kind: 'requirement',
    id: requirement.id,
    text: `${requirement.id} ${requirement.title}`,
    detail: `status ${requirement.status}${requirement.size ? ` · size ${requirement.size}` : ''}`,
  });

  for (const criterion of (named.length ? named : requirement.acceptance).slice(0, 3)) {
    links.push({ kind: 'criterion', id: criterion.id, text: `acceptance criterion ${criterion.id} ("${criterion.text}")` });
  }

  // The source section, cited as the business numbers it.
  if (requirement.source) {
    const [sourceId, cite] = requirement.source.split(/\s*§\s*|\s*#\s*/);
    // No falling back to another section of the same document. Quoting §1 when the requirement
    // cited §9.9 would present a different paragraph as the thing that was asked for, which is
    // worse than reporting the citation as broken.
    const section = cite
      ? sections.find((entry) => entry.source === sourceId && entry.number === cite)
      : sections.find((entry) => entry.source === sourceId);
    links.push(section
      ? { kind: 'source', text: `${section.source} §${section.number} ${section.title}`.trim(), path: section.path, quote: firstSentence(section.body) }
      : { kind: 'source', text: requirement.source, warn: `${requirement.source} is cited but there is no such section in product/sources/.` });
  } else {
    links.push({ kind: 'source', text: 'no source cited', warn: 'This requirement cites nothing, so no one can check it against what was asked for.' });
  }

  // The human answer that settled it. `answerAsk` signs the body with "— who, when", so the
  // attribution is read from there rather than from a field that does not exist.
  for (const ask of asks.filter((entry) => entry.for === requirement.id && entry.answer)) {
    const signature = ask.answer.match(/^—\s*(.+?),\s*(\d{4}-\d{2}-\d{2})\s*$/m);
    const body = ask.answer.replace(/^—.*$/m, '').trim();
    links.push({
      kind: 'answer',
      text: `${ask.id} answered${signature ? ` ${signature[2]} by ${signature[1]}` : ''}: "${firstSentence(body)}"`,
    });
  }

  // §36 — the last line, and the reason the command exists.
  for (const id of requirement.assumes) {
    const assumption = assumptions.find((entry) => entry.id === id);
    links.push(assumption
      ? {
        kind: 'assumption',
        text: `assumption ${assumption.id} (${firstSentence(assumption.text)})`,
        warn: assumption.confidence === 'low'
          ? 'This behaviour rests on a low-confidence assumption nobody has confirmed.'
          : null,
      }
      : { kind: 'assumption', text: `${id}, which is not in workflow/assumptions.md`, warn: 'The requirement assumes something nobody wrote down.' });
  }

  return { path, line, requirement, links, commit };
}

const firstSentence = (text) => String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s/)[0].trim().slice(0, 160);

export function renderChain(chain) {
  const out = [chain.links[0].text];
  for (const link of chain.links.slice(1)) {
    out.push(`  ← ${link.text}${link.detail ? `  [${link.detail}]` : ''}`);
    if (link.quote) out.push(`      "${link.quote}"`);
    if (link.warn) out.push(`      ! ${link.warn}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- the matrix (§50)

/**
 * §50 — "The traceability matrix is not a document anyone maintains; it is `vibekit why` run
 * across the folder."
 *
 * So it is generated from the same links, and a broken one is shown as broken. A matrix that
 * quietly omitted the rows it could not complete would be a matrix that always looks full.
 */
export async function traceMatrix(root, { folder = DEFAULT_FOLDER, all = false } = {}) {
  const [requirements, sections] = await Promise.all([
    listRequirements(root, folder),
    allSections(root, folder),
  ]);

  const wanted = all ? requirements : requirements.filter((requirement) => requirement.status === 'done');
  const rows = [];

  for (const requirement of wanted) {
    const [sourceId, cite] = (requirement.source ?? '').split(/\s*§\s*|\s*#\s*/);
    const section = sections.find((entry) => entry.source === sourceId && entry.number === cite);
    const sha = requirementAt(root, `${folder}/product/requirements/${requirement.id}.md`).sha;

    for (const criterion of requirement.acceptance) {
      const proof = requirement.verification.split('\n').find((row) => row.includes(criterion.id));
      rows.push({
        source: section ? `${section.source} §${section.number}` : (requirement.source ?? null),
        sourceOk: Boolean(section),
        requirement: requirement.id,
        title: requirement.title,
        criterion: criterion.id,
        behaviour: criterion.text,
        test: proof ? proof.replace(/^[-*|\s]*/, '').replace(new RegExp(`^.*?\\b${criterion.id}\\b[\\s:|—-]*`), '').trim() : null,
        commit: sha ? sha.slice(0, 7) : null,
        status: requirement.status,
      });
    }

    if (!requirement.acceptance.length) {
      rows.push({
        source: requirement.source ?? null,
        sourceOk: Boolean(section),
        requirement: requirement.id,
        title: requirement.title,
        criterion: null,
        behaviour: null,
        test: null,
        commit: sha ? sha.slice(0, 7) : null,
        status: requirement.status,
      });
    }
  }

  const broken = rows.filter((row) => !row.source || !row.sourceOk || !row.criterion || !row.test || !row.commit);
  return { rows, broken, complete: rows.length > 0 && broken.length === 0 };
}

export const renderMatrix = (matrix) => [
  '| Source | Requirement | Criterion | Behaviour | Proved by | Commit |',
  '| --- | --- | --- | --- | --- | --- |',
  ...matrix.rows.map((row) => [
    '',
    row.sourceOk ? row.source : `**${row.source ?? 'none'}**`,
    row.requirement,
    row.criterion ?? '**none**',
    (row.behaviour ?? '—').replace(/\|/g, '\\|'),
    row.test ? row.test.replace(/\|/g, '\\|') : '**not proved**',
    row.commit ?? '**uncommitted**',
    '',
  ].join(' | ').trim()),
].join('\n');
