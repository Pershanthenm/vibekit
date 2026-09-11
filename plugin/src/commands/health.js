import { detectPlatform, PLATFORM_NAMES } from '../machine/platform.js';
import { liveChecks, loadProjectIfAny, projectChecks, toolChecks } from '../machine/health.js';

const symbol = (result) => (result.warn ? '!' : result.ok ? '✔' : result.unknown ? '?' : '✖');

function printGroup(title, results) {
  if (!results.length) return;
  console.log(`\n${title}`);
  results.forEach((result) => {
    console.log(`  ${symbol(result)} ${result.name} — ${result.detail}`);
    if (!result.ok && result.fix) console.log(`      fix: ${result.fix}`);
  });
}

export async function runHealthCheck(root, { live = false } = {}) {
  const platform = detectPlatform();
  const project = await loadProjectIfAny(root);
  const tools = await toolChecks(project, platform);
  const projectResults = await projectChecks(root, project);
  const liveResults = live ? await liveChecks(root, project) : [];
  return { platform, project, groups: { Tools: tools, Project: projectResults, Live: liveResults } };
}

export async function health({ root, live, json }) {
  const report = await runHealthCheck(root, { live });
  const all = Object.values(report.groups).flat();
  if (json) {
    console.log(JSON.stringify({ platform: report.platform, results: all.map(({ tool, ...rest }) => rest) }, null, 2));
  } else {
    console.log(`vibecheck health · ${PLATFORM_NAMES[report.platform]}${report.project ? ` · project ${report.project.project.name}` : ''}`);
    Object.entries(report.groups).forEach(([title, results]) => printGroup(title, results));
    if (report.platform === 'windows') console.log('\n! Native Windows works for Claude Code, Cursor and Multica, but agentmemory needs WSL2. Running everything inside WSL2 is the smoothest path.');
    if (!live) console.log('\nRun "vibecheck health --live" to prove the chain end to end (sends a few tiny prompts to Claude and Cursor).');
  }
  const failed = all.filter((result) => !result.ok && !result.unknown);
  if (!json) console.log(failed.length ? `\n${failed.length} issue(s). Fix them one by one above, or run "vibecheck setup".` : '\n✔ Everything this project needs works on this machine.');
  if (failed.length) process.exitCode = 1;
}
