# The catalogue

Every unique skill in [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) at commit `19392f7` (MIT; Copyright (c) 2025 Alireza Rezvani), converted to data: identity removed, scripts not carried, filed by domain. 374 skills in 16 domains.

None of these is indexed into a project until it is enabled: `vibekit skills enable <domain>` or `vibekit skills enable <name>` writes the chosen ones into `skills/lib/vibekit/` with a short lead as the body and the full text as the reference. `vibekit skills catalogue [query]` searches this list. The 27 skills in `skills/` are hand-distilled versions of some of these and are on by default.

Regenerate with: `node tools/catalogue.mjs <clone>`

## agent-launcher (6)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| agent-launcher-orchestrator | Use when a user wants to build, launch, grade, or schedule a Claude Managed Agent (CMA) in their own Anthropic account — | 996 |
| grade-iterate | Phase 3 of building a Claude Managed Agent — the bounded grade→iterate loop. Define a CMA outcome (a required markdown r | 751 |
| interview | Phase 1 of building a Claude Managed Agent — interview the founder about the one job the agent should do, then produce a | 836 |
| run-without-you | Phase 4 of building a Claude Managed Agent — make it run without you. Turn a graded agent into a recurring scheduled dep | 790 |
| stage-launch | Phase 2 of building a Claude Managed Agent — turn a validated build sheet into exact API payloads and a resumable BYOK c | 709 |
| wrap-up | Close out a launched Claude Managed Agent — recap every primitive the founder now owns, regenerate the single-file overv | 533 |

## business-growth (5)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| business-growth-skills | Router/index for the 4 business & growth skills bundled in this plugin: customer-success-manager (health scoring, churn  | 327 |
| contract-and-proposal-writer | Generate professional, jurisdiction-aware business documents: freelance contracts, project proposals, SOWs, NDAs, and MS | 3301 |
| customer-success-manager | Monitors customer health, predicts churn risk, and identifies expansion opportunities using weighted scoring models for  | 2077 |
| revenue-operations | Analyzes sales pipeline health, revenue forecasting accuracy, and go-to-market efficiency metrics for SaaS revenue optim | 2243 |
| sales-engineer | Analyzes RFP/RFI responses for coverage gaps, builds competitive feature comparison matrices, and plans proof-of-concept | 2179 |

## business-operations (7)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| business-operations-skills | Use when running, diagnosing, or designing internal business operations — process documentation, vendor SLAs, capacity p | 2021 |
| capacity-planner | Use when an ops leader (Director of CX, Head of Support, VP Ops, Head of BizOps, Head of IT ops, Head of Finance ops) is | 2752 |
| internal-comms | Use when a Head of People Ops, BizOps lead, or Internal Communications owner needs to draft and sequence an internal-onl | 3063 |
| knowledge-ops | Use when a Head of Ops, Knowledge Manager, or TPM-Internal needs to author, validate, or clean up company SOPs and inter | 3784 |
| process-mapper | Use when a BizOps lead, COO, or process-improvement owner needs to document an end-to-end business process (procurement, | 1966 |
| procurement-optimizer | Use when running an annual SaaS audit, doing category-level spend review, or rationalizing the supplier base — when the  | 3169 |
| vendor-management | Use when reviewing, scoring, or auditing third-party SaaS / vendor relationships — running a vendor scorecard with indus | 2500 |

## c-level (62)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| arquiteto-de-empresa | Company Architect: builds a business from scratch as an OKF (Open Knowledge Format) bundle — a tree of version-controlla | 1230 |
| chief-ai-officer-advisor | Chief AI Officer advisory for startups: model build-vs-buy decisions (API vs fine-tune vs in-house), AI risk classificat | 3300 |
| chief-customer-officer-advisor | Chief Customer Officer advisory for startups: retention decomposition (gross retention vs NRR honesty, churn root-cause  | 2733 |
| chief-data-officer-advisor | Chief Data Officer advisory for startups: AI training data rights and consent provenance, data product strategy (warehou | 2635 |
| board-prep | Board meeting preparation for the adversarial scenario, not the friendly one. Forces numbers-cold mastery, anticipates h | 1550 |
| challenge | Pre-mortem plan analysis. Imagine the plan failed 12 months from now and work backwards to find the weaknesses. Surfaces | 1586 |
| executive-mentor | Adversarial thinking partner for founders and executives. Stress-tests plans, prepares for brutal board meetings, dissec | 1517 |
| hard-call | /em:hard-call — Framework for decisions with no good options. Use when every option is painful and a structured 10/10/10 | 1757 |
| postmortem | /em:postmortem — Honest analysis of what went wrong. Use after a failed launch, missed quarter, or bad hire to run a bla | 1921 |
| stress-test | /em:stress-test — Business assumption stress testing. Use before betting on a plan whose core assumptions are unvalidate | 1890 |
| general-counsel-advisor | General Counsel advisory for startups: contract review (MSA, SaaS, NDA, DPA, employment), IP strategy, term sheet decodi | 2027 |
| agent-protocol | Inter-agent communication protocol for C-suite agent teams. Defines invocation syntax, loop prevention, isolation rules, | 3871 |
| board-deck-builder | Assembles comprehensive board and investor update decks by pulling perspectives from all C-suite roles. Use when prepari | 1739 |
| board-meeting | Multi-agent board meeting protocol for strategic decisions. Runs a structured 6-phase deliberation: context loading, ind | 1452 |
| c-level-skills | Index and router for the C-level advisory bundle: 33 skills covering 14 C-suite roles, orchestration, cross-cutting capa | 655 |
| ceo-advisor | Executive leadership guidance for strategic decision-making, organizational development, and stakeholder management. Use | 1859 |
| cfo-advisor | Financial leadership for startups and scaling companies. Financial modeling, unit economics, fundraising strategy, cash  | 1626 |
| change-management | Framework for rolling out organizational changes without chaos. Covers the ADKAR model adapted for startups, communicati | 2683 |
| chief-of-staff | C-suite orchestration layer. Routes founder questions to the right advisor role(s), triggers multi-role board meetings f | 1494 |
| chro-advisor | People leadership for scaling companies. Hiring strategy, compensation design, org structure, culture, and retention. Us | 1624 |
| ciso-advisor | Security leadership for growth-stage companies. Risk quantification in dollars, compliance roadmap (SOC 2/ISO 27001/HIPA | 1609 |
| cmo-advisor | Marketing leadership for scaling companies. Brand positioning, growth model design, marketing budget allocation, and mar | 1934 |
| company-os | The meta-framework for how a company runs — the connective tissue between all C-suite roles. Covers operating system sel | 2467 |
| competitive-intel | Systematic competitor tracking that feeds CMO positioning, CRO battlecards, and CPO roadmap decisions. Use when analyzin | 1915 |
| context-engine | Loads and manages company context for all C-suite advisor skills. Reads ~/.claude/company-context.md, detects stale cont | 951 |
| coo-advisor | Operations leadership for scaling companies. Process design, OKR execution, operational cadence, and scaling playbooks.  | 1427 |
| cpo-advisor | Product leadership for scaling companies. Product vision, portfolio strategy, product-market fit, and product org design | 2081 |
| cro-advisor | Revenue leadership for B2B SaaS companies. Revenue forecasting, sales model design, pricing strategy, net revenue retent | 2022 |
| cs-onboard | Founder onboarding interview that captures company context across 7 dimensions. Invoke with /cs:setup for initial interv | 1034 |
| cto-advisor | Technical leadership guidance for engineering teams, architecture decisions, and technology strategy. Use when assessing | 2787 |
| culture-architect | Build, measure, and evolve company culture as operational behavior — not wall posters. Covers mission/vision/values work | 1961 |
| decision-logger | Two-layer memory architecture for board meeting decisions. Manages raw transcripts (Layer 1) and approved decisions (Lay | 1248 |
| founder-coach | Personal leadership development for founders and first-time CEOs. Covers founder archetype identification, delegation fr | 3334 |
| internal-narrative | Build and maintain one coherent company story across all audiences — employees, investors, customers, candidates, and pa | 2464 |
| intl-expansion | International market expansion strategy. Market selection, entry modes, localization, regulatory compliance, and go-to-m | 1020 |
| ma-playbook | M&A strategy for acquiring companies or being acquired. Due diligence, valuation, integration, and deal structure. Use w | 1417 |
| org-health-diagnostic | Cross-functional organizational health check combining signals from all C-suite roles. Scores 8 dimensions on a traffic- | 1912 |
| scenario-war-room | Cross-functional what-if modeling for cascading multi-variable scenarios. Unlike single-assumption stress testing, this  | 1841 |
| strategic-alignment | Cascades strategy from boardroom to individual contributor. Detects and fixes misalignment between company goals and tea | 2165 |
| vpe-advisor | VP of Engineering advisory for startups: delivery throughput (DORA 4 metrics + bottleneck identification), engineering h | 3073 |
| boardroom | /cs:boardroom <brief> — 6-phase multi-role deliberation across the C-suite with Phase 2 isolation, critic pre-screen, an | 1070 |
| brief | /cs:brief <topic> — Generate a one-page strategy brief from an office-hours intake. First step in the strategic sprint p | 878 |
| c-level-agents | Founder-mode executive team. 13 cs-* C-suite agents (CFO, CMO, CRO, CPO, COO, CHRO, CISO, GC, CDO, CAIO, CCO, VPE, Chief | 985 |
| caio-review | /cs:caio-review <plan> — Eval-demanding Chief AI Officer interrogation of any plan that involves AI: model selection, ri | 1405 |
| cco-review | /cs:cco-review <plan> — Retention-obsessed Chief Customer Officer interrogation of any plan that touches customer retent | 1216 |
| cdo-review | /cs:cdo-review <plan> — Decision-driven Chief Data Officer interrogation of any plan that touches training data, data ar | 1188 |
| cfo-review | /cs:cfo-review <plan> — Numerate-skeptic interrogation of any plan that touches money. Unit economics, runway, dilution, | 748 |
| ciso-review | /cs:ciso-review <plan> — Risk-paranoid interrogation of any plan that touches data, compliance, or production access. Us | 738 |
| cmo-review | /cs:cmo-review <plan> — Narrative-first interrogation of positioning, ICP, message house, and channel mix. Use when laun | 741 |
| cpo-review | /cs:cpo-review <plan> — JTBD-driven interrogation of product roadmap, PMF signal, and portfolio focus. Use when committi | 727 |
| cro-review | /cs:cro-review <plan> — Pipeline-paranoid interrogation of revenue, win rate, NRR, and ramp time. Use when the forecast  | 712 |
| cross-eval | /cs:cross-eval <memo> — Multi-model consensus on a board memo or strategy brief. Claude + Codex + Gemini cross-review wi | 995 |
| cto-review | /cs:cto-review <plan> — Architecture and scaling interrogation. Tech debt, scaling cliffs, team scaling, build-vs-buy. U | 781 |
| decide | /cs:decide <memo> — Log a decision to two-layer memory via decision-logger. Approved memo becomes durable; raw transcrip | 788 |
| execute | /cs:execute <decision> — Generate a 90-day execution plan with weekly milestones, DRIs, and check-in cadence from an app | 752 |
| founder-mode | /cs:founder-mode <question> — Auto-routes any founder question to the right C-role advisor or to /cs:boardroom for multi | 1028 |
| freeze | /cs:freeze <decision> <days> — Lock a strategic decision for a cooldown period to prevent impulse reversal. Mirrors gsta | 841 |
| gc-review | /cs:gc-review <plan> — General Counsel interrogation of contracts, IP, regulatory, term sheets, and employment-law surfa | 1075 |
| office-hours | /cs:office-hours <topic> — YC-style 6-question founder interrogation before any advice. Forces clarity on problem, custo | 849 |
| onboard | /cs:onboard — Founder interview that populates ~/.claude/company-context.md using the canonical 7-dimension cs-onboard s | 1172 |
| post-mortem | /cs:post-mortem <decision> — Honest retrospective on an executed decision, scored against original assumptions and disse | 875 |
| vpe-review | /cs:vpe-review <plan> — Throughput-first VP of Engineering interrogation of any plan that touches delivery, eng hiring,  | 1120 |

## commercial (8)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| channel-economics | Use when reviewing or rebalancing direct vs. partner-led channel economics — computing fully-loaded cost-to-serve per ch | 3054 |
| commercial-forecaster | Use when building a quarterly bookings forecast, ARR projection, pipeline forecast, NRR projection, or commit/best-case/ | 2728 |
| commercial-policy | Use when designing or revising a company's commercial policy — the rules of engagement governing discounts off list pric | 3313 |
| commercial-skills | Use when reviewing, approving, or designing commercial motion — pricing models, deal review, discount approval, partners | 2054 |
| deal-desk | Use when reviewing a specific inbound deal before close — when sales has asked for a discount that exceeds AE authority, | 2561 |
| partnerships-architect | Use when a startup is approached by a prospective partner and someone has to decide should we sign this partner, at what | 2967 |
| pricing-strategist | Use when designing or revisiting product pricing — selecting a pricing model (subscription seat-based, usage-based, valu | 2121 |
| rfp-responder | Use when an RFP, RFI, RFQ, security questionnaire, vendor questionnaire, or proposal request arrives and the team needs  | 2948 |

## compliance-os (9)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| ai-act-readiness | /cs:ai-act-readiness <system> — EU AI Act 6-question forcing interrogation. Use during AI-system intake, before EU deplo | 1698 |
| aims-audit | /cs:aims-audit <scope> — ISO/IEC 42001 AIMS internal-audit 6-question forcing interrogation. Use before certification st | 1242 |
| compliance-os | Compliance OS — meta-orchestrator that lets compliance teams CONFIGURE which frameworks apply, COMPUTE cross-framework c | 2932 |
| compliance-readiness | /cs:compliance-readiness <program> — Multi-framework compliance officer 6-question forcing interrogation of any complian | 1303 |
| fda-qsr-audit-prep | /cs:fda-qsr-audit-prep <scope> — FDA 21 CFR 820 (QSR / QMSR) audit 6-question forcing interrogation. Post-Feb 2026 subst | 1525 |
| gdpr-audit-prep | /cs:gdpr-audit-prep <scope> — GDPR audit 6-question Article-cited forcing interrogation. Use before annual internal GDPR | 1626 |
| iso13485-audit-prep | /cs:iso13485-audit-prep <scope> — ISO 13485 QMS audit 6-question forcing interrogation. Design controls + CAPA + post-ma | 1591 |
| iso27001-audit-prep | /cs:iso27001-audit-prep <scope> — ISO 27001 ISMS audit readiness 6-question forcing interrogation. Use before annual Cla | 1347 |
| soc2-audit-prep | /cs:soc2-audit-prep <scope> — SOC 2 Type II readiness 6-question forcing interrogation. Observation-period focused. Use  | 1446 |

## engineering (141)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| agent-harness | Turn any domain folder of skills into a bounded agentic loop: compile a goal into a verifiable task plan, execute tasks  | 1762 |
| agent-memory | Use when a project's CLAUDE.md has grown past what anyone reads and you want the agent to learn durable facts from its o | 1011 |
| agenthub | Multi-agent collaboration plugin that spawns N parallel subagents competing on the same task via git worktree isolation. | 1819 |
| board | Read, write, and browse the AgentHub message board for agent coordination. Use when the user runs /hub:board or asks to  | 545 |
| eval | Evaluate and rank agent results by metric or LLM judge for an AgentHub session. Use when the user runs /hub:eval or asks | 556 |
| hub-init | Create a new AgentHub collaboration session with task, agent count, and evaluation criteria. Use when the user runs /hub | 643 |
| hub-status | Show DAG state, agent progress, and branch status for an AgentHub session. Use when the user runs /hub:hub-status or ask | 568 |
| merge | Merge the winning agent's branch into base, archive losers, and clean up worktrees. Use when the user runs /hub:merge or | 526 |
| run | One-shot lifecycle command that chains init → baseline → spawn → eval → merge in a single invocation. Use when the user  | 882 |
| spawn | Launch N parallel subagents in isolated git worktrees to compete on the session task. Use when the user runs /hub:spawn  | 766 |
| ar-resume | Resume a paused experiment. Checkout the experiment branch, read results history, continue iterating. Use when the user  | 461 |
| ar-status | Show experiment dashboard with results, active loops, and progress. Use when the user runs /ar:ar-status or asks how an  | 430 |
| autoresearch-agent | Autonomous experiment loop that optimizes any file by a measurable metric. Inspired by Karpathy's autoresearch. The agen | 2847 |
| loop | Start an autonomous experiment loop with user-selected interval (10min, 1h, daily, weekly, monthly). Uses CronCreate for | 981 |
| setup | Set up a new autoresearch experiment interactively. Collects domain, target file, eval command, metric, direction, and e | 666 |
| behuman | Use when the user wants more human-like AI responses — less robotic, less listy, more authentic. Triggers: 'behuman', 'b | 1914 |
| book-to-skill | Converts books, documentation folders, and source collections (PDF, EPUB, DOCX, HTML, Markdown, RST, AsciiDoc, RTF, MOBI | 2745 |
| boost-asio-pro | Use when writing or reviewing asynchronous C++ networking code with Boost.Asio or standalone Asio — TCP/UDP servers and  | 2532 |
| caveman | Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler, articles, and pleasantries while keeping  | 540 |
| chaos-engineering | Use when planning, running, or learning from chaos engineering experiments. Triggers on "chaos experiment", "fault injec | 2408 |
| claude-coach | Personal coach that teaches users to become Claude power users. Use this skill the FIRST time a user asks to "learn Clau | 1823 |
| code-tour | Use when the user asks to create a CodeTour .tour file — persona-targeted, step-by-step walkthroughs that link to real f | 1480 |
| collab-proof | Use when you want to understand what Claude contributed vs what you drove in a session. Triggers on: /collab-proof, sess | 3538 |
| data-quality-auditor | Audit datasets for completeness, consistency, accuracy, and validity. Profile data distributions, detect anomalies and o | 2088 |
| deep-learning-book | Study companion and working knowledge base for the Deep Learning textbook by Goodfellow, Bengio & Courville (MIT Press,  | 2627 |
| demo-video | Use when the user asks to create a demo video, product walkthrough, feature showcase, animated presentation, marketing v | 1183 |
| docker-development | Docker and container development agent skill and plugin for Dockerfile optimization, docker-compose orchestration, multi | 2726 |
| feature-flags-architect | Use when adding, retiring, or auditing feature flags. Triggers on "add a flag", "ship behind a flag", "rollout plan", "k | 2225 |
| grill-me | Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the | 511 |
| grill-with-docs | Docs-anchored grilling session — challenges a plan against the project's existing language (CONTEXT.md) and recorded dec | 1615 |
| handoff | Compact the current conversation into a handoff document for another agent to pick up. References existing artifacts (PR | 352 |
| helm-chart-builder | Helm chart development agent skill and plugin for Claude Code, Codex, Gemini CLI, Cursor, OpenClaw — chart scaffolding,  | 3609 |
| hivemind | Orchestrate free opencode workers from Claude Code to cut token costs. Use when delegating grunt work to a single worker | 2360 |
| human-gate | Runs the human-verification lane of an agent loop, and proves review happened before work is called done. Builds a singl | 1228 |
| karpathy-coder | Use when writing, reviewing, or committing code to enforce Karpathy's 4 coding principles — surface assumptions before c | 1261 |
| kubernetes-operator | Use when building a Kubernetes Operator — custom controllers that reconcile CRD state. Triggers on "build an operator",  | 2563 |
| llm-cost-optimizer | Use proactively whenever LLM API costs come up -- or should. Triggers include: 'my AI costs are too high', 'optimize tok | 2584 |
| llm-wiki | Use when building or maintaining a persistent personal knowledge base (second brain) in Obsidian where an LLM incrementa | 2336 |
| memory-engineering | Use when designing, reviewing, or paying for an agent memory system — adding memory to an agent, choosing between long-c | 1399 |
| minimalist | Use when the user asks to write code efficiently, avoid over-engineering, reduce dependencies, or prevent unnecessary ab | 713 |
| prompt-governance | Use when managing prompts in production at scale: versioning prompts, running A/B tests on prompts, building prompt regi | 2568 |
| security-guidance | PreToolUse security-anti-pattern hook for Claude Code. Catches 12 common security risks (command injection, XSS, SQL inj | 1733 |
| skill-doctor | Use when the user wants their agent setup graded from real conversation history, asks which installed skills are actuall | 1296 |
| skillopt-sleep | Use when the user wants their Claude agent to self-improve from past usage, asks about a nightly/offline 'sleep' or 'dre | 1646 |
| agent-designer | Use when the user asks to design a multi-agent system, pick an orchestration pattern (supervisor/swarm/pipeline), genera | 912 |
| agent-workflow-designer | Design production-grade multi-agent workflows with clear pattern choice (sequential, parallel, hierarchical), handoff co | 575 |
| api-design-reviewer | Comprehensive REST API design review with automated linting, breaking-change detection, and design scorecards. Catches i | 3125 |
| api-test-suite-builder | Use when the user asks to generate API tests, create integration test suites, test REST endpoints, or build contract tes | 1520 |
| browser-automation | Use when the user asks to automate browser tasks, scrape websites, fill forms, capture screenshots, extract structured d | 3372 |
| changelog-generator | Produce consistent, auditable release notes from Conventional Commits. Separates commit parsing, semantic-bump logic, an | 1740 |
| ci-cd-pipeline-builder | Generate pragmatic CI/CD pipelines from detected project stack signals — fast baseline generation, repeatable checks, en | 720 |
| codebase-onboarding | Analyze a codebase and generate onboarding documentation for engineers, tech leads, and contractors. Fast fact-gathering | 563 |
| database-designer | Use when the user asks to design database schemas, plan data migrations, optimize queries, choose between SQL and NoSQL, | 3127 |
| database-schema-designer | Use when the user asks to create ERD diagrams, normalize database schemas, design table relationships, or plan schema mi | 1812 |
| dependency-auditor | Audit and manage dependencies across multi-language projects. Identifies vulnerabilities, license conflicts, transitive  | 1028 |
| engineering-advanced-skills | Index of 37 advanced engineering agent skills for Claude Code, Codex, Gemini CLI, Cursor, OpenClaw. Use when browsing or | 918 |
| env-secrets-manager | Manage environment-variable hygiene and secrets safety across local development and production. Practical auditing, drif | 2571 |
| focused-fix | Use when the user asks to fix, debug, or make a specific feature/module/area work end-to-end. Triggers: 'make X work', ' | 3330 |
| full-page-screenshot | Use when the user asks to capture a full-page screenshot, long screenshot, or complete page capture of a web page. Handl | 1297 |
| git-worktree-manager | Run parallel feature work safely with Git worktrees. Standardizes branch isolation, port allocation, environment sync, a | 1652 |
| interview-system-designer | This skill should be used when the user asks to "design interview processes", "create hiring pipelines", "calibrate inte | 451 |
| mcp-server-builder | Design and ship production-ready MCP (Model Context Protocol) servers from OpenAPI contracts instead of hand-written too | 884 |
| migration-architect | Zero-downtime migration planning, compatibility validation, and rollback strategy generation. Tools for system, database | 4085 |
| monorepo-navigator | Navigate, manage, and optimize monorepos. Covers Turborepo, Nx, pnpm workspaces, and Lerna. Cross-package impact analysi | 1108 |
| observability-designer | Design production-ready observability strategies combining metrics, logs, and traces. Includes SLI/SLO design, golden-si | 3380 |
| performance-profiler | Systematic performance profiling for Node.js, Python, and Go applications. Identifies CPU, memory, and I/O bottlenecks,  | 576 |
| pr-review-expert | Use when the user asks to review pull requests, analyze code changes, check for security issues in PRs, or assess code q | 3094 |
| rag-architect | Use when the user asks to design a RAG pipeline, choose a chunking strategy or embedding model, pick a vector database,  | 1003 |
| runbook-generator | Generate operational runbooks from a service name — deployment, incident response, maintenance, and rollback workflows.  | 440 |
| secrets-vault-manager | Use when the user asks to set up secret management infrastructure, integrate HashiCorp Vault, configure cloud secret sto | 3560 |
| self-eval | Honestly evaluate AI work quality using a two-axis scoring system. Use after completing a task, code review, or work ses | 2024 |
| ship-gate | Pre-production audit that scans a codebase for security, database, deployment, code quality, AI/LLM, dependency, fronten | 1516 |
| skill-security-auditor | Security audit and vulnerability scanner for AI agent skills before installation. Use when: (1) evaluating a skill from  | 1699 |
| sample-text-processor | Reference BASIC-tier skill used as a fixture by skill-tester. Counts words and characters and applies basic text transfo | 1363 |
| skill-tester | Validate, test, and score the quality of skills within the claude-skills ecosystem. Comprehensive meta-skill: structure  | 1134 |
| slo-architect | Use when defining, reviewing, or operating SLOs/SLIs/error budgets. Triggers on "define an SLO", "what should our SLO be | 2358 |
| spec-driven-workflow | Use when the user asks to write specs before code, define acceptance criteria, plan features before implementation, gene | 3812 |
| sql-database-assistant | Use when the user asks to write SQL queries, optimize database performance, generate migrations, explore database schema | 3936 |
| tc-tracker | Use when the user asks to track technical changes, create change records, manage TC lifecycles, or hand off work between | 2486 |
| tech-debt-tracker | Scan codebases for technical debt, score severity, track trends, and generate prioritized remediation plans. Use when us | 1092 |
| spinning-up-deep-rl | Knowledge base from \"Spinning Up in Deep RL\" by Joshua Achiam (OpenAI, MIT-licensed). Use when applying Achiam's frame | 2686 |
| statistical-analyst | Run hypothesis tests, analyze A/B experiment results, calculate sample sizes, and interpret statistical significance wit | 2330 |
| strict-api | Use when the user says 'no hallucinations', 'verify APIs', 'reality check', or 'don't invent functions'. Prevents the ag | 768 |
| terraform-patterns | Terraform infrastructure-as-code agent skill and plugin for Claude Code, Codex, Gemini CLI, Cursor, OpenClaw. Covers mod | 5245 |
| universal-scraping-architect | Use for web scraping, crawling, document extraction, API parsing, or building validation-heavy data pipelines using Fire | 1094 |
| workflow-builder | Design and write deterministic multi-agent workflow scripts (.js files in .claude/workflows/) for Claude Code's Workflow | 1183 |
| write-a-skill | Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to cre | 1086 |
| zero-hallucination-coder | Runs a disciplined Discuss -> Map -> Decompose -> Execute -> Verify loop that grounds code in verified structure — no in | 3274 |
| a11y-audit | Accessibility audit skill for scanning, fixing, and verifying WCAG 2.2 Level A and AA compliance across React, Next.js,  | 2350 |
| google-workspace-cli | Google Workspace administration via the gws CLI (github.com/googleworkspace/cli). Install, authenticate, and automate Gm | 2908 |
| browserstack | Run tests on BrowserStack. Use when user mentions "browserstack", "cross-browser", "cloud testing", "browser matrix", "t | 1217 |
| coverage | Analyze test coverage gaps. Use when user says "test coverage", "what's not tested", "coverage gaps", "missing tests", " | 616 |
| fix | Fix failing or flaky Playwright tests. Use when user says "fix test", "flaky test", "test failing", "debug test", "test  | 708 |
| generate | Generate Playwright tests. Use when user says "write tests", "generate tests", "add tests for", "test this component", " | 1070 |
| migrate | Migrate from Cypress or Selenium to Playwright. Use when user mentions "cypress", "selenium", "migrate tests", "convert  | 977 |
| playwright-pro | Production-grade Playwright testing toolkit. Use when the user mentions Playwright tests, end-to-end testing, browser au | 1315 |
| pw-init | Set up Playwright in a project. Use when user says "set up playwright", "add e2e tests", "configure playwright", "testin | 1105 |
| pw-review | Review Playwright tests for quality. Use when user says "review tests", "check test quality", "audit tests", "improve te | 713 |
| report | Generate test report. Use when user says "test report", "results summary", "test status", "show results", "test dashboar | 679 |
| testrail | Sync tests with TestRail. Use when user mentions "testrail", "test management", "test cases", "test run", "sync test cas | 909 |
| extract | Turn a proven pattern or debugging solution into a standalone reusable skill with SKILL.md, reference docs, and examples | 1348 |
| memory-review | Analyze auto-memory for promotion candidates, stale entries, consolidation opportunities, and health metrics. Use when t | 990 |
| memory-status | Memory health dashboard showing line counts, topic files, capacity, stale entries, and recommendations. Use when the use | 661 |
| promote | Graduate a proven pattern from auto-memory (MEMORY.md) to CLAUDE.md or .claude/rules/ for permanent enforcement. Use whe | 1086 |
| remember | Explicitly save important knowledge to auto-memory with timestamp and context. Use when a discovery is too important to  | 738 |
| self-improving-agent | Curate Claude Code's auto-memory into durable project knowledge. Analyze MEMORY.md for patterns, promote proven learning | 1472 |
| adversarial-reviewer | Adversarial code review that breaks the self-review monoculture. Use when you want a genuinely critical review of recent | 1806 |
| ai-security | Use when assessing AI/ML systems for prompt injection, jailbreak vulnerabilities, model inversion risk, data poisoning e | 4395 |
| aws-solution-architect | Design AWS architectures for startups using serverless patterns and IaC templates. Use when asked to design serverless a | 2429 |
| azure-cloud-architect | Design Azure architectures for startups and enterprises. Use when asked to design Azure infrastructure, create Bicep/ARM | 3335 |
| cloud-security | Use when assessing cloud infrastructure for security misconfigurations, IAM privilege escalation paths, S3 public exposu | 4069 |
| code-reviewer | Code review automation for TypeScript, JavaScript, Python, Go, Swift, Kotlin, C#, .NET, Java, C, C++, Rust, Ruby, PHP, a | 1517 |
| email-template-builder | Build complete transactional email systems: React Email templates, provider integration (Resend, Postmark, SendGrid, AWS | 3724 |
| embedded-iot-mentor | Mentor for embedded and IoT hardware projects. Helps select MCUs, dev boards, and toolchains, decides where sensor readi | 2364 |
| engineering-skills | Index of the engineering-team skills bundle for Claude Code, Codex, Gemini CLI, Cursor, OpenClaw, and 6 more tools. Arch | 723 |
| epic-design | Build immersive, cinematic 2.5D interactive websites using scroll storytelling, parallax depth, text animations, and pre | 3729 |
| gcp-cloud-architect | Design GCP architectures for startups and enterprises. Use when asked to design Google Cloud infrastructure, deploy to G | 3138 |
| incident-commander | Comprehensive incident response framework from detection through resolution and post-incident review. Battle-tested SRE/ | 3710 |
| incident-response | Use when a security incident has been detected or declared and needs classification, triage, escalation path determinati | 3757 |
| ms365-tenant-manager | Microsoft 365 tenant administration for Global Administrators. Automate M365 tenant setup, Office 365 admin tasks, Azure | 2637 |
| named-persona-adversarial-review | Code review through the lens of real engineers' documented philosophies (Torvalds, Thompson, Carmack, Kent Beck, Jobs, C | 2198 |
| red-team | Use when planning or executing authorized red team engagements, attack path analysis, or offensive security simulations. | 3867 |
| security-pen-testing | Use when the user asks to perform security audits, penetration testing, vulnerability scanning, OWASP Top 10 checks, or  | 3386 |
| senior-architect | This skill should be used when the user asks to "design system architecture", "evaluate microservices vs monolith", "cre | 2601 |
| senior-backend | Designs and implements backend systems including REST APIs, microservices, database architectures, authentication flows, | 3639 |
| senior-computer-vision | Computer vision engineering skill for object detection, image segmentation, and visual AI systems. Covers CNN and Vision | 3095 |
| senior-data-engineer | Data engineering skill for building scalable data pipelines, ETL/ELT systems, and data infrastructure. Expertise in Pyth | 1318 |
| senior-data-scientist | World-class senior data scientist skill specialising in statistical modeling, experiment design, causal inference, and p | 2148 |
| senior-devops | Comprehensive DevOps skill for CI/CD, infrastructure automation, containerization, and cloud platforms (AWS, GCP, Azure) | 2593 |
| senior-frontend | Frontend development skill for React, Next.js, TypeScript, and Tailwind CSS applications. Use when building React compon | 3815 |
| senior-fullstack | Fullstack development toolkit with project scaffolding for Next.js, FastAPI, MERN, and Django stacks, code quality analy | 3521 |
| senior-ml-engineer | ML engineering skill for productionizing models, building MLOps pipelines, and integrating LLMs. Covers model deployment | 2241 |
| senior-prompt-engineer | Use when the user asks to optimize prompts, design prompt templates, evaluate LLM outputs with an eval set, measure RAG  | 2354 |
| senior-qa | Generates unit tests, integration tests, and E2E tests for React/Next.js applications. Scans components to create Jest + | 2000 |
| senior-secops | Senior SecOps engineer skill for application security, vulnerability management, compliance verification, and secure dev | 3838 |
| senior-security | Use when the user asks for STRIDE threat modeling, DREAD risk scoring, data-flow-diagram threat analysis, or a quick sec | 1181 |
| stripe-integration-expert | Production-grade Stripe integrations: subscriptions with trials and proration, one-time payments, usage-based billing, c | 3585 |
| tdd-guide | Test-driven development skill for writing unit tests, generating test fixtures and mocks, analyzing coverage gaps, and g | 3291 |
| tech-stack-evaluator | Technology stack evaluation and comparison with TCO analysis, security assessment, and ecosystem health scoring. Use whe | 1006 |
| threat-detection | Use when hunting for threats in an environment, analyzing IOCs, or detecting behavioral anomalies in telemetry. Covers h | 3449 |
| snowflake-development | Use when writing Snowflake SQL, building data pipelines with Dynamic Tables or Streams/Tasks, using Cortex AI functions, | 3123 |

## finance (5)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| business-investment-advisor | Business investment analysis and capital allocation advisor. Use when evaluating whether to invest in equipment, real es | 2286 |
| finance-skills | Router/index for the 2 finance skills bundled in this plugin: financial-analyst (ratio analysis, DCF valuation, budget v | 360 |
| financial-analyst | Performs financial ratio analysis, DCF valuation, budget variance analysis, and rolling forecast construction for strate | 1680 |
| saas-metrics-coach | SaaS financial health advisor. Use when a user shares revenue or customer numbers, or mentions ARR, MRR, churn, LTV, CAC | 1303 |
| stock-analysis | Produce a rigorous, sector-relative, multi-factor fundamental analysis of a publicly listed company — Indian (NSE/BSE) o | 8250 |

## loop-library (1)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| loop-library | Discover, find, compare, audit, repair, adapt, and design repeatable AI-agent loops with explicit triggers, actions, ver | 2707 |

## markdown-html (5)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| design-system | Captures the user's brand identity once via a 10-question onboarding wizard (primary/accent HEX + heading + body Google  | 2503 |
| markdown-html-orchestrator | Use when a user wants to convert any markdown file in their Claude project into a single-file, lightly-interactive HTML  | 2422 |
| md-document | Converts long-form markdown (specs, RFCs, reports, plans, explainers) into a single-file, lightly-interactive HTML docum | 1309 |
| md-review | Converts a markdown PR writeup or code review (one with ```diff fenced blocks and severity-tagged > [!BLOCKER]/[!MAJOR]/ | 1367 |
| md-slides | Converts a markdown deck (slides separated by `---` HR boundaries or by `# ` H1 headings, with optional `<!-- notes: ... | 1348 |

## marketing (56)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| landing | Generates a premium single-page HTML landing page with 3D CSS animations, GSAP scroll effects, and mouse-parallax depth. | 3479 |
| linkedin-analytics | Use when someone wants to understand their own LinkedIn numbers — which posts worked, why reach dropped, whether a patte | 1158 |
| linkedin-content | Use when someone wants to write, edit, or lint a LinkedIn post — a story, how-to, opinion piece, carousel script, video  | 1196 |
| linkedin-engagement | Use when someone wants to grow reach through comments, replies, groups, or outreach on LinkedIn — a commenting roster, a | 1165 |
| linkedin-profile | Use when someone wants their LinkedIn profile audited or rewritten — headline, About section, experience bullets, Featur | 1089 |
| linkedin-skills | Use when someone wants to grow an organic LinkedIn presence — a content strategy for a career change or consulting or th | 1111 |
| linkedin-strategy | Use when someone needs a LinkedIn plan rather than a post — content pillars, positioning for a career change or consulti | 1097 |
| ab-test-setup | When the user wants to plan, design, or implement an A/B test or experiment. Also use when the user mentions "A/B test," | 2389 |
| ad-creative | When the user needs to generate, iterate, or scale ad creative for paid advertising. Use when they say 'write ad copy,'  | 2583 |
| aeo | Answer Engine Optimization (AEO) skill — optimize content to be cited by AI language models (ChatGPT, Perplexity, Claude | 2548 |
| analytics-tracking | Set up, audit, and debug analytics tracking implementation — GA4, Google Tag Manager, event taxonomy, conversion trackin | 3486 |
| app-store-optimization | App Store Optimization (ASO) toolkit for researching keywords, analyzing competitor rankings, generating metadata sugges | 3986 |
| brand-guidelines | When the user wants to apply, document, or enforce brand guidelines for any product or company. Also use when the user m | 1109 |
| business-name-fit | Suggest, pick, or vet a business, startup, or product name that stays true to the founder's cultural origin while workin | 2582 |
| campaign-analytics | Analyzes campaign performance with multi-touch attribution, funnel conversion analysis, and ROI calculation for marketin | 1938 |
| churn-prevention | Reduce voluntary and involuntary churn through cancel flow design, save offers, exit surveys, and dunning sequences. Use | 2516 |
| cold-email | When the user wants to write, improve, or build a sequence of B2B cold outreach emails to prospects who haven't asked to | 3156 |
| competitor-alternatives | When the user wants to create competitor comparison or alternative pages for SEO and sales enablement. Also use when the | 2548 |
| content-creator | Deprecated redirect skill that routes legacy 'content creator' requests to the correct specialist. Use when a user invok | 538 |
| content-humanizer | Makes AI-generated content sound genuinely human — not just cleaned up, but alive. Use when content feels robotic, uses  | 3230 |
| content-production | Full content production pipeline — takes a topic from blank page to published-ready piece. Use when you need to execute  | 2612 |
| content-strategy | When the user wants to plan a content strategy, decide what content to create, or figure out what topics to cover. Also  | 1561 |
| copy-editing | When the user wants to edit, review, or improve existing marketing copy. Also use when the user mentions 'edit this copy | 3950 |
| copywriting | When the user wants to write, rewrite, or improve marketing copy for any page — including homepage, landing pages, prici | 2302 |
| email-sequence | When the user wants to create or optimize an email sequence, drip campaign, automated email flow, or lifecycle email pro | 1298 |
| form-cro | When the user wants to optimize any form that is NOT signup/registration — including lead capture forms, contact forms,  | 2166 |
| free-tool-strategy | When the user wants to build a free tool for marketing — lead generation, SEO value, or brand awareness. Use when they m | 2796 |
| launch-strategy | When the user wants to plan a product launch, feature announcement, or release strategy. Also use when the user mentions | 1263 |
| local-seo-manager | Manage local SEO for service-area businesses — appliance repair, HVAC, plumbing, cleaning, and any business that serves  | 3047 |
| marketing-context | Create and maintain the marketing context document that all marketing skills read before starting. Use when the user men | 1742 |
| marketing-demand-acquisition | Creates demand generation campaigns, optimizes paid ad spend across LinkedIn, Google, and Meta, develops SEO strategies, | 2192 |
| marketing-ideas | When the user needs marketing ideas, inspiration, or strategies for their SaaS or software product. Also use when the us | 1803 |
| marketing-ops | Central router for the marketing skill ecosystem. Use when unsure which marketing skill to use, when orchestrating a mul | 2659 |
| marketing-psychology | When the user wants to apply psychological principles, mental models, or behavioral science to marketing. Also use when  | 1517 |
| marketing-skills | Directory and router for the marketing skills library. Use when you need to find the right marketing skill for a task, s | 1160 |
| marketing-strategy-pmm | Product marketing skill for positioning, GTM strategy, competitive intelligence, and product launches. Use when the user | 2888 |
| onboarding-cro | When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value. Also us | 2054 |
| page-cro | When the user wants to optimize, improve, or increase conversions on any marketing page — including homepage, landing pa | 2196 |
| paid-ads | When the user wants help with paid advertising campaigns on Google Ads, Meta (Facebook/Instagram), LinkedIn, Twitter/X,  | 3072 |
| paywall-upgrade-cro | When the user wants to create or optimize in-app paywalls, upgrade screens, upsell modals, or feature gates. Also use wh | 1757 |
| popup-cro | When the user wants to create or optimize popups, modals, overlays, slide-ins, or banners for conversion purposes. Also  | 1774 |
| pricing-strategy | Design, optimize, and communicate SaaS pricing — tier structure, value metrics, pricing pages, and price increase strate | 3272 |
| programmatic-seo | When the user wants to create SEO-driven pages at scale using templates and data. Also use when the user mentions "progr | 2480 |
| prompt-engineer-toolkit | Turns marketing prompts into tested, versioned production assets: A/B prompt evaluation against structured test cases, i | 1235 |
| referral-program | When the user wants to design, launch, or optimize a referral or affiliate program. Use when they mention 'referral prog | 3196 |
| schema-markup | When the user wants to implement, audit, or validate structured data (schema markup) on their website. Use when the user | 2666 |
| seo-audit | When the user wants to audit, review, or diagnose SEO issues on their site. Also use when the user mentions "SEO audit," | 1720 |
| signup-flow-cro | When the user wants to optimize signup, registration, account creation, or trial activation flows. Also use when the use | 2219 |
| site-architecture | When the user wants to audit, redesign, or plan their website's structure, URL hierarchy, navigation design, or internal | 3225 |
| social-content | When the user wants help creating, scheduling, or optimizing social media content for LinkedIn, Twitter/X, Instagram, Ti | 2626 |
| social-media-analyzer | Social media campaign analysis and performance tracking. Calculates engagement rates, ROI, and benchmarks across platfor | 1969 |
| social-media-manager | When the user wants to develop social media strategy, plan content calendars, manage community engagement, or grow their | 2170 |
| webinar-marketing | When the user wants to plan, promote, run, or improve a webinar or virtual event to generate and convert demand. Use whe | 2915 |
| x-twitter-growth | X/Twitter growth engine for building audience, crafting viral content, and analyzing engagement. Use when the user wants | 1997 |
| youtube-full | Use when the user needs YouTube transcripts, video search, channel browsing, playlist extraction, or content monitoring. | 1698 |
| video-content-strategist | Use when planning video content strategy, writing video scripts, optimizing YouTube channels, building short-form video  | 2635 |

## product (17)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| agile-product-owner | Agile product ownership for backlog management and sprint execution. Covers user story writing, acceptance criteria, spr | 2847 |
| apple-hig-expert | Audits and designs iOS/macOS/watchOS/visionOS interfaces against the Apple Human Interface Guidelines, including the Liq | 1194 |
| code-to-prd | Reverse-engineer any codebase into a complete Product Requirements Document (PRD). Analyzes routes, components, state ma | 4585 |
| research-summarizer | Structured research summarization agent skill for non-dev users. Handles academic papers, web articles, reports, and doc | 2557 |
| competitive-teardown | Analyzes competitor products and companies by synthesizing data from pricing pages, app store reviews, job postings, SEO | 1901 |
| experiment-designer | Use when planning product experiments, writing testable hypotheses, estimating sample size, prioritizing tests, or inter | 727 |
| landing-page-generator | Generates high-converting landing pages as complete Next.js/React (TSX) components with Tailwind CSS. Creates hero secti | 2459 |
| product-analytics | Use when defining product KPIs, building metric dashboards, running cohort or retention analysis, or interpreting featur | 1319 |
| product-discovery | Use when validating product opportunities, mapping assumptions, planning discovery sprints, or testing problem-solution  | 776 |
| product-manager-toolkit | Comprehensive toolkit for product managers including RICE prioritization, customer interview analysis, PRD templates, di | 2428 |
| product-skills | Use when coordinating product work across the 12 bundled product sub-skills (RICE, OKRs, UX research, design tokens, com | 2290 |
| product-strategist | Strategic product leadership toolkit for Head of Product covering OKR cascade generation, quarterly planning, competitiv | 1680 |
| roadmap-communicator | Use when preparing roadmap narratives, release notes, changelogs, or stakeholder updates tailored for executives, engine | 598 |
| saas-scaffolder | Generates complete, production-ready SaaS project boilerplate including authentication, database schemas, billing integr | 2445 |
| spec-to-repo | Use when the user says 'build me an app', 'create a project from this spec', 'scaffold a new repo', 'generate a starter' | 2580 |
| ui-design-system | UI design system toolkit for Senior UI Designer including design token generation, component documentation, responsive d | 2597 |
| ux-researcher-designer | UX research and design toolkit for Senior UX Designer/Researcher including data-driven persona generation, journey mappi | 2774 |

## productivity (11)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| andreessen | Marc Andreessen-mode decision and productivity skill. A blunt, market-first operator that pressure-tests ideas, ventures | 2676 |
| capture | Captures and organizes chaotic brain dumps into a structured, actionable system with zero information loss. Use this ski | 2485 |
| deep-work | Use when someone wants to plan a deep work day, time-block their calendar or task list, budget or cut shallow work, prot | 1282 |
| inbox-setup | One-time setup skill that builds a personalized inbox triage knowledge base via interactive interview. Interviews the us | 3538 |
| inbox-triage | Runs a full inbox triage using the knowledge base created by the 'inbox-setup' skill. Light-intake by design (most invoc | 3247 |
| fable-goal | Convert a rambling description of a desired outcome into one polished, autonomous /goal prompt ready to paste into a fre | 2228 |
| meetings | Use when someone wants to decide whether a meeting is worth calling, price a meeting in dollars, build a timeboxed agend | 1236 |
| reflect | Mid-conversation reflection skill that pauses execution and zooms out from detail-mode to honestly reassess direction, a | 2010 |
| roast | Use when someone asks to roast an idea, pressure-test or stress-test an idea, validate a business idea, "convene the pan | 2417 |
| swedish-mentor | Mentor Swedish language learners by selecting YouTube video clips and podcast episodes by CEFR level and skill (listenin | 2564 |
| weekly-review | Use when someone wants to run a weekly review, close open loops, audit stalled projects and commitments, get their syste | 1211 |

## project-management (9)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| atlassian-admin | Atlassian Administrator for managing and organizing Atlassian products (Jira, Confluence, Bitbucket, Trello), users, per | 3110 |
| atlassian-templates | Atlassian Template and Files Creator/Modifier expert for creating, modifying, and managing Jira and Confluence templates | 3014 |
| confluence-expert | Atlassian Confluence expert for creating and managing spaces, knowledge bases, and documentation. Configures space permi | 2932 |
| jira-expert | Atlassian Jira expert for creating and managing projects, planning, product discovery, JQL queries, workflows, custom fi | 3061 |
| meeting-analyzer | Analyzes meeting transcripts and recordings to surface behavioral patterns, communication anti-patterns, and actionable  | 2871 |
| pm-skills | Use when coordinating project-delivery work across the 8 project-management sub-skills — sprint/velocity analytics, port | 2300 |
| scrum-master | Advanced Scrum Master skill for data-driven agile team analysis and coaching. Use when the user asks about sprint planni | 2168 |
| senior-pm | Senior Project Manager for enterprise software, SaaS, and digital transformation projects. Specializes in portfolio mana | 3942 |
| team-communications | Write internal company communications — 3P updates (Progress/Plans/Problems), company-wide newsletters, FAQ roundups, in | 829 |

## ra-qm (17)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| eu-ai-act-specialist | EU AI Act (Regulation (EU) 2024/1689) operational compliance for compliance teams. Three Article-level decisions: (1) Wh | 3428 |
| iso42001-specialist | ISO/IEC 42001:2023 AI Management System (AIMS) specialist for compliance teams running internal audits. Three decisions: | 3212 |
| agent-decision-receipts | Mint a tamper-evident, post-quantum-signed receipt for a consequential agent action (deploy, delete, pay, grant-access,  | 1825 |
| capa-officer | CAPA system management for medical device QMS. Covers root cause analysis, corrective action planning, effectiveness ver | 3825 |
| fda-consultant-specialist | FDA regulatory consultant for medical device companies. Provides 510(k)/PMA/De Novo pathway guidance, QMSR (21 CFR 820,  | 2820 |
| gdpr-dsgvo-expert | GDPR and German DSGVO compliance automation. Scans codebases for privacy risks, generates DPIA documentation, tracks dat | 1977 |
| information-security-manager-iso27001 | ISO 27001 ISMS implementation and cybersecurity governance for HealthTech and MedTech companies. Use when designing an I | 2809 |
| isms-audit-expert | Information Security Management System (ISMS) audit expert for ISO 27001 compliance verification, security control asses | 1701 |
| mdr-745-specialist | EU MDR 2017/745 compliance specialist for medical device classification, technical documentation, clinical evidence, and | 2379 |
| qms-audit-expert | ISO 13485 internal audit expertise for medical device QMS. Covers audit planning, execution, nonconformity classificatio | 2269 |
| quality-documentation-manager | Document control system management for medical device QMS. Covers document numbering, version control, change management | 3723 |
| quality-manager-qmr | Senior Quality Manager Responsible Person (QMR) for HealthTech and MedTech companies. Provides quality system governance | 4463 |
| quality-manager-qms-iso13485 | ISO 13485 Quality Management System implementation and maintenance for medical device organizations. Provides QMS design | 4225 |
| ra-qm-skills | Router/index for the 15 regulatory & quality-management skills bundled in this plugin (ISO 13485 QMS, EU MDR 2017/745, F | 659 |
| regulatory-affairs-head | Senior Regulatory Affairs Manager for HealthTech and MedTech companies. Prepares FDA 510(k), De Novo, and PMA submission | 4624 |
| risk-management-specialist | Medical device risk management specialist implementing ISO 14971 throughout product lifecycle. Provides risk analysis, r | 4019 |
| soc2-compliance | Use when the user asks to prepare for SOC 2 audits, map Trust Service Criteria, build control matrices, collect audit ev | 4640 |

## research (15)

| Skill | What it is for | Tokens |
| --- | --- | ---: |
| deep-research | Run a disciplined, multi-source research investigation for a high-stakes question or decision — fan-out web search acros | 1739 |
| deepread | Use when the user asks to deeply read a book, article, PDF, or document set; extract claims and evidence; build a knowle | 1898 |
| dossier | Decision-grade entity research skill — produces a hypothesis-tested dossier on a specific company, person, nonprofit, or | 3878 |
| grants | NIH grant research skill for clinical researchers. Grill-me intake (research idea + career stage + preliminary data + en | 3368 |
| litreview | Academic literature orientation skill that searches papers via free keyless APIs (PubMed E-utilities + OpenAlex) by defa | 4262 |
| notebooklm | Browser automation skill for controlling Google's NotebookLM. Use when the user wants anything done in NotebookLM (e.g., | 3783 |
| patent | Patent prior-art and landscape intelligence skill — not generic patent help. Commits to one of five sub-use-cases via fo | 3801 |
| pulse | Multi-source recency research skill that takes the pulse of any topic across Reddit, Hacker News, the open web, and opti | 3477 |
| research | Default entry point for any research request — a hybrid router that classifies the question deterministically and either | 4056 |
| syllabus | Generates a curated supplementary reading list from any course syllabus using Consensus academic search. Grill-me intake | 2823 |
| clinical-research | Use when designing a prospective clinical study before submission — selecting and classifying endpoints (primary / key-s | 2486 |
| market-research | Use when doing upstream market-research methodology — sizing a market as TAM/SAM/SOM computed BOTH top-down and bottoms- | 2312 |
| product-research | Use when planning and synthesizing product/user research as a method-and-repository discipline — selecting the right met | 2451 |
| research-finance | Use when managing the money for an internal R&D program or portfolio — building a multi-period program budget with the F | 2423 |
| research-ops-skills | Use when planning, funding, scoping, or synthesizing enterprise research across workstreams — clinical study design, R&D | 2492 |

## Not carried

| Skill | Path | Why |
| --- | --- | --- |
| arquiteto-de-empresa | `c-level-advisor/skills/arquiteto-de-empresa/SKILL.md` | duplicate of `c-level-advisor/arquiteto-de-empresa/skills/arquiteto-de-empresa/SKILL.md` |
| chief-ai-officer-advisor | `c-level-advisor/skills/chief-ai-officer-advisor/SKILL.md` | duplicate of `c-level-advisor/chief-ai-officer-advisor/skills/chief-ai-officer-advisor/SKILL.md` |
| chief-customer-officer-advisor | `c-level-advisor/skills/chief-customer-officer-advisor/SKILL.md` | duplicate of `c-level-advisor/chief-customer-officer-advisor/skills/chief-customer-officer-advisor/SKILL.md` |
| chief-data-officer-advisor | `c-level-advisor/skills/chief-data-officer-advisor/SKILL.md` | duplicate of `c-level-advisor/chief-data-officer-advisor/skills/chief-data-officer-advisor/SKILL.md` |
| general-counsel-advisor | `c-level-advisor/skills/general-counsel-advisor/SKILL.md` | duplicate of `c-level-advisor/general-counsel-advisor/skills/general-counsel-advisor/SKILL.md` |
| vpe-advisor | `c-level-advisor/vpe-advisor/skills/vpe-advisor/SKILL.md` | duplicate of `c-level-advisor/skills/vpe-advisor/SKILL.md` |
| run | `engineering/autoresearch-agent/skills/run/SKILL.md` | duplicate of `engineering/agenthub/skills/run/SKILL.md` |
| chaos-engineering | `engineering/skills/chaos-engineering/SKILL.md` | duplicate of `engineering/chaos-engineering/skills/chaos-engineering/SKILL.md` |
| feature-flags-architect | `engineering/skills/feature-flags-architect/SKILL.md` | duplicate of `engineering/feature-flags-architect/skills/feature-flags-architect/SKILL.md` |
| kubernetes-operator | `engineering/skills/kubernetes-operator/SKILL.md` | duplicate of `engineering/kubernetes-operator/skills/kubernetes-operator/SKILL.md` |
| slo-architect | `engineering/slo-architect/skills/slo-architect/SKILL.md` | duplicate of `engineering/skills/slo-architect/SKILL.md` |
| handoff | `productivity/handoff/skills/handoff/SKILL.md` | duplicate of `engineering/handoff/skills/handoff/SKILL.md` |
| eu-ai-act-specialist | `ra-qm-team/skills/eu-ai-act-specialist/SKILL.md` | duplicate of `ra-qm-team/compliance-team-eu-ai-act/skills/eu-ai-act-specialist/SKILL.md` |
| iso42001-specialist | `ra-qm-team/skills/iso42001-specialist/SKILL.md` | duplicate of `ra-qm-team/compliance-team-iso42001/skills/iso42001-specialist/SKILL.md` |
