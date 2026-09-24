"use client";

import { useRef, type CSSProperties } from "react";
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from "motion/react";

export function WordReveal({
  text,
  className,
  style,
  as: Tag = "p",
  dim = 0.28,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  as?: "p" | "h2";
  dim?: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 88%", "end 42%"] });
  const words = text.split(" ");
  const M = motion[Tag];
  if (reduce) {
    return <Tag ref={ref} className={className} style={style}>{text}</Tag>;
  }
  return (
    <M ref={ref} className={className} style={style} aria-label={text}>
      {words.map((w, i) => (
        <Word key={i} word={w} index={i} total={words.length} progress={scrollYProgress} dim={dim} />
      ))}
    </M>
  );
}

function Word({
  word,
  index,
  total,
  progress,
  dim,
}: {
  word: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
  dim: number;
}) {
  const start = index / total;
  const end = Math.min(1, start + 1.6 / total);
  const opacity = useTransform(progress, [start, end], [dim, 1]);
  return (
    <motion.span style={{ opacity, display: "inline-block", marginRight: "0.26em" }} aria-hidden="true">
      {word}
    </motion.span>
  );
}
