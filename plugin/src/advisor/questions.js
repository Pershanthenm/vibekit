const option = (id, label, description) => ({ id, label, description });

const STATIC_ROUNDS = [
  {
    title: 'What you are building',
    questions: [
      {
        id: 'platform', header: 'Platform', question: 'What are you building first?',
        options: [
          option('web', 'Web application', 'Runs in the browser'),
          option('mobile', 'Mobile app', 'iOS and Android'),
          option('desktop', 'Desktop app', 'Windows, macOS or Linux'),
          option('backend', 'API or backend service', 'Headless service other systems call'),
        ],
      },
      {
        id: 'appType', header: 'App type', question: 'What kind of application is it?',
        options: [
          option('internal', 'Internal business tool', 'Assets, HR, inventory, approvals'),
          option('saas', 'Product for customers', 'SaaS, consumer app, many users or tenants'),
          option('content', 'Content or e-commerce', 'Public pages, catalogue, checkout'),
          option('integration', 'Integration or data service', 'Moves and transforms data between systems'),
        ],
      },
      {
        id: 'scale', header: 'Users', question: 'How many users do you expect in the first year?',
        options: [
          option('small', 'Under 100', 'A team or one department'),
          option('medium', '100 to 5,000', 'A whole company or a few customers'),
          option('large', '5,000 to 100,000', 'Many customers, steady load'),
          option('huge', 'Over 100,000', 'High traffic, scaling matters from day one'),
        ],
      },
      {
        id: 'clients', header: 'Also on', question: 'Which other platforms does it need? (none is fine)', multi: true,
        options: [
          option('web', 'Web app', 'Browser-based UI'),
          option('mobile', 'iOS and Android app', 'Native or cross-platform mobile'),
          option('desktop', 'Desktop app', 'Windows or macOS application'),
          option('api', 'Public API', 'Partners or other systems integrate'),
        ],
      },
    ],
  },
  {
    title: 'Constraints',
    questions: [
      {
        id: 'licensing', header: 'Licensing', question: 'What licensing model do you want?',
        options: [
          option('permissive', 'Permissive open source only', 'MIT, Apache, BSD; no GPL obligations (closed-source products)'),
          option('oss-only', 'Any open source', 'OSI licences including GPL and LGPL'),
          option('oss-preferred', 'Open source preferred', 'Paid or proprietary only where clearly better'),
          option('commercial-ok', 'Commercial is fine', 'e.g. SQL Server, Windows Server, Firebase'),
        ],
      },
      {
        id: 'ecosystem', header: 'Ecosystem', question: 'Which environment will it live in?',
        options: [
          option('microsoft', 'Microsoft', 'Entra ID / Active Directory, Microsoft 365, Intune'),
          option('google', 'Google Workspace', 'Google accounts and admin console'),
          option('opensource', 'Open-source / Linux shop', 'Self-hosted, open tooling'),
          option('mixed', 'Mixed or none', 'No strong platform commitment'),
        ],
      },
      {
        id: 'team', header: 'Team skills', question: 'Which languages does the team know well? (Other: Java, Kotlin, Go, Dart, Swift, Rust, Ruby, C++…)', multi: true,
        options: [
          option('csharp', 'C# / .NET', ''),
          option('php', 'PHP', ''),
          option('typescript', 'JavaScript / TypeScript', ''),
          option('python', 'Python', ''),
        ],
      },
      {
        id: 'data', header: 'Data', question: 'What does the data look like?',
        options: [
          option('relational', 'Relational records', 'Entities with relationships and strong consistency'),
          option('reporting', 'Relational + reporting', 'Heavy search, dashboards and exports'),
          option('documents', 'Flexible documents', 'Schemas vary per record'),
          option('offline', 'On the device, offline-first', 'Local data that syncs when online, or never'),
        ],
      },
    ],
  },
  {
    title: 'Architecture and security',
    questions: [
      {
        id: 'architecture', header: 'Architecture', question: 'Which software architecture?',
        options: [
          option('modular-clean', 'Modular monolith', 'One deployable, Clean Architecture per module'),
          option('clean', 'Clean Architecture', 'Single application, layered core'),
          option('microservices', 'Microservices', 'Independent services, each owns its data'),
          option('recommend', 'Recommend for me', 'Pick based on my answers'),
        ],
      },
      {
        id: 'signin', header: 'Sign-in', question: 'How do people sign in?',
        options: [
          option('sso', 'Company SSO', 'OIDC or SAML via Entra ID, Okta, Google'),
          option('local-mfa', 'Local accounts + MFA', 'Email and password with authenticator'),
          option('social', 'Social logins', 'Google, Apple, Microsoft personal accounts'),
          option('sso-and-local', 'SSO and local accounts', 'Staff via SSO, externals locally'),
        ],
      },
      {
        id: 'security', header: 'Security', question: 'Which security controls are required?', multi: true,
        options: [
          option('rbac-audit', 'Roles + audit log', 'Policy-based access and a full audit trail'),
          option('mfa', 'MFA for admins', 'TOTP or WebAuthn on privileged roles'),
          option('encryption', 'Encryption + vault', 'Sensitive fields encrypted, secrets in a vault'),
          option('hardening', 'Hardening', 'Security headers, rate limits, dependency scans'),
        ],
      },
      {
        id: 'compliance', header: 'Compliance', question: 'What compliance level applies?',
        options: [
          option('standard', 'Standard', 'OWASP ASVS Level 1'),
          option('elevated', 'Elevated', 'ASVS Level 2, ISO 27001-ready'),
          option('privacy', 'Personal data (POPIA/GDPR)', 'ASVS Level 2 plus privacy controls'),
          option('strict', 'Strict', 'ASVS Level 3, e.g. finance or health'),
        ],
      },
    ],
  },
  {
    title: 'Agent workflow',
    questions: [
      {
        id: 'autonomy', header: 'Autonomy', question: 'How much should agents do without asking?',
        options: [
          option('gated', 'Approve specs and plans', 'You sign off both before code is written'),
          option('auto', 'Approve specs only', 'Agents plan and build after spec approval'),
        ],
      },
      {
        id: 'engine', header: 'Parallel', question: 'Who runs parallel tasks?',
        options: [
          option('cursor', 'Cursor agents', 'Headless Cursor CLI agents in git worktrees'),
          option('claude', 'Claude Code agents', 'Headless Claude Code in git worktrees'),
          option('manual', 'I open them in Cursor', 'Worktrees and briefs prepared for you'),
          option('multica', 'Multica board', 'Lanes become issues assigned to your Multica agents'),
        ],
      },
      {
        id: 'context', header: 'Context', question: 'Which context tools should be on?', multi: true,
        options: [
          option('agentmemory', 'agentmemory', 'Shared memory across sessions and agents'),
          option('opencontext', 'OpenContext', 'Your cross-project knowledge library'),
          option('docs', 'Living docs', 'Docs and diagrams kept fresh by gates'),
        ],
      },
    ],
  },
];



const HOSTING = {
  id: 'hosting', header: 'Hosting', question: 'Where will it be deployed?',
  options: [
    option('linux', 'Linux servers', 'Ubuntu, Nginx, Docker, systemd'),
    option('windows', 'Windows Server (IIS)', 'On-premises or VM with IIS'),
    option('cloud', 'Cloud platform (PaaS)', 'Azure App Service, AWS, Vercel and similar'),
    option('kubernetes', 'Kubernetes', 'Containers orchestrated by Kubernetes'),
  ],
};

const INTEGRATIONS = {
  id: 'integrations', header: 'Integrations', question: 'Which integrations are needed?', multi: true,
  options: [
    option('directory', 'Directory sync', 'LDAP / Active Directory, SCIM provisioning'),
    option('email', 'Email', 'SMTP notifications'),
    option('devices', 'Device management', 'Intune, Jamf or similar'),
    option('reporting', 'Reporting / BI', 'Exports and BI connectors'),
  ],
};

const PLATFORM_TARGETS = { web: ['web'], mobile: ['ios', 'android'], desktop: ['desktop'], backend: ['api'], api: ['api'] };
const CLIENT_TARGETS = { web: ['web'], mobile: ['ios', 'android'], desktop: ['desktop'], api: ['api'] };
export const BAAS = ['supabase', 'firebase'];
export const hasServer = (backend) => Boolean(backend) && backend !== 'none';

export function targetsOf(answers) {
  const clients = Array.isArray(answers.clients) ? answers.clients : [];
  return [...new Set([...(PLATFORM_TARGETS[answers.platform] ?? []), ...clients.flatMap((client) => CLIENT_TARGETS[client] ?? [])])];
}

export function neededLayers(answers) {
  const targets = targetsOf(answers);
  return [
    'backend',
    targets.includes('web') && 'web',
    (targets.includes('ios') || targets.includes('android')) && 'mobile',
    targets.includes('desktop') && 'desktop',
  ].filter(Boolean);
}

export const needsDatabase = (answers) => answers.backend !== undefined && !BAAS.includes(answers.backend);
export const needsHosting = (answers) => hasServer(answers.backend) && !BAAS.includes(answers.backend);

const [BUILDING, CONSTRAINTS, ARCHITECTURE, WORKFLOW] = STATIC_ROUNDS;

export function roundsFor(answers, layerQuestions) {
  const delivery = [
    needsDatabase(answers) && layerQuestions.database,
    needsHosting(answers) && HOSTING,
    INTEGRATIONS,
  ].filter(Boolean);
  return [
    BUILDING,
    CONSTRAINTS,
    ARCHITECTURE,
    { title: 'Stack', questions: neededLayers(answers).map((layer) => layerQuestions[layer]) },
    { title: 'Data and delivery', questions: delivery },
    WORKFLOW,
  ];
}

export const STATIC_QUESTIONS = [...STATIC_ROUNDS.flatMap((round) => round.questions), HOSTING, INTEGRATIONS];
