import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import "./Hero.css";

const EASE = [0.16, 1, 0.3, 1];
const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4";
const ALPHA = "https://github.com/Pershanthenm/vibekit/releases/tag/v0.1.0-alpha";

const LINKS = [
  { href: "#install", label: "Get Started" },
  { href: "#commands", label: "Developers" },
  { href: "#coverage", label: "Features" },
  { href: "#helpers", label: "Resources" },
];

function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="3.2" y="7.4" width="16" height="6.2" rx="3.1" fill="#000" transform="rotate(-35 11.2 10.5)" />
      <rect x="8.6" y="13.2" width="16" height="6.2" rx="3.1" fill="#000" transform="rotate(-35 16.6 16.3)" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="3" cy="3" r="1.35" fill="#fff" />
      <circle cx="9" cy="3" r="1.35" fill="#fff" />
      <circle cx="3" cy="9" r="1.35" fill="#fff" />
      <circle cx="9" cy="9" r="1.35" fill="#fff" />
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
      <div className="video-stage">
        <motion.div
          className="video-frame"
          {...enter({
            initial: { opacity: 0, scale: 1.05 },
            animate: { opacity: 1, scale: 1 },
            transition: { duration: 1.8, ease: EASE },
          })}
        >
          <video autoPlay muted loop playsInline>
            <source src={VIDEO} type="video/mp4" />
          </video>
        </motion.div>
      </div>

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
              Menu
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
            <span>Live tracker</span>
            <span>Parallel lanes</span>
          </div>
        </div>

        <div className="nav-right">
          <div className="adaptive">
            <span className="grid-btn" aria-hidden="true">
              <GridIcon />
            </span>
            <span className="adaptive-label">Signed gates</span>
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
            Alpha for Claude, Cursor, Codex
          </motion.p>
          <motion.h1
            {...enter({
              initial: { opacity: 0, y: 20 },
              animate: { opacity: 1, y: 0 },
              transition: { delay: 0.8, duration: 0.8, ease: EASE },
            })}
          >
            Agents write.
            <br />
            A person decides.
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
              Get Alpha
            </a>
            <a className="btn ghost" href="#coverage" onClick={(event) => jump(event, "#coverage")}>
              How it works
            </a>
          </motion.div>
        </div>
        <div className="foot-tags">
          <span>Tracker</span>
          <span>Lanes</span>
          <span>Evidence</span>
        </div>
      </motion.div>
    </section>
  );
}
