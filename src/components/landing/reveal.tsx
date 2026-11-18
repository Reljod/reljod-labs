"use client";

import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

/** Every landing animation honours the visitor's reduced-motion setting. */
export function LandingMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** How fast words land. Short on purpose: a reveal must never hold up reading. */
const WORD_STAGGER = 0.06;
const WORD_DURATION = 0.45;

/**
 * A line that arrives a word at a time. Screen readers get the whole line
 * once; the animated words are hidden from them.
 */
export function RevealWords({
  text,
  onMount = false,
  delay = 0,
  className,
}: {
  text: string;
  /** Plays on load (the opening scene) instead of when scrolled into view. */
  onMount?: boolean;
  delay?: number;
  className?: string;
}) {
  const words = text.split(" ");
  const shown = { opacity: 1, y: 0, rotate: 0 };
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's words never reorder.
            key={index}
            className="inline-block whitespace-pre"
            initial={{ opacity: 0, y: "0.45em", rotate: index % 2 ? 2 : -2 }}
            {...(onMount
              ? { animate: shown }
              : { whileInView: shown, viewport: { once: true, amount: 0.6 } })}
            transition={{
              duration: WORD_DURATION,
              delay: delay + index * WORD_STAGGER,
              ease: [0.2, 0.8, 0.2, 1],
            }}
          >
            {index < words.length - 1 ? `${word} ` : word}
          </motion.span>
        ))}
      </span>
    </span>
  );
}

/** A block that rises in once when it scrolls into view. */
export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
