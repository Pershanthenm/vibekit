import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'out', 'vendor', 'packages', '.next', '.venv', 'venv', '__pycache__', 'target', 'coverage']);
const MANIFEST_NAMES = new Set(['package.json', 'packages.config', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'requirements.txt', 'pyproject.toml', 'composer.json', 'go.mod', 'Gemfile', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']);
const MANIFEST_EXTS = new Set(['.csproj', '.fsproj']);
const MAX_DEPTH = 4;
const MAX_MANIFEST_BYTES = 512_000;

const LANGUAGE_BY_EXT = {
  '.cs': 'C#', '.fs': 'F#', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.vue': 'JavaScript', '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin', '.go': 'Go', '.rb': 'Ruby',
  '.php': 'PHP', '.swift': 'Swift', '.rs': 'Rust', '.dart': 'Dart', '.scala': 'Scala',
};

const isManifest = (name) => MANIFEST_NAMES.has(name) || MANIFEST_EXTS.has(extname(name)) || /^requirements.*\.txt$/.test(name);

/** Walk the repository once, collecting manifest contents, language counts and top-level structure. */
export async function inspect(root, { maxDepth = MAX_DEPTH } = {}) {
  const manifests = new Map();
  const languageCounts = new Map();
  const dirs = new Set();
  const ci = [];
  const migrations = [];

  async function walk(dir, depth) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      const slashed = rel.split(sep).join('/');
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || depth >= maxDepth) continue;
        if (!rel.includes(sep)) dirs.add(entry.name);
        await walk(full, depth + 1);
        continue;
      }
      const language = LANGUAGE_BY_EXT[extname(entry.name)];
      if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
      if (/^\.github\/workflows\//.test(slashed)) ci.push(slashed);
      if (/migrations?\//i.test(slashed) && /\.(cs|py|rb|sql|js|ts)$/.test(entry.name)) migrations.push(slashed);
      if (!isManifest(entry.name)) continue;
      try {
        if ((await stat(full)).size < MAX_MANIFEST_BYTES) manifests.set(slashed, await readFile(full, 'utf8'));
      } catch { /* unreadable: reported as not inspected rather than guessed */ }
    }
  }

  await walk(root, 0);
  await walk(join(root, '.github', 'workflows'), MAX_DEPTH - 1);
  return { manifests, languageCounts, dirs: [...dirs].sort(), ci, migrations: migrations.sort() };
}

/** Languages ordered by share of the files carrying a known extension. */
export function languageShare(languageCounts) {
  const total = [...languageCounts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return [];
  return [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([language, files]) => ({ language, files, share: Math.round((files / total) * 100) }));
}

const jsonOrNull = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const cleanVersion = (value) => String(value ?? '').replace(/^[\^~><= ]+/, '').trim();

const NODE_FRAMEWORKS = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@angular/core', 'Angular'], ['angular', 'AngularJS'],
  ['vue', 'Vue'], ['react', 'React'], ['svelte', 'Svelte'], ['express', 'Express'],
  ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'], ['koa', 'Koa'],
];
const NODE_TEST = [['vitest', 'Vitest'], ['jest', 'Jest'], ['mocha', 'Mocha'], ['@playwright/test', 'Playwright'], ['cypress', 'Cypress'], ['karma', 'Karma'], ['jasmine', 'Jasmine']];

export function detectNode(text) {
  const pkg = jsonOrNull(text);
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const named = (pairs) => pairs.filter(([id]) => deps[id]).map(([id, label]) => `${label} ${cleanVersion(deps[id])}`.trim());
  const scripts = pkg.scripts ?? {};
  const manager = pkg.packageManager?.startsWith('pnpm') ? 'pnpm' : pkg.packageManager?.startsWith('yarn') ? 'yarn' : 'npm';
  const script = (name) => (scripts[name] ? `${manager}${manager === 'npm' ? ' run' : ''} ${name}` : '');
  return {
    language: deps.typescript || pkg.types ? 'TypeScript' : 'JavaScript',
    frameworks: named(NODE_FRAMEWORKS),
    testFrameworks: named(NODE_TEST),
    commands: { install: `${manager} install`, dev: script('dev'), lint: script('lint'), test: script('test'), build: script('build') },
  };
}

const TFM_NAMES = { net48: '.NET Framework 4.8', net472: '.NET Framework 4.7.2', net471: '.NET Framework 4.7.1', net47: '.NET Framework 4.7', net462: '.NET Framework 4.6.2', net461: '.NET Framework 4.6.1', net45: '.NET Framework 4.5' };

function friendlyTfm(tfm) {
  if (TFM_NAMES[tfm]) return TFM_NAMES[tfm];
  if (/^netcoreapp/.test(tfm)) return `.NET Core ${tfm.replace('netcoreapp', '')}`;
  if (/^net\d+\.\d+$/.test(tfm)) return `.NET ${tfm.replace('net', '')}`;
  return tfm;
}

export function detectDotnet(projectText = '', packagesConfigText = '') {
  const legacy = projectText.match(/<TargetFrameworkVersion>v([\d.]+)<\/TargetFrameworkVersion>/)?.[1];
  const moniker = projectText.match(/<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/)?.[1]?.split(';')[0]?.trim();
  const runtime = legacy ? `.NET Framework ${legacy}` : moniker ? friendlyTfm(moniker) : null;

  const packages = new Map();
  for (const [, id, version] of packagesConfigText.matchAll(/<package\s+id="([^"]+)"\s+version="([^"]+)"/g)) packages.set(id, version);
  for (const [, id, version] of projectText.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) packages.set(id, version);

  const frameworks = [];
  const mvc = packages.get('Microsoft.AspNet.Mvc');
  if (mvc) frameworks.push(`ASP.NET MVC ${mvc.split('.')[0]}`);
  if (/Microsoft\.NET\.Sdk\.Web/.test(projectText)) frameworks.push('ASP.NET Core');
  if (packages.has('Microsoft.AspNet.WebApi.Core')) frameworks.push('ASP.NET Web API');
  const ef6 = packages.get('EntityFramework');
  if (ef6) frameworks.push(`Entity Framework ${ef6.split('.')[0]}`);
  if ([...packages.keys()].some((id) => id.startsWith('Microsoft.EntityFrameworkCore'))) frameworks.push('EF Core');

  const labels = { xunit: 'xUnit', NUnit: 'NUnit', 'MSTest.TestFramework': 'MSTest' };
  const testFrameworks = Object.keys(labels).filter((id) => packages.has(id)).map((id) => labels[id]);

  return { language: 'C#', runtime, frameworks, testFrameworks, packages };
}

export function detectPython(texts = []) {
  const text = texts.join('\n');
  if (!text.trim()) return null;
  const has = (name) => new RegExp(`(^|[\\n"'\\[])${name}\\b`, 'i').test(text);
  return {
    language: 'Python',
    frameworks: [['django', 'Django'], ['fastapi', 'FastAPI'], ['flask', 'Flask']].filter(([id]) => has(id)).map(([, label]) => label),
    testFrameworks: has('pytest') ? ['pytest'] : [],
  };
}

export function detectJava(text = '') {
  if (!text.trim()) return null;
  const frameworks = [];
  if (/spring-boot/.test(text)) frameworks.push('Spring Boot');
  if (/quarkus/.test(text)) frameworks.push('Quarkus');
  const version = text.match(/<maven\.compiler\.source>([^<]+)</)?.[1] ?? text.match(/<java\.version>([^<]+)</)?.[1];
  return { language: 'Java', runtime: version ? `Java ${version}` : null, frameworks, testFrameworks: /junit/.test(text) ? ['JUnit'] : [] };
}

export function detectGo(text = '') {
  const version = text.match(/^go\s+([\d.]+)/m)?.[1];
  return { language: 'Go', runtime: version ? `Go ${version}` : null, frameworks: [], testFrameworks: ['go test'] };
}

export function detectPhp(text = '') {
  const composer = jsonOrNull(text);
  if (!composer) return null;
  const deps = { ...composer.require, ...composer['require-dev'] };
  return {
    language: 'PHP',
    runtime: deps.php ? `PHP ${cleanVersion(deps.php)}` : null,
    frameworks: [['laravel/framework', 'Laravel'], ['symfony/framework-bundle', 'Symfony']].filter(([id]) => deps[id]).map(([id, label]) => `${label} ${cleanVersion(deps[id])}`.trim()),
    testFrameworks: deps['phpunit/phpunit'] ? ['PHPUnit'] : [],
  };
}
