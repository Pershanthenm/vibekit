import { join } from 'node:path';
import { readFrontMatter } from '../../frontmatter.js';
import { readText } from '../../fsutil.js';
import { DEFAULT_FOLDER } from '../../folder/layout.js';
import { listRequirements } from '../../folder/requirements.js';

/**
 * The architecture model. Documentation Feature Spec §3.
 *
 * One model, generated from the folder, from which every diagram is a view. The reason there is a
 * model at all rather than a diagram per document is that a single model cannot contradict itself
 * across four levels — and a set of hand-drawn diagrams always eventually does.
 *
 * Nothing here draws anything. It reads the same files the build is checked against and produces
 * a structure; `dsl.js` and `svg.js` are views of it.
 *
 * **Determinism is a requirement, not a nicety** (§8 acceptance 7). Every list is sorted by a
 * stable key, because a document that reshuffles itself on every run produces a diff nobody
 * reads, which is the same failure as a document nobody trusts.
 */

const id = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'x';
const bySortKey = (a, b) => a.sortKey.localeCompare(b.sortKey);

const section = (text, heading) => String(text ?? '')
  .replace(/\r\n/g, '\n')
  .match(new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im'))?.[1]?.trim() ?? '';

const fenced = (text, heading) => section(text, heading).match(/```[\w]*\n([\s\S]*?)```/)?.[1] ?? section(text, heading);

const bullets = (text) => text.split('\n').map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);

/** `**Who uses it.** members, studio staff` — the people the product describes. */
function peopleFromContext(context) {
  const line = String(context ?? '').match(/\*\*Who uses it\.\*\*[^\S\n]*(.+)/i)?.[1] ?? '';
  // The whole line is tested for TODO before it is split: the starter reads
  // `TODO: the actual roles, not "users"`, and splitting first left "not \"users\"" behind as a
  // person. A placeholder must produce nobody, not somebody with a strange name.
  if (!line.trim() || /\bTODO\b/i.test(line)) return [];
  return line
    .split(/,| and /)
    .map((name) => name.trim().replace(/[.".]+$/, '').trim())
    .filter(Boolean);
}

/** The left column of the access matrix is the authoritative role list when there is one. */
function rolesFromAccess(access) {
  const rows = String(access ?? '').split('\n').filter((line) => /^\|/.test(line));
  return rows
    .slice(1)
    .map((row) => row.split('|')[1]?.trim())
    .filter((name) => name && !/^-+$/.test(name) && !/^TODO/i.test(name) && !/\\/.test(name));
}

/**
 * Containers are the deployables. The stack block names them by role — web, backend, database —
 * which is exactly the level C4 calls a container, so no guessing is involved.
 */
const CONTAINER_ROLES = [
  { keys: ['web', 'frontend'], name: 'Web', tag: 'spa', description: 'The browser application' },
  { keys: ['mobile'], name: 'Mobile', tag: 'mobile', description: 'The mobile application' },
  { keys: ['desktop'], name: 'Desktop', tag: 'desktop', description: 'The desktop application' },
  { keys: ['backend', 'api', 'language'], name: 'API', tag: 'service', description: 'The application service' },
  { keys: ['database'], name: 'Database', tag: 'database', description: 'Persistent storage' },
  { keys: ['queue', 'broker', 'background'], name: 'Queue', tag: 'queue', description: 'Background work' },
];

function containersFromStack(stackBlock) {
  const stack = new Map();
  for (const line of String(stackBlock ?? '').split('\n')) {
    const matched = line.match(/^\s*([\w-]+)\s{2,}(.+?)\s*$/);
    if (matched) stack.set(matched[1].toLowerCase(), matched[2].trim());
  }

  const found = [];
  const used = new Set();
  for (const role of CONTAINER_ROLES) {
    const key = role.keys.find((candidate) => stack.has(candidate) && !used.has(candidate));
    if (!key) continue;
    // `language` only becomes the API container when nothing more specific named it, so a stack
    // that says both `backend` and `language` produces one service, not two.
    if (key === 'language' && found.some((entry) => entry.tag === 'service')) continue;
    used.add(key);
    found.push({ id: id(role.name), name: role.name, technology: stack.get(key), description: role.description, tag: role.tag, sortKey: role.name });
  }
  return found.sort(bySortKey);
}

/**
 * Components live in their own id namespace.
 *
 * A clean-architecture layout has a `src/Web/` layer and a Vue container both called Web. Without
 * the prefix they hashed to the same id and a layer dependency attached itself to the browser
 * application, which is a diagram that says something false.
 */
const componentId = (name) => `c_${id(name)}`;

/**
 * Components are the layers `map.md` declares, reconciled against what the code actually has.
 *
 * This reconciliation is the part that matters. `map.md` says where code is *supposed* to go;
 * `bindings.json` records where it *went*. A component in the code that the intended structure
 * does not have is marked unplanned and reported — showing only the intention is precisely why
 * nobody trusts architecture diagrams.
 */
function componentsFromMap(whereCodeGoes, bindings) {
  const planned = [];
  for (const line of String(whereCodeGoes ?? '').split('\n')) {
    const matched = line.match(/^\s*(?<path>[\w./<>-]+\/)\s{2,}(?<description>.+?)\s*$/);
    if (!matched) continue;
    const path = matched.groups.path;
    if (/^tests?\//.test(path)) continue;
    const name = path.replace(/\/$/, '').split('/').filter((part) => !part.startsWith('<')).pop();
    if (!name) continue;
    planned.push({ id: componentId(name), name: name.replace(/^./, (first) => first.toUpperCase()), path, description: matched.groups.description, unplanned: false, sortKey: path });
  }

  const known = new Set(planned.map((entry) => entry.path));
  const unplanned = Object.keys(bindings ?? {})
    .map((path) => path.replace(/[^/]+$/, ''))
    .filter((dir) => dir && !known.has(dir) && !/^tests?\//.test(dir))
    .filter((dir, index, all) => all.indexOf(dir) === index)
    .map((dir) => ({ id: componentId(dir), name: dir.replace(/\/$/, ''), path: dir, description: 'In the code but not in the intended structure', unplanned: true, sortKey: dir }));

  return [...planned, ...unplanned].sort(bySortKey);
}

/** `## Dependencies` in the architecture record: the external systems this one talks to. */
function externalsFromArchitecture(architecture) {
  const lines = bullets(section(architecture, 'Dependencies'));
  return lines
    .map((line) => {
      const name = line.split(/\s+·\s+|\s{2,}|,/)[0].replace(/^[`*]|[`*]$/g, '').trim();
      return { name, detail: line };
    })
    .filter((entry) => entry.name && !/^TODO/i.test(entry.name) && !/^name\b/i.test(entry.name))
    .map((entry) => ({ id: id(entry.name), name: entry.name, description: entry.detail, sortKey: entry.name }))
    .sort(bySortKey);
}

/** Entities and their relations, for the ERD and for the relationships between components. */
export function entitiesFrom(text) {
  const blocks = String(text ?? '').split(/^##[ \t]+/m).slice(1);
  return blocks
    .map((block) => {
      const [heading, ...rest] = block.split('\n');
      const body = rest.join('\n');
      const name = heading.trim();
      return {
        id: id(name),
        name,
        class: body.match(/^class:\s*(\w+)/m)?.[1] ?? 'internal',
        // `- \`email\` string · personal — the login`. The separators carry spaces around them,
        // which the first version of this pattern did not allow, so every classified field on a
        // line with notes parsed as nothing at all.
        fields: [...body.matchAll(/^-\s+`(?<name>[\w.]+)`\s*(?<type>[^·—\n]*?)\s*(?:·\s*(?<class>\w+))?\s*(?:—\s*(?<notes>.+))?$/gm)]
          .map((match) => ({ name: match.groups.name, type: (match.groups.type ?? '').trim(), class: match.groups.class ?? null, notes: (match.groups.notes ?? '').trim() || null })),
        relations: bullets(body).filter((line) => /\b(belongs to|has many|has one|references)\b/i.test(line)),
        sortKey: name,
      };
    })
    .filter((entity) => entity.name && !/^TODO/i.test(entity.name))
    .sort(bySortKey);
}

/** Environments, only when delivery is on. A deployment diagram for a project that never deploys is noise. */
function deploymentFrom(environments) {
  const rows = String(environments ?? '').split('\n').filter((line) => /^\|/.test(line)).slice(2);
  return rows
    .map((row) => row.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells[1] && !/^-+$/.test(cells[1]))
    .map((cells) => ({ id: id(cells[1]), name: cells[1], promotedFrom: cells[2] ?? '', requires: cells[3] ?? '', approver: cells[4] ?? '', sortKey: cells[1] }))
    .sort(bySortKey);
}

const relate = (from, to, description, technology = null, tags = []) => ({ from, to, description, technology, tags, sortKey: `${from}→${to}→${description}` });

/**
 * Read the whole model. `root` is the repository; `folder` is the VibeKit folder inside it.
 */
export async function buildModel(root, { folder = DEFAULT_FOLDER } = {}) {
  const base = join(root, folder);
  const read = (path) => readText(join(base, path));

  const [context, access, map, architecture, entitiesText, environments, flows, pointer] = await Promise.all([
    read('product/context.md'), read('product/access.md'), read('product/map.md'),
    read('workflow/architecture.md'), read('product/entities.md'),
    read('delivery/environments.md'), read('product/design/flows.md'),
    readText(join(root, 'CLAUDE.md')),
  ]);

  // The pointer names the app; context.md's heading is the starter's own title ("Context"), which
  // would otherwise become the name of the system on every diagram.
  const heading = String(context ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = String(pointer ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim()
    || (heading && !/^context$/i.test(heading) ? heading : null)
    || 'System';

  let bindings = {};
  try {
    bindings = JSON.parse((await read('.state/bindings.json')) ?? '{}').entities ?? {};
  } catch { /* state is disposable; an unreadable file means no reconciliation, not a failure */ }

  const meta = readFrontMatter(architecture ?? '');
  const requirements = await listRequirements(root, folder);

  const roles = rolesFromAccess(access);
  const people = (roles.length ? roles : peopleFromContext(context))
    .map((name) => ({ id: id(name), name, description: roles.length ? 'A role from the access matrix' : 'A user the product describes', sortKey: name }))
    .filter((person, index, all) => all.findIndex((other) => other.id === person.id) === index)
    .sort(bySortKey);

  const containers = containersFromStack(fenced(map, 'Stack'));
  const components = componentsFromMap(fenced(map, 'Where code goes'), bindings);
  const externals = externalsFromArchitecture(architecture);
  const entities = entitiesFrom(entitiesText);

  const service = containers.find((container) => container.tag === 'service');
  const ui = containers.find((container) => ['spa', 'mobile', 'desktop'].includes(container.tag));
  const database = containers.find((container) => container.tag === 'database');

  // Components belong to the service container: the layers map.md declares are its internals.
  if (service) service.components = components;

  const relationships = [];
  for (const person of people) {
    if (ui) relationships.push(relate(person.id, ui.id, 'Uses'));
    else if (service) relationships.push(relate(person.id, service.id, 'Calls'));
  }
  if (ui && service) relationships.push(relate(ui.id, service.id, 'Calls', meta.api === 'none' ? null : `${meta.api ?? 'REST'} over TLS`));
  if (service && database) relationships.push(relate(service.id, database.id, 'Reads and writes'));
  for (const external of externals) {
    if (service) relationships.push(relate(service.id, external.id, 'Calls', null, ['outbound']));
  }
  // Layer direction comes from the architecture's own rules rather than being assumed.
  const inward = /point inward|depends on|implements/i.test(section(architecture, 'Layers and what may reference what'));
  if (inward && components.length > 1) {
    const domain = components.find((component) => /domain|core/i.test(component.name));
    for (const component of components) {
      if (domain && component.id !== domain.id && !component.unplanned) {
        relationships.push(relate(component.id, domain.id, 'depends on'));
      }
    }
  }

  return {
    name,
    description: String(context ?? '').match(/\*\*What this is\.\*\*[^\S\n]*(.+)/i)?.[1]?.trim() ?? '',
    architecture: meta.architecture ?? null,
    api: meta.api ?? null,
    approved: Boolean(meta.approved && !/^TODO/i.test(String(meta.approved))),
    people,
    externals,
    system: { id: id(name), name, containers },
    containers,
    components,
    entities,
    relationships: relationships.sort(bySortKey),
    deployment: deploymentFrom(environments),
    // Bullets only: taking the whole file when there is no `## Flows` swept up its heading and
    // its own explanatory prose as if they were flows.
    flows: String(flows ?? '')
      .split('\n')
      .filter((line) => /^\s*[-*]\s+/.test(line))
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter((line) => line && !/^TODO/i.test(line)),
    requirements: requirements.map((requirement) => ({ id: requirement.id, title: requirement.title, status: requirement.status, entities: requirement.entities })),
  };
}

export { section, fenced, id as slug };
