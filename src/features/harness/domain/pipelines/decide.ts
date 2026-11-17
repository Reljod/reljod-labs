import type { MemberRequestKind } from "../records";
import type { FindingDraft } from "./apply";

/**
 * What a member request comes to: `reject` (a Rule that blocks is not met),
 * `request_documents` (a Rule that refers is not met: papers missing, or a
 * person must look), or `proceed`.
 */
export type MemberRequestDecision = "reject" | "request_documents" | "proceed";

export type DecideResult = {
  decision: MemberRequestDecision;
  /** Rules not met that block. */
  blocking: string[];
  /** Rules not met that refer. */
  referred: string[];
  /** Rules not met that only warn. */
  warnings: string[];
  /** Plain lines on why, in Rule order: what a Draft is written from. */
  reasons: string[];
};

/**
 * Combines a member request's Findings by Outcome (ADR 0015: only code
 * decides). Any block rejects; otherwise any refer, an unknown kind or no
 * Member asks for papers or a look; otherwise it proceeds. Warnings never
 * change the decision; they ride along into the Draft.
 */
export function decideMemberRequest(input: {
  findings: FindingDraft[];
  kind: MemberRequestKind | null;
  memberFound: boolean;
}): DecideResult {
  const unmet = input.findings.filter((finding) => !finding.met);
  const ids = (outcome: FindingDraft["outcome"]) =>
    unmet
      .filter((finding) => finding.outcome === outcome)
      .map((finding) => finding.ruleId);
  const blocking = ids("block");
  const referred = ids("refer");
  const warnings = ids("warn");
  const reasons = unmet.map((finding) => finding.summary);
  if (!input.kind) {
    reasons.unshift(
      "The papers do not say clearly what the Member is asking for.",
    );
  }
  if (
    !input.memberFound &&
    !reasons.some((reason) => /Member record/.test(reason))
  ) {
    reasons.unshift("No Member record matches the papers.");
  }
  const decision: MemberRequestDecision =
    blocking.length > 0
      ? "reject"
      : referred.length > 0 || !input.kind || !input.memberFound
        ? "request_documents"
        : "proceed";
  return { decision, blocking, referred, warnings, reasons };
}
