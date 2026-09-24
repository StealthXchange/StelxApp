"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from "motion/react";
import { BlockButton } from "@/components/BlockButton";

const HEADLINE = "Hold stocks. Nobody sees what.";
const PARA =
  "A privacy pool for tokenised stocks on Robinhood Chain. Deposit once, and your positions and transfers are yours alone.";

export function HeroTrack() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });

  const headScale = useTransform(p, [0.04, 0.26], [1, 0.26]);
  const ctaOpacity = useTransform(p, [0.02, 0.14], [1, 0]);
  const ctaY = useTransform(p, [0.02, 0.14], [0, 16]);
  const ctaVis = useTransform(p, (v) => (v > 0.15 ? "hidden" : "visible"));

  const paraOpacity = useTransform(p, [0.16, 0.24, 0.62, 0.72], [0, 1, 1, 0]);
  const paraY = useTransform(p, [0.16, 0.24, 0.62, 0.72], [40, 0, 0, -32]);
  const stmtOpacity = useTransform(p, [0.70, 0.80], [0, 1]);
  const stmtY = useTransform(p, [0.70, 0.80], [56, 0]);
  const rotate = useTransform(p, [0, 1], [0, 34]);
  const cut = useTransform(p, [0.36, 0.62], [0, 1]);

  {
    return (
      <div className="hero-static">
        <h1 className="display hero-title">{HEADLINE}</h1>
        <div className="hero-cta"><BlockButton href="/pool" label="Open the wallet" /></div>
        <p className="display hero-para-static">{PARA}</p>
        <div className="hero-mark-static"><StaticMark /></div>
      </div>
    );
  }

  const words = PARA.split(" ");

  return (
    <div ref={ref} className="hero-track">
      <div className="hero-sticky">
        <div className="hero-left">
          <motion.h1 className="display hero-title" style={{ scale: headScale, transformOrigin: "left top" }}>
            {HEADLINE}
          </motion.h1>
          <motion.div className="hero-cta" style={{ opacity: ctaOpacity, y: ctaY, visibility: ctaVis }}>
            <BlockButton href="/pool" label="Open the wallet" />
          </motion.div>
          <motion.p className="display hero-para" style={{ opacity: paraOpacity, y: paraY }} aria-label={PARA}>
            {words.map((w, i) => (
              <HeroWord key={i} word={w} index={i} total={words.length} progress={p} />
            ))}
          </motion.p>
          <motion.div className="display hero-stmt" style={{ opacity: stmtOpacity, y: stmtY }}>
            Win <span className="tint">quietly</span>
            <br />
            on chain.
          </motion.div>
        </div>
        <div className="hero-divider" aria-hidden="true" />
        <div className="hero-right">
          <motion.div className="hero-mark-wrap" style={{ rotate }}>
            <ScrubMark cut={cut} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function HeroWord({
  word,
  index,
  total,
  progress,
}: {
  word: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const start = 0.3 + (index / total) * 0.22;
  const end = Math.min(0.56, start + 0.03);
  const opacity = useTransform(progress, [start, end], [0.3, 1]);
  return (
    <motion.span style={{ opacity, display: "inline-block", marginRight: "0.26em" }} aria-hidden="true">
      {word}
    </motion.span>
  );
}

const EASE = [0.16, 1, 0.3, 1] as const;

function ScrubMark({ cut }: { cut: MotionValue<number> }) {
  const linkOpacity = useTransform(cut, [0.45, 0.6], [1, 0]);
  const endOpacity = useTransform(cut, [0.55, 0.7], [0, 1]);
  const offA = useTransform(cut, [0.55, 1], [0, -0.6]);
  const offB = useTransform(cut, [0.55, 1], [0, 0.6]);
  const spark = useTransform(cut, [0.5, 0.6, 0.74], [0, 1.4, 0]);
  return (
    <svg viewBox="0 0 24 24" fill="none" className="scrub-mark" role="img" aria-label="STELX mark: the link is cut as you scroll" style={{ overflow: "visible" }}>
      <motion.path
        d="M19.5 4.5L4.5 19.5"
        stroke="var(--t-fg)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7, ease: EASE }}
      />
      <motion.path
        d="M4.5 4.5L19.5 19.5"
        stroke="var(--t-fg)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
        style={{ opacity: linkOpacity }}
      />
      <motion.path d="M4.5 4.5l4.6 4.6" stroke="var(--mark-accent)" strokeWidth={2.2} strokeLinecap="round" style={{ opacity: endOpacity, x: offA, y: offA }} />
      <motion.path d="M14.9 14.9l4.6 4.6" stroke="var(--mark-accent)" strokeWidth={2.2} strokeLinecap="round" style={{ opacity: endOpacity, x: offB, y: offB }} />
      <motion.circle cx={12} cy={12} r={1.3} fill="var(--mark-accent)" style={{ scale: spark, transformOrigin: "12px 12px" }} />
    </svg>
  );
}

function StaticMark() {

  return (
    <svg viewBox="0 0 24 24" fill="none" className="hero-mark" role="img" aria-label="STELX mark" style={{ overflow: "visible" }}>
      <path className="mk-long" d="M19.5 4.5L4.5 19.5" stroke="var(--mark-long)" strokeWidth={2.2} strokeLinecap="round" pathLength={1} />
      <path className="mk-cut mk-cut-a" d="M4.5 4.5l4.6 4.6" stroke="var(--mark-cut)" strokeWidth={2.2} strokeLinecap="round" pathLength={1} />
      <path className="mk-cut mk-cut-b" d="M14.9 14.9l4.6 4.6" stroke="var(--mark-cut)" strokeWidth={2.2} strokeLinecap="round" pathLength={1} />
    </svg>
  );
}

