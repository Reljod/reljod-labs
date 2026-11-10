import type { DocumentKind } from "./document-kinds";
import type { JobId } from "./jobs";

export const PIPELINE_IDS = [
  "pension_withdrawal",
  "employer_onboarding",
  "structure_review",
  "screening_review",
] as const;

export type PipelineId = (typeof PIPELINE_IDS)[number];

export type PipelineSpec = {
  title: string;
  /** For the person: what this review is for, in one line. */
  blurb: string;
  description: string;
  jobs: JobId[];
  /** Kinds that, once sorted, point to this pipeline. */
  signals: DocumentKind[];
};

export const PIPELINES: Record<PipelineId, PipelineSpec> = {
  pension_withdrawal: {
    title: "Pension withdrawal review",
    blurb: "A member wants money out for a home or retirement",
    description:
      "Reviews a member's request to withdraw pension funds: identity against the record, the National Pensions Act rules, where the money goes, and a screen of everyone involved.",
    jobs: [
      "sort",
      "read",
      "match_identity",
      "check_eligibility",
      "verify_payee",
      "screen",
      "adjudicate",
      "decide",
    ],
    signals: [
      "withdrawal_request_form",
      "member_statement",
      "sale_agreement",
      "mortgage_statement",
      "attorney_letter",
      "caymanian_status_evidence",
    ],
  },
  employer_onboarding: {
    title: "Employer onboarding & arrears",
    blurb: "An employer joins the plan, or its contributions need reconciling",
    description:
      "Onboards an employer to the multi-employer plan and reconciles its contribution files: company papers, member census, screening of directors, arrears and late interest.",
    jobs: [
      "sort",
      "read",
      "verify_entity",
      "check_census",
      "screen",
      "adjudicate",
      "reconcile",
      "rate_risk",
      "decide",
    ],
    signals: [
      "employer_application",
      "member_census",
      "contribution_schedule",
      "remittance_advice",
      "trade_business_licence",
    ],
  },
  structure_review: {
    title: "Structure file review",
    blurb: "A company or trust needs its owners and controllers known",
    description:
      "Unwinds a company or trust to its beneficial owners at 10% and controllers, verifies and screens them, and risk-rates the relationship.",
    jobs: [
      "sort",
      "read",
      "verify_entity",
      "map_ownership",
      "match_identity",
      "screen",
      "adjudicate",
      "rate_risk",
      "decide",
    ],
    signals: [
      "trust_deed",
      "register_of_members",
      "structure_chart",
      "deed_of_appointment",
      "letter_of_wishes",
      "source_of_wealth",
    ],
  },
  screening_review: {
    title: "Screening hit review",
    blurb: "A watchlist alert needs each hit cleared or confirmed",
    description:
      "Works a screening alert: compares every hit with the customer's identifiers and writes a discount reason or escalates.",
    jobs: ["sort", "read", "match_identity", "adjudicate", "decide"],
    signals: [
      "screening_alert",
      "watchlist_entry",
      "adverse_media_article",
      "customer_profile",
    ],
  },
};

export function isPipelineId(value: string): value is PipelineId {
  return (PIPELINE_IDS as readonly string[]).includes(value);
}

/**
 * The pipeline sorted Documents point to, when one clearly leads. Ties and
 * silence return null, and the Specialist asks.
 */
export function inferPipeline(kinds: DocumentKind[]): PipelineId | null {
  const scores = PIPELINE_IDS.map((id) => ({
    id,
    score: kinds.filter((kind) => PIPELINES[id].signals.includes(kind)).length,
  })).sort((a, b) => b.score - a.score);
  const [first, second] = scores;
  if (!first || first.score === 0) return null;
  if (second && second.score === first.score) return null;
  return first.id;
}
