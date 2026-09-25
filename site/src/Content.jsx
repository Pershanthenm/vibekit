import "./Content.css";

const ALPHA = "https://github.com/Pershanthenm/vibekit/releases/tag/v0.1.0-alpha";

const IDEAS = [
  ["Asks, not guesses", "An agent that lacks a fact writes an ask with an id and stops. It does not invent a refund policy so the build can keep going."],
  ["Gates only you close", "Between every stage is a line a person writes. Nothing advances itself. A tap on the phone is still a commit with your name on it."],
  ["Evidence on the commit", "vibekit verify writes the exit code into the requirement. tested is refused without it. A second model reviews; a person sets done."],
  ["Why any line exists", "show why src/x.js:12 walks the chain: the requirement, the ask, the assumption, the review. Chat history is not the record."],
  ["Several agents, one folder", "run works lanes in parallel. One job, one branch, one folder each. A crash or a tool switch picks up the same checkpoint."],
  ["The live board in your pocket", "tracker puts the sprint behind a QR code. Creating a list, not REQ-007 step 4/5. Answer, approve, reorder from anywhere."],
];

const HELPERS = [
  ["/vibekit:setup", "Once, after install: where projects live, who you are, which provider and token"],
  ["/vibekit:new-project", "Start here. Name, platforms, what it is; then the repository, created for you or linked"],
  ["/vibekit:new-brs", "No requirements document? Five plain questions become one"],
  ["/vibekit:use-project", "Pick the project to work on from the ones on this machine"],
  ["/vibekit:answer", "Everything waiting on you, one question at a time, by picking"],
  ["/vibekit:show-status", "Where everything stands, in words, then what to do about it"],
  ["/vibekit:run-sprint", "Whatever the current gate allows"],
  ["/vibekit:clarify", "Asks first, with the choices. Assumptions get ids."],
  ["/vibekit:plan-project", "The sprints, in dependency order, for a person to approve"],
  ["/vibekit:plan-sprint", "What runs in which lane, and why"],
  ["/vibekit:new-sprint", "Begin the next sprint; the last one closes at its gate"],
  ["/vibekit:build", "One requirement, one branch, evidence"],
  ["/vibekit:run-check", "Every rule the standards state, mechanically"],
  ["/vibekit:run-review", "Second model. A person sets done."],
  ["/vibekit:new-feature", "Add work without a new planning pile"],
  ["/vibekit:new-bug", "A defect is a requirement with its failing test"],
  ["/vibekit:new-hotfix", "Production is down. Stay small."],
  ["/vibekit:show-plan", "Sprints, pieces of work, pace, approval"],
  ["/vibekit:show-why", "Why this line of code exists"],
  ["/vibekit:analyze", "Explain a codebase back. Changes nothing."],
];

const COMMANDS = [
  ["new · start something that did not exist", [
    ["new project \"Hello World\"", "Name it, choose where it lives, describe it, answer the questions"],
    ["new sprint", "Begins the next sprint in the plan; closes the finished one at its gate"],
    ["new feature \"…\"", "One feature, mid-project, sized and slotted"],
    ["new bug \"…\" --test <path>", "A bug is a requirement with its failing test"],
    ["new hotfix \"…\"", "Production is broken; skip the ceremony"],
    ["new repo", "The repository at GitHub, GitLab or Azure DevOps, its pipeline file, the first push"],
    ["new brs", "The requirements document, from five plain questions, when you have none"],
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
            <p className="over">The first version is not the product</p>
            <h3>The chain breaks at the first PR.</h3>
            <p>A spec that is not bound to the next commit is a souvenir. Review, evidence, drift, a hotfix, “why is this here?” get left in chat history.</p>
          </article>
          <article className="wide">
            <p className="over">What VibeKit does instead</p>
            <h3>If it does not know, it asks. If a person has not signed, it does not move.</h3>
            <p>One folder, <code>vibekit/</code>, is what every agent reads. Unknowns become asks with ids. Assumptions get a blast radius. <code>vibekit verify</code> writes the commit and the exit code into the requirement. Only a person sets <code>done</code>.</p>
          </article>
        </div>
      </section>

      <section className="block" id="coverage">
        <p className="kicker">02 · What it does</p>
        <h2>A loop that stays after the first version.</h2>
        <p className="prose">VibeKit is the folder agents have to read, the ask they have to write, and the gate only you can close. The first version is the start of the project, not the end of the tool.</p>
        <div className="cards">
          {IDEAS.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <p className="prose">Already have a folder? <code>vibekit new project --import .</code> reads it. Nothing is thrown away so you can start again.</p>
      </section>

      <section className="block" id="helpers">
        <p className="kicker">03 · Helpers</p>
        <h2>The helpers</h2>
        <p className="prose">Twenty slash commands in Claude Code, one per CLI verb: type <code>/vibekit:</code> and the list completes. Each asks with a picker, so you choose rather than type. They are a thin layer over the CLI, so Cursor, Codex and an MCP client stay on the same workflow.</p>
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
        <p className="prose">VibeKit is an alpha built by one person. Parts of it are rough. The bet is that a year from now you can still say why a line is there, what it cost, and who closed the gate.</p>
        <p className="prose strong">That is the product. Not a first-pass spec. The chain that survives the morning after.</p>
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
