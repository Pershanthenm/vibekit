import { hasServer, targetsOf } from '../advisor/questions.js';
import { resolveOption } from '../advisor/recommend.js';
import { CONTROLS, findControl } from './controls.js';

const STANDARD = ['object-level', 'headers-csp', 'rate-limit', 'deps', 'secrets-scan', 'security-logs', 'secure-storage', 'code-signing'];
const ELEVATED = [...STANDARD, 'rbac', 'sast', 'audit-append-only', 'backups', 'session-timeout', 'pii-redaction'];
const PRIVACY = [...ELEVATED, 'field-encryption', 'retention'];
const REQUIRED = { standard: STANDARD, elevated: ELEVATED, privacy: PRIVACY, strict: [...PRIVACY, 'dast', 'alerts', 'waf', 'containers', 'signed-updates', 'cert-pinning'] };
const LEVEL_NAMES = { standard: 'standard', elevated: 'elevated', privacy: 'POPIA / GDPR', strict: 'strict' };

const includes = (value, item) => [value].flat().includes(item);
const complianceOf = (requirements) => (REQUIRED[requirements.compliance] ? requirements.compliance : 'standard');

function option(id, required, overrides = {}) {
  const item = findControl(id);
  const suffix = required.includes(id) ? ' (required)' : '';
  return { id, label: overrides.label ?? item.title, description: `${overrides.description ?? item.rule.split(';')[0].split('.')[0]}${suffix}` };
}

function question(id, header, text, multi, entries, defaults, required) {
  const options = entries.filter(Boolean);
  const offered = new Set(options.map((entry) => entry.id));
  return { id, header, question: text, multi, options, defaults: defaults.filter((value) => value && offered.has(value)), required: required.filter((value) => offered.has(value)) };
}

const serverOf = (r) => r.backend === undefined || hasServer(typeof r.backend === 'string' ? r.backend : 'custom');
const clientTargets = (r) => targetsOf(r).filter((target) => ['ios', 'android', 'desktop'].includes(target));

function clientRound(r, required) {
  const targets = clientTargets(r);
  if (!targets.length) return null;
  const desktop = targets.includes('desktop');
  const server = serverOf(r);
  return {
    title: 'Security: client apps',
    questions: [
      question('clientApps', 'Client apps', 'Which protections for the installed apps?', true, [
        option('secure-storage', required), option('code-signing', required),
        desktop && option('signed-updates', required), server && option('cert-pinning', required),
      ], ['secure-storage', 'code-signing', desktop && 'signed-updates', server && r.compliance === 'strict' && 'cert-pinning'], required),
    ].filter((entry) => entry.options.length >= 2),
  };
}

function identityRound(r, required) {
  if (!serverOf(r)) return null;
  const targets = targetsOf(r);
  const web = targets.includes('web') || !targets.length;
  const nativeOrApi = ['ios', 'android', 'desktop', 'api'].some((target) => targets.includes(target));
  const sso = r.signin === 'sso';
  const local = ['local-mfa', 'sso-and-local', 'social'].includes(r.signin) || !r.signin;
  const ossOnly = r.licensing === 'oss-only';
  const platformLabel = { windows: 'Windows DPAPI / Credential Manager', kubernetes: 'Kubernetes secrets (sealed)' }[r.hosting] ?? 'Docker / systemd credentials';
  const cloudLabel = r.ecosystem === 'microsoft' ? 'Azure Key Vault' : 'Cloud secrets manager';
  const secretsDefault = (r.hosting === 'cloud' && !ossOnly && 'cloud-kms') || (['large', 'huge'].includes(r.scale) || r.compliance === 'strict' ? 'openbao' : 'platform-secrets');
  return {
    title: 'Security: identity and access',
    questions: [
      question('sessions', 'Sessions', 'How should clients hold sessions?', false, [
        web && option('bff-cookie', required),
        option('jwt-rotation', required),
        nativeOrApi && option('oauth-pkce', required),
      ], [web ? 'bff-cookie' : nativeOrApi ? 'oauth-pkce' : 'jwt-rotation'], required),
      question('accounts', 'Accounts', 'Which account protections?', true, sso
        ? [option('idp-mfa', required), option('session-timeout', required), option('least-privilege', required)]
        : [option('lockout', required), option('mfa-all', required), option('password-policy', required), option('session-timeout', required)],
      sso ? ['idp-mfa', 'session-timeout', 'least-privilege'] : ['lockout', 'password-policy', 'session-timeout', r.compliance === 'strict' && 'mfa-all', local && includes(r.security, 'mfa') && 'mfa-all'], required),
      question('authz', 'Access', 'Which authorization controls?', true, [
        option('rbac', required), option('object-level', required), option('admin-separation', required),
        r.appType === 'saas' && option('tenant-isolation', required),
      ], ['rbac', 'object-level', 'admin-separation', r.appType === 'saas' && 'tenant-isolation'], required),
      question('secrets', 'Secrets', 'Where do secrets live?', false, [
        option('openbao', required, { description: 'Open-source Vault fork, no licence cost' }),
        option('platform-secrets', required, { label: platformLabel }),
        !ossOnly && option('cloud-kms', required, { label: cloudLabel }),
        r.scale === 'small' && option('env-files', required),
      ], [secretsDefault], required),
    ],
  };
}

function assuranceRound(r, required) {
  const server = serverOf(r);
  const containers = server && r.hosting !== 'windows';
  const privacy = ['privacy', 'strict'].includes(r.compliance);
  return {
    title: 'Security: protection and assurance',
    questions: [
      question('data', 'Data', 'How is data protected?', true,
        ['field-encryption', 'backups', 'retention', 'audit-append-only'].map((id) => option(id, required)),
        [(privacy || includes(r.security, 'encryption')) && 'field-encryption', 'backups', privacy && 'retention', includes(r.security, 'rbac-audit') && 'audit-append-only'], required),
      server && question('edge', 'Edge', 'Which edge protections?', true,
        ['headers-csp', 'rate-limit', 'waf', 'cors-allowlist'].map((id) => option(id, required)),
        ['headers-csp', 'rate-limit', 'cors-allowlist', (r.compliance === 'strict' || ['large', 'huge'].includes(r.scale)) && 'waf'], required),
      question('pipeline', 'CI checks', 'Which checks run in CI?', true,
        [option('sast', required), option('deps', required), containers && option('containers', required), option('secrets-scan', required)],
        ['sast', 'deps', 'containers', 'secrets-scan'], required),
      question('monitoring', 'Monitoring', 'Which monitoring?', true,
        ['security-logs', 'pii-redaction', server && 'alerts', server && 'dast'].filter(Boolean).map((id) => option(id, required)),
        ['security-logs', 'pii-redaction', r.compliance !== 'standard' && r.compliance && 'alerts', r.compliance === 'strict' && 'dast'], required),
    ],
  };
}

export function securityRounds(requirements = {}) {
  const required = REQUIRED[complianceOf(requirements)];
  return [identityRound(requirements, required), assuranceRound(requirements, required), clientRound(requirements, required)]
    .filter(Boolean)
    .map((round) => ({ ...round, questions: round.questions.filter(Boolean) }));
}

function answerFor(entry, raw) {
  if (raw === undefined) return entry.multi ? entry.defaults : entry.defaults[0];
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'other' in raw) return { other: String(raw.other) };
  const ids = [raw].flat().filter((value) => value !== '' && value !== null).map((value) => resolveOption(entry, value));
  return entry.multi ? ids : ids[0];
}

export function resolveSecurity(requirements, rawAnswers = {}) {
  const questions = securityRounds(requirements).flatMap((round) => round.questions);
  const answers = Object.fromEntries(questions.map((entry) => [entry.id, answerFor(entry, rawAnswers[entry.id])]));
  const selected = new Set(questions.flatMap((entry) => [answers[entry.id]].flat().filter((value) => typeof value === 'string')));
  const level = complianceOf(requirements);
  const required = [...new Set(questions.flatMap((entry) => entry.required))];
  return {
    answers,
    controls: CONTROLS.map((item) => item.id).filter((id) => selected.has(id)),
    acceptedRisks: required.filter((id) => !selected.has(id)).map((id) => ({ id, reason: `required for ${LEVEL_NAMES[level]} compliance but deselected` })),
    notes: questions.filter((entry) => answers[entry.id]?.other).map((entry) => `${entry.header}: ${answers[entry.id].other}`),
  };
}
