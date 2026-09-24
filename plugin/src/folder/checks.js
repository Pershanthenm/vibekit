import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontMatter } from '../frontmatter.js';
import { exists, readText } from '../fsutil.js';
import { ASK_THRESHOLD_DAYS, PLAIN_WORD_CAP, isOpen, listAsks } from './asks.js';
import { budgetReport } from './budget.js';
import { hasHeader } from './header.js';
import { BUDGET_CAP, DEFAULT_DELIVERY, DEFAULT_FOLDER, Kind, POINTERS, filesFor } from './layout.js';
import { PROMPTS_VERSION } from './stages.js';
import { checkpointGaps } from './checkpoint.js';
import { holdAgeHours, listRequirements, readTasksState, readyBlockers } from './requirements.js';
import { readAssumptions } from './workflow.js';

/**
 * Existing is not agreeing. Specification §32.
 *
 * Every check here compares two things in the folder that are supposed to describe the same
 * world, and fails when they have drifted apart. A guardrail naming a path that was deleted, a
 * requirement naming an entity nobody defined, a skill nothing can ever fetch, a criterion no
 * test could be written for — each looks fine on its own page and is worthless in practice, which
 * is exactly the failure a format made of separate Markdown files invites.
 */

const finding = (code, message, fix = null, severity = 'error') => ({ code, message, fix, severity });

/**
 * §22 and §23 — "No skipped or disabled tests." A rule in two prompts, and until this was a check
 * an agent could `it.skip` the test it could not make pass, set `tested`, and the reviewer would
 * see a green suite. A skipped test reads as coverage and proves nothing.
 */
const SKIP_MARKERS = /\b(?:it|test|describe)\.(?:skip|only)\b|\bxit\(|\bxdescribe\(|\[(?:Ignore|Skip)[\](]|\[Fact\(Skip\s*=|@(?:Ignore|Disabled)\b|@pytest\.mark\.skip|@unittest\.skip|\bpytest\.skip\(|\bt\.Skip\(/;
const TEST_FILE = /(\.test\.|\.spec\.|_test\.|Tests?\.(?:cs|java|kt)$|(?:^|\/)test_)/i;
const CODE_FILE = /\.(?:cs|fs|ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rb|php|swift|rs)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', 'vendor', 'coverage', '.next', 'target', '.venv', 'venv']);

/**
 * §31 — "The redaction detector from §31 also runs in `vibekit check` over `memory/` and
 * `workflow/`, because session notes are free text and will eventually contain a connection
 * string. A hit is a check failure until the line is redacted."
 *
 * I described this as built before it was. It is now: the same detectors ingest uses, over the two
 * areas an agent writes prose into, plus the secret shapes a session note picks up from a terminal.
 */
const SECRET_SHAPES = Object.freeze([
  { kind: 'CONNECTION', pattern: /\b(?:Server|Host|Data Source)=[^;\n]+;[^\n]*Password=[^;\n]+/i },
  { kind: 'CONNECTION', pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s]+:[^@\s]+@/i },
  { kind: 'KEY', pattern: /\b(?:sk_live_|sk_test_|AKIA|ghp_|xox[bp]-)[A-Za-z0-9_-]{8,}/ },
  { kind: 'KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: 'BEARER', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
]);

/**
 * §52 — "Sources are scanned on ingest for instruction-shaped text ('ignore previous', 'you are
 * now') and the analyst is shown a warning; memory proposals containing instruction-shaped text
 * are rejected by `vibekit check`." Everything an agent reads that a human did not write for it is
 * data, not instructions — and a memory is loaded into every future session that matches its topic.
 */
export const INSTRUCTION_SHAPED = /\b(?:ignore (?:all |the )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)|disregard (?:the |your )?(?:previous|prior|above|earlier|system)|you are now (?:a|an|the)\b|new instructions?:|system prompt|do not (?:tell|mention|reveal)(?: this)? to the (?:user|human)|from now on,? (?:you|ignore|always|never)|pretend (?:that )?you (?:are|have)|act as (?:if|though) you|override (?:your|the) (?:rules|guardrails|instructions))/i;

export const instructionShaped = (text) => [...String(text ?? '').split('\n').entries()]
  .filter(([, line]) => INSTRUCTION_SHAPED.test(line))
  .map(([index, line]) => ({ line: index + 1, text: line.trim().slice(0, 120) }));

export async function detectorHits(root, folder = DEFAULT_FOLDER) {
  const { detect } = await import('../sources.js');
  const hits = [];
  const walk = async (dir, area, depth = 0) => {
    if (depth > 4) return;
    for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => []))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.state') await walk(path, area, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const text = (await readText(path)) ?? '';
      const relative = `${folder}/${area}/${path.slice(join(root, folder, area).length + 1)}`;
      // Personal data and secrets are the failure; a name or an amount is noisy enough to be a warning.
      for (const hit of detect(text)) {
        hits.push({ path: relative, kind: hit.kind, value: hit.kind === 'SECRET' ? `${hit.value.slice(0, 8)}…` : hit.value, severity: ['EMAIL', 'PHONE', 'SECRET'].includes(hit.kind) ? 'error' : 'warning' });
      }
      for (const shape of SECRET_SHAPES) {
        const found = text.match(shape.pattern);
        if (found) hits.push({ path: relative, kind: shape.kind, value: `${found[0].slice(0, 12)}…`, severity: 'error' });
      }
    }
  };
  await walk(join(root, folder, 'memory'), 'memory');
  await walk(join(root, folder, 'workflow'), 'workflow');
  return hits;
}

export async function skippedTests(root, { max = 400 } = {}) {
  const hits = [];
  const walk = async (dir, depth) => {
    if (depth > 6 || hits.length >= max) return;
    for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => []))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(path, depth + 1);
        continue;
      }
      if (!TEST_FILE.test(entry.name) || !CODE_FILE.test(entry.name)) continue;
      const lines = ((await readText(path)) ?? '').split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (SKIP_MARKERS.test(lines[index])) hits.push({ path: path.slice(root.length + 1).split(/[\\/]/).join('/'), line: index + 1, text: lines[index].trim().slice(0, 100) });
      }
    }
  };
  await walk(root, 0);
  return hits;
}

const listFiles = async (dir, match) => (await readdir(dir).catch(() => [])).filter((name) => match.test(name)).sort();

/** §5 — a fixed shape, because a guardrail `check` cannot read is not enforced. */
export function parseGuardrails(text) {
  const section = (heading) => String(text ?? '').replace(/\r\n/g, '\n')
    .match(new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im'))?.[1] ?? '';
  const items = (heading) => section(heading).split('\n').map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
  return {
    deniedPaths: items('Denied paths').map((line) => ({ path: line.split(/\s{2,}|\s+—\s+/)[0].trim(), note: line })),
    requiredBeforeDone: items('Required before done'),
    locked: items('Locked'),
    allowedCommands: items('Allowed commands'),
    deniedCommands: items('Denied commands'),
  };
}

export function parseSkillsIndex(text) {
  const entries = [];
  let current = null;
  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const name = raw.match(/^-\s+name:\s*(.+)$/);
    if (name) {
      current = { name: name[1].trim(), triggers: [], path: null };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const triggers = raw.match(/^\s+triggers:\s*\[(.*)\]\s*$/);
    if (triggers) current.triggers = triggers[1].split(',').map((word) => word.trim()).filter(Boolean);
    const path = raw.match(/^\s+path:\s*(.+)$/);
    if (path) current.path = path[1].trim();
  }
  return entries;
}

const sectionNames = (text) => [...String(text ?? '').matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());

/** §21 — the plan is a DAG. A cycle means two requirements each wait for the other, forever. */
export function findCycle(requirements) {
  const byId = new Map(requirements.map((entry) => [entry.id, entry]));
  const state = new Map();
  let cycle = null;

  const walk = (id, trail) => {
    if (cycle) return;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      cycle = [...trail.slice(trail.indexOf(id)), id];
      return;
    }
    state.set(id, 'open');
    for (const next of byId.get(id)?.after ?? []) if (byId.has(next)) walk(next, [...trail, id]);
    state.set(id, 'done');
  };

  for (const entry of requirements) walk(entry.id, []);
  return cycle;
}

const newerThan = async (a, b) => {
  const [one, two] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
  return one && two ? one.mtimeMs > two.mtimeMs : false;
};

export async function runChecks(root, options = {}) {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const base = join(root, folder);
  const findings = [];

  if (!(await exists(base))) {
    return { folder, findings: [finding('folder.missing', `No ${folder}/ folder. Run \`vibekit init\` to write one.`, 'vibekit init')], budget: null, passes: false, requirements: [], asks: [] };
  }

  const profile = readFrontMatter((await readText(join(base, 'profile.md'))) ?? '');
  const delivery = options.delivery ?? profile.delivery ?? DEFAULT_DELIVERY;
  const cap = Number.parseInt(profile['budget-cap'] ?? BUDGET_CAP, 10) || BUDGET_CAP;
  const holdTimeout = Number.parseFloat(String(profile['hold-timeout'] ?? '4').replace(/h$/i, '')) || 4;
  const waitDays = Number.parseInt(profile['ask-threshold'] ?? ASK_THRESHOLD_DAYS, 10) || ASK_THRESHOLD_DAYS;

  // --- who owns every declared file ---------------------------------------------------------
  const declared = [
    ...POINTERS.map((entry) => ({ ...entry, full: entry.path })),
    ...filesFor(delivery).filter((entry) => !entry.glob).map((entry) => ({ ...entry, full: `${folder}/${entry.path}` })),
  ];
  for (const file of declared) {
    if (file.kind === Kind.State) continue;
    const content = await readText(join(root, file.full));
    if (content === null) {
      if (file.kind === Kind.Generated) findings.push(finding('file.missing', `${file.full} is missing. It is generated, so a rerun writes it.`, 'vibekit init'));
      continue;
    }
    if (file.kind === Kind.Generated && !hasHeader(content)) {
      findings.push(finding('header.missing', `${file.full} is a generated path with no generated header, so it will never be regenerated. If you meant to own it, move its content into an authored file.`));
    }
    if (file.kind === Kind.Authored && hasHeader(content)) {
      findings.push(finding('header.unexpected', `${file.full} is yours to write but carries a generated header. The next run will overwrite it.`));
    }
  }

  // --- guardrails ----------------------------------------------------------------------------
  const guardrailsText = await readText(join(base, 'standards/guardrails.md'));
  if (guardrailsText) {
    const guardrails = parseGuardrails(guardrailsText);
    for (const denied of guardrails.deniedPaths) {
      const target = denied.path.replace(/\/+$/, '');
      if (/^TODO/i.test(target)) {
        // A starter that has not been filled in yet is incomplete, not inconsistent. Failing a
        // brand-new folder on it makes `init` then `check` red on day one, which is how a team
        // learns to ignore the check. A path that is *named* and missing is the error.
        findings.push(finding('guardrail.todo', 'standards/guardrails.md still has a TODO denied path. Until it names a real path, it denies nothing.', null, 'warning'));
        continue;
      }
      if (!(await exists(join(root, target)))) {
        findings.push(finding('guardrail.unknownPath', `standards/guardrails.md denies "${denied.path}", which does not exist here. A guardrail that can never fire protects nothing.`));
      }
    }
    if (!guardrails.requiredBeforeDone.length || guardrails.requiredBeforeDone.every((item) => /TODO/i.test(item))) {
      findings.push(finding('guardrail.noRequirements', 'standards/guardrails.md names nothing that must pass before done, so "done" means whatever an agent decides it means.', null, 'warning'));
    }
    if (!guardrails.allowedCommands.length) {
      findings.push(finding('guardrail.noCommands', 'standards/guardrails.md has no Allowed commands section, so there is nothing to enforce when an agent runs a shell.', null, 'warning'));
    }
  }

  // --- entities, requirements, criteria ------------------------------------------------------
  const entities = sectionNames(await readText(join(base, 'product/entities.md')));
  const requirements = await listRequirements(root, folder);
  const assumptions = await readAssumptions(root, folder);
  const assumptionIds = assumptions.map((entry) => entry.id);

  for (const requirement of requirements) {
    for (const entity of requirement.entities) {
      if (!entities.includes(entity)) {
        findings.push(finding('requirement.unknownEntity', `${requirement.id} names the entity "${entity}", which is not in product/entities.md. Either it is a typo, or it needs a proposal.`));
      }
    }
    for (const bad of requirement.malformed) {
      findings.push(finding('criterion.notEars', `${requirement.id} ${bad.id ?? 'a criterion'} ${bad.reason}`));
    }
    if (['ready', 'in-progress', 'tested', 'review', 'done'].includes(requirement.status)) {
      const blockers = readyBlockers(requirement, { entities, assumptions: assumptionIds });
      for (const blocker of blockers) {
        findings.push(finding('requirement.notReady', `${requirement.id} is ${requirement.status} but ${blocker}.`));
      }
    }
    for (const after of requirement.after) {
      if (!requirements.some((entry) => entry.id === after)) {
        findings.push(finding('requirement.unknownAfter', `${requirement.id} waits on ${after}, which does not exist.`));
      }
    }
  }

  const cycle = findCycle(requirements);
  if (cycle) findings.push(finding('plan.cycle', `The plan has a cycle: ${cycle.join(' → ')}. Each of these waits for the next, so none can ever start.`));

  // --- assumption blast radius (§38) ----------------------------------------------------------
  for (const assumption of assumptions.filter((entry) => entry.confidence === 'low')) {
    const bearing = requirements.filter((entry) => entry.assumes.includes(assumption.id) && entry.status !== 'done').length;
    if (bearing > 3) {
      findings.push(finding('assumption.loadBearing', `${assumption.id} is low-confidence and ${bearing} requirements stand on it. Confirm it, or accept it as a risk in writing, before the plan gate.`));
    }
  }

  // --- invariants (§49) -----------------------------------------------------------------------
  const invariantsText = await readText(join(base, 'product/invariants.md'));
  const invariantTests = await listFiles(join(root, 'tests/invariants'), /\./);
  for (const match of String(invariantsText ?? '').matchAll(/^[-*]\s*(INV-\d+)\b/gim)) {
    const id = match[1];
    if (!/TODO/i.test(invariantsText) && !invariantTests.some((name) => name.includes(id))) {
      findings.push(finding('invariant.noTest', `${id} has no property test in tests/invariants/. An invariant nothing checks is a comment.`, null, 'warning'));
    }
  }

  // --- ownership -------------------------------------------------------------------------------
  const state = await readTasksState(root, folder);
  for (const requirement of requirements.filter((entry) => entry.status === 'in-progress')) {
    if (!state.held[requirement.id]) {
      findings.push(finding('requirement.unheld', `${requirement.id} is in-progress but nobody holds it in .state/tasks.json, so the work is not attributable.`, 'vibekit rescan'));
    }
  }
  for (const [id, holder] of Object.entries(state.held)) {
    const requirement = requirements.find((entry) => entry.id === id);
    if (!requirement) {
      findings.push(finding('holder.orphan', `.state/tasks.json says ${holder.role} holds ${id}, which no longer exists.`, 'vibekit rescan'));
      continue;
    }
    if (!['in-progress', 'blocked'].includes(requirement.status)) {
      findings.push(finding('holder.stale', `${id} is ${requirement.status} but is still held by ${holder.role}.`, 'vibekit rescan'));
    }
    if (holdAgeHours(holder) > holdTimeout) {
      findings.push(finding('holder.timedOut', `${id} has been held by ${holder.role} for ${Math.round(holdAgeHours(holder))}h, past the ${holdTimeout}h timeout.`, `vibekit unhold ${id}`));
    }
  }

  const asks = await listAsks(root, folder);
  // --- the detector, everywhere an agent writes prose (§31, §52) ---------------------------------
  for (const hit of await detectorHits(root, folder)) {
    findings.push(finding(
      'detector.hit',
      `${hit.path} contains ${hit.kind === 'CONNECTION' ? 'a connection string' : hit.kind === 'KEY' ? 'what looks like a key' : hit.kind === 'SECRET' ? 'a high-entropy token that looks like a secret' : `a ${hit.kind.toLowerCase()}`} (${hit.value}). Session notes are free text and the folder is in git forever.`,
      'redact the line: replace it with a placeholder, and keep the real value outside the repository',
      hit.severity,
    ));
  }
  // A memory proposal with instruction-shaped text is a prompt injection asking to be loaded into
  // every future session that matches its topic.
  for (const ask of asks.filter((entry) => entry.kind === 'proposal')) {
    for (const hit of instructionShaped(ask.ask)) {
      findings.push(finding('ask.injection', `${ask.id} contains instruction-shaped text ("${hit.text}"). A memory is data, not an instruction; this proposal is rejected.`, `vibekit ask reject ${ask.id} "instruction-shaped text"`));
    }
  }

  // --- skipped tests (§22, §23) -----------------------------------------------------------------
  for (const hit of await skippedTests(root)) {
    findings.push(finding(
      'tests.skipped',
      `${hit.path}:${hit.line} skips or focuses a test (\`${hit.text}\`). A skipped test reads as coverage and proves nothing; a test you cannot make pass is an ask against the criterion.`,
      'remove the skip, or write the ask: vibekit ask "<what stops this test passing>" --plain "..."',
    ));
  }

  // --- checkpoints (§60) ------------------------------------------------------------------------
  // A warning, not an error: the checkpoint is what makes resuming cheap, and work that is
  // genuinely a few minutes old has nothing to say yet. What it must never be is silently
  // absent for a week, because by then the only record of where the work got to is the diff.
  for (const { requirement, problems } of checkpointGaps(requirements)) {
    findings.push(finding(
      'checkpoint.thin',
      `${requirement.id} is ${requirement.status} and its ## Checkpoint ${problems[0]}. A session resuming it would have to reconstruct the work from the diff.`,
      `vibekit req checkpoint ${requirement.id} --done "..." --in-hand "..." --next "..."`,
      'warning',
    ));
  }

  // --- asks (§12) -------------------------------------------------------------------------------
  for (const ask of asks) {
    if (!ask.plain.trim()) {
      findings.push(finding('ask.noPlainTerms', `${ask.id} has no "## In plain terms" section. The person answering it should not have to read the technical version.`));
    } else if (ask.plainWords > PLAIN_WORD_CAP) {
      findings.push(finding('ask.plainTooLong', `${ask.id}'s plain-terms section is ${ask.plainWords} words (cap ${PLAIN_WORD_CAP}). Past that it has started explaining the implementation again.`));
    }
    if (!ask.why.trim()) {
      findings.push(finding('ask.noWhy', `${ask.id} does not say why it matters, so nobody can tell how much to care.`));
    }
    if (!isOpen(ask)) continue;
    if (ask.waitingDays > waitDays) {
      findings.push(finding('ask.stale', `${ask.id} has waited ${ask.waitingDays} days (threshold ${waitDays}). An ask nobody answers is a requirement nobody can finish.`));
    }
    if (ask.for && !requirements.some((entry) => entry.id === ask.for)) {
      findings.push(finding('ask.orphan', `${ask.id} is for ${ask.for}, which does not exist.`));
    }
  }

  // --- skills (§7) --------------------------------------------------------------------------------
  const skillIndex = parseSkillsIndex(await readText(join(base, 'skills/index.yml')));
  const bodies = await listFiles(join(base, 'skills/lib'), /^(?!.*\.test\.md$).*\.md$/);
  for (const entry of skillIndex) {
    if (entry.triggers.length < 2) {
      findings.push(finding('skill.noTriggers', `Skill "${entry.name}" has ${entry.triggers.length} trigger word(s). With fewer than two it will almost never be fetched, which makes it dead weight in the index.`));
    }
    const target = entry.path ? join(base, 'skills', entry.path) : null;
    if (!target || !(await exists(target))) {
      findings.push(finding('skill.brokenPath', `Skill "${entry.name}" points at ${entry.path ?? '(nothing)'}, which does not resolve.`));
    }
  }
  for (const body of bodies) {
    const name = body.replace(/\.md$/, '');
    if (!skillIndex.some((entry) => entry.name === name)) {
      findings.push(finding('skill.unindexed', `skills/lib/${body} has no entry in index.yml, so nothing can find it.`, 'vibekit init'));
    }
  }

  // --- extensions and integration (Extensions and Integration Spec §2, §5) ---------------------------
  // Declarative checks from enabled extensions run here, coded by their source; a skill present in
  // more than one place prints its override chain; a badly declared MCP server is a finding.
  try {
    const { enabledChecks, enabledSkills } = await import('../extensions.js');
    const { evaluateChecks } = await import('../extchecks.js');
    const extChecks = await enabledChecks();
    for (const check of extChecks) for (const problem of check.problems ?? []) findings.push(finding('ext.invalidCheck', problem, null, 'warning'));
    findings.push(...(await evaluateChecks(root, extChecks.filter((check) => !(check.problems ?? []).length))));

    const { listSkills, overrideChain } = await import('../skills.js');
    const { skills } = await listSkills(root, { folder, extensionSkills: await enabledSkills() });
    for (const entry of overrideChain(skills)) {
      findings.push(finding('skill.override', `Skill "${entry.name}" is in more than one place (${entry.scopes.join(' → ')}); the ${entry.wins} copy fires. Nobody should be surprised by which version that is.`, null, 'warning'));
    }
  } catch { /* an extension that cannot be read is reported by `vibekit ext list`, not here */ }

  const { loadServers } = await import('../servers.js');
  for (const server of await loadServers(root, { folder }).catch(() => [])) {
    for (const problem of server.problems) findings.push(finding('server.declaration', `agents/servers.yml: ${problem}`, `${folder}/agents/servers.yml`));
    if (server.writes && server.roles.includes('reviewer')) findings.push(finding('server.reviewerWrites', `${server.id} lets the reviewer write. The reviewer does not write to Jira; that is the role model, not a setting.`, `${folder}/agents/servers.yml`, 'warning'));
  }

  // --- memory (§30) ---------------------------------------------------------------------------------
  for (const name of await listFiles(join(base, 'memory/repo'), /\.md$/)) {
    const meta = readFrontMatter((await readText(join(base, 'memory/repo', name))) ?? '');
    if (!meta.by) findings.push(finding('memory.noBy', `memory/repo/${name} has no \`by:\`, so nobody can judge whether to trust it.`));
  }

  // --- abstracts (§13) --------------------------------------------------------------------------------
  for (const [area, summarises] of [['product', 'product/context.md'], ['skills', 'skills/index.yml'], ['memory', 'memory/index.md']]) {
    if (await newerThan(join(base, summarises), join(base, `${area}/.abstract`))) {
      findings.push(finding('abstract.stale', `${area}/.abstract is older than ${summarises}, so it describes a folder that has moved on.`, 'vibekit init', 'warning'));
    }
  }

  // --- prompt version (§5) ------------------------------------------------------------------------------
  if (profile.prompts && profile.prompts !== PROMPTS_VERSION) {
    findings.push(finding('prompts.behind', `This project is on prompts ${profile.prompts}; ${PROMPTS_VERSION} is installed. A project's agents should never change behaviour because of an update nobody saw.`, 'vibekit upgrade-prompts', 'warning'));
  }

  // --- budget (§10) ---------------------------------------------------------------------------------------
  const budget = await budgetReport(root, folder, { delivery, cap });
  if (!budget.passes) {
    findings.push(finding('budget.overCap', `The always-loaded folder costs ${budget.alwaysLoaded} tokens against a cap of ${budget.ceiling}. Past this, teams delete rules to make room.`, 'vibekit check --budget'));
  }
  for (const row of budget.rows) {
    const limit = row.hardCeiling ? row.budget : row.ceiling;
    if (limit && row.tokens > limit) {
      findings.push(finding('budget.hardCeiling', `${row.path} is ${row.tokens} tokens against a hard ceiling of ${limit}. If it does not fit, the scope is not decided yet.`));
    }
  }

  const errors = findings.filter((entry) => entry.severity === 'error');
  return { folder, delivery, findings, budget, requirements, asks, passes: errors.length === 0 };
}

export function renderChecks(result) {
  const errors = result.findings.filter((entry) => entry.severity === 'error');
  const warnings = result.findings.filter((entry) => entry.severity === 'warning');

  if (!result.findings.length) {
    return `✔ ${result.folder}/ is consistent (${result.requirements.length} requirements, ${result.budget?.alwaysLoaded ?? 0} tokens always loaded).`;
  }

  const lines = [];
  if (errors.length) lines.push(`✖ ${errors.length} problem(s) in ${result.folder}/`, '');
  for (const item of errors) {
    lines.push(`  ${item.message}`);
    if (item.fix) lines.push(`    fix: ${item.fix}`);
  }
  if (warnings.length) {
    if (errors.length) lines.push('');
    lines.push(`! ${warnings.length} warning(s)`, '');
    for (const item of warnings) lines.push(`  ${item.message}`);
  }
  return lines.join('\n');
}
