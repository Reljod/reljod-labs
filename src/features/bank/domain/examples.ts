/**
 * Example prompts the Teller chat offers before the first message. The first
 * `EXAMPLES_SHOWN` are always on screen; "See more" opens the whole list.
 * Every example asks for something an existing command can do, or (the last
 * ones) asks the bank to grow.
 */
export const EXAMPLES = [
  "What can Mara spend right now, and why is it less than her balance?",
  "Transfer MRF 25 from Mara's everyday account to Joren",
  "Pay Tavi's supplier Old Mill Supplies MRF 180",
  "Chart Mara's spending by month",
  "Freeze Mara's card",
  "I want savings goals with a target and a progress bar",
  "How much is left on Joren's loan, and when is the next repayment due?",
  "Show Tavi's last ten transactions",
  "Which standing orders run from Mara's accounts?",
  "Open a 6-month term deposit for Joren with MRF 500 from his house fund",
  "Set a daily card limit of MRF 300 on Tavi's card",
  "Are there any alerts waiting for a decision?",
  "Request a statement for Mara's everyday account",
  "Does the trial balance balance?",
  "Move the bank's clock forward one day and tell me what end-of-day did",
  "Which Rules decide whether a payment needs an Approval?",
] as const;

/** How many examples the chat shows before "See more". */
export const EXAMPLES_SHOWN = 6;

/** The examples on screen by default: never more than `EXAMPLES_SHOWN`. */
export function defaultExamples(
  all: readonly string[] = EXAMPLES,
  shown: number = EXAMPLES_SHOWN,
): readonly string[] {
  return all.slice(0, Math.max(0, shown));
}

/** Whether "See more" is offered: only when some examples are hidden. */
export function hasMoreExamples(
  all: readonly string[] = EXAMPLES,
  shown: number = EXAMPLES_SHOWN,
): boolean {
  return all.length > Math.max(0, shown);
}
