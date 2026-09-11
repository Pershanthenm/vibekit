import { extname } from 'node:path';
import { detectDotnet, detectGo, detectJava, detectNode, detectPhp, detectPython, languageShare } from './detect.js';

const uniq = (values) => [...new Set(values.filter(Boolean))];

const FRONTEND_HINTS = ['Next.js', 'Nuxt', 'Angular', 'AngularJS', 'Vue', 'React', 'Svelte'];
const BACKEND_HINTS = ['Express', 'Fastify', 'NestJS', 'Koa', 'ASP.NET MVC', 'ASP.NET Core', 'ASP.NET Web API', 'Django', 'FastAPI', 'Flask', 'Spring Boot', 'Quarkus', 'Laravel', 'Symfony'];
const DATABASE_HINTS = ['Entity Framework', 'EF Core'];

const matching = (frameworks, hints) => frameworks.filter((name) => hints.some((hint) => name.startsWith(hint)));

/**
 * Turn a repository inspection into an as-is description.
 * Anything not found is left empty and listed in `unknown` — never guessed.
 */
export function describe(inspection) {
  const { manifests, languageCounts, migrations = [], ci = [] } = inspection;
  const get = (predicate) => [...manifests.entries()].filter(([path]) => predicate(path));
  const evidence = [];
  const detected = [];

  for (const [path, text] of get((path) => path.endsWith('package.json'))) {
    const node = detectNode(text);
    if (node) {
      detected.push(node);
      evidence.push({ file: path, found: uniq([node.language, ...node.frameworks]).join(', ') || 'no framework recognised' });
    }
  }

  const projectFiles = get((path) => ['.csproj', '.fsproj'].includes(extname(path)));
  if (projectFiles.length) {
    const configs = get((path) => path.endsWith('packages.config')).map(([, text]) => text).join('\n');
    for (const [path, text] of projectFiles) {
      const net = detectDotnet(text, configs);
      detected.push(net);
      evidence.push({ file: path, found: uniq([net.runtime, ...net.frameworks]).join(', ') || 'no framework recognised' });
    }
  }

  const pythonFiles = get((path) => /requirements.*\.txt$|pyproject\.toml$/.test(path));
  if (pythonFiles.length) {
    const python = detectPython(pythonFiles.map(([, text]) => text));
    if (python) {
      detected.push(python);
      evidence.push({ file: pythonFiles.map(([path]) => path).join(', '), found: uniq([python.language, ...python.frameworks]).join(', ') });
    }
  }

  for (const [path, text] of get((path) => /pom\.xml$|build\.gradle(\.kts)?$/.test(path))) {
    const java = detectJava(text);
    if (java) {
      detected.push(java);
      evidence.push({ file: path, found: uniq([java.runtime, ...java.frameworks]).join(', ') || 'Java' });
    }
  }

  for (const [path, text] of get((path) => path.endsWith('go.mod'))) {
    const go = detectGo(text);
    detected.push(go);
    evidence.push({ file: path, found: go.runtime ?? 'Go' });
  }

  for (const [path, text] of get((path) => path.endsWith('composer.json'))) {
    const php = detectPhp(text);
    if (php) {
      detected.push(php);
      evidence.push({ file: path, found: uniq([php.runtime, ...php.frameworks]).join(', ') || 'PHP' });
    }
  }

  const containers = [...manifests.keys()].filter((path) => /Dockerfile$|docker-compose\.ya?ml$/.test(path));
  const frameworks = uniq(detected.flatMap((entry) => entry.frameworks ?? []));
  const runtimes = uniq(detected.map((entry) => entry.runtime));
  const testFrameworks = uniq(detected.flatMap((entry) => entry.testFrameworks ?? []));
  const share = languageShare(languageCounts);
  const languages = uniq([...detected.map((entry) => entry.language), ...share.map((entry) => entry.language)]);

  const commands = { install: '', dev: '', lint: '', format: '', typecheck: '', test: '', build: '' };
  for (const entry of detected) Object.assign(commands, Object.fromEntries(Object.entries(entry.commands ?? {}).filter(([, value]) => value)));

  const unknown = [];
  if (!commands.test) unknown.push('commands.test');
  if (!commands.build) unknown.push('commands.build');
  if (!frameworks.length) unknown.push('stack frameworks');
  if (!ci.length) unknown.push('CI workflow');

  return {
    languages,
    share,
    runtimes,
    frameworks,
    testFrameworks,
    commands,
    containers,
    migrations,
    ci,
    evidence,
    unknown,
    stack: {
      languages,
      frontend: matching(frameworks, FRONTEND_HINTS).join(', '),
      backend: uniq([...matching(frameworks, BACKEND_HINTS), ...runtimes]).join(' on '),
      database: matching(frameworks, DATABASE_HINTS).join(', '),
      mobile: '',
      desktop: '',
      auth: '',
      hosting: containers.length ? 'Containers detected (see Dockerfile / compose files)' : '',
      other: uniq([...testFrameworks.map((name) => `Tests: ${name}`), ...(containers.length ? ['Containerised'] : [])]),
    },
  };
}

const TABLE_PATTERNS = [
  /CreateTable\(\s*"(?:dbo\.)?([A-Za-z0-9_]+)"\s*,\s*c\s*=>\s*new\s*\{([\s\S]*?)\}\s*\)/g,
  /CreateTable\(\s*name:\s*"([A-Za-z0-9_]+)"[\s\S]*?columns:\s*table\s*=>\s*new\s*\{([\s\S]*?)\}\s*,?\s*constraints/g,
];
const COLUMN_PATTERN = /([A-Za-z0-9_]+)\s*=\s*(?:c|table)\.(?:Column<([A-Za-z0-9_?]+)>|([A-Za-z0-9_]+))\s*\(/g;

/**
 * Build an erDiagram from EF6 or EF Core migration sources.
 * Returns null when nothing parses, so callers can say so rather than emit an empty diagram.
 */
export function erDiagramFrom(sources) {
  const tables = new Map();
  for (const text of sources) {
    for (const pattern of TABLE_PATTERNS) {
      for (const [, table, body] of text.matchAll(pattern)) {
        const columns = [];
        for (const [, name, generic, method] of body.matchAll(COLUMN_PATTERN)) {
          columns.push({ name, type: (generic ?? method ?? 'unknown').replace('?', '') });
        }
        if (columns.length) tables.set(table, columns);
      }
    }
  }
  if (!tables.size) return null;

  const lines = ['erDiagram'];
  for (const [table, columns] of [...tables].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${table.toUpperCase()} {`);
    for (const column of columns) lines.push(`    ${column.type.toLowerCase()} ${column.name}`);
    lines.push('  }');
  }
  return lines.join('\n');
}
