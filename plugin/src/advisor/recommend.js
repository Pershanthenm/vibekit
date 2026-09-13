import { BAAS, STATIC_QUESTIONS, hasServer, needsDatabase, neededLayers, roundsFor, targetsOf } from './questions.js';
import { componentsFor, findComponent, LICENCE_CLASSES } from './components.js';
import { STARTERS, rankStarters } from './starters.js';

const RECOMMENDED_SUFFIX = / \(recommended\)$/i;
const MAX_LAYER_OPTIONS = 4;
const LANGUAGE_IDS = { 'c#': 'csharp', php: 'php', typescript: 'typescript', javascript: 'typescript', python: 'python', java: 'java', kotlin: 'kotlin', go: 'go', dart: 'dart', swift: 'swift', rust: 'rust', ruby: 'ruby', 'c++': 'cpp' };
const OTHER_WORDS = { ...LANGUAGE_IDS, '.net': 'csharp', golang: 'go', flutter: 'dart', cpp: 'cpp' };
const ALLOWED_LICENCES = {
  permissive: ['permissive', 'platform'],
  'oss-only': ['permissive', 'weak-copyleft', 'copyleft', 'platform'],
};
const SERVER_RENDERING = ['django', 'laravel', 'rails', 'aspnetcore', 'go'];
const LAYER_HEADERS = { backend: 'Backend', web: 'Web', mobile: 'Mobile', desktop: 'Desktop', database: 'Database' };
const LAYER_QUESTIONS = { backend: 'Which backend?', web: 'Which web front end?', mobile: 'Which mobile technology?', desktop: 'Which desktop technology?', database: 'Which database?' };

export function resolveOption(question, value) {
  const wanted = String(value).replace(RECOMMENDED_SUFFIX, '').trim().toLowerCase();
  const match = question.options.find((option) => option.id === wanted || option.label.toLowerCase() === wanted);
  if (!match) throw new Error(`"${value}" is not an option for ${question.id} (options: ${question.options.map((option) => option.id).join(', ')})`);
  return match.id;
}

const isOther = (raw) => raw && typeof raw === 'object' && !Array.isArray(raw) && 'other' in raw;

function normalizeStatic(question, raw) {
  if (isOther(raw)) return { other: String(raw.other) };
  const ids = [raw].flat().filter((value) => value !== undefined && value !== null && value !== '').map((value) => resolveOption(question, value));
  return question.multi ? ids : ids[0];
}

function normalizeLayer(layer, raw) {
  if (isOther(raw)) return { other: String(raw.other) };
  const wanted = String(raw).replace(RECOMMENDED_SUFFIX, '').trim().toLowerCase();
  const match = componentsFor(layer).find((item) => item.id === wanted || item.label.toLowerCase() === wanted);
  return match ? match.id : { other: String(raw).replace(RECOMMENDED_SUFFIX, '') };
}

export function normalizeAnswers(raw = {}) {
  const answers = {};
  for (const question of STATIC_QUESTIONS) {
    if (raw[question.id] !== undefined) answers[question.id] = normalizeStatic(question, raw[question.id]);
  }
  for (const layer of ['backend', 'web', 'mobile', 'desktop', 'database']) {
    if (raw[layer] !== undefined) answers[layer] = normalizeLayer(layer, raw[layer]);
  }
  if (raw.starter !== undefined) answers.starter = normalizeStarter(raw.starter);
  return answers;
}

// "none" is a real answer, not a missing one: it records a deliberate decision to build from
// scratch, so the question is never asked twice.
function normalizeStarter(raw) {
  if (isOther(raw)) return { other: String(raw.other) };
  const wanted = String(raw).replace(RECOMMENDED_SUFFIX, '').trim().toLowerCase();
  if (!wanted || ['none', 'scratch', 'from scratch'].includes(wanted)) return 'none';
  const match = STARTERS.find((item) => item.id === wanted || item.label.toLowerCase() === wanted);
  return match ? match.id : { other: String(raw).replace(RECOMMENDED_SUFFIX, '') };
}

const has = (answers, id, value) => [answers[id]].flat().includes(value);

function teamOf(answers) {
  const picked = Array.isArray(answers.team) ? answers.team : [];
  const text = String(answers.team?.other ?? '').toLowerCase();
  const fromOther = Object.entries(OTHER_WORDS).filter(([word]) => text.includes(word)).map(([, id]) => id);
  return new Set([...picked, ...fromOther]);
}

const serverFamily = (item) => hasServer(item.id) && !BAAS.includes(item.id);
const BACKEND_BY_APP = { internal: { dotnet: 2, python: 2, php: 1 }, saas: { node: 2, php: 2, ruby: 2, dotnet: 1, supabase: 1 }, content: { php: 3, node: 2, ruby: 1 }, integration: { dotnet: 2, java: 2, go: 2, node: 1 } };
const BACKEND_BY_SCALE = { huge: { go: 3, dotnet: 2, java: 2, node: 1, python: -1, ruby: -1, php: -1 }, small: { php: 1, python: 1, ruby: 1, supabase: 2, firebase: 2 } };
const WINDOWS_FIT = { dotnet: 3, php: -1, node: -2, java: -1, go: -1, python: -3, ruby: -3 };

const RULES = [
  (c, x) => { const language = c.languages.find((name) => x.team.has(LANGUAGE_IDS[name.toLowerCase()])); return language && [3, `your team knows ${language}`]; },
  (c, x) => x.ecosystem === 'microsoft' && c.family === 'dotnet' && [2, 'first-class Entra ID, Microsoft Graph and Intune support'],
  (c, x) => x.ecosystem === 'microsoft' && c.id === 'sqlserver' && [2, 'native to the Microsoft ecosystem'],
  (c, x) => x.ecosystem === 'opensource' && ['proprietary', 'source-available'].includes(c.licence.class) && [-2, 'at odds with an open-source shop'],
  (c, x) => x.licensing === 'oss-preferred' && ['proprietary', 'source-available'].includes(c.licence.class) && [-2, 'not open source'],
  (c, x) => x.licensing === 'commercial-ok' && x.ecosystem === 'microsoft' && c.id === 'sqlserver' && [1, 'licensed Microsoft stack is acceptable'],
  (c, x) => x.layer === 'backend' && x.hosting === 'windows' && WINDOWS_FIT[c.family] && [WINDOWS_FIT[c.family], WINDOWS_FIT[c.family] > 0 ? 'runs natively on IIS' : 'weak fit for Windows Server / IIS'],
  (c, x) => x.layer === 'backend' && x.hosting === 'linux' && serverFamily(c) && [1, 'first-class on Linux'],
  (c, x) => x.layer === 'backend' && BACKEND_BY_APP[x.appType]?.[c.family] && [BACKEND_BY_APP[x.appType][c.family], `strong fit for ${x.appType === 'internal' ? 'internal business tools' : x.appType === 'saas' ? 'customer products' : x.appType === 'content' ? 'content and e-commerce' : 'integration work'}`],
  (c, x) => x.layer === 'backend' && BACKEND_BY_SCALE[x.scale]?.[c.family] && [BACKEND_BY_SCALE[x.scale][c.family], x.scale === 'huge' ? 'throughput at very high scale' : 'fastest path to a working v1'],
  (c, x) => x.layer === 'backend' && x.compliance === 'strict' && ['dotnet', 'java'].includes(c.family) && [1, 'mature, well-audited security frameworks'],
  (c, x) => x.layer === 'backend' && BAAS.includes(c.id) && x.platform === 'mobile' && ['saas', 'content'].includes(x.appType) && [2, 'auth, data and storage without running servers'],
  (c, x) => x.layer === 'backend' && BAAS.includes(c.id) && x.appType === 'internal' && x.ecosystem === 'microsoft' && [-2, 'harder to integrate with a Microsoft directory'],
  (c, x) => x.layer === 'backend' && c.id === 'none' && (x.needsServerTarget ? [-6, 'web and API clients need a server'] : [x.data === 'offline' ? 7 : 2, 'no server to run: data stays on the device']),
  (c, x) => x.layer === 'web' && x.backend && c.family !== 'web' && c.languages.some((name) => x.backend.languages.includes(name)) && [2, 'same language as the backend'],
  (c, x) => x.layer === 'web' && c.id === 'blazor' && x.backend?.family !== 'dotnet' && [-6, 'needs an ASP.NET Core backend'],
  (c, x) => x.layer === 'web' && c.id === 'htmx' && (SERVER_RENDERING.includes(x.backend?.id) ? [['internal', 'content'].includes(x.appType) ? 2 : 1, 'the backend renders pages; little JavaScript to maintain'] : [-6, 'needs a server-rendering backend']),
  (c, x) => x.layer === 'web' && c.id === 'flutter-web' && (x.mobile?.id === 'flutter' ? [3, 'same Flutter code as the mobile app'] : [-1, 'best only when Flutter is used elsewhere']),
  (c, x) => x.layer === 'web' && c.id === 'react-next' && [1, 'largest ecosystem and hiring pool'],
  (c, x) => x.layer === 'web' && c.id === 'vue' && [1, 'gentle learning curve, clean component model'],
  (c, x) => x.layer === 'web' && c.id === 'angular' && x.appType === 'internal' && ['large', 'huge'].includes(x.scale) && [1, 'enterprise conventions for large teams'],
  (c, x) => x.layer === 'mobile' && c.id === 'flutter' && [2, 'one codebase with consistent UI on iOS and Android'],
  (c, x) => x.layer === 'mobile' && c.id === 'react-native' && [1, 'native apps from a React codebase'],
  (c, x) => x.layer === 'mobile' && c.id === 'maui' && x.backend?.family === 'dotnet' && [2, 'shares C# and models with the backend'],
  (c, x) => x.layer === 'mobile' && c.id === 'native' && (x.scale === 'huge' ? [2, 'best performance and platform fidelity'] : [-1, 'two codebases to maintain']),
  (c, x) => x.layer === 'mobile' && c.id === 'capacitor' && x.appType === 'internal' && x.targets.includes('web') && [2, 'reuses the web app for internal users'],
  (c, x) => x.layer === 'desktop' && c.id === 'tauri' && [2, 'small, secure binaries on every OS'],
  (c, x) => x.layer === 'desktop' && c.id === 'electron' && [1, 'mature ecosystem, heavier footprint'],
  (c, x) => x.layer === 'desktop' && c.id === 'wpf' && (x.ecosystem === 'microsoft' ? [1, 'Windows-first organisation (Windows only)'] : [-2, 'Windows only']),
  (c, x) => x.layer === 'desktop' && c.id === 'avalonia' && (x.backend?.family === 'dotnet' || x.team.has('csharp')) && [2, 'cross-platform .NET desktop'],
  (c, x) => x.layer === 'desktop' && ['flutter', 'maui', 'kmp'].includes(c.id) && x.mobile?.id === c.id && [3, 'same code as the mobile app'],
  (c, x) => x.layer === 'desktop' && c.id === 'compose-desktop' && x.mobile?.id === 'kmp' && [3, 'shares Kotlin UI with the mobile app'],
  (c, x) => x.layer === 'database' && c.id === 'postgres' && [3, 'robust default: relational, JSONB, full-text search'],
  (c, x) => x.layer === 'database' && c.id === 'sqlite' && (x.backend?.id === 'none' ? [6, 'embedded on the device, zero operations'] : x.data === 'offline' ? [2, 'good for offline-first local data'] : ['medium', 'large', 'huge'].includes(x.scale) && [-3, 'not built for many concurrent server users']),
  (c, x) => x.layer === 'database' && c.id !== 'sqlite' && x.backend?.id === 'none' && [-6, 'needs a database server'],
  (c, x) => x.layer === 'database' && c.id === 'mongodb' && (x.data === 'documents' ? [3, 'flexible document schemas'] : ['relational', 'reporting'].includes(x.data) && [-2, 'relational data fits SQL better']),
  (c, x) => x.layer === 'database' && ['mysql', 'mariadb'].includes(c.id) && x.backend?.family === 'php' && [2, 'the most common pairing for PHP'],
  (c, x) => x.layer === 'database' && c.id === 'postgres' && x.data === 'reporting' && [1, 'reporting views and full-text search built in'],
];

function excludedReason(item, context) {
  const allowed = ALLOWED_LICENCES[context.licensing];
  if (allowed && !allowed.includes(item.licence.class)) return `${item.licence.name} is ${LICENCE_CLASSES[item.licence.class]}, which "${context.licensing === 'permissive' ? 'permissive open source only' : 'any open source'}" rules out`;
  return null;
}

function scoreComponent(item, context, preferred) {
  const reasons = RULES.map((rule) => rule(item, context)).filter(Boolean).map(([points, text]) => ({ points, text }));
  if (preferred.includes(item.id)) reasons.push({ points: 3, text: 'your preferred choice' });
  return { id: item.id, label: item.label, summary: item.summary, licence: item.licence, custom: Boolean(item.custom), score: reasons.reduce((sum, reason) => sum + reason.points, 0), reasons };
}

function rankLayer(layer, context, preferred) {
  const candidates = componentsFor(layer);
  const excluded = candidates.map((item) => ({ item, reason: excludedReason(item, { ...context, layer }) })).filter(({ reason }) => reason);
  const ranked = candidates.filter((item) => !excluded.some((entry) => entry.item.id === item.id))
    .map((item) => scoreComponent(item, { ...context, layer }, preferred))
    .sort((left, right) => right.score - left.score);
  return { ranked, excluded: excluded.map(({ item, reason }) => ({ id: item.id, label: item.label, reason })) };
}

const chosenOrTop = (answers, layer, ranking) => (typeof answers[layer] === 'string' ? findComponent(answers[layer]) : findComponent(ranking?.ranked[0]?.id));

function contextOf(answers) {
  const targets = targetsOf(answers);
  return {
    ...answers, targets, team: teamOf(answers),
    needsServerTarget: targets.includes('web') || targets.includes('api'),
  };
}

function warningsFor(answers, layers) {
  return [
    answers.hosting === 'windows' && ['permissive', 'oss-only'].includes(answers.licensing) && 'Windows Server needs a licence, which conflicts with an open-source-only policy. Consider Linux hosting.',
    has(answers, 'architecture', 'microservices') && ['small', 'medium'].includes(answers.scale) && 'Microservices add significant operational cost at this scale; a modular monolith is usually the better start.',
    ['privacy', 'strict'].includes(answers.compliance) && answers.hosting === 'cloud' && 'Check data residency for personal data (POPIA / GDPR) when choosing a cloud region.',
    answers.backend === 'none' && contextOf(answers).needsServerTarget && 'A web or API target needs a server; "no backend" only suits device-only apps.',
    answers.backend === 'none' && typeof answers.database === 'string' && answers.database !== 'sqlite' && 'A local-only app cannot run a database server; SQLite is the usual choice.',
    Object.entries(layers).some(([layer]) => answers[layer]?.other) && 'Custom stack choices were recorded as entered; set their commands in specs/project.json.',
  ].filter(Boolean);
}

export function recommend(rawAnswers, { preferred = [] } = {}) {
  const answers = normalizeAnswers(rawAnswers);
  const context = contextOf(answers);
  const layers = {};
  layers.backend = rankLayer('backend', context, preferred);
  const withBackend = { ...context, backend: chosenOrTop(answers, 'backend', layers.backend) };
  const needed = neededLayers(answers);
  if (needed.includes('mobile')) layers.mobile = rankLayer('mobile', withBackend, preferred);
  const withMobile = { ...withBackend, mobile: chosenOrTop(answers, 'mobile', layers.mobile) };
  for (const layer of ['web', 'desktop'].filter((name) => needed.includes(name))) layers[layer] = rankLayer(layer, withMobile, preferred);
  if (needsDatabase({ ...answers, backend: withBackend.backend?.id })) layers.database = rankLayer('database', withMobile, preferred);
  const resolved = Object.fromEntries(Object.keys(layers).map((layer) => [layer, chosenOrTop(answers, layer, layers[layer])]));
  return { answers, layers, starters: rankStarters(resolved, answers), warnings: warningsFor(answers, layers) };
}

function layerQuestion(layer, ranking) {
  const top = ranking.ranked.slice(0, MAX_LAYER_OPTIONS);
  return {
    id: layer, header: LAYER_HEADERS[layer], question: LAYER_QUESTIONS[layer], layer: true,
    defaults: top[0] ? [top[0].id] : [],
    options: top.map((entry, index) => ({
      id: entry.id,
      label: index === 0 ? `${entry.label} (Recommended)` : entry.label,
      description: `${entry.licence.name} · score ${entry.score} · ${entry.summary}`,
    })),
  };
}

// Offered only once a stack exists to match against, and only when something actually fits.
// "From scratch" is a listed answer so the decision is recorded rather than defaulted into.
const STRONG_ENOUGH_TO_RECOMMEND = 4;

export function starterQuestion(starters) {
  if (!starters.ranked.length) return null;
  const top = starters.ranked.slice(0, 3);
  const leadWithStarter = top[0].score >= STRONG_ENOUGH_TO_RECOMMEND;
  return {
    id: 'starter',
    header: 'Boilerplate',
    question: 'Start from a boilerplate, or generate the structure from scratch?',
    defaults: [leadWithStarter ? top[0].id : 'none'],
    options: [
      ...top.map((item, index) => ({
        id: item.id,
        label: index === 0 && leadWithStarter ? `${item.label} (Recommended)` : item.label,
        description: `${item.licence.name} · ${item.summary}`,
      })),
      {
        id: 'none',
        label: leadWithStarter ? 'From scratch' : 'From scratch (Recommended)',
        description: 'vibekit generates the layout and conventions; nothing extra to learn, licence or upgrade',
      },
    ],
  };
}

export function nextRound(rawAnswers, options = {}) {
  const result = recommend(rawAnswers, options);
  const layerQuestions = Object.fromEntries(Object.entries(result.layers).map(([layer, ranking]) => [layer, layerQuestion(layer, ranking)]));
  const withLayerDefaults = { ...result.answers, backend: result.answers.backend ?? (result.answers.platform ? result.layers.backend.ranked[0]?.id : undefined) };
  for (const round of roundsFor(withLayerDefaults, layerQuestions, { starter: starterQuestion(result.starters) })) {
    const open = round.questions.filter((question) => question && result.answers[question.id] === undefined);
    if (open.length) return { complete: false, title: round.title, questions: open };
  }
  return { complete: true };
}
