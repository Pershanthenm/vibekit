import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import "./TuiDemo.css";

const ANSWER = "A shared list for a team that leaves.";
const HOLD = [5200, 1600, 3400, 5200, 4000];

function Opening({ typed }) {
  return (
    <>
      <p className="tui-lead">Before I build anything, I need to understand what you want.</p>
      <p className="tui-q">What are you building?</p>
      <p className="tui-gutter">
        <span className="tui-teal">▏</span>
        {typed}
        <i className="tui-caret" />
      </p>
      <p className="tui-keys">⏎ when you&apos;re done · or drop a requirements document here</p>
    </>
  );
}

function Setup() {
  return (
    <>
      <p className="tui-q">Got it.</p>
      <p className="tui-row">
        <span className="tui-label">Reading what&apos;s here</span>
        <span className="tui-muted">nothing here yet — starting from your description</span>
      </p>
      <p className="tui-row">
        <span className="tui-label">Setting up</span>
        <span>Claude Code, Cursor — and AGENTS.md for the rest</span>
      </p>
      <p className="tui-row">
        <span className="tui-label">Checking</span>
        <span className="tui-muted">nothing existing was changed</span>
      </p>
      <p className="tui-next">Now — 6 questions. 4 of them change the shape of the app.</p>
    </>
  );
}

function Ask() {
  const rows = [
    ["1", "In a web browser", true],
    ["2", "On their phones (iOS and Android)", false],
    ["3", "Both: a browser and a phone app", false],
    ["4", "It is an API; something else has the screens", false],
    ["5", "On the command line", false],
    ["?", "I don\u2019t know", false, "records it as a guess for you to check"],
  ];
  return (
    <>
      <p className="tui-meta">
        <span>1 of 6</span>
        <span>4 change the shape</span>
      </p>
      <p className="tui-q">Where will people use it?</p>
      <p className="tui-why">This decides the architecture, the kinds of test, and whether there is a design stage at all. Changing it later means a different front end.</p>
      <ul className="tui-opts">
        {rows.map(([n, label, on, extra]) => (
          <li key={n} className={on ? "is-on" : ""}>
            <span className="tui-teal">{on ? "▸" : " "}</span>
            <span className="tui-n">{n}</span>
            <span>{label}</span>
            {extra ? <em>{extra}</em> : null}
          </li>
        ))}
      </ul>
      <p className="tui-keys">↑↓ move · ⏎ choose · t type something else · esc back</p>
    </>
  );
}

function Done() {
  return (
    <>
      <p className="tui-q">6 answers recorded.</p>
      <p className="tui-why">That is everything I need to start. The analyst reads your answers next and asks only what they do not cover.</p>
      <p className="tui-row">
        <span className="tui-label">Next</span>
        <span>vibekit show status</span>
        <span className="tui-muted">what is waiting on you</span>
      </p>
      <p className="tui-row">
        <span className="tui-label" />
        <span>vibekit run</span>
        <span className="tui-muted">hand the first work to an agent</span>
      </p>
    </>
  );
}

export default function TuiDemo() {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(reduced ? 3 : 0);
  const [typed, setTyped] = useState(reduced ? ANSWER : "");

  useEffect(() => {
    if (reduced) return undefined;
    let cancelled = false;
    let timer;

    function typeOut() {
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        i += 1;
        setTyped(ANSWER.slice(0, i));
        if (i < ANSWER.length) timer = setTimeout(tick, 38);
      };
      setTyped("");
      timer = setTimeout(tick, 420);
    }

    function play(at) {
      setFrame(at);
      if (at === 0) typeOut();
      timer = setTimeout(() => play((at + 1) % HOLD.length), HOLD[at]);
    }

    play(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduced]);

  const screen = frame === 0 || frame === 1
    ? <Opening typed={typed} />
    : frame === 2
      ? <Setup />
      : frame === 3
        ? <Ask />
        : <Done />;

  return (
    <figure className="tui" aria-label="First run of vibekit in a terminal">
      <figcaption className="tui-cap">
        <span>vibekit</span>
        <span>full · a TTY</span>
      </figcaption>
      <div className="tui-body" aria-live="polite">
        {screen}
      </div>
    </figure>
  );
}
