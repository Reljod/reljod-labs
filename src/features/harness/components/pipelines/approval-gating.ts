import {
  type ApprovalRisk,
  approvalRefusal,
  roleNeeded,
} from "../../domain/permissions";
import type { ApprovalView, RunView } from "../../domain/run";
import type { Staff } from "../../domain/staff";

export type ApprovalGate = {
  /** Whether Approve and Return may be pressed. */
  allowed: boolean;
  /** Why not, in words a person can act on; null when allowed. */
  reason: string | null;
  /** High-risk decisions ask first. */
  confirm: boolean;
  risk: ApprovalRisk;
};

/**
 * What the Approval panel enforces in the UI, the way the server enforces it
 * (ADR 0014): the decision is open, the Role is enough, and for a high-risk
 * one the Staff member did not start the Run. The server checks again.
 */
export function approvalGate(
  staff: Pick<Staff, "id" | "role">,
  run: Pick<RunView, "status" | "startedBy">,
  approval: Pick<ApprovalView, "status" | "risk">,
): ApprovalGate {
  const risk = approval.risk;
  const confirm = risk === "high";
  if (approval.status !== "pending") {
    return {
      allowed: false,
      reason: "This Approval has already been decided.",
      confirm,
      risk,
    };
  }
  if (run.status !== "waiting_approval") {
    return {
      allowed: false,
      reason: "The Run is not waiting for an Approval.",
      confirm,
      risk,
    };
  }
  const refusal = approvalRefusal(staff, { risk, startedBy: run.startedBy.id });
  if (refusal) {
    const needsAdmin = risk === "high" && staff.role !== "admin";
    return {
      allowed: false,
      reason: needsAdmin
        ? `${refusal} Switch to a Staff member with the ${roleNeeded("approval.decide.high")} Role.`
        : refusal,
      confirm,
      risk,
    };
  }
  return { allowed: true, reason: null, confirm, risk };
}

/** The Approval a Run waits on now: the first that is pending. */
export function pendingApproval(
  run: Pick<RunView, "approvals">,
): ApprovalView | null {
  return (
    run.approvals.find((approval) => approval.status === "pending") ?? null
  );
}
