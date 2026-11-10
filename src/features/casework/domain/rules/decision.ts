import { CHECKS, type Recommendation } from "../checks";
import { formatMoney } from "../dates";
import { kindLabel } from "../document-kinds";
import { words } from "../names";
import { PIPELINES } from "../pipelines";
import type { Check, Decision, Risk, RunState } from "../run-state";
import type { JobOutcome } from "./types";

const HIGHER_RISK_PLACES = [
  "panama",
  "british virgin islands",
  "bvi",
  "nigeria",
  "russia",
  "venezuela",
  "iran",
  "seychelles",
  "belize",
  "lebanon",
];

/** rate_risk: a transparent score from what the Run found. */
export function rateRisk(state: RunState): JobOutcome {
  const factors: string[] = [];
  let score = 0;
  const add = (points: number, factor: string) => {
    score += points;
    factors.push(`${factor} (+${points})`);
  };

  const hits = state.hits ?? [];
  if (
    hits.some(
      (hit) => hit.disposition === "true_match" && hit.listType === "sanctions",
    )
  )
    add(5, "Sanctions match");
  if (
    hits.some(
      (hit) => hit.disposition === "true_match" && hit.listType === "pep",
    )
  )
    add(3, "Politically exposed person");
  if (
    hits.some(
      (hit) =>
        hit.disposition === "true_match" && hit.listType === "adverse_media",
    )
  )
    add(2, "Adverse media");
  if (hits.some((hit) => hit.disposition === "inconclusive"))
    add(1, "Unresolved screening hit");

  const ownership = state.ownership;
  if (ownership) {
    const layers = new Set(
      ownership.links
        .filter((link) => link.relation === "shareholding")
        .map((link) => link.owned),
    ).size;
    if (layers >= 3) add(2, `${layers} layers of ownership`);
    else if (layers === 2) add(1, "Two layers of ownership");
    if (
      ownership.links.some(
        (link) => /trust/i.test(link.owner) || link.relation !== "shareholding",
      )
    )
      add(1, "Trust or control arrangement");
    if (ownership.links.some((link) => /nominee/i.test(link.owner)))
      add(2, "Nominee shareholder");
  }
  const placeText = state.documents
    .flatMap((document) => [
      document.fields?.jurisdiction,
      document.fields?.governing_law,
      document.fields?.nationality,
    ])
    .filter((value): value is string => typeof value === "string")
    .join(" | ")
    .toLowerCase();
  const places = HIGHER_RISK_PLACES.filter((place) =>
    placeText.includes(place),
  );
  if (places.length > 0)
    add(1, `Higher-risk jurisdiction: ${places.join(", ")}`);
  if (state.arrears && state.arrears.total > 0)
    add(1, `Arrears of ${formatMoney(state.arrears.total)}`);
  if (
    state.checks.some(
      (check) =>
        check.id === "contributions_on_time" && check.outcome === "fail",
    )
  )
    add(1, "Late payer");
  if (
    state.checks.some(
      (check) => check.id === "census_valid" && check.outcome !== "pass",
    )
  )
    add(1, "Census problems");
  if (state.gaps.length > 0) add(1, "Documents missing");

  const rating: Risk["rating"] =
    score >= 4 ? "high" : score >= 2 ? "standard" : "low";
  const edd =
    rating === "high" ||
    hits.some(
      (hit) => hit.disposition === "true_match" && hit.listType === "pep",
    );
  const check: Check = {
    id: "edd_required",
    outcome: edd ? "review" : "pass",
    detail: edd
      ? `Enhanced due diligence: ${factors.slice(0, 3).join(", ")}`
      : `Standard due diligence (${rating} risk)`,
    job: "rate_risk",
    evidence: [],
  };
  return {
    checks: [check],
    patch: { risk: { rating, score, factors } },
    summary: `${rating[0].toUpperCase()}${rating.slice(1)} risk, score ${score}${factors.length ? `: ${factors.join(", ")}` : ""}`,
  };
}

/** The recommendation every Check adds up to. */
export function recommend(state: RunState): Recommendation {
  const blocking = state.checks.some(
    (check) =>
      check.outcome === "fail" &&
      (CHECKS[check.id] as { blocking?: boolean }).blocking,
  );
  if (blocking) return "decline";
  if (state.gaps.length > 0) return "request_info";
  if (state.checks.some((check) => check.outcome !== "pass")) return "refer";
  return "approve";
}

const VERB: Record<Recommendation, string> = {
  approve: "Approve",
  refer: "Refer to a senior reviewer",
  decline: "Decline",
  request_info: "Ask for more information",
};

/** decide without a model: the recommendation, a headline and next steps. */
export function decide(state: RunState): JobOutcome & { decision: Decision } {
  const recommendation = recommend(state);
  // What leads the headline: screening and identity before paperwork.
  const PRIORITY = [
    "screening_clear",
    "identity_matches_record",
    "amount_within_cap",
    "amount_within_balance",
    "meridian_status",
    "payee_permitted",
    "no_arrears",
    "ubos_identified",
    "ubos_verified",
    "edd_required",
  ];
  const rank = (check: Check) => {
    const index = PRIORITY.indexOf(check.id);
    return index === -1 ? PRIORITY.length : index;
  };
  const failed = state.checks
    .filter((check) => check.outcome === "fail")
    .sort((a, b) => rank(a) - rank(b));
  const review = state.checks
    .filter((check) => check.outcome === "review")
    .sort((a, b) => rank(a) - rank(b));
  const pipeline = state.pipeline ? PIPELINES[state.pipeline].title : "Review";
  const lead =
    recommendation === "decline"
      ? (failed.find(
          (check) => (CHECKS[check.id] as { blocking?: boolean }).blocking,
        ) ?? failed[0])
      : recommendation === "request_info"
        ? undefined
        : (failed[0] ?? review[0]);
  const headline =
    recommendation === "approve"
      ? `${VERB.approve}: all ${state.checks.length} checks pass`
      : recommendation === "request_info"
        ? `${VERB.request_info}: ${state.gaps.map((gap) => gap.wants).join(", ")}`
        : `${VERB[recommendation]}: ${lead ? lead.detail.replace(/\.$/, "") : "see the checks"}`;

  const nextSteps = [
    ...state.gaps.map((gap) => `Obtain the ${gap.wants}`),
    ...failed.map((check) => `${CHECKS[check.id].title}: ${check.detail}`),
    ...review.map(
      (check) =>
        `Confirm ${CHECKS[check.id].title.toLowerCase()}: ${check.detail}`,
    ),
  ].slice(0, 5);
  if (state.arrears && state.arrears.total > 0) {
    nextSteps.unshift(
      `Send an arrears notice for ${formatMoney(state.arrears.total)} plus about ${formatMoney(state.arrears.interest)} interest`,
    );
  }
  const passed = state.checks.filter(
    (check) => check.outcome === "pass",
  ).length;
  const summary = `${pipeline} of ${state.documents.length} documents: ${passed} checks pass, ${failed.length} fail, ${review.length} need a person.`;
  const decision: Decision = {
    recommendation,
    headline,
    summary,
    nextSteps: nextSteps.slice(0, 5),
  };
  return { checks: [], patch: { decision }, summary: headline, decision };
}

/** For a question: the document kinds wanted, in words. */
export function wantsInWords(kinds: Parameters<typeof kindLabel>[0][]) {
  // Lowercase for running text, but never the proper noun "Meridian".
  const labels = kinds.map((kind) =>
    kindLabel(kind).replace(/^(?!Meridian)\w/, (c) => c.toLowerCase()),
  );
  return labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

export { words };
