"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Mark, XLogo, GitHubLogo, GITHUB_URL } from "@/components/icons";

const LINKS: Array<[string, string]> = [
  ["Architecture", "/architecture"],
  ["Security", "#security"],
  ["Roadmap", "/roadmap"],
  ["Privacy Center", "/privacy"],
  ["The Ceremony", "/ceremony"],
  ["Open the wallet", "/pool"],
  ["GitHub", GITHUB_URL],
  ["@StelXchange", "https://x.com/StelXchange"],
];

const EASE = [0.16, 1, 0.3, 1] as const;

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.width = "100%";
    document.documentElement.classList.add("menu-open");
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      document.documentElement.classList.remove("menu-open");
      window.scrollTo(0, y);
    };
  }, [open]);

  return (
    <>
      <header className="site-nav">
        <Link href="/" className="site-brand" onClick={() => setOpen(false)}>
          <Mark size={44} />
          <span>STELX</span>
        </Link>
        <div className="site-nav-right">
          <Link href="/pool" className="site-nav-link">Open the wallet</Link>
          <a href={GITHUB_URL} className="site-nav-x" target="_blank" rel="noopener noreferrer" aria-label="STELX on GitHub">
            <GitHubLogo size={18} />
          </a>
          <a href="https://x.com/StelXchange" className="site-nav-x" target="_blank" rel="noopener noreferrer" aria-label="STELX on X">
            <XLogo size={18} />
          </a>
          <button
            type="button"
            className={open ? "burger is-open" : "burger"}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
          </button>
        </div>
      </header>
      <AnimatePresence>
        {open ? (
          <motion.nav
            className="site-menu"
            aria-label="Site"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            {LINKS.map(([label, href], i) => (
              <motion.div
                key={href}
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 + i * 0.06, duration: 0.5, ease: EASE }}
              >
                {href.startsWith("http") ? (
                  <a href={href} className="site-menu-link site-menu-ext" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                    {href === GITHUB_URL ? <GitHubLogo size={22} /> : <XLogo size={22} />} {label}
                  </a>
                ) : (
                  <Link href={href} className="site-menu-link" onClick={() => setOpen(false)}>
                    {label}
                  </Link>
                )}
              </motion.div>
            ))}
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </>
  );
}
