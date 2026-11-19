/**
 * Example prompts for the Teller's empty chat. The first `SHOWN_EXAMPLES`
 * appear under the welcome text; "See more" opens the whole list. Every
 * example is something the Teller can do with the seed bank's Customers.
 */
export const TELLER_EXAMPLES: readonly string[] = [
  "What can Mara spend right now, and why is it less than her balance?",
  "Transfer MRF 25 from Mara's everyday account to Joren",
  "Pay Tavi's supplier Old Mill Supplies MRF 180",
  "Chart Mara's spending by month",
  "Freeze Mara's card",
  "I want savings goals with a target and a progress bar",
  "Open a savings account for Selin",
  "Set up a monthly standing order of MRF 50 from Mara to Joren",
  "Show Joren's last ten transactions",
  "Lower the daily limit on Mara's card to MRF 200",
  "Open a 12-month term deposit of MRF 1,000 for Tavi",
  "Can Selin borrow MRF 2,000 over a year? What would it cost?",
  "Request a statement for Mara's everyday account",
  "Which alerts are waiting for a decision?",
  "Advance the bank's clock by one day and tell me what end-of-day did",
  "What do the bank's Rules say about large transfers?",
];

/** How many examples the chat shows before "See more". */
export const SHOWN_EXAMPLES = 6;

/** The examples shown by default, and whether more are behind "See more". */
export function exampleView(
  examples: readonly string[] = TELLER_EXAMPLES,
  shown: number = SHOWN_EXAMPLES,
): { shown: readonly string[]; hasMore: boolean } {
  const count = Math.max(0, Math.floor(shown));
  return {
    shown: examples.slice(0, count),
    hasMore: examples.length > count,
  };
}
