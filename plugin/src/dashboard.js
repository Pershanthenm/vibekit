// The live tracker. Specification §57.
//
// One page, four cards, ordered by what needs a human most. Everything on it is the plain-language
// version: what it means, what happens if you choose each option, and why it matters, in words a
// product owner uses. Technical detail sits behind a "details" tap on every card.
//
// The bar is a decision the person can make in one read, without remembering anything from an
// earlier one — because the person reading it is on a phone, between other things.
//
// The whole state is plain JSON: safe to serialise, diff, publish, or hand to the page as the
// payload it re-renders from. Nothing here renders; nothing here decides.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { blastRadius, isOpen, listAsks } from './folder/asks.js';
import { runChecks } from './folder/checks.js';
import { DEFAULT_FOLDER, FOLDER_NAMES } from './folder/layout.js';
import { holdAgeHours, listRequirements, readTasksState, sectionOf, STATUSES } from './folder/requirements.js';
import { sprintBoard, stepWords } from './folder/sprints.js';
import { currentStage, gateState, nextAction, readAssumptions, STAGES } from './folder/workflow.js';
import { exists, readText } from './fsutil.js';
import { readFrontMatter } from './frontmatter.js';
import { repoState } from './evidence.js';
import { loadHumans } from './humans.js';
import { costForecast } from './reports.js';
import { readPosture } from './security/scan.js';
import { readSessions } from './session.js';

export { renderDashboard } from './dashboard-view.js';

/**
 * A generated page is written inside `.git/`, which is ignored by definition. A page in the
 * project root shows up in every `git status` and eventually in somebody's commit.
 */
export const dashboardPath = (root) => join(root, '.git', 'vibekit', 'tracker.html');

export async function folderOf(root, project = null) {
  if (project?.folder) return project.folder;
  for (const name of FOLDER_NAMES) if (await exists(join(root, name))) return name;
  return DEFAULT_FOLDER;
}

/**
 * What a person can do from the page, and what they cannot.
 *
 * Only moves that are a human's to make are offered: setting a requirement ready, closing it,
 * answering an ask, releasing a stale hold. An agent's moves happen where the work happens and
 * would be meaningless from a board. Nothing here can edit code, standards, guardrails or the
 * architecture record — those are pull requests.
 */
export function offersFor(requirement, holder) {
  const offers = [];
  if (requirement.status === 'draft') offers.push('ready');
  if (requirement.status === 'ready') offers.push('draft');
  if (holder) offers.push('release');
  if (requirement.status === 'review' && requirement.review.trim() && !holder) offers.push('done');
  if (['ready', 'in-progress', 'blocked'].includes(requirement.status)) offers.push('paused');
  return offers;
}

const countBy = (items, key) => items.reduce((tally, item) => ({ ...tally, [item[key]]: (tally[item[key]] ?? 0) + 1 }), {});

/** §48 — every number traces to a file. Nothing is tracked separately. */
export function stats(requirements, asks, budget) {
  const done = requirements.filter((entry) => entry.status === 'done').length;
  const open = asks.filter(isOpen);
  return {
    requirements: requirements.length,
    done,
    percent: requirements.length ? Math.round((done / requirements.length) * 100) : 0,
    ready: requirements.filter((entry) => entry.status === 'ready').length,
    inProgress: requirements.filter((entry) => entry.status === 'in-progress').length,
    blocked: requirements.filter((entry) => entry.status === 'blocked').length,
    tested: requirements.filter((entry) => entry.status === 'tested').length,
    openAsks: open.length,
    blockingAsks: open.filter((entry) => entry.blocking).length,
    oldestAskDays: open.reduce((top, entry) => Math.max(top, entry.waitingDays), 0),
    alwaysLoaded: budget?.alwaysLoaded ?? 0,
    cap: budget?.ceiling ?? 0,
    typicalTask: budget?.typicalTask ?? 0,
  };
}

/**
 * §57 card 1 — everything waiting on a person, sorted by how much work it unblocks rather than by
 * when it arrived. The Monday-morning job of the page is to show the ten decisions that unblock
 * the most, ranked by blast radius.
 */
export function needsYou({ asks, requirements, gates, held, holdTimeout }) {
  const items = [];

  for (const ask of asks.filter(isOpen)) {
    // A memory proposal is kept as a lesson or not; every other ask is answered or refused.
    const lesson = ask.kind === 'proposal' && (/\b(?:memory|lesson|distil)\b/i.test(String(ask.topic ?? '')) || /distil/i.test(String(ask.by ?? '')));
    items.push({
      kind: lesson ? 'lesson' : ask.kind === 'proposal' ? 'proposal' : 'ask',
      id: ask.id,
      plain: ask.plain || ask.ask.split('\n')[0],
      why: ask.why,
      options: lesson ? [] : ask.options,
      blocking: ask.blocking,
      waitingDays: ask.waitingDays,
      weight: blastRadius(ask, requirements) * 10 + (ask.blocking ? 100 : 0) + ask.waitingDays,
      actions: lesson ? ['keep', 'not-lesson'] : ['answer', 'reject'],
      file: `workflow/asks/${ask.id}`,
    });
  }

  // §57 — "Approve or reject a gate": the button writes the line the role humans.md names would.
  const GATE_FILES = { 1: 'workflow/assumptions.md', 2: 'workflow/architecture.md', 3: 'product/design/components.md', 4: 'workflow/plan.md' };
  for (const stage of STAGES.slice(0, 5)) {
    const gate = gates[stage.n];
    if (!gate || gate.passed || gate.skipped) continue;
    if (!/approved|reviewed/i.test(gate.detail)) continue;
    items.push({
      kind: 'gate',
      id: String(stage.n),
      plain: `The ${stage.name} stage is finished and waiting for you to approve it.`,
      why: `${gate.detail}. Approving writes the line in ${GATE_FILES[stage.n] ?? 'the file'} with your name and the date; sending it back leaves a note in status.md.`,
      weight: 90,
      actions: ['approve', 'reject-gate'],
      file: GATE_FILES[stage.n] ?? null,
    });
    break;
  }

  for (const requirement of requirements.filter((entry) => entry.status === 'review' && entry.review.trim())) {
    if (held[requirement.id]) continue;
    items.push({
      kind: 'close',
      id: requirement.id,
      plain: `${requirement.title} has been reviewed and is waiting for you to call it done.`,
      why: 'Only a human closes a requirement.',
      weight: 50,
      actions: ['done'],
    });
  }

  for (const [id, holder] of Object.entries(held)) {
    if (holdAgeHours(holder) <= holdTimeout) continue;
    // §60 — the checkpoint is what makes this decidable. "Held for nine hours" tells a person
    // nothing about whether releasing costs anything; "next: wire the controller" does.
    const checkpoint = requirements.find((entry) => entry.id === id)?.checkpoint?.trim() ?? '';
    items.push({
      kind: 'stale-hold',
      id,
      plain: `${id} has been held by the ${holder.role} for ${Math.round(holdAgeHours(holder))} hours with nothing landing.`,
      why: `The hold timeout is ${holdTimeout}h. Releasing keeps the work on its branch.`,
      checkpoint: checkpoint || null,
      weight: 40,
      actions: ['release'],
    });
  }

  return items.sort((a, b) => b.weight - a.weight);
}

/** §57 card 3 — what is open against the security report, in words a product owner can act on. */
export function securityCard(checks, requirements, entities) {
  const classified = entities.filter((entity) => ['personal', 'financial', 'secret'].includes(entity.class));
  const findings = checks.findings.filter((entry) => /security|guardrail|redact|denied/i.test(entry.code));
  return {
    classified: classified.map((entity) => ({ name: entity.name, class: entity.class })),
    touching: requirements.filter((entry) => entry.entities.some((name) => classified.some((entity) => entity.name === name))).length,
    findings: findings.map((entry) => ({ code: entry.code, message: entry.message, severity: entry.severity })),
    unclassified: entities.filter((entity) => !entity.class).map((entity) => entity.name),
  };
}

/**
 * §57 card 4 — completion derived from **measured throughput**, never from an agent's estimate.
 * §53 says estimates are a non-goal: agents are bad at them and the numbers get treated as
 * promises. A rate computed from requirements that actually closed is a different thing.
 */
export function schedule(requirements) {
  const closed = requirements
    .filter((entry) => entry.status === 'done')
    .map((entry) => entry.log.map((line) => line.slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).pop())
    .filter(Boolean)
    .sort();

  const remaining = requirements.filter((entry) => entry.status !== 'done').length;
  if (closed.length < 3) {
    return { remaining, perWeek: null, weeksLeft: null, basis: `${closed.length} requirement(s) closed — not enough to measure a rate yet` };
  }
  const spanDays = Math.max(1, (new Date(closed.at(-1)) - new Date(closed[0])) / 86400000);
  const perWeek = (closed.length / spanDays) * 7;
  return {
    remaining,
    perWeek: Math.round(perWeek * 10) / 10,
    weeksLeft: perWeek > 0 ? Math.ceil(remaining / perWeek) : null,
    basis: `measured from ${closed.length} closed requirements over ${Math.round(spanDays)} days`,
  };
}

const entitiesFrom = (text) => [...String(text ?? '').matchAll(/^##\s+(.+)$\n+(?:class:\s*(\w+))?/gm)]
  .map((match) => ({ name: match[1].trim(), class: match[2] ?? null }));

/** Everything the page shows, as plain JSON. */
export async function collectState(root, project, { setup = null, problems = [], tunnel = null } = {}) {
  const folder = await folderOf(root, project);
  const profile = readFrontMatter((await readText(join(root, folder, 'profile.md'))) ?? '');
  const holdTimeout = Number.parseFloat(String(profile['hold-timeout'] ?? '4').replace(/h$/i, '')) || 4;

  const [requirements, asks, checks, gates, stage, assumptions] = await Promise.all([
    listRequirements(root, folder),
    listAsks(root, folder),
    runChecks(root, { folder }),
    gateState(root, folder),
    currentStage(root, folder),
    readAssumptions(root, folder),
  ]);
  const held = (await readTasksState(root, folder)).held;
  const entities = entitiesFrom(await readText(join(root, folder, 'product/entities.md')));
  const repo = repoState(root);

  // §70's screens, each from the file that already had to be right: the board from plan.md, bugs
  // from the BUG-* requirements, security from the last scan, cost from the sessions, docs from
  // docs/, the team from humans.md. Nothing here is tracked separately.
  const [board, posture, forecast, sessions, humans] = await Promise.all([
    sprintBoard(root, folder).catch(() => null),
    readPosture(root, folder).catch(() => null),
    costForecast(root, folder).catch(() => null),
    readSessions(root, folder).catch(() => []),
    loadHumans(root, folder).catch(() => ({ approvers: [] })),
  ]);
  const docsDir = join(root, 'docs');
  const docs = [];
  for (const name of (await readdir(docsDir).catch(() => [])).filter((entry) => entry.endsWith('.md')).sort()) {
    const info = await stat(join(docsDir, name)).catch(() => null);
    docs.push({ title: name.replace(/\.md$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), path: `docs/${name}`, date: info ? info.mtime.toISOString().slice(0, 10) : null });
  }
  const spent = sessions.reduce((sum, session) => sum + (Number(session.tokensIn ?? session.input ?? 0) + Number(session.tokensOut ?? session.output ?? 0)), 0);
  const byTier = sessions.reduce((tally, session) => (session.tier ? { ...tally, [session.tier]: (tally[session.tier] ?? 0) + Number(session.tokensIn ?? 0) + Number(session.tokensOut ?? 0) } : tally), {});
  const verdictOf = (text) => sectionOf(text, 'Verdict').match(/^\*\*(Verified|Partial|Failed)\b/i)?.[1]?.toLowerCase() ?? null;
  const evidenceOf = (requirement) => (!requirement.evidence.trim() ? null : /\bexit\s+[1-9]\d*\b/.test(requirement.evidence) ? 'red' : /\bexit\s+0\b/.test(requirement.evidence) ? 'green' : null);

  return {
    sprints: board ? {
      current: board.current ? { n: board.current.n, title: board.current.title, done: board.current.done, total: board.current.total } : null,
      sprints: board.sprints.map((sprint) => ({ n: sprint.n, title: sprint.title, ids: sprint.ids, lines: sprint.lines, done: sprint.done, total: sprint.total, complete: sprint.complete, closed: sprint.closed })),
      deferred: board.deferred,
      unplanned: board.unplanned.map((entry) => entry.id),
    } : null,
    bugs: requirements.filter((entry) => entry.kind === 'bug').map((bug) => ({
      id: bug.id, title: bug.title, severity: bug.severity, status: bug.status, foundBy: bug.foundBy, foundOn: bug.foundOn, test: bug.test,
      verdict: verdictOf(bug.text), assessment: sectionOf(bug.text, 'Assessment').split('\n')[0] || null,
    })),
    posture,
    cost: forecast ? { forecast: forecast.total ?? 0, spent, sessions: sessions.length, byTier, escalated: sessions.filter((session) => session.escalated).length } : null,
    docs,
    team: humans.approvers.map((person) => ({ name: person.name, role: person.role, email: person.email ?? null })),
    folder,
    // What the running server is doing, which no file records: whether there is a way in from
    // outside right now. Null where the page was rendered by the CLI rather than served.
    tunnel,
    project: {
      name: project?.project?.name ?? profile.template ?? 'project',
      generatedAt: new Date().toISOString(),
      commit: repo?.commit ?? null,
      branch: repo?.branch ?? null,
    },
    stage: { n: stage.n, name: stage.name, prompt: `${folder}/${stage.prompt}` },
    gates: Object.fromEntries(Object.entries(gates).map(([n, gate]) => [n, { ...gate, name: STAGES.find((entry) => String(entry.n) === n)?.name ?? n }])),
    stats: stats(requirements, asks, checks.budget),
    byStatus: countBy(requirements, 'status'),
    statuses: [...STATUSES],
    next: await nextAction(root, folder, { holdTimeout }),
    needsYou: needsYou({ asks, requirements, gates, held, holdTimeout }),
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      kind: requirement.kind,
      size: requirement.size,
      status: requirement.status,
      entities: requirement.entities,
      criteria: requirement.acceptance.map((criterion) => ({ id: criterion.id, pattern: criterion.pattern, text: criterion.text })),
      malformed: requirement.malformed.length,
      phase: requirement.phase,
      after: requirement.after,
      log: requirement.log,
      holder: held[requirement.id] ?? null,
      heldHours: held[requirement.id] ? Math.round(holdAgeHours(held[requirement.id])) : null,
      offers: offersFor(requirement, held[requirement.id] ?? null),
      // §67 — the sentence, not the fraction: "writing the tests", not "step 3/5".
      step: stepWords(requirement, held[requirement.id] ?? null),
      verified: [...requirement.verification.matchAll(/\bAC-\d+\b/g)].map((match) => match[0]),
      evidence: evidenceOf(requirement),
      reviewed: Boolean(requirement.review.trim()),
      checkpoint: requirement.checkpoint || null,
      severity: requirement.severity,
      tokens: requirement.tokens,
      file: `${folder}/product/requirements/${requirement.id}.md`,
    })),
    asks: asks.map((ask) => ({
      id: ask.id, kind: ask.kind, for: ask.for, status: ask.status, blocking: ask.blocking,
      waitingDays: ask.waitingDays, plain: ask.plain, why: ask.why, options: ask.options, answer: ask.answer,
      radius: blastRadius(ask, requirements),
    })),
    assumptions: assumptions.map((assumption) => ({
      ...assumption,
      bearing: requirements.filter((entry) => entry.assumes.includes(assumption.id) && entry.status !== 'done').length,
    })),
    security: securityCard(checks, requirements, entities),
    schedule: schedule(requirements),
    budget: checks.budget,
    checks: checks.findings,
    setup,
    problems,
  };
}
