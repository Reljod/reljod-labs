import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  approvalRefusal,
  can,
  canDecideApproval,
  roleNeeded,
} from "./permissions";

const user = { id: "u1", role: "user" as const };
const admin = { id: "a1", role: "admin" as const };

describe("can", () => {
  it("lets an admin do everything", () => {
    for (const action of ACTIONS) expect(can(admin, action)).toBe(true);
  });

  it("lets a user work cases", () => {
    for (const action of [
      "session.create",
      "run.start",
      "run.stop",
      "approval.decide.low",
      "source.add",
      "audit.read.own",
      "plugin.download",
      "mcp.connect",
    ] as const) {
      expect(can(user, action)).toBe(true);
    }
  });

  it("keeps Skills, Rules, Conflicts and the Workspace trail for an admin", () => {
    for (const action of [
      "skill.edit",
      "rule.edit",
      "conflict.resolve",
      "source.remove",
      "approval.decide.high",
      "audit.read.workspace",
    ] as const) {
      expect(can(user, action)).toBe(false);
      expect(roleNeeded(action)).toBe("admin");
    }
  });
});

describe("canDecideApproval", () => {
  it("lets any Staff member decide a low-risk Approval, even on their own Run", () => {
    expect(canDecideApproval(user, { risk: "low", startedBy: "u1" })).toBe(
      true,
    );
    expect(canDecideApproval(admin, { risk: "low", startedBy: "u1" })).toBe(
      true,
    );
  });

  it("refuses a user a high-risk Approval", () => {
    expect(canDecideApproval(user, { risk: "high", startedBy: "u2" })).toBe(
      false,
    );
    expect(approvalRefusal(user, { risk: "high", startedBy: "u2" })).toMatch(
      /admin/,
    );
  });

  it("refuses an admin a high-risk Approval on a Run they started", () => {
    expect(canDecideApproval(admin, { risk: "high", startedBy: "a1" })).toBe(
      false,
    );
    expect(approvalRefusal(admin, { risk: "high", startedBy: "a1" })).toMatch(
      /did not start/,
    );
  });

  it("lets an admin decide a high-risk Approval on someone else's Run", () => {
    expect(canDecideApproval(admin, { risk: "high", startedBy: "u1" })).toBe(
      true,
    );
  });
});
