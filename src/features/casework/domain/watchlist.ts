import employer from "../../../../fixtures/casework/watchlist/employer_onboarding.json";
import withdrawal from "../../../../fixtures/casework/watchlist/pension_withdrawal.json";
import screening from "../../../../fixtures/casework/watchlist/screening_review.json";
import structure from "../../../../fixtures/casework/watchlist/structure_review.json";
import type { WatchlistEntry } from "./rules/screening";

/** The synthetic watchlist every `screen` Job checks against. All entries are fictional. */
export const WATCHLIST: WatchlistEntry[] = [
  ...(screening as WatchlistEntry[]),
  ...(employer as WatchlistEntry[]),
  ...(structure as WatchlistEntry[]),
  ...(withdrawal as WatchlistEntry[]),
];
