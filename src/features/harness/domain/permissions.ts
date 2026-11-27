import type { Role, Staff } from "./staff";

/**
 * Everything a Role can be asked about. `can()` is the one place Roles are
 * decided (ADR 0014); every server function that writes calls it, through
 * `requirePermission()`.
 */
export const ACTIONS = [
  "session.create",
  "run.start",
  "run.stop",
  "approval.decide.low",
  "approval.decide.high",
  "skill.edit",
  "rule.edit",
  "conflict.resolve",
  "source.add",
  "source.remove",
  "audit.read.own",
  "audit.read.workspace",
  "plugin.download",
  "mcp.connect",
] as const;

export type Action = (typeof ACTIONS)[number];

/** The lowest Role that may do each thing. An admin may do all a user may. */
const NEEDS: Record<Action, Role> = {
  "session.create": "user",
  "run.start": "user",
  "run.stop": "user",
  "approval.decide.low": "user",
  "approval.decide.high": "admin",
  "skill.edit": "admin",
  "rule.edit": "admin",
  "conflict.resolve": "admin",
  "source.add": "user",
  "source.remove": "admin",
  "audit.read.own": "user",
  "audit.read.workspace": "admin",
  "plugin.download": "user",
  "mcp.connect": "user",
};

const RANK: Record<Role, number> = { user: 0, admin: 1 };

/** The Role an action needs, for messages that say who may do it. */
export function roleNeeded(action: Action): Role {
  return NEEDS[action];
}

export function can(staff: Pick<Staff, "role">, action: Action): boolean {
  return RANK[staff.role] >= RANK[NEEDS[action]];
}

const PHRASE: Record<Action, string> = {
  "session.create": "open a Session",
  "run.start": "start a Run",
  "run.stop": "stop a Run",
  "approval.decide.low": "give an Approval",
  "approval.decide.high": "give a high-risk Approval",
  "skill.edit": "edit Skills",
  "rule.edit": "edit Rules",
  "conflict.resolve": "settle a Conflict",
  "source.add": "add a Source",
  "source.remove": "remove a Source",
  "audit.read.own": "read an Audit trail",
  "audit.read.workspace": "read the whole Workspace's Audit trail",
  "plugin.download": "download the Plugin",
  "mcp.connect": "connect an MCP client",
};

/**
 * Why this Staff member may not do the action, naming the Role it needs
 * ("Only an admin may edit Rules. Switch Staff to try it."), or null when
 * `can()` allows it. The REST policies, the MCP tools and the services all
 * refuse with this one message.
 */
export function refusalFor(
  staff: Pick<Staff, "role">,
  action: Action,
): string | null {
  if (can(staff, action)) return null;
  return roleNeeded(action) === "admin"
    ? `Only an admin may ${PHRASE[action]}. Switch Staff to try it.`
    : `Your Role may not ${PHRASE[action]}.`;
}

export type ApprovalRisk = "low" | "high";

export type ApprovalCheck = {
  risk: ApprovalRisk;
  /** The Staff member who started the Run. */
  startedBy: string;
};

/**
 * Why this Staff member may not decide the Approval, or null when they may.
 * Low risk: any Staff member. High risk (a payment instruction, a rejection,
 * a report to the regulator): an admin who did not start the Run (four eyes).
 */
export function approvalRefusal(
  staff: Pick<Staff, "id" | "role">,
  approval: ApprovalCheck,
): string | null {
  if (approval.risk === "low") {
    return can(staff, "approval.decide.low")
      ? null
      : "Your Role may not give Approvals.";
  }
  if (!can(staff, "approval.decide.high")) {
    return "A high-risk Approval needs an admin.";
  }
  if (staff.id === approval.startedBy) {
    return "A high-risk Approval needs an admin who did not start the Run.";
  }
  return null;
}

export function canDecideApproval(
  staff: Pick<Staff, "id" | "role">,
  approval: ApprovalCheck,
): boolean {
  return approvalRefusal(staff, approval) === null;
}
