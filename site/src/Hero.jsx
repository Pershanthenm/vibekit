import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import LaptopScene from "./LaptopScene.jsx";
import "./Hero.css";

const EASE = [0.16, 1, 0.3, 1];
const ALPHA = "https://github.com/Pershanthenm/vibekit/releases/tag/v0.1.0-alpha";

const LINKS = [
  { href: "#install", label: "Get Started" },
  { href: "#first-run", label: "First run" },
  { href: "#commands", label: "Developers" },
  { href: "#coverage", label: "Features" },
];

function LogoMark() {
  return (
    <svg className="logo-mark" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="13" height="5" rx="2.5" fill="#000" transform="rotate(-35 3 7)" />
      <rect x="9" y="13" width="13" height="5" rx="2.5" fill="#000" transform="rotate(-35 9 13)" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="3.5" r="1.4" fill="#fff" />
      <circle cx="8.5" cy="3.5" r="1.4" fill="#fff" />
      <circle cx="3.5" cy="8.5" r="1.4" fill="#fff" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="#fff" />
    </svg>
  );
}

export default function Hero() {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  const enter = (extra = {}) =>
    reduced
      ? { initial: false, animate: { opacity: 1, y: 0, scale: 1 } }
      : extra;

  function jump(event, href) {
    if (!href.startsWith("#")) return;
    event.preventDefault();
    setOpen(false);
    const el = document.querySelector(href);
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", href);
  }

  return (
    <section className="hero" id="home">
      <motion.div
        className="scene"
        aria-hidden="true"
        {...enter({
          initial: { opacity: 0, scale: 1.05 },
          animate: { opacity: 1, scale: 1 },
          transition: { duration: 1.8, ease: EASE },
        })}
      >
        <LaptopScene reduced={reduced} />
      </motion.div>

      <motion.nav
        className="nav"
        aria-label="Site"
        {...enter({
          initial: { opacity: 0, y: -16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, ease: EASE },
        })}
      >
        <div className="nav-left">
          <a className="brand" href="#home" onClick={(event) => jump(event, "#home")}>
            <LogoMark />
            <span className="brand-text">VibeKit</span>
          </a>

          <div className="menu-wrap">
            <button
              type="button"
              className="menu-btn"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
            >
              <span className={`menu-circle${open ? " is-open" : ""}`}>
                <Plus size={12} strokeWidth={3} />
              </span>
              <span className="menu-label">Menu</span>
            </button>
            {open && (
              <div className="menu-panel" id="site-menu">
                {LINKS.map((link) => (
                  <a key={link.href} href={link.href} onClick={(event) => jump(event, link.href)}>
                    {link.label}
                  </a>
                ))}
                <a href="https://github.com/Pershanthenm/vibekit" onClick={() => setOpen(false)}>
                  GitHub
                </a>
              </div>
            )}
          </div>

          <div className="tags-pill">
            <span>Ask-first</span>
            <span>Human-gated</span>
          </div>
        </div>

        <div className="nav-right">
          <div className="right-pill">
            <span className="right-circle" aria-hidden="true">
              <GridIcon />
            </span>
            <span className="right-label">Built for the morning after</span>
          </div>
        </div>
      </motion.nav>

      <motion.div
        className="foot"
        {...enter({
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: 0.5, duration: 1, ease: EASE },
        })}
      >
        <div className="foot-left">
          <motion.p
            className="subtitle"
            {...enter({
              initial: { opacity: 0, y: 16 },
              animate: { opacity: 1, y: 0 },
              transition: { delay: 0.6, duration: 0.8, ease: EASE },
            })}
          >
            <i />
            Alpha · Claude Code, Cursor, Codex, any MCP client
          </motion.p>
          <motion.h1
            {...enter({
              initial: { opacity: 0, y: 20 },
              animate: { opacity: 1, y: 0 },
              transition: { delay: 0.8, duration: 0.8, ease: EASE },
            })}
          >
            Agents build it.
            <br />
            You decide it.
          </motion.h1>
          <motion.div
            className="cta-row"
            {...enter({
              initial: { opacity: 0, y: 16 },
              animate: { opacity: 1, y: 0 },
              transition: { delay: 1, duration: 0.8, ease: EASE },
            })}
          >
            <a className="btn solid" href={ALPHA}>
              Get the alpha
            </a>
            <a className="btn ghost" href="#first-run" onClick={(event) => jump(event, "#first-run")}>
              See the first run
            </a>
          </motion.div>
        </div>
        <div className="foot-tags">
          <span>Asks, not guesses</span>
          <span>Evidence, not claims</span>
          <span>Reviewed on a second model</span>
        </div>
      </motion.div>
    </section>
  );
}
