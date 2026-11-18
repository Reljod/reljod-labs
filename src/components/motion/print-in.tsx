import type { ReactNode } from "react";
import "./motion.css";

/**
 * Slides out of an unseen slot, top first, like a card from an ID printer.
 * Pure CSS, so it needs no script and honours reduced motion (motion.css).
 */
export function PrintIn({ children }: { children: ReactNode }) {
  return <div className="print-in">{children}</div>;
}
