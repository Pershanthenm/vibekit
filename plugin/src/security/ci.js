import { stackFamily } from './controls.js';

const DEPENDENCY_AUDIT = {
  dotnet: ['uses: actions/setup-dotnet@v4\n        with: { dotnet-version: "9.0.x" }', 'run: |\n          dotnet restore\n          dotnet list package --vulnerable --include-transitive | tee audit.txt\n          ! grep -q "has the following vulnerable packages" audit.txt\n          find . -name package-lock.json -not -path "*/node_modules/*" -execdir npm audit --audit-level=high \\;'],
  php: ['uses: shivammathur/setup-php@v2\n        with: { php-version: "8.3" }', 'run: |\n          composer install --no-interaction --no-scripts\n          composer audit\n          npm audit --audit-level=high'],
  node: ['uses: actions/setup-node@v4\n        with: { node-version: 22 }', 'run: npm audit --audit-level=high'],
  python: ['uses: actions/setup-python@v5\n        with: { python-version: "3.12" }', 'run: |\n          pip install pip-audit\n          pip-audit -r requirements.txt'],
  java: ['uses: actions/setup-java@v4\n        with: { distribution: temurin, java-version: 21 }', 'run: ./mvnw -B org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7'],
  generic: ['run: echo "Add your dependency audit command here" && exit 1'],
};

const checkout = ({ fetchDepth } = {}) => `      - uses: actions/checkout@v4${fetchDepth === 0 ? '\n        with: { fetch-depth: 0 }' : ''}`;
const jobEnv = ({ env } = {}) => (env ? `    env:\n${Object.entries(env).map(([key, value]) => `      ${key}: ${value}`).join('\n')}\n` : '');
const job = (name, steps, options) => `  ${name}:\n    runs-on: ubuntu-latest\n${jobEnv(options)}    steps:\n${checkout(options)}\n${steps.map((step) => `      - ${step}`).join('\n')}`;

const JOBS = {
  'secrets-scan': () => job('secrets', ['run: docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact --exit-code 1'], { fetchDepth: 0 }),
  sast: () => job('sast', ['run: docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config auto --error /src']),
  deps: (family) => job('dependencies', DEPENDENCY_AUDIT[family] ?? DEPENDENCY_AUDIT.generic),
  containers: () => job('containers', ['run: docker run --rm -v "$PWD:/src" aquasec/trivy:latest fs --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 /src']),
  dast: () => job('dast', [
    'name: ZAP baseline against staging (set the STAGING_URL secret)\n        if: env.STAGING_URL != \'\'\n        run: docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t "$STAGING_URL"',
  ], { env: { STAGING_URL: '${{ secrets.STAGING_URL }}' } }),
};

export function renderSecurityWorkflow(project) {
  const family = stackFamily(project);
  const jobs = Object.entries(JOBS).filter(([id]) => project.security.controls.includes(id)).map(([, render]) => render(family));
  if (!jobs.length) return null;
  return `# Generated once by VibeKit from the security baseline. Yours to edit.\nname: security\non:\n  push:\n  pull_request:\npermissions:\n  contents: read\njobs:\n${jobs.join('\n\n')}\n`;
}
