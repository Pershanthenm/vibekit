import { req } from './folder.js';

/**
 * The verbs the specification uses at top level. Appendix A.
 *
 * These are one line each on purpose: `vibekit start REQ-014 --as implementer` and
 * `vibekit req start REQ-014 --as implementer` must do exactly the same thing, so they are the
 * same call rather than two implementations that drift.
 *
 * `quick` is the one that is not a pure alias: §34 defines it as "adds a requirement mid-build,
 * sizes it S and starts it", which is three steps a person would otherwise type in order and
 * get wrong under pressure.
 */

export const start = (options) => req({ ...options, args: ['start', ...options.args] });
export const unhold = (options) => req({ ...options, args: ['release', ...options.args] });
export const add = (options) => req({ ...options, args: ['new', ...options.args] });

/** §34 — a hotfix-sized change, added and picked up in one step. */
export async function quick(options) {
  const title = options.args.join(' ').trim();
  if (!title) throw new Error('Usage: vibekit quick "<what needs doing>"   — adds it, sizes it S, and starts it.');

  const { listRequirements, nextRequirementId } = await import('../folder/requirements.js');
  const { folderName } = await import('./folder.js');
  const folder = options.folder ?? (await folderName(options.root));
  const kind = options.hotfix ? 'bug' : 'requirement';
  // The id is decided before the file is written, so what is reported is what was created — the
  // last entry of a sorted list is not, once BUG-* files sort ahead of REQ-*.
  const id = nextRequirementId(await listRequirements(options.root, folder), kind);
  await req({ ...options, args: ['new', title], size: 'S', kind });

  console.log('');
  console.log(`  Size S, and not yet ready: write its acceptance criteria, then \`vibekit req ready ${id}\`.`);
  console.log(options.hotfix
    ? `  A hotfix is a bug: name the failing test (\`vibekit bug assess ${id} --test <path> --cause "…"\`), then \`vibekit bug fix ${id}\` starts it on hotfix/*.`
    : '  A quick change skips the ceremony, not the criteria — that is what makes it small rather than untested.');
  return { id };
}

/**
 * `vibekit tracker` — §57's name for the page the dashboard already serves.
 *
 * A server that blocks is right for a person and wrong for a script, and there was no way to ask
 * "would this work?" without starting one that never returns. `--dry-run` answers that: it
 * resolves everything the server needs, prints it, and exits.
 */
export async function tracker(options) {
  const { dashboard } = await import('./dashboard.js');
  // `vibekit tracker <project>` from anywhere: the name is looked up in the registry, the page
  // is served with a tunnel and the QR code is printed — the whole point being a phone, the
  // tunnel is on unless --no-tunnel says otherwise. Inside a project, no name is needed.
  const root = await resolveProjectRoot(options);
  const tunnel = options['no-tunnel'] ? false : (options.tunnel ?? options.qr ?? true);

  if (options['dry-run']) {
    const { folderName } = await import('./folder.js');
    const { loadHumans } = await import('../humans.js');
    const { currentStage } = await import('../folder/workflow.js');
    const folder = options.folder ?? (await folderName(root));

    const [humans, stage] = await Promise.all([
      loadHumans(root, folder),
      currentStage(root, folder).catch(() => null),
    ]);

    console.log(`tracker · would serve ${folder}/ of ${root} on 127.0.0.1${options.port ? `:${options.port}` : ''}`);
    console.log(`  stage      ${stage ? `${stage.n} · ${stage.name}` : 'no folder to read'}`);
    console.log(`  approvers  ${humans.approvers.length ? humans.approvers.map((person) => `${person.name} (${person.role})`).join(', ') : 'none named — everyone would see a read-only page'}`);
    console.log(`  tunnel     ${tunnel ? 'yes — a QR code for the phone is printed when it opens' : 'no (--no-tunnel)'}`);
    console.log('');
    console.log('  Nothing was started. Without --dry-run this serves until you stop it, which is what a');
    console.log('  page is for and what a script has to know not to wait on.');
    return;
  }

  // --static or --out: write the page to a file instead of serving it, for a copy that is going
  // somewhere other than a local browser. Everything else serves.
  if (options.static || options.out) return dashboard({ ...options, root, serve: false, static: Boolean(options.static) });
  return dashboard({ ...options, root, serve: true, tunnel });
}

/**
 * Which project: the name given, matched against the registry `project new` and `project import`
 * keep; else the folder we are in. One match is used; none or several is a question back.
 */
export async function resolveProjectRoot(options) {
  const name = options.args?.find((argument) => !argument.startsWith('-'));
  if (!name) return options.root;
  const { listProjects, folderIn } = await import('../projects.js');
  const rows = await listProjects({ match: name });
  const exact = rows.filter((row) => String(row.name).toLowerCase() === name.toLowerCase());
  const chosen = exact.length === 1 ? exact : rows;
  if (!chosen.length) {
    if (await folderIn(options.root)) return options.root; // a name that is not a project: serve what is here
    throw new Error(`No project called "${name}" on this machine. \`vibekit project select\` lists them; \`vibekit project select --rescan <dir>\` finds the ones you have.`);
  }
  if (chosen.length > 1) throw new Error(`"${name}" matches ${chosen.length} projects: ${chosen.map((row) => row.name).join(', ')}. Say which.`);
  if (!chosen[0].folder) throw new Error(`${chosen[0].name} has no vibekit/ folder yet, so there is nothing to track. \`vibekit project new\` there first.`);
  return chosen[0].path;
}
