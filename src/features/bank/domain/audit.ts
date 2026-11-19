/**
 * The Audit trail's vocabulary. Every write writes one event, in the
 * transaction of the write; every Teller step and every Workflow step
 * writes one too. Details hold ids, names, numbers and amounts: never a
 * secret, a full card number or a whole document.
 */
export type ActorKind = "staff" | "teller" | "client" | "system";

/** Actions that are not a command: what the system and the Teller do. */
export const SYSTEM_ACTIONS = [
  "bank.opened",
  "staff.switched",
  "mcp.connected",
  "confirmation.requested",
  "confirmation.confirmed",
  "confirmation.declined",
  "confirmation.failed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.failed",
  "alert.raised",
  "alert.timed_out",
  "payment.settled",
  "payment.returned",
  "eod.completed",
  "interest.accrued",
  "interest.paid",
  "standing_order.ran",
  "loan.disbursed",
  "loan.collected",
  "loan.missed",
  "term.matured",
  "card.settled",
  "card.expired",
  "statement.generated",
  "notification.delivered",
  "workflow.started",
  "workflow.failed",
  "teller.model_called",
  "teller.tool_called",
  "teller.skill_loaded",
  "teller.code_ran",
  "growth.triaged",
  "growth.refused",
  "growth.issue_filed",
  "growth.advanced",
  "growth.live",
] as const;

export type SystemAction = (typeof SYSTEM_ACTIONS)[number];

const SECRET_KEY =
  /token|secret|password|authorization|api[-_]?key|cookie|pan|cvv|card[-_]?number/i;

/**
 * Drops anything that looks like a credential from an event's details, cuts
 * long strings, and keeps the object shallow enough to read. Belt and
 * braces: callers already pass ids and sizes only.
 */
export function redactDetail(
  detail: unknown,
  depth = 0,
): Record<string, unknown> {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SECRET_KEY.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string") {
      out[key] = value.length > 400 ? `${value.slice(0, 400)}…` : value;
    } else if (Array.isArray(value)) {
      out[key] = value
        .slice(0, 20)
        .map((item) =>
          typeof item === "object" && item !== null
            ? depth < 2
              ? redactDetail(item, depth + 1)
              : "[…]"
            : typeof item === "string" && item.length > 400
              ? `${item.slice(0, 400)}…`
              : item,
        );
    } else if (typeof value === "object" && value !== null) {
      out[key] = depth < 2 ? redactDetail(value, depth + 1) : "[…]";
    } else {
      out[key] = value;
    }
  }
  return out;
}
