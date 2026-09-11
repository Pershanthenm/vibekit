const ALIASES = {
  ts: 'typescript',
  js: 'javascript',
  node: 'javascript',
  'node.js': 'javascript',
  py: 'python',
  golang: 'go',
  flutter: 'dart',
  csharp: 'c#',
  dotnet: 'c#',
  '.net': 'c#',
};

export const normalizeLanguage = (name) => {
  const key = name.trim().toLowerCase();
  return ALIASES[key] ?? key;
};

const EMPTY_COMMANDS = { install: '', dev: '', lint: '', format: '', typecheck: '', test: '', smoke: '', ui: '', build: '' };

const NODE_COMMANDS = {
  install: 'npm install',
  dev: 'npm run dev',
  lint: 'npm run lint',
  format: 'npm run format',
  typecheck: 'npm run typecheck',
  test: 'npm test',
  smoke: 'npm run test:smoke',
  ui: 'npm run test:ui',
  build: 'npm run build',
};

const GRADLE_COMMANDS = {
  install: './gradlew dependencies',
  dev: '',
  lint: './gradlew lint',
  format: './gradlew spotlessApply',
  typecheck: './gradlew assemble',
  test: './gradlew test',
  smoke: './gradlew test --tests "*Smoke*"',
  ui: '',
  build: './gradlew build',
};

const COMMAND_PRESETS = {
  typescript: NODE_COMMANDS,
  javascript: { ...NODE_COMMANDS, typecheck: '' },
  python: {
    install: 'uv sync',
    dev: 'uv run python -m app',
    lint: 'uv run ruff check .',
    format: 'uv run ruff format .',
    typecheck: 'uv run mypy .',
    test: 'uv run pytest',
    smoke: 'uv run pytest -m smoke',
    ui: 'uv run pytest -m ui',
    build: 'uv build',
  },
  go: {
    install: 'go mod download',
    dev: 'go run .',
    lint: 'golangci-lint run',
    format: 'gofmt -w .',
    typecheck: 'go vet ./...',
    test: 'go test ./...',
    smoke: 'go test -run Smoke ./...',
    ui: '',
    build: 'go build ./...',
  },
  dart: {
    install: 'flutter pub get',
    dev: 'flutter run',
    lint: 'flutter analyze',
    format: 'dart format .',
    typecheck: '',
    test: 'flutter test',
    smoke: 'flutter test integration_test --tags smoke',
    ui: 'flutter test integration_test',
    build: '',
  },
  'c#': {
    install: 'dotnet restore',
    dev: 'dotnet run',
    lint: 'dotnet format --verify-no-changes',
    format: 'dotnet format',
    typecheck: 'dotnet build',
    test: 'dotnet test',
    smoke: 'dotnet test --filter Category=Smoke',
    ui: 'dotnet test --filter Category=UI',
    build: 'dotnet build -c Release',
  },
  rust: {
    install: 'cargo fetch',
    dev: 'cargo run',
    lint: 'cargo clippy -- -D warnings',
    format: 'cargo fmt',
    typecheck: 'cargo check',
    test: 'cargo test',
    smoke: 'cargo test smoke',
    ui: '',
    build: 'cargo build --release',
  },
  php: {
    install: 'composer install',
    dev: 'php -S localhost:8000 -t public',
    lint: 'vendor/bin/phpstan analyse',
    format: 'vendor/bin/php-cs-fixer fix',
    typecheck: '',
    test: 'vendor/bin/phpunit',
    smoke: 'vendor/bin/phpunit --group smoke',
    ui: '',
    build: '',
  },
  kotlin: GRADLE_COMMANDS,
  java: GRADLE_COMMANDS,
  swift: {
    install: 'swift package resolve',
    dev: '',
    lint: 'swiftlint',
    format: 'swift-format -i -r .',
    typecheck: 'swift build',
    test: 'swift test',
    smoke: 'swift test --filter Smoke',
    ui: '',
    build: 'swift build -c release',
  },
};

export function commandPresetFor(languages) {
  const known = languages.map(normalizeLanguage).find((language) => COMMAND_PRESETS[language]);
  return { ...EMPTY_COMMANDS, ...COMMAND_PRESETS[known] };
}

export const LANGUAGE_RULES = {
  typescript: {
    globs: '**/*.ts,**/*.tsx',
    rules: [
      'Strict mode; no `any` — use `unknown` and narrow.',
      'Validate all external input at the boundary (e.g. zod) and derive types from schemas.',
      'Prefer named exports; one component per file.',
    ],
  },
  javascript: {
    globs: '**/*.js,**/*.jsx,**/*.mjs',
    rules: ['ES modules only.', 'JSDoc types on exported functions.'],
  },
  python: {
    globs: '**/*.py',
    rules: [
      'Type hints on every public function; code is mypy-clean.',
      'Dataclasses or pydantic models for structured data — no loose dicts across layers.',
      'No bare `except`; catch specific exceptions.',
    ],
  },
  go: {
    globs: '**/*.go',
    rules: [
      'Wrap errors with context: `fmt.Errorf("doing x: %w", err)`.',
      'Accept interfaces, return structs.',
      '`context.Context` is the first parameter of anything doing I/O.',
    ],
  },
  dart: {
    globs: '**/*.dart',
    rules: [
      'Sound null safety; avoid the `!` operator.',
      'Small widgets; business logic lives outside widgets.',
      'Use `const` constructors wherever possible.',
    ],
  },
  'c#': {
    globs: '**/*.cs',
    rules: [
      'Nullable reference types enabled.',
      'Async all the way — never `.Result` or `.Wait()`.',
      'Constructor injection for dependencies.',
    ],
  },
  rust: {
    globs: '**/*.rs',
    rules: [
      'No `unwrap()`/`expect()` outside tests.',
      '`thiserror` for library errors, `anyhow` at application edges.',
      'Clippy-clean with `-D warnings`.',
    ],
  },
  php: {
    globs: '**/*.php',
    rules: ['`declare(strict_types=1);` in every file; PSR-12 style.', 'Validate input in Form Request classes, never in controllers.', 'Typed properties and return types everywhere; PHPStan clean.'],
  },
  kotlin: {
    globs: '**/*.kt,**/*.kts',
    rules: ['Prefer `val` and immutable data classes.', 'Structured concurrency; never `GlobalScope`.'],
  },
  swift: {
    globs: '**/*.swift',
    rules: ['Prefer value types (`struct`).', '`async/await` over completion handlers.', 'No force unwraps.'],
  },
  java: {
    globs: '**/*.java',
    rules: ['Records for data carriers.', 'Return `Optional` for absent values, never `null`.'],
  },
};

export const TEST_GLOBS = '**/*.test.*,**/*.spec.*,**/test_*.py,**/*_test.go,**/tests/**,**/__tests__/**';
