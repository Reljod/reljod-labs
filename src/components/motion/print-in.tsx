"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Slides out of an unseen slot, top first, like a card from an ID printer. */
export function PrintIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{
        clipPath: "inset(-16px -16px 100% -16px)",
        y: -36,
        rotate: -2,
      }}
      animate={{ clipPath: "inset(-16px -16px -16px -16px)", y: 0, rotate: 0 }}
      transition={{ duration: 1.1, delay: 0.35, ease: [0.3, 0, 0.15, 1] }}
    >
      {children}
    </motion.div>
  );
}
