/**
 * Every Check a Job can make. A Check's id is stable: Jobs emit it, the
 * Decision file groups by it and the synthetic Cabinet's labels name it.
 */

export type CheckOutcome = "pass" | "fail" | "review";

export type CheckSpec = {
  title: string;
  /** A fail here decides the case on its own. */
  blocking?: boolean;
};

export const CHECKS = {
  // Identity (match_identity)
  identity_matches_record: {
    title: "ID matches the record",
    blocking: true,
  },
  id_in_date: { title: "ID in date" },
  id_certified: { title: "ID properly certified" },

  // Withdrawal rules (check_eligibility)
  caymanian_status: { title: "Caymanian status shown", blocking: true },
  withdrawal_purpose_supported: {
    title: "Purpose allowed by the Act",
    blocking: true,
  },
  amount_within_cap: { title: "Within the CI$50,000 cap", blocking: true },
  amount_within_balance: { title: "Within the balance", blocking: true },
  purpose_evidence_consistent: { title: "Property evidence agrees" },
  lender_permitted: { title: "Permitted lender", blocking: true },
  primary_residence: { title: "Primary residence declared" },
  prior_withdrawals_repaid: { title: "Earlier withdrawals repaid" },

  // Payee (verify_payee)
  payee_permitted: { title: "Money goes to the right place", blocking: true },

  // Screening (screen, adjudicate)
  screening_clear: { title: "Screening clear", blocking: true },

  // Entities (verify_entity)
  entity_documents_consistent: { title: "Company documents agree" },
  licence_in_date: { title: "Trade licence in date" },
  signatories_authorised: { title: "Signatories authorised" },

  // Census (check_census)
  census_valid: { title: "Member census clean" },

  // Contributions (reconcile)
  contributions_at_rate: { title: "Contributions at 5% + 5%" },
  contributions_on_time: { title: "Paid by the 15th" },
  no_arrears: { title: "No arrears" },

  // Ownership (map_ownership)
  ownership_reconciles: { title: "Ownership adds up" },
  ubos_identified: { title: "Owners at 10%+ identified" },
  controllers_identified: { title: "Controllers identified" },
  ubos_verified: { title: "Every owner verified" },

  // Risk (rate_risk)
  edd_required: { title: "Enhanced due diligence" },
} satisfies Record<string, CheckSpec>;

export type CheckId = keyof typeof CHECKS;

export const CHECK_IDS = Object.keys(CHECKS) as CheckId[];

export function isCheckId(value: string): value is CheckId {
  return value in CHECKS;
}

export type Recommendation = "approve" | "refer" | "decline" | "request_info";

export type RiskRating = "low" | "standard" | "high";

export type HitDisposition = "false_positive" | "true_match" | "inconclusive";
