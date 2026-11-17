import type { Staff } from "./staff";

/**
 * The fixed list of things an Audit event can record (ADR 0018), with the
 * label the Audit tab shows. A new kind of action is added here first; the
 * server's `audit()` accepts nothing else.
 */
export const AUDIT_ACTIONS = {
  "session.created": "Session opened",
  "session.renamed": "Session renamed",
  "staff.switched": "Staff member changed",
  "message.sent": "Message sent",
  "file.uploaded": "File uploaded",
  "model.called": "Model called",
  "tool.called": "Tool called",
  "tool.failed": "Tool failed",
  "skill.loaded": "Skill loaded",
  "web.searched": "Web searched",
  "run.started": "Run started",
  "step.finished": "Step finished",
  "step.failed": "Step failed",
  "finding.made": "Finding made",
  "approval.requested": "Approval requested",
  "approval.decided": "Approval decided",
  "run.finished": "Run finished",
  "run.stopped": "Run stopped",
  "skill.saved": "Skill saved",
  "skill.restored": "Skill restored",
  "rule.saved": "Rule saved",
  "rule.restored": "Rule restored",
  "source.added": "Source added",
  "source.read": "Source read",
  "source.removed": "Source removed",
  "conflict.found": "Conflict found",
  "conflict.resolved": "Conflict settled",
  "sandbox.started": "Sandbox started",
  "sandbox.command": "Sandbox command",
  "sandbox.destroyed": "Sandbox destroyed",
  "mcp.connected": "MCP client connected",
  "plugin.downloaded": "Plugin downloaded",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_IDS = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && value in AUDIT_ACTIONS;
}

export const ACTOR_KINDS = ["staff", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Who did it: a Staff member, the Agent or the system. */
export type AuditActor =
  | { kind: "staff"; staff: Pick<Staff, "id" | "name"> }
  | { kind: "agent" }
  | { kind: "system" };

export const AGENT_LABEL = "Agent";
export const SYSTEM_LABEL = "System";

export function actorLabel(actor: AuditActor): string {
  switch (actor.kind) {
    case "staff":
      return actor.staff.name;
    case "agent":
      return AGENT_LABEL;
    case "system":
      return SYSTEM_LABEL;
  }
}

/** What a model call cost; Agent events carry it. */
export type AuditUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** What a server function hands `audit()`. The Owner is added by the caller's context. */
export type AuditInput = {
  actor: AuditActor;
  action: AuditAction;
  /** One line a person can read: "Approved the transfer letter". */
  summary: string;
  sessionId?: string | null;
  runId?: string | null;
  /** What it was done to: `{ kind: "rule", id: "mr.notice-period" }`. */
  target?: { kind: string; id: string } | null;
  /** Ids, names, sizes, Versions. Passed through `redactDetail` before saving. */
  detail?: Record<string, unknown>;
  usage?: AuditUsage | null;
};

/** One recorded action, as the Audit tab reads it. */
export type AuditEvent = {
  id: number;
  sessionId: string | null;
  runId: string | null;
  actorKind: ActorKind;
  staffId: string | null;
  actorLabel: string;
  action: AuditAction;
  targetKind: string | null;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown>;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: string;
};

/** How much of a long value an Audit event keeps. */
export const DETAIL_LIMITS = {
  stringChars: 300,
  arrayItems: 20,
  objectKeys: 40,
  depth: 5,
} as const;

const SECRET_KEY =
  /(secret|token|password|passwd|authorization|api[-_]?key|cookie|bearer|credential)/i;

function cut(text: string): string {
  if (text.length <= DETAIL_LIMITS.stringChars) return text;
  return `${text.slice(0, DETAIL_LIMITS.stringChars)}… (+${text.length - DETAIL_LIMITS.stringChars} chars)`;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return cut(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return null;
  if (depth >= DETAIL_LIMITS.depth) return "[cut]";
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, DETAIL_LIMITS.arrayItems)
      .map((item) => redactValue(item, depth + 1));
    return value.length > DETAIL_LIMITS.arrayItems
      ? [...kept, `… (+${value.length - DETAIL_LIMITS.arrayItems} more)`]
      : kept;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, DETAIL_LIMITS.objectKeys)) {
    result[key] = SECRET_KEY.test(key)
      ? "[redacted]"
      : redactValue(item, depth + 1);
  }
  if (entries.length > DETAIL_LIMITS.objectKeys) {
    result["…"] = `+${entries.length - DETAIL_LIMITS.objectKeys} more keys`;
  }
  return result;
}

/**
 * Makes details safe to keep for good (ADR 0018): long strings are cut, long
 * lists and deep objects are trimmed, and anything under a key that looks
 * like a credential is replaced. The result is plain JSON.
 */
export function redactDetail(
  detail: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!detail) return {};
  return redactValue(detail, 0) as Record<string, unknown>;
}
