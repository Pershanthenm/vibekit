import { commandPresetFor } from '../languages.js';
import { findComponent } from './components.js';
import { BAAS, STATIC_QUESTIONS, hasServer, targetsOf } from './questions.js';
import { findStarter } from './starters.js';

const SECURITY_RULES = {
  'rbac-audit': 'Authorization is role- and policy-based and enforced on the server; every state change writes an audit entry (who, what, when, before/after).',
  mfa: 'MFA (TOTP or WebAuthn) is required for privileged roles.',
  encryption: 'Sensitive fields are encrypted at rest, TLS is used everywhere, and secrets live in a vault, never in config files.',
  hardening: 'Security headers (CSP, HSTS), rate limiting, strict input validation, and dependency plus container scanning in CI.',
};
const COMPLIANCE = {
  standard: { security: 'OWASP ASVS Level 1' },
  elevated: { security: 'OWASP ASVS Level 2, ISO 27001-ready controls' },
  privacy: { security: 'OWASP ASVS Level 2', privacy: 'POPIA / GDPR: lawful basis, data minimisation, subject access and deletion, breach logging' },
  strict: { security: 'OWASP ASVS Level 3, independent penetration test before launch' },
};
const INTEGRATIONS = {
  directory: 'LDAP / Active Directory + SCIM provisioning',
  email: 'SMTP notifications (TLS)',
  devices: 'Device management sync (Intune / Jamf APIs)',
  reporting: 'Reporting exports (CSV / Excel) + BI connector',
};
const DATA_NOTES = {
  reporting: 'Full-text search and reporting views in the database; add a search engine only when needed',
  documents: 'JSON columns or a document store for flexible attributes',
  offline: 'Offline-first: local store on the device with sync and conflict handling',
};
const MODULAR_NOTES = ['Each module follows Clean Architecture: Domain, Application, Infrastructure, API.'];
const ARCHITECTURE = {
  'modular-clean': { style: 'modular-monolith', notes: MODULAR_NOTES },
  clean: { style: 'clean', notes: [] },
  microservices: { style: 'microservices', notes: [] },
  recommend: { style: 'modular-monolith', notes: [...MODULAR_NOTES, 'Modular monolith first; split out services only when a module needs independent scaling or deployment.'] },
};
const HOSTING = {
  dotnet: { linux: 'Ubuntu Server + Nginx + Docker Compose + systemd', windows: 'Windows Server + IIS (ASP.NET Core Module)', cloud: 'Azure App Service or any container platform', kubernetes: 'Kubernetes (Helm charts)' },
  php: { linux: 'Ubuntu Server + Nginx + PHP-FPM', windows: 'Windows Server + IIS + PHP via FastCGI', cloud: 'Managed PHP hosting (Laravel Cloud, Forge on AWS)', kubernetes: 'Kubernetes (Helm charts)' },
  node: { linux: 'Ubuntu Server + Nginx + Docker Compose', windows: 'Windows Server with Docker (Node on IIS needs iisnode)', cloud: 'Managed containers (Azure Container Apps, AWS, Cloud Run)', kubernetes: 'Kubernetes (Helm charts)' },
  python: { linux: 'Ubuntu Server + Nginx + Gunicorn/Uvicorn + systemd', windows: 'Windows Server + IIS + wfastcgi (poorly supported)', cloud: 'Managed containers (Azure Container Apps, AWS, Cloud Run)', kubernetes: 'Kubernetes (Helm charts)' },
  java: { linux: 'Ubuntu Server + Nginx + systemd', windows: 'Windows Server service (no IIS needed)', cloud: 'Managed containers or Azure Spring Apps', kubernetes: 'Kubernetes (Helm charts)' },
  go: { linux: 'Ubuntu Server + Nginx + systemd (single binary)', windows: 'Windows service (single binary)', cloud: 'Managed containers (Cloud Run, Container Apps)', kubernetes: 'Kubernetes (Helm charts)' },
  ruby: { linux: 'Ubuntu Server + Nginx + Puma + systemd', windows: 'Not recommended on Windows Server', cloud: 'Managed containers (Render, Fly.io)', kubernetes: 'Kubernetes (Helm charts)' },
};
const BAAS_HOSTING = { supabase: 'Supabase Cloud, or self-hosted Supabase via Docker Compose', firebase: 'Firebase (Google Cloud)' };
const AUTH = {
  dotnet: { sso: 'OpenID Connect / SAML via ASP.NET Core authentication', local: 'ASP.NET Core Identity with TOTP MFA', social: 'ASP.NET Core external logins' },
  php: { sso: 'Laravel Socialite (OIDC) + a SAML2 package', local: 'Laravel Fortify with 2FA', social: 'Laravel Socialite' },
  node: { sso: 'OpenID Connect / SAML via Auth.js and a SAML strategy', local: 'Better Auth with TOTP', social: 'Auth.js' },
  python: { sso: 'Authlib / django-allauth (OIDC) + python3-saml', local: 'Framework auth + TOTP (pyotp / django-otp)', social: 'Authlib / django-allauth' },
  java: { sso: 'Spring Security OAuth2 / SAML2', local: 'Spring Security with TOTP', social: 'Spring Security OAuth2 client' },
  go: { sso: 'coreos/go-oidc + crewjam/saml', local: 'Session auth with argon2id + TOTP', social: 'golang.org/x/oauth2' },
  ruby: { sso: 'OmniAuth (OIDC / SAML)', local: 'Rails authentication generator + TOTP', social: 'OmniAuth' },
  supabase: { sso: 'Supabase Auth SSO (SAML)', local: 'Supabase Auth email + TOTP MFA', social: 'Supabase Auth OAuth providers' },
  firebase: { sso: 'Firebase Auth (OIDC / SAML via Identity Platform)', local: 'Firebase Auth email + MFA', social: 'Firebase Auth providers' },
  none: { sso: 'OIDC sign-in through the system browser (AppAuth)', local: 'Device sign-in / OS biometrics; no server accounts', social: 'OIDC sign-in through the system browser' },
};
const DISTRIBUTION = { mobile: 'App Store + Google Play (signed builds via Fastlane or EAS)', desktop: 'Signed installers (MSI / DMG / AppImage) with auto-update' };
const CODE_LAYERS = ['backend', 'web', 'mobile', 'desktop'];
const NON_CODE_LANGUAGES = ['SQL', 'HTML'];
const COMMAND_KEYS = ['install', 'dev', 'lint', 'format', 'typecheck', 'test', 'smoke', 'ui', 'build'];

const pascal = (name) => name.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, __, char) => char.toUpperCase());
const list = (value) => (Array.isArray(value) ? value : []);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function customComponent(layer, text) {
  return { id: `custom-${slug(text)}`, layers: [layer], label: text, languages: [], family: 'generic', licence: { name: 'unknown', class: 'unknown' }, summary: 'your choice', testing: '', custom: true, commands: () => ({}) };
}

export function resolveChoices(answers, result) {
  return Object.fromEntries(Object.keys(result.layers).map((layer) => {
    const answer = answers[layer];
    if (answer?.other) return [layer, customComponent(layer, answer.other)];
    const id = answer ?? result.layers[layer].ranked[0]?.id;
    const excluded = result.layers[layer].excluded.find((entry) => entry.id === id);
    if (excluded) throw new Error(`Cannot use ${excluded.label} for ${layer}: ${excluded.reason}.`);
    return [layer, findComponent(id)];
  }));
}

function layoutFor(choices, name) {
  const SHARES_ANOTHER_PROJECT = ['none', 'blazor', 'htmx', 'flutter-web'];
  const codeLayers = CODE_LAYERS.filter((layer, index) => choices[layer] && !SHARES_ANOTHER_PROJECT.includes(choices[layer].id)
    && !CODE_LAYERS.slice(0, index).some((earlier) => choices[earlier]?.id === choices[layer].id));
  const dotnetHouse = choices.backend?.family === 'dotnet';
  const houseDirs = { backend: '.', web: `src/${pascal(name)}.WebApp`, mobile: `src/${pascal(name)}.Mobile`, desktop: `src/${pascal(name)}.Desktop` };
  return Object.fromEntries(codeLayers.map((layer) => [layer, codeLayers.length === 1 ? '.' : dotnetHouse ? houseDirs[layer] : layer]));
}

function combineCommands(choices, layout, context) {
  const hostDir = layout.backend ?? layout.mobile ?? '.';
  const shared = CODE_LAYERS.filter((layer) => choices[layer] && !layout[layer] && choices[layer].id !== 'none').map((layer) => [layer, choices[layer].commands(context, hostDir) ?? {}]);
  const perLayer = [...Object.entries(layout).map(([layer, dir]) => [layer, choices[layer].commands(context, dir) ?? {}]), ...shared];
  const combined = Object.fromEntries(COMMAND_KEYS.map((key) => {
    const parts = [...new Set(perLayer.map(([, commands]) => commands[key]).filter(Boolean))];
    return [key, key === 'dev' ? parts[0] ?? '' : parts.join(' && ')];
  }));
  if (!combined.test) combined.test = 'echo "Set the test command for your stack in specs/project.json" && exit 1';
  return combined;
}

function hostingFor(choices, answers) {
  const backend = choices.backend;
  if (BAAS_HOSTING[backend?.id]) return BAAS_HOSTING[backend.id];
  if (!hasServer(backend?.id) || backend.custom) return backend?.custom ? `${backend.label} (hosting to be decided)` : '';
  return HOSTING[backend.family]?.[answers.hosting ?? 'linux'] ?? HOSTING[backend.family]?.linux ?? '';
}

function signInFor(backend, answers) {
  const auth = AUTH[backend?.family] ?? AUTH[backend?.id] ?? AUTH.none;
  const choices = { sso: auth.sso, 'local-mfa': auth.local, social: auth.social, 'sso-and-local': `${auth.sso}; ${auth.local} for external users` };
  return choices[answers.signin] ?? auth.sso;
}

const describe = (item) => (item ? (item.custom ? item.label : `${item.label} — ${item.summary}`) : '');

const EMPTY_STARTER = { id: '', label: '', licence: '', scaffold: '', docs: '' };

/** The boilerplate the project starts from, flattened for project.json. "none" stays empty. */
function starterFor(answer) {
  if (answer?.other) return { ...EMPTY_STARTER, id: 'other', label: answer.other };
  const found = findStarter(answer);
  return found ? { id: found.id, label: found.label, licence: found.licence.name, scaffold: found.scaffold, docs: found.docs } : EMPTY_STARTER;
}

// Where a boilerplate and this tool disagree about layout or naming, the boilerplate wins — its
// generators and upgrades depend on its own conventions. Saying so here keeps agents from
// "correcting" a structure the framework owns.
const starterNote = (starter) => starter.id && `Generated from ${starter.label}; follow its conventions and directory layout where they differ from the notes above${starter.docs ? ` (${starter.docs})` : ''}.`;

function contextSettings(answers, base) {
  if (!Array.isArray(answers.context)) return {};
  return {
    memory: { ...base.memory, provider: answers.context.includes('agentmemory') ? 'agentmemory' : 'none' },
    knowledge: { ...base.knowledge, provider: answers.context.includes('opencontext') ? 'opencontext' : 'none' },
    docs: { ...base.docs, enabled: answers.context.includes('docs') },
  };
}

export function buildProject(base, answers, choices) {
  const layout = layoutFor(choices, base.project.name);
  const targets = [...new Set([...targetsOf(answers), ...(hasServer(choices.backend?.id) ? ['api'] : [])])];
  const architecture = ARCHITECTURE[answers.architecture] ?? ARCHITECTURE.recommend;
  const compliance = COMPLIANCE[answers.compliance] ?? COMPLIANCE.standard;
  const picked = Object.values(choices).filter(Boolean);
  const languages = [...new Set(picked.flatMap((item) => item.languages))].filter((name) => !NON_CODE_LANGUAGES.includes(name));
  const layoutNote = Object.keys(layout).length > 1 && `Repository layout: ${Object.entries(layout).map(([layer, dir]) => `${dir === '.' ? 'root' : `${dir}/`} (${choices[layer].label})`).join(', ')}.`;
  const starter = starterFor(answers.starter);
  const commands = combineCommands(choices, layout, { pascal: pascal(base.project.name), backendFamily: choices.backend?.family });
  return {
    ...base,
    targets,
    stack: {
      languages: languages.length ? languages : base.stack.languages,
      frontend: describe(choices.web),
      mobile: describe(choices.mobile),
      desktop: describe(choices.desktop),
      backend: choices.backend?.id === 'none' ? 'None (local-only app)' : describe(choices.backend),
      database: choices.database?.label ?? (choices.backend?.id === 'supabase' ? 'PostgreSQL (managed by Supabase)' : choices.backend?.id === 'firebase' ? 'Cloud Firestore' : ''),
      auth: signInFor(choices.backend, answers),
      hosting: hostingFor(choices, answers),
      other: [
        ...list(answers.integrations).map((id) => INTEGRATIONS[id]),
        DATA_NOTES[answers.data],
        choices.mobile && DISTRIBUTION.mobile,
        choices.desktop && DISTRIBUTION.desktop,
      ].filter(Boolean),
    },
    starter,
    architecture: { style: architecture.style, notes: [...architecture.notes, layoutNote, starterNote(starter)].filter(Boolean) },
    standards: {
      ...base.standards,
      testing: { ...base.standards.testing, framework: [...new Set(picked.map((item) => item.testing).filter(Boolean))].join(' · ') || base.standards.testing.framework },
      rules: [...new Set([...base.standards.rules, ...list(answers.security).map((id) => SECURITY_RULES[id])])],
    },
    commands: Object.values(commands).some(Boolean) ? commands : commandPresetFor(languages),
    workflow: { ...base.workflow, autonomy: answers.autonomy ?? base.workflow.autonomy, engine: answers.engine ?? base.workflow.engine },
    security: { ...base.security, stack: choices.backend?.id ?? '' },
    nfr: { ...base.nfr, security: compliance.security, privacy: compliance.privacy ?? base.nfr.privacy },
    ...contextSettings(answers, base),
  };
}

function answerLabel(question, value) {
  if (value?.other) return `Other: ${value.other}`;
  return [value].flat().map((id) => question.options.find((option) => option.id === id)?.label ?? id).join(', ');
}

const signed = (points) => (points > 0 ? `+${points}` : `${points}`);
const reasonsText = (entry) => entry.reasons.map((reason) => `${signed(reason.points)} ${reason.text}`).join('; ');

function layerSection(layer, ranking, chosen) {
  const winner = ranking.ranked.find((entry) => entry.id === chosen.id);
  const top = ranking.ranked[0];
  const header = `### ${layer[0].toUpperCase()}${layer.slice(1)}: ${chosen.label} (${chosen.licence.name})`;
  const why = winner ? `Score ${winner.score}${winner.id !== top.id ? ` (top recommendation ${top.label} scored ${top.score}; chosen deliberately)` : ''}. ${reasonsText(winner) || 'No scoring rules applied.'}` : 'Chosen by you (not in the catalogue).';
  const alternatives = ranking.ranked.filter((entry) => entry.id !== chosen.id).slice(0, 3).map((entry) => `- ${entry.label} — ${entry.score}${entry.reasons.length ? `: ${reasonsText(entry)}` : ''}`);
  const excluded = ranking.excluded.map((entry) => `- ${entry.label} — excluded: ${entry.reason}`);
  return [header, why, [...alternatives, ...excluded].join('\n')].filter(Boolean).join('\n\n');
}

// A boilerplate is a harder decision to reverse than a framework choice, so the ADR records what
// was on offer and what was ruled out — including the ones a licensing answer removed silently.
function starterSection(result) {
  const starters = result.starters;
  if (!starters?.ranked.length && !starters?.excluded.length) return '';
  const chosen = result.answers.starter;
  const picked = starters.ranked.find((item) => item.id === chosen);
  const heading = '### Starting point';
  const decision = picked
    ? `${picked.label} (${picked.licence.name}) — score ${picked.score}. ${picked.reasons.map((reason) => reason.text).join('; ') || 'No scoring rules applied.'}`
    : chosen?.other
      ? `${chosen.other} (entered by you; not in the catalogue).`
      : 'From scratch: no boilerplate. The layout and conventions are the ones vibecheck generates.';
  const alternatives = starters.ranked.filter((item) => item.id !== chosen).slice(0, 3)
    .map((item) => `- ${item.label} (${item.licence.name}) — ${item.summary}`);
  const excluded = starters.excluded.map((item) => `- ${item.label} — excluded: ${item.reason}`);
  const caveats = picked?.caveats.length ? `Known trade-offs:\n${picked.caveats.map((line) => `- ${line}`).join('\n')}` : '';
  return [heading, decision, caveats, [...alternatives, ...excluded].join('\n')].filter(Boolean).join('\n\n');
}

export function renderSelectionAdr({ number, date, result, choices }) {
  const requirementRows = STATIC_QUESTIONS.filter((question) => result.answers[question.id] !== undefined)
    .map((question) => `| ${question.header} | ${answerLabel(question, result.answers[question.id])} |`);
  const summary = Object.entries(choices).map(([layer, item]) => `${layer}: ${item.label}`).join(' · ');
  return [
    `# ${String(number).padStart(4, '0')} — Technology selection`,
    `- Status: accepted\n- Date: ${date}`,
    `## Context\n\nRequirements gathered with \`vibecheck advise\`:\n\n| Topic | Answer |\n|---|---|\n${requirementRows.join('\n')}`,
    `## Decision\n\n${summary}`,
    ...Object.entries(choices).map(([layer, item]) => layerSection(layer, result.layers[layer], item)),
    starterSection(result),
    result.warnings.length ? `## Warnings\n\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}` : '',
    `## Consequences\n\nLicences: ${Object.values(choices).map((item) => `${item.label} (${item.licence.name})`).join(', ')}. Revisit with \`vibecheck advise recommend\`; changing a layer goes through the re-architect workflow.`,
  ].filter(Boolean).join('\n\n') + '\n';
}
