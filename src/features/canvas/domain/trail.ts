/**
 * The fixed list of things a Trail event can record, with the label the
 * Trail shows. A new kind of action is added here first; the server's
 * `trail()` accepts nothing else.
 */
export const TRAIL_ACTIONS = {
  "conversation.started": "Conversation started",
  "conversation.deleted": "Conversation deleted",
  "question.asked": "Question asked",
  "question.answered": "Question answered",
  "question.stopped": "Question stopped",
  "model.called": "Model called",
  "tool.called": "Tool called",
  "tool.failed": "Tool failed",
  "skill.loaded": "Skill loaded",
  "query.started": "Query started",
  "query.finished": "Query finished",
  "query.refused": "Query refused",
  "code.started": "Code started",
  "code.finished": "Code finished",
  "view.created": "View created",
  "view.refused": "View refused",
  "view.updated": "View Parameters changed",
  "view.refreshed": "View refreshed",
  "view.deleted": "View deleted",
  "rules.saved": "Rules saved",
  "board.created": "Board created",
  "board.renamed": "Board renamed",
  "board.arranged": "Board arranged",
  "board.pinned": "View pinned",
  "board.unpinned": "View unpinned",
  "board.deleted": "Board deleted",
  "board.scheduled": "Schedule set",
  "board.exported": "Board exported",
  "refresh.started": "Refresh started",
  "refresh.finished": "Refresh finished",
  "upload.started": "Upload started",
  "upload.profiled": "Upload profiled",
  "upload.failed": "Upload failed",
  "upload.deleted": "Upload deleted",
  "sandbox.started": "Sandbox started",
  "mcp.connected": "MCP client connected",
  "app.resource_read": "App resource read",
} as const;

export type TrailAction = keyof typeof TRAIL_ACTIONS;

export function isTrailAction(value: unknown): value is TrailAction {
  return typeof value === "string" && value in TRAIL_ACTIONS;
}

/** Who did it: the person on the page, the Analyst, an outside MCP client, or the system (a Refresh). */
export const ACTOR_KINDS = ["person", "analyst", "client", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ACTOR_LABEL: Record<ActorKind, string> = {
  person: "You",
  analyst: "Analyst",
  client: "MCP client",
  system: "System",
};

export type TrailUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type TrailEvent = {
  id: number;
  conversationId: string | null;
  questionId: string | null;
  viewId: string | null;
  boardId: string | null;
  actorKind: ActorKind;
  action: TrailAction;
  summary: string;
  detail: Record<string, unknown>;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ms: number | null;
  createdAt: string;
};

const SECRET_KEY = /token|secret|password|authorization|api[-_]?key|bearer/i;
const DETAIL_TEXT = 14_000;

/** A detail object safe to store: no secret-looking keys, no huge strings. */
export function redactDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const clean = (value: unknown, depth: number): unknown => {
    if (typeof value === "string")
      return value.length > DETAIL_TEXT
        ? `${value.slice(0, DETAIL_TEXT)}… [${value.length - DETAIL_TEXT} more characters]`
        : value;
    if (Array.isArray(value))
      return depth > 5 ? "[…]" : value.slice(0, 200).map((item) => clean(item, depth + 1));
    if (value && typeof value === "object") {
      if (depth > 5) return "{…}";
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value))
        out[key] = SECRET_KEY.test(key) ? "[redacted]" : clean(item, depth + 1);
      return out;
    }
    return value;
  };
  return clean(detail ?? {}, 0) as Record<string, unknown>;
}
