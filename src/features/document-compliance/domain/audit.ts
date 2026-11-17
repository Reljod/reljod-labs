/**
 * The fixed list of things an Audit event records (ADR 0019), with the label
 * the Audit trail shows. A new kind of action is added here first; the
 * server's `audit()` accepts nothing else.
 */
export const AUDIT_ACTIONS = {
  "run.started": "Pre-screen started",
  "document.read": "Document read",
  "run.finished": "Pre-screen finished",
  "run.failed": "Pre-screen failed",
  "rule.saved": "Rule saved",
  "rule.restored": "Rule restored",
  "run.reevaluated": "Re-evaluated",
  "finding.reviewed": "Finding reviewed",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_IDS = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && value in AUDIT_ACTIONS;
}

/** Who did it: a person (a Host or a Guest), the model, or the system. */
export const ACTOR_KINDS = ["person", "model", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export type AuditActor = { kind: ActorKind; label: string };

export const MODEL_ACTOR: AuditActor = { kind: "model", label: "Model" };
export const SYSTEM_ACTOR: AuditActor = { kind: "system", label: "System" };

/** What a model call cost; `document.read` events carry it. */
export type AuditUsage = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

/** One Audit event as the trail shows it. */
export type AuditEventView = {
  id: number;
  at: string;
  action: AuditAction;
  actor: AuditActor;
  runId: string | null;
  /** One line on what happened, written when it happened. */
  summary: string;
  details: Record<string, unknown>;
  usage: AuditUsage | null;
};

/** A page of the trail, newest first; `before` fetches the next page. */
export type AuditPage = {
  events: AuditEventView[];
  before: number | null;
};

const MAX_DETAIL_TEXT = 300;

/**
 * Keeps details small and free of documents: long strings are cut and
 * nesting stops at three levels. Details hold ids, names and Rule Versions,
 * never a whole reading or a page of text.
 */
export function trimDetails(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > MAX_DETAIL_TEXT
      ? `${value.slice(0, MAX_DETAIL_TEXT)}…`
      : value;
  }
  if (Array.isArray(value)) {
    return depth >= 3
      ? `[${value.length} items]`
      : value.slice(0, 50).map((item) => trimDetails(item, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= 3) return "{…}";
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        trimDetails(item, depth + 1),
      ]),
    );
  }
  return value;
}
