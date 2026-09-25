import "./Content.css";

const ALPHA = "https://github.com/Pershanthenm/vibekit/releases/tag/v0.1.0-alpha";

const MARK = { yes: "✓", part: "◐", no: "—" };

function Table({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Spec Kit</th>
            <th>Agent OS</th>
            <th>VibeKit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {["sk", "ao", "vk"].map((key) => (
                <td key={key}>
                  <b className={`m ${row[key]}`}>{MARK[row[key]]}</b>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BEFORE = [
  { label: "Turn an idea into a spec", sk: "yes", ao: "part", vk: "yes" },
  { label: "Read a real requirements document", sk: "no", ao: "no", vk: "yes" },
  { label: "Ask before assuming", sk: "part", ao: "part", vk: "yes" },
  { label: "Track every guess and what's riding on it", sk: "no", ao: "no", vk: "yes" },
  { label: "Learn your team's conventions", sk: "no", ao: "yes", vk: "yes" },
  { label: "Decide whether to build it at all", sk: "no", ao: "no", vk: "yes" },
  { label: "Work on a codebase you already have", sk: "no", ao: "yes", vk: "yes" },
];

const DURING = [
  { label: "Break work into tasks", sk: "yes", ao: "part", vk: "yes" },
  { label: "Write the code", sk: "yes", ao: "part", vk: "yes" },
  { label: "Run several agents at once", sk: "no", ao: "no", vk: "yes" },
  { label: "Watch it live, from your phone", sk: "no", ao: "no", vk: "yes" },
  { label: "Prove the tests actually passed", sk: "no", ao: "no", vk: "yes" },
  { label: "Review on a second model", sk: "no", ao: "no", vk: "yes" },
  { label: "Survive a crash or a tool switch", sk: "no", ao: "no", vk: "yes" },
  { label: "Keep small changes small", sk: "no", ao: "part", vk: "yes" },
  { label: "Use cheap models where they're enough", sk: "no", ao: "no", vk: "yes" },
  { label: "Cap what it spends", sk: "no", ao: "no", vk: "yes" },
];

const AFTER = [
  { label: "Say why any line exists", sk: "no", ao: "no", vk: "yes" },
  { label: "Catch the spec drifting from the code", sk: "no", ao: "no", vk: "yes" },
  { label: "Score security against OWASP, POPIA, CIS", sk: "no", ao: "no", vk: "yes" },
  { label: "Generate HLD, LLD and diagrams in your brand", sk: "no", ao: "no", vk: "yes" },
  { label: "Hand a client something to approve", sk: "no", ao: "no", vk: "yes" },
  { label: "Undo a shipped feature cleanly", sk: "no", ao: "no", vk: "yes" },
  { label: "Show what the agents cost, and what was wasted", sk: "no", ao: "no", vk: "yes" },
  { label: "Learn from what went wrong", sk: "no", ao: "no", vk: "yes" },
  { label: "Onboard someone without you in the room", sk: "part", ao: "part", vk: "yes" },
];

const HELPERS = [
  ["/vibekit.clarify", "Asks first. Assumptions get ids."],
  ["/vibekit.run-sprint", "Whatever the current gate allows"],
  ["/vibekit.build", "One requirement, one branch, evidence"],
  ["/vibekit.run-review", "Second model. A person sets done."],
  ["/vibekit.show-status", "Where everything stands, in words"],
  ["/vibekit.show-why", "Why this line of code exists"],
  ["/vibekit.new-hotfix", "Production is down. Stay small."],
  ["/vibekit.new-feature", "Add work without a new planning pile"],
];

const COMMANDS = [
  ["new · start something that did not exist", [
    ["new project \"Hello World\"", "Name it, choose where it lives, describe it, answer the questions"],
    ["new sprint", "Begins the next sprint in the plan; closes the finished one at its gate"],
    ["new feature \"…\"", "One feature, mid-project, sized and slotted"],
    ["new bug \"…\" --test <path>", "A bug is a requirement with its failing test"],
    ["new hotfix \"…\"", "Production is broken; skip the ceremony"],
  ]],
  ["use · switch what I am working on", [
    ["use project \"Hello World 2\"", "Everything after applies there, until you switch again"],
    ["use sprint 2", "Switch the working sprint"],
    ["use", "Pick from a list"],
  ]],
  ["show · tell me something, change nothing", [
    ["show project", "Where we are, on one screen: needs you first"],
    ["show plan", "The sprints, in order, dependencies as English"],
    ["show status", "What needs you, across every project"],
    ["show cost · security · backlog · docs · team", "Spend, findings, unplanned work, documents, approvers"],
    ["show why src/x.js:12", "Why this line of code exists"],
  ]],
  ["plan · run", [
    ["plan project", "Turn the spec into sprints; approve with --approve --by"],
    ["plan sprint", "Re-order or re-scope the current sprint"],
    ["run", "Work the current sprint with several agents. --lanes 2 --until blocked"],
    ["run check · scan · review · docs", "Every mechanical check; security; the reviewer; the documents"],
  ]],
  ["analyze · migrate · verify", [
    ["analyze . | <git url>", "Read-only: what it is, how it is built, what would worry you. --focus, --compare, --pdf"],
    ["migrate upgrade | replatform | decompose", "Five stages, each ending at a gate you approve"],
    ["migrate status · next", "Where the migration is; move the next slice"],
    ["verify", "The current slice against the characterisation suite. --live, --replay, --data, --report"],
  ]],
  ["stop · resume · ship", [
    ["stop", "Stop cleanly; everything checkpointed, nothing billed"],
    ["resume", "Re-check the ground, then carry on"],
    ["ship release 1.2.0", "Tag, changelog, documents, evidence bundle"],
    ["ship rollback v1.1.0 · ship undo REQ-014", "Put the previous release back; remove a shipped feature"],
  ]],
  ["Extras", [
    ["tracker", "The live board, and a QR code for your phone"],
    ["settings · design add · ext add", "Models and tiers; a design reference; an extension"],
    ["completion <shell>", "Completes your projects, sprints and files, not just the grammar"],
  ]],
];

export default function Content() {
  return (
    <main className="page">
      <section className="block" id="intro">
        <ol className="ledger">
          <li><b>01</b><span>Watch it</span><em>From your phone</em></li>
          <li><b>02</b><span>Several agents</span><em>No collisions</em></li>
          <li><b>03</b><span>Cheap models</span><em>Where they work</em></li>
          <li><b>04</b><span>After it ships</span><em>Still the chain</em></li>
        </ol>
      </section>

      <section className="block" id="problem">
        <p className="kicker">01 · Problem</p>
        <h2>The problem I am trying to solve</h2>
        <p className="prose">Specs and agents already write the first version. The mess starts the next morning, when nobody can say what was decided, what was guessed, or why a line is there.</p>
        <div className="cards">
          <article>
            <p className="over">Agents invent policy</p>
            <h3>They fill the gaps you never wrote.</h3>
            <p>A coding agent that lacks a fact will pick one. Refunds go to a store credit. Auth is “good enough”. The code compiles. The decision was never yours.</p>
          </article>
          <article>
            <p className="over">Specs die after generation one</p>
            <h3>The chain breaks at the first PR.</h3>
            <p>Constitution, specify, plan, tasks, implement — then the loop ends. Review, evidence, drift, a hotfix, “why is this here?” are left to chat history.</p>
          </article>
          <article className="wide">
            <p className="over">What VibeKit does instead</p>
            <h3>If it does not know, it asks. If a person has not signed, it does not move.</h3>
            <p>One folder, <code>vibekit/</code>, is what every agent reads. Unknowns become asks with ids. Assumptions get a blast radius. <code>vibekit verify</code> writes the commit and the exit code into the requirement. Only a person sets <code>done</code>.</p>
          </article>
        </div>
      </section>

      <section className="block" id="coverage">
        <p className="kicker">02 · Coverage</p>
        <h2>Why not just Spec Kit?</h2>
        <p className="prose"><a href="https://github.com/github/spec-kit">Spec Kit</a> gets you to a first version fast, and that's genuinely the hard part starting out. <a href="https://github.com/buildermethods/agent-os">Agent OS</a> learns how your team already writes code. Both are good. The difference is how far each one takes you.</p>
        <p className="prose">Already using either? <code>vibekit new project --import .</code> reads what you have. Nothing is lost.</p>
        <p className="legend"><b className="m yes">✓</b> does it · <b className="m part">◐</b> partly · <b className="m no">—</b> doesn't, and isn't trying to</p>
        <h3 className="stage">Before you build</h3>
        <Table rows={BEFORE} />
        <h3 className="stage">While you build</h3>
        <Table rows={DURING} />
        <h3 className="stage">After it ships</h3>
        <Table rows={AFTER} />
        <p className="prose">The pattern is the point. Nobody loses the first table by much. The third one is empty for everything except VibeKit — they're first-pass tools, and they say so.</p>
      </section>

      <section className="block" id="helpers">
        <p className="kicker">03 · Helpers</p>
        <h2>The helpers</h2>
        <p className="prose">Slash commands in Claude Code. They are a thin layer over the CLI, so Cursor, Codex and an MCP client stay on the same workflow.</p>
        <div className="helpers">
          {HELPERS.map(([name, desc]) => (
            <div className="helper" key={name}><b>{name}</b><span>{desc}</span></div>
          ))}
        </div>
      </section>

      <section className="block" id="commands">
        <p className="kicker">04 · Commands</p>
        <h2>The command surface</h2>
        <p className="prose">Grouped the way <code>vibekit --help</code> prints it. A working day is still <code>vibekit show status</code>, then <code>vibekit run</code>.</p>
        <pre>{`vibekit show status     # what needs you, most blocking first
vibekit run             # the current sprint, several agents at once
vibekit tracker stock   # QR code; approve gates from your phone`}</pre>
        <div className="cmd-grid">
          {COMMANDS.map(([title, rows]) => (
            <article key={title}>
              <h3>{title}</h3>
              {rows.map(([name, desc]) => (
                <div className="helper" key={name}><b>{name}</b><span>{desc}</span></div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className="block" id="tracker">
        <p className="kicker">05 · Tracker</p>
        <h2>Watch it work. From anywhere.</h2>
        <p className="prose">Agents run for hours. You shouldn't have to sit there. <code>vibekit tracker</code> puts a live board behind a link. Scan the QR code and it's on your phone.</p>
        <p className="prose">“Creating a list”, not <code>REQ-007 step 4/5</code>. You can act from it: answer the question, approve a gate, reorder the sprint. Every tap is a commit with your name on it.</p>
      </section>

      <section className="block" id="lanes">
        <p className="kicker">06 · Lanes</p>
        <h2>Several agents. No collisions.</h2>
        <p className="prose">One agent at a time is a waiting game. <code>vibekit run</code> works several pieces at once, across whatever tools you've got. Two lanes is the default. Four is about the limit.</p>
      </section>

      <section className="block" id="cost">
        <p className="kicker">07 · Cost</p>
        <h2>Stop paying premium rates for scaffolding</h2>
        <p className="prose">Your best model doesn't need to write test fixtures. VibeKit sends each piece to the cheapest thing that does it well. Reviews are never cheaper than the work they check. Seats you already pay for go first.</p>
      </section>

      <section className="block" id="honest">
        <p className="kicker">08 · Honest</p>
        <h2>The honest version</h2>
        <p className="prose">Spec Kit is free, mature and backed by GitHub. Agent OS is the best thing going for standards. Both have real users today. VibeKit is an alpha built by one person and parts of it are rough.</p>
        <p className="prose strong">VibeKit is for the project where somebody asks, a year later, why a line is there — and you'd like to answer in a second rather than an afternoon.</p>
      </section>

      <section className="block" id="install">
        <p className="kicker">09 · Install</p>
        <h2>Install</h2>
        <p className="prose">Node.js 20+ and Git. The CLI is the same on every tool. Claude Code also gets a plugin; Cursor, Codex and the rest read the pointer files <code>vibekit new project</code> writes.</p>
        <pre>{`npm install -g https://github.com/Pershanthenm/vibekit/releases/download/v0.1.0-alpha/vibekit-0.1.0-alpha.tgz
git clone https://github.com/Pershanthenm/vibekit.git
npm install -g ./vibekit/plugin
vibekit version`}</pre>
        <div className="cards">
          <article>
            <h3>Claude Code</h3>
            <pre>{`/plugin marketplace add Pershanthenm/vibekit
/plugin install vibekit
cd your-project && vibekit new project`}</pre>
          </article>
          <article>
            <h3>Cursor and Cursor CLI</h3>
            <p><code>new project</code> writes <code>.cursorrules</code>. Attach MCP in <code>~/.cursor/mcp.json</code>.</p>
            <pre>{`{ "mcpServers": { "vibekit": { "command": "vibekit", "args": ["serve", "--stdio"] } } }`}</pre>
          </article>
          <article>
            <h3>Codex</h3>
            <pre>{`cd your-project && vibekit new project
vibekit serve --stdio`}</pre>
          </article>
          <article>
            <h3>Other CLI agents</h3>
            <pre>{`vibekit new project
vibekit new project --import .
vibekit serve --stdio --sandbox`}</pre>
          </article>
        </div>
        <div className="end-links">
          <a className="btn solid" href={ALPHA}>Alpha release</a>
          <a className="btn ghost" href="https://github.com/Pershanthenm/vibekit/blob/main/ONBOARDING.md">Onboarding</a>
        </div>
      </section>
    </main>
  );
}
