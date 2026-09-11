import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LAYERS = ['backend', 'web', 'mobile', 'desktop', 'database'];

export const LICENCE_CLASSES = {
  permissive: 'permissive open source',
  'weak-copyleft': 'weak copyleft (LGPL/MPL)',
  copyleft: 'copyleft (GPL)',
  'source-available': 'source-available, not OSI open source',
  proprietary: 'proprietary (free tier or paid)',
  platform: 'vendor platform SDKs (unavoidable for the target)',
};

const inDir = (dir, command) => (dir === '.' ? command : `(cd ${dir} && ${command})`);
const PLAYWRIGHT = { ui: 'npx playwright test', smoke: 'npx playwright test --grep @smoke' };
const npm = (dir, overrides = {}) => ({
  install: inDir(dir, 'npm ci'), dev: inDir(dir, 'npm run dev'), lint: inDir(dir, 'npm run lint'), format: inDir(dir, 'npm run format'),
  typecheck: inDir(dir, 'npm run typecheck'), test: inDir(dir, 'npm test'), smoke: inDir(dir, 'npm run test:smoke'), build: inDir(dir, 'npm run build'),
  ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, value && inDir(dir, value)])),
});
const dotnet = (ctx) => ({
  install: 'dotnet restore', dev: `dotnet watch --project src/${ctx.pascal}.WebApi`, lint: 'dotnet format --verify-no-changes',
  format: 'dotnet format', typecheck: 'dotnet build --no-restore', test: 'dotnet test', smoke: 'dotnet test --filter Category=Smoke', build: 'dotnet publish -c Release',
});
const dotnetUi = { ui: 'dotnet test --filter Category=UI', smoke: 'dotnet test --filter Category=Smoke' };
const dotnetClient = (ctx, dir) => (ctx.backendFamily === 'dotnet' ? { ...dotnetUi } : { install: inDir(dir, 'dotnet restore'), lint: inDir(dir, 'dotnet format --verify-no-changes'), test: inDir(dir, 'dotnet test'), ui: inDir(dir, dotnetUi.ui), smoke: inDir(dir, dotnetUi.smoke), build: inDir(dir, 'dotnet build -c Release') });
const gradle = (dir, ui = '') => ({ install: '', lint: inDir(dir, './gradlew lint'), typecheck: inDir(dir, './gradlew assemble'), test: inDir(dir, './gradlew check'), smoke: inDir(dir, './gradlew test --tests "*Smoke*"'), ui: ui && inDir(dir, ui), build: inDir(dir, './gradlew build') });
const uv = (dir, dev) => ({ install: inDir(dir, 'uv sync'), dev: inDir(dir, dev), lint: inDir(dir, 'uv run ruff check .'), format: inDir(dir, 'uv run ruff format .'), typecheck: inDir(dir, 'uv run mypy .'), test: inDir(dir, 'uv run pytest'), smoke: inDir(dir, 'uv run pytest -m smoke'), build: '' });

const component = (id, layers, label, languages, family, licence, summary, testing, commands) =>
  ({ id, layers: [layers].flat(), label, languages, family, licence: { name: licence[0], class: licence[1] }, summary, testing, commands });

export const BUILT_IN_COMPONENTS = [
  component('aspnetcore', 'backend', 'ASP.NET Core (.NET 9)', ['C#'], 'dotnet', ['MIT', 'permissive'], 'Clean Architecture API: EF Core, MediatR, Serilog', 'xUnit + FluentAssertions + Testcontainers', (ctx) => dotnet(ctx)),
  component('laravel', 'backend', 'Laravel 11 (PHP 8.3)', ['PHP'], 'php', ['MIT', 'permissive'], 'Batteries-included PHP framework', 'Pest + PHPUnit', (ctx, dir) => ({ install: inDir(dir, 'composer install'), dev: inDir(dir, 'php artisan serve'), lint: inDir(dir, 'vendor/bin/phpstan analyse'), format: inDir(dir, 'vendor/bin/pint'), test: inDir(dir, 'php artisan test'), smoke: inDir(dir, 'php artisan test --group=smoke'), ui: inDir(dir, 'php artisan dusk') })),
  component('nestjs', 'backend', 'NestJS (Node.js 22)', ['TypeScript'], 'node', ['MIT', 'permissive'], 'Structured TypeScript API with Prisma', 'Vitest + Supertest', (ctx, dir) => npm(dir)),
  component('fastapi', 'backend', 'FastAPI (Python 3.12)', ['Python'], 'python', ['MIT', 'permissive'], 'Async Python API with Pydantic and SQLAlchemy', 'pytest + httpx', (ctx, dir) => uv(dir, 'uv run fastapi dev')),
  component('django', 'backend', 'Django 5 + DRF (Python)', ['Python'], 'python', ['BSD-3-Clause', 'permissive'], 'Admin, ORM and REST framework included', 'pytest + pytest-django', (ctx, dir) => uv(dir, 'uv run python manage.py runserver')),
  component('spring', 'backend', 'Spring Boot 3 (Java 21)', ['Java'], 'java', ['Apache-2.0', 'permissive'], 'Enterprise JVM stack', 'JUnit 5 + Testcontainers', (ctx, dir) => gradle(dir)),
  component('go', 'backend', 'Go (net/http + chi)', ['Go'], 'go', ['BSD-3-Clause', 'permissive'], 'Single static binary, very efficient', 'go test + testcontainers-go', (ctx, dir) => ({ install: inDir(dir, 'go mod download'), dev: inDir(dir, 'go run ./cmd/api'), lint: inDir(dir, 'golangci-lint run'), format: inDir(dir, 'gofmt -w .'), typecheck: inDir(dir, 'go vet ./...'), test: inDir(dir, 'go test ./...'), smoke: inDir(dir, 'go test -run Smoke ./...'), build: inDir(dir, 'go build ./...') })),
  component('rails', 'backend', 'Ruby on Rails 8', ['Ruby'], 'ruby', ['MIT', 'permissive'], 'Convention-driven full-stack framework', 'Minitest + system tests', (ctx, dir) => ({ install: inDir(dir, 'bundle install'), dev: inDir(dir, 'bin/rails server'), lint: inDir(dir, 'bin/rubocop'), test: inDir(dir, 'bin/rails test'), smoke: inDir(dir, 'bin/rails test test/smoke'), ui: inDir(dir, 'bin/rails test:system') })),
  component('supabase', 'backend', 'Supabase (backend-as-a-service)', ['SQL', 'TypeScript'], 'supabase', ['Apache-2.0', 'permissive'], 'Postgres, auth, storage and edge functions; self-hostable', 'pgTAP + Vitest', (ctx, dir) => ({ dev: inDir(dir, 'supabase start'), test: inDir(dir, 'supabase test db') })),
  component('firebase', 'backend', 'Firebase (backend-as-a-service)', ['TypeScript'], 'firebase', ['Proprietary service', 'proprietary'], 'Google-hosted auth, Firestore and functions', 'Firebase emulator + Vitest', (ctx, dir) => ({ dev: inDir(dir, 'firebase emulators:start'), test: inDir(dir, 'firebase emulators:exec "npm test"') })),
  component('none', 'backend', 'No backend (local-only app)', [], 'none', ['n/a', 'permissive'], 'Everything runs on the device', '', () => ({})),

  component('vue', 'web', 'Vue 3 + Vite + Pinia', ['TypeScript'], 'web', ['MIT', 'permissive'], 'Approachable SPA framework, SCSS design system', 'Vitest + Vue Test Utils + Playwright', (ctx, dir) => npm(dir, { typecheck: 'npm run type-check', test: 'npm run test:unit', ...PLAYWRIGHT })),
  component('react-next', 'web', 'Next.js (React)', ['TypeScript'], 'web', ['MIT', 'permissive'], 'React with server rendering and routing', 'Vitest + Testing Library + Playwright', (ctx, dir) => npm(dir, PLAYWRIGHT)),
  component('angular', 'web', 'Angular', ['TypeScript'], 'web', ['MIT', 'permissive'], 'Opinionated enterprise SPA framework', 'Jest + Playwright', (ctx, dir) => npm(dir, PLAYWRIGHT)),
  component('sveltekit', 'web', 'SvelteKit', ['TypeScript'], 'web', ['MIT', 'permissive'], 'Lean compiled UI with server routes', 'Vitest + Playwright', (ctx, dir) => npm(dir, PLAYWRIGHT)),
  component('blazor', 'web', 'Blazor Web App', ['C#'], 'dotnet', ['MIT', 'permissive'], 'C# end to end, no JavaScript framework', 'bUnit + Playwright', () => ({ ...dotnetUi })),
  component('htmx', 'web', 'Server-rendered + HTMX', ['HTML'], 'web', ['0BSD', 'permissive'], 'Pages rendered by the backend, sprinkled interactivity', 'Backend tests + Playwright', (ctx, dir) => ({ ui: inDir(dir, PLAYWRIGHT.ui), smoke: inDir(dir, PLAYWRIGHT.smoke) })),
  component('flutter-web', 'web', 'Flutter for web', ['Dart'], 'flutter', ['BSD-3-Clause', 'permissive'], 'Same Flutter code as mobile and desktop', 'flutter test', () => ({})),

  component('flutter', ['mobile', 'desktop'], 'Flutter', ['Dart'], 'flutter', ['BSD-3-Clause', 'permissive'], 'One codebase for iOS, Android, desktop and web', 'flutter test + integration_test', (ctx, dir) => ({ install: inDir(dir, 'flutter pub get'), dev: inDir(dir, 'flutter run'), lint: inDir(dir, 'flutter analyze'), format: inDir(dir, 'dart format .'), test: inDir(dir, 'flutter test'), smoke: inDir(dir, 'flutter test integration_test --tags smoke'), ui: inDir(dir, 'flutter test integration_test') })),
  component('react-native', 'mobile', 'React Native (Expo)', ['TypeScript'], 'web', ['MIT', 'permissive'], 'Native apps in TypeScript, shares code with React web', 'Jest + Maestro', (ctx, dir) => npm(dir, { dev: 'npx expo start', build: '', ui: 'maestro test .maestro', smoke: 'maestro test .maestro/smoke' })),
  component('maui', ['mobile', 'desktop'], '.NET MAUI', ['C#'], 'dotnet', ['MIT', 'permissive'], 'C# apps for iOS, Android, Windows and macOS', 'xUnit + Appium', (ctx, dir) => dotnetClient(ctx, dir)),
  component('native', 'mobile', 'Native: SwiftUI + Jetpack Compose', ['Swift', 'Kotlin'], 'native', ['Apple and Google SDKs', 'platform'], 'Best platform fidelity; two codebases', 'XCTest + JUnit/Espresso', (ctx, dir) => ({ smoke: inDir(dir, 'maestro test .maestro/smoke'), ui: `${inDir(`${dir}/android`, './gradlew connectedAndroidTest')} && ${inDir(`${dir}/ios`, 'xcodebuild test -scheme AppUITests -destination "platform=iOS Simulator,name=iPhone 16"')}`, test: `${inDir(`${dir}/android`, './gradlew test')} && ${inDir(`${dir}/ios`, 'xcodebuild test -scheme App -destination "platform=iOS Simulator,name=iPhone 16"')}` })),
  component('kmp', ['mobile', 'desktop'], 'Kotlin Multiplatform + Compose', ['Kotlin'], 'kotlin', ['Apache-2.0', 'permissive'], 'Shared Kotlin logic and UI across platforms', 'kotlin.test + JUnit', (ctx, dir) => gradle(dir, './gradlew connectedCheck')),
  component('capacitor', 'mobile', 'Ionic + Capacitor', ['TypeScript'], 'web', ['MIT', 'permissive'], 'Web app packaged as native apps', 'Vitest + Playwright', (ctx, dir) => npm(dir, PLAYWRIGHT)),

  component('tauri', 'desktop', 'Tauri 2 (Rust + web UI)', ['Rust', 'TypeScript'], 'rust', ['MIT/Apache-2.0', 'permissive'], 'Small, secure desktop apps with a web front end', 'Vitest + cargo test', (ctx, dir) => npm(dir, { dev: 'npm run tauri dev', test: 'npm test && cargo test --manifest-path src-tauri/Cargo.toml', ui: 'npm run test:ui', build: 'npm run tauri build' })),
  component('electron', 'desktop', 'Electron', ['TypeScript'], 'web', ['MIT', 'permissive'], 'Web tech desktop apps with a large ecosystem', 'Vitest + Playwright for Electron', (ctx, dir) => npm(dir, PLAYWRIGHT)),
  component('avalonia', 'desktop', 'Avalonia UI (.NET)', ['C#'], 'dotnet', ['MIT', 'permissive'], 'Cross-platform .NET desktop (Windows, macOS, Linux)', 'xUnit + Avalonia.Headless', (ctx, dir) => dotnetClient(ctx, dir)),
  component('wpf', 'desktop', 'WPF (.NET, Windows only)', ['C#'], 'dotnet', ['MIT', 'permissive'], 'Mature Windows desktop framework', 'xUnit + FlaUI', (ctx, dir) => dotnetClient(ctx, dir)),
  component('qt', 'desktop', 'Qt 6 (C++)', ['C++'], 'cpp', ['LGPL-3.0 or commercial', 'weak-copyleft'], 'Native-feel C++ desktop and embedded', 'Qt Test + CTest', (ctx, dir) => ({ build: `cmake -S ${dir} -B build && cmake --build build`, test: 'ctest --test-dir build', smoke: 'ctest --test-dir build -L smoke', ui: 'ctest --test-dir build -L ui' })),
  component('compose-desktop', 'desktop', 'Compose Multiplatform (Kotlin)', ['Kotlin'], 'kotlin', ['Apache-2.0', 'permissive'], 'Kotlin desktop UI, shares code with Android', 'kotlin.test', (ctx, dir) => gradle(dir)),

  component('postgres', 'database', 'PostgreSQL 16', [], 'sql', ['PostgreSQL License', 'permissive'], 'Relational workhorse with JSONB and full-text search', '', () => ({})),
  component('mysql', 'database', 'MySQL 8 Community', [], 'sql', ['GPL-2.0', 'copyleft'], 'Widely hosted relational database', '', () => ({})),
  component('mariadb', 'database', 'MariaDB 11', [], 'sql', ['GPL-2.0', 'copyleft'], 'Community MySQL fork', '', () => ({})),
  component('sqlserver', 'database', 'SQL Server 2022', [], 'sql', ['Commercial (Express is free)', 'proprietary'], 'Microsoft relational database', '', () => ({})),
  component('sqlite', 'database', 'SQLite', [], 'sql', ['Public domain', 'permissive'], 'Embedded, zero-ops; ideal on devices', '', () => ({})),
  component('mongodb', 'database', 'MongoDB', [], 'document', ['SSPL', 'source-available'], 'Document database for flexible schemas', '', () => ({})),
];

export const PRESETS = {
  'dotnet-vue': { backend: 'aspnetcore', web: 'vue', mobile: 'maui', desktop: 'avalonia', database: 'postgres' },
  'dotnet-blazor': { backend: 'aspnetcore', web: 'blazor', mobile: 'maui', desktop: 'wpf', database: 'sqlserver' },
  'php-laravel': { backend: 'laravel', web: 'vue', mobile: 'flutter', desktop: 'tauri', database: 'mysql' },
  'node-ts': { backend: 'nestjs', web: 'react-next', mobile: 'react-native', desktop: 'electron', database: 'postgres' },
  'python-django': { backend: 'django', web: 'htmx', mobile: 'flutter', desktop: 'tauri', database: 'postgres' },
  'java-spring': { backend: 'spring', web: 'angular', mobile: 'kmp', desktop: 'compose-desktop', database: 'postgres' },
  'flutter-supabase': { backend: 'supabase', web: 'flutter-web', mobile: 'flutter', desktop: 'flutter' },
  'local-desktop': { backend: 'none', desktop: 'tauri', database: 'sqlite' },
};

const userComponentsPath = () => join(process.env.VIBECHECK_HOME || join(homedir(), '.vibe-check-cli'), 'components.json');

function toComponent(raw) {
  const commands = raw.commands ?? {};
  return {
    ...raw,
    layers: [raw.layers ?? raw.layer].flat().filter(Boolean),
    languages: raw.languages ?? [],
    family: raw.family ?? 'generic',
    licence: { name: raw.licence?.name ?? 'unknown', class: raw.licence?.class ?? 'proprietary' },
    custom: true,
    commands: (ctx, dir) => Object.fromEntries(Object.entries(commands).map(([key, value]) => [key, inDir(dir, value)])),
  };
}

export function loadUserComponents() {
  try {
    return JSON.parse(readFileSync(userComponentsPath(), 'utf8')).map(toComponent);
  } catch {
    return [];
  }
}

export const allComponents = () => [...BUILT_IN_COMPONENTS, ...loadUserComponents()];
export const findComponent = (id) => allComponents().find((item) => item.id === id);
export const componentsFor = (layer) => allComponents().filter((item) => item.layers.includes(layer));
export { userComponentsPath };
