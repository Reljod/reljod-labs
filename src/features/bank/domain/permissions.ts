import type { Role, Staff } from "./staff";

/**
 * Everything a Role can be asked about. `can()` is the one place Roles are
 * decided; the command engine calls it for every command, whoever asks
 * (the app, the Teller, an outside MCP client).
 */
export const ACTIONS = [
  "bank.read",
  "customer.manage",
  "kyc.decide",
  "account.manage",
  "account.restrict",
  "money.move",
  "money.reverse",
  "card.manage",
  "loan.manage",
  "dispute.open",
  "dispute.resolve",
  "alert.decide",
  "approval.decide",
  "rule.edit",
  "clock.advance",
  "growth.raise",
  "audit.read",
  "mcp.connect",
] as const;

export type Action = (typeof ACTIONS)[number];

const ALL: Role[] = ["teller", "supervisor", "compliance"];

/** The Roles that may do each thing. */
const ALLOWED: Record<Action, Role[]> = {
  "bank.read": ALL,
  "customer.manage": ["teller", "supervisor"],
  "kyc.decide": ["compliance", "supervisor"],
  "account.manage": ["teller", "supervisor"],
  "account.restrict": ["supervisor", "compliance"],
  "money.move": ["teller", "supervisor"],
  "money.reverse": ["supervisor"],
  "card.manage": ["teller", "supervisor"],
  "loan.manage": ["teller", "supervisor"],
  "dispute.open": ALL,
  "dispute.resolve": ["supervisor", "compliance"],
  "alert.decide": ["compliance"],
  "approval.decide": ["supervisor"],
  "rule.edit": ["supervisor"],
  "clock.advance": ALL,
  "growth.raise": ALL,
  "audit.read": ALL,
  "mcp.connect": ALL,
};

export function can(staff: Pick<Staff, "role">, action: Action): boolean {
  return ALLOWED[action].includes(staff.role);
}

export function rolesFor(action: Action): Role[] {
  return ALLOWED[action];
}

/**
 * Why this Staff member may not decide the Approval, or null when they may.
 * Maker-checker: the checker has the Role and is not the maker. The Teller
 * (the agent) is never handed this: no tool gives an Approval.
 */
export function approvalRefusal(
  staff: Pick<Staff, "id" | "role">,
  approval: { requestedBy: string },
): string | null {
  if (!can(staff, "approval.decide")) {
    return "An Approval needs a supervisor. Switch Staff to try it.";
  }
  if (staff.id === approval.requestedBy) {
    return "An Approval needs a supervisor who did not make the request.";
  }
  return null;
}
