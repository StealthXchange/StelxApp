"use client";

import { useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;
const MONO = "var(--font-mono), Consolas, monospace";
const noop = () => () => {};

function useIsClient() {
  return useSyncExternalStore(noop, () => true, () => false);
}

interface Props {
  size?: number;
  hoverReplay?: boolean;

  labels?: [string, string];
}

export function AnimatedMark({ size = 320, hoverReplay = true, labels }: Props) {
  const reduce = useReducedMotion();
  const isClient = useIsClient();
  const [run, setRun] = useState(0);

  if (!isClient) return <div style={{ width: size, height: size }} aria-hidden="true" />;

  if (reduce) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label="STELX mark: a wallet link, severed" style={{ display: "block", overflow: "visible" }}>
        <path d="M19.5 4.5L4.5 19.5" stroke="var(--text-hi)" strokeWidth={2.2} strokeLinecap="round" />
        <path d="M4.5 4.5l4.6 4.6" stroke="var(--accent)" strokeWidth={2.2} strokeLinecap="round" />
        <path d="M14.9 14.9l4.6 4.6" stroke="var(--accent)" strokeWidth={2.2} strokeLinecap="round" />
        {labels ? <Labels labels={labels} animate={false} /> : null}
      </svg>
    );
  }

  return (
    <motion.svg
      key={run}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="STELX mark: a wallet link, severed"
      onMouseEnter={hoverReplay ? () => setRun((r) => r + 1) : undefined}
      style={{ display: "block", overflow: "visible" }}
    >

      <motion.path
        d="M19.5 4.5L4.5 19.5"
        stroke="var(--text-hi)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.55, ease: EASE }}
      />

      <motion.path
        d="M4.5 4.5L19.5 19.5"
        stroke="var(--text-hi)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 1 }}
        animate={{ pathLength: [0, 1, 1, 1], opacity: [1, 1, 1, 0] }}
        transition={{ duration: 1.15, times: [0, 0.5, 0.82, 0.92], ease: EASE, delay: 0.2 }}
      />

      <motion.path
        d="M4.5 4.5l4.6 4.6"
        stroke="var(--accent)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ opacity: 0, x: 0, y: 0 }}
        animate={{ opacity: 1, x: -0.55, y: -0.55 }}
        transition={{
          delay: 1.22,
          type: "spring",
          stiffness: 260,
          damping: 18,
          opacity: { duration: 0.12, delay: 1.22 },
        }}
      />
      <motion.path
        d="M14.9 14.9l4.6 4.6"
        stroke="var(--accent)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ opacity: 0, x: 0, y: 0 }}
        animate={{ opacity: 1, x: 0.55, y: 0.55 }}
        transition={{
          delay: 1.22,
          type: "spring",
          stiffness: 260,
          damping: 18,
          opacity: { duration: 0.12, delay: 1.22 },
        }}
      />

      <motion.circle
        cx={12}
        cy={12}
        r={1.3}
        fill="var(--accent)"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 0], opacity: [0, 1, 0] }}
        transition={{ delay: 1.1, duration: 0.4, ease: "easeOut" }}
        style={{ transformOrigin: "12px 12px" }}
      />
      {labels ? <Labels labels={labels} animate /> : null}
    </motion.svg>
  );
}

function Labels({ labels, animate }: { labels: [string, string]; animate: boolean }) {
  const common = {
    fontSize: 1.05,
    letterSpacing: 0.14,
    fill: "var(--text-low)",
    style: { fontFamily: MONO },
  } as const;
  if (!animate) {
    return (
      <>
        <text x={2.2} y={1.9} {...common}>{labels[0]}</text>
        <text x={21.8} y={23.4} textAnchor="end" {...common}>{labels[1]}</text>
      </>
    );
  }
  return (
    <>
      <motion.text x={2.2} y={1.9} {...common} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.7, duration: 0.5 }}>
        {labels[0]}
      </motion.text>
      <motion.text x={21.8} y={23.4} textAnchor="end" {...common} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.85, duration: 0.5 }}>
        {labels[1]}
      </motion.text>
    </>
  );
}
