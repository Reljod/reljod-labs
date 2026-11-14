/**
 * How sure the graph is of a fact, in three steps the view draws the same
 * way everywhere: a full dot and a solid line, a half dot and a dashed line,
 * a hollow dot and a dotted line.
 */

export type Certainty = "high" | "medium" | "low";

export const CERTAINTY_FLOOR = { high: 0.8, medium: 0.6 } as const;

export function certaintyOf(confidence: number): Certainty {
  if (confidence >= CERTAINTY_FLOOR.high) return "high";
  if (confidence >= CERTAINTY_FLOOR.medium) return "medium";
  return "low";
}

export const CERTAINTY_STYLE: Record<
  Certainty,
  { color: string; dash: string | undefined; label: string }
> = {
  high: { color: "#2f6b3f", dash: undefined, label: "Stated plainly" },
  medium: { color: "#b38327", dash: "7 5", label: "Likely" },
  low: { color: "#b23a2b", dash: "1.5 5", label: "Unsure" },
};

/** What a research finding's word means as a number on the graph. */
export const CERTAINTY_VALUE: Record<Certainty, number> = {
  high: 0.85,
  medium: 0.7,
  low: 0.5,
};
