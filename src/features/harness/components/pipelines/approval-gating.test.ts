import { describe, expect, it } from "vitest";
import type { ApprovalView, RunView } from "../../domain/run";
import { approvalGate, pendingApproval } from "./approval-gating";

const user = { id: "u1", role: "user" as const };
const otherUser = { id: "u2", role: "user" as const };
const admin = { id: "a1", role: "admin" as const };

const run = (
  startedBy: string,
  status: RunView["status"] = "waiting_approval",
) => ({
  status,
  startedBy: { id: startedBy, name: "X" },
});
const approval = (
  risk: "low" | "high",
  status: ApprovalView["status"] = "pending",
) => ({ risk, status });

describe("approvalGate", () => {
  it("lets any Staff member give a low-risk Approval, including the one who started the Run", () => {
    expect(approvalGate(user, run("u1"), approval("low"))).toMatchObject({
      allowed: true,
      reason: null,
      confirm: false,
    });
  });

  it("keeps a high-risk Approval from a user", () => {
    const gate = approvalGate(otherUser, run("u1"), approval("high"));
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/needs an admin/);
    expect(gate.confirm).toBe(true);
  });

  it("keeps a high-risk Approval from the admin who started the Run (four eyes)", () => {
    const gate = approvalGate(admin, run("a1"), approval("high"));
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/did not start the Run/);
  });

  it("lets a different admin give it, after confirming", () => {
    expect(approvalGate(admin, run("u1"), approval("high"))).toMatchObject({
      allowed: true,
      confirm: true,
    });
  });

  it("refuses a decided Approval and a Run that is not waiting", () => {
    expect(
      approvalGate(admin, run("u1"), approval("low", "approved")).reason,
    ).toMatch(/already been decided/);
    expect(
      approvalGate(admin, run("u1", "running"), approval("low")).reason,
    ).toMatch(/not waiting/);
  });
});

describe("pendingApproval", () => {
  it("finds the first pending one", () => {
    const make = (id: string, status: ApprovalView["status"]) =>
      ({ id, status }) as ApprovalView;
    expect(
      pendingApproval({
        approvals: [make("a", "approved"), make("b", "pending")],
      })?.id,
    ).toBe("b");
    expect(pendingApproval({ approvals: [] })).toBeNull();
  });
});
