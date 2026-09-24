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
  ["/vibekit.next", "Whatever the current gate allows"],
  ["/vibekit.build", "One requirement, one branch, evidence"],
  ["/vibekit.review", "Second model. A person sets done."],
  ["/vibekit.status", "Where everything stands, in words"],
  ["/vibekit.why", "Why this line of code exists"],
  ["/vibekit.hotfix", "Production is down. Stay small."],
  ["/vibekit.new-feature", "Add work without a new planning pile"],
];

const COMMANDS = [
  ["Projects", [
    ["project new", "Starts a project. --name, --describe, --from, --platform"],
    ["project select", "Lists your projects and picks one"],
    ["project status", "Where this project is, or every project on one screen"],
    ["project import <repo>", "Reads an existing codebase"],
    ["project assess", "Asks whether it should be built at all"],
    ["project stop / resume", "Stops cleanly and restarts after re-checking"],
  ]],
  ["Sprints", [
    ["sprint plan", "Turns the spec into sprints in dependency order"],
    ["sprint start", "Works the current sprint one piece at a time"],
    ["sprint run", "Several agents at once. --lanes 2"],
    ["sprint status", "Progress, lanes and what is blocked"],
    ["sprint close --by", "The one step VibeKit cannot do for you"],
  ]],
  ["Action needed", [
    ["action", "Everything waiting on you, most blocking first"],
    ["action answer", "Answers from anywhere and writes it in"],
    ["tracker", "The same inbox on your phone. QR code"],
  ]],
  ["Work", [
    ["feature add", "Adds one feature mid-project"],
    ["bug", "A bug is a requirement with its failing test"],
    ["hotfix", "Branches from the live tag, fixes, tests, releases"],
    ["review", "Runs the reviewer. A person still approves"],
    ["why <file:line>", "Explains why a line of code exists"],
  ]],
  ["Design", [
    ["design", "What the app looks like now and the intent"],
    ["design add", "A URL, image or PDF"],
    ["design preview", "Renders your real screens"],
    ["design apply", "Turns references into tokens"],
  ]],
  ["Quality", [
    ["security scan", "OWASP, CIS, POPIA and whatever else applies"],
    ["check", "Every mechanical check. This is what CI runs"],
    ["docs", "HLD, LLD, API, data, runbook"],
    ["report", "build, budget or security as documents"],
  ]],
  ["Shipping", [
    ["release", "Verifies, writes the changelog, tags"],
    ["rollback <tag>", "Restores the previous release"],
    ["undo <id>", "Removes a shipped feature cleanly"],
  ]],
  ["Setup", [
    ["init", "Creates the folder"],
    ["team", "People and CODEOWNERS"],
    ["cost", "Spend against forecast"],
    ["settings", "Machine settings, tokens, publishers"],
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
        <p className="prose">Already using either? <code>vibekit project import .</code> reads what you have. Nothing is lost.</p>
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
        <p className="prose">Grouped the way <code>vibekit --help</code> prints it. A working day is still <code>vibekit action</code>, then <code>vibekit sprint run</code>.</p>
        <pre>{`vibekit action          # everything waiting on you, most blocking first
vibekit sprint run      # the current sprint, several agents at once
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
        <p className="prose">One agent at a time is a waiting game. <code>vibekit sprint run</code> works several pieces at once, across whatever tools you've got. Two lanes is the default. Four is about the limit.</p>
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
        <p className="prose">Node.js 20+ and Git. The CLI is the same on every tool. Claude Code also gets a plugin; Cursor, Codex and the rest read the pointer files <code>vibekit project new</code> writes.</p>
        <pre>{`npm install -g https://github.com/Pershanthenm/vibekit/releases/download/v0.1.0-alpha/vibekit-0.1.0-alpha.tgz
git clone https://github.com/Pershanthenm/vibekit.git
npm install -g ./vibekit/plugin
vibekit version`}</pre>
        <div className="cards">
          <article>
            <h3>Claude Code</h3>
            <pre>{`/plugin marketplace add Pershanthenm/vibekit
/plugin install vibekit
cd your-project && vibekit project new`}</pre>
          </article>
          <article>
            <h3>Cursor and Cursor CLI</h3>
            <p><code>project new</code> writes <code>.cursorrules</code>. Attach MCP in <code>~/.cursor/mcp.json</code>.</p>
            <pre>{`{ "mcpServers": { "vibekit": { "command": "vibekit", "args": ["serve", "--stdio"] } } }`}</pre>
          </article>
          <article>
            <h3>Codex</h3>
            <pre>{`cd your-project && vibekit project new
vibekit serve --stdio`}</pre>
          </article>
          <article>
            <h3>Other CLI agents</h3>
            <pre>{`vibekit project new
vibekit project import .
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
