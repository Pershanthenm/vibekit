import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProblems } from '../commands/check.js';
import { exists } from '../fsutil.js';
import { memoryHealth, recall, remember } from '../memory.js';
import { multicaHealth } from '../multica.js';
import { PROJECT_FILE, loadProject } from '../project.js';
import { toolEnv } from './platform.js';
import { firstAvailable, probe } from './probe.js';
import { toolsFor } from './tools.js';

const BIN = fileURLToPath(new URL('../../bin/vibecheck', import.meta.url));
const LIVE_TIMEOUT_MS = 180000;
const item = (group, name, ok, detail, fix) => ({ group, name, ok, detail, fix });

export async function loadProjectIfAny(root) {
  return (await exists(join(root, PROJECT_FILE))) ? loadProject(root) : null;
}

export async function toolChecks(project, platform, tools = toolsFor(project)) {
  const results = [];
  for (const tool of tools) {
    const result = await tool.check(project);
    const fix = result.ok ? undefined : result.fix ? tool[result.fix] : tool.install[platform];
    results.push({ ...item('Tools', tool.name, result.ok, result.detail, fix), tool, unknown: result.unknown, warn: result.warn, action: result.fix });
  }
  return results;
}

function hookSelfTest(root) {
  try {
    const output = execFileSync('node', [BIN, 'hook', 'session-start'], { cwd: root, input: JSON.stringify({ cwd: root }), encoding: 'utf8', env: toolEnv(), timeout: 30000 });
    return JSON.parse(output).hookSpecificOutput.additionalContext.includes('orchestrator protocol');
  } catch {
    return false;
  }
}

function gitState(root) {
  const inRepo = probe('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }).ok;
  const remote = inRepo && probe('git', ['remote'], { cwd: root }).output.split('\n').filter(Boolean);
  return { inRepo, remotes: remote || [] };
}

export async function projectChecks(root, project) {
  if (!project) return [item('Project', 'vibecheck project', true, 'not in a project (machine checks only)')];
  const problems = await collectProblems(root, project);
  const git = gitState(root);
  const needsRemote = project.workflow.engine === 'multica';
  return [
    item('Project', 'specs consistent', !problems.length, problems.length ? `${problems.length} problem(s): ${problems[0]}` : 'vibecheck check passes', problems.length ? 'vibecheck check' : undefined),
    item('Project', 'hooks run on this machine', hookSelfTest(root), 'session-start hook executed with this Node and PATH', 'reinstall the plugin: vibecheck setup'),
    item('Project', 'git repository', git.inRepo, git.inRepo ? `remotes: ${git.remotes.join(', ') || 'none'}` : 'not a git repository', git.inRepo ? undefined : 'git init && git add -A && git commit -m "chore: initial specification"'),
    needsRemote && item('Project', 'git remote for Multica', git.remotes.includes(project.multica.remote), `Multica agents need "${project.multica.remote}"`, `git remote add ${project.multica.remote} <url> && git push -u ${project.multica.remote} HEAD`),
  ].filter(Boolean);
}

function askAgent(command, args, cwd) {
  const result = probe(command, args, { timeout: LIVE_TIMEOUT_MS, cwd });
  return { ok: result.ok, output: result.output };
}

export async function liveChecks(root, project) {
  const results = [];
  const claudePrompt = project
    ? "Reply with exactly VIBECHECK_OK if your context contains a section titled 'Vibe-check-cli orchestrator protocol'; otherwise reply exactly MISSING."
    : 'Reply with exactly VIBECHECK_OK.';
  const claude = askAgent('claude', ['-p', claudePrompt, '--output-format', 'text'], project ? root : undefined);
  results.push(item('Live', 'Claude Code answers' + (project ? ' with Vibe-check-cli hooks loaded' : ''), claude.output.includes('VIBECHECK_OK'), claude.output.split('\n').pop()?.slice(0, 100) || 'no answer', claude.output.includes('MISSING') ? 'claude plugin install vibe-check-cli@vibe-check-cli (then restart Claude Code)' : 'run `claude` once and sign in'));
  if (!project || project.workflow.engine === 'cursor') {
    const cursorCommand = firstAvailable(['cursor-agent', 'agent'])?.command;
    const cursor = cursorCommand ? askAgent(cursorCommand, ['-p', '--output-format', 'text', 'Reply with exactly CURSOR_OK'], root) : { ok: false, output: 'Cursor CLI not installed' };
    results.push(item('Live', 'Cursor agent answers headlessly', cursor.output.includes('CURSOR_OK'), cursor.output.split('\n').pop()?.slice(0, 100) || 'no answer', 'run `agent` once and sign in, or set CURSOR_API_KEY'));
  }
  if (project?.memory.provider === 'agentmemory') {
    const probeText = `vibecheck health probe ${Date.now()}`;
    const health = await memoryHealth(project);
    const saved = health.ok && (await remember(project, probeText, ['health']));
    const found = saved && (await recall(project, probeText)).some((memory) => memory.includes('health probe'));
    results.push(item('Live', 'agentmemory saves and recalls', Boolean(found), found ? 'round trip ok' : health.detail, 'agentmemory (then re-run vibecheck health --live)'));
  }
  if (project?.knowledge.provider === 'opencontext') {
    const search = probe('oc', ['search', 'vibecheck', '--mode', 'keyword', '--format', 'json']);
    results.push(item('Live', 'OpenContext search works', search.ok, search.firstLine || 'no output', `cd ~ && oc init --tools cursor,claude`));
  }
  if (project && (project.workflow.engine === 'multica' || project.multica.board)) {
    for (const check of await multicaHealth(project)) results.push({ ...item('Live', 'Multica', check.ok, check.detail, 'multica setup self-host && multica daemon start'), warn: check.warn });
  }
  return results;
}
