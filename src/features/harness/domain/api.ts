import type { ActorKind, AuditAction, AuditEvent } from "./audit";
import type {
  ConflictView,
  Passage,
  PassageHit,
  Resolution,
  SourceView,
} from "./knowledge";
import type { PipelineId } from "./pipeline";
import type {
  Employer,
  Member,
  MemberRequest,
  MemberRequestKind,
  Schedule,
} from "./records";
import type { RuleEdit, RuleEditError, RuleVersion, RuleView } from "./rules";
import type { ApprovalDecision, RunSummary, RunView } from "./run";
import type { MessageView, SessionSummary } from "./session";
import type { SkillText, SkillVersion, SkillView } from "./skills";
import type { Staff } from "./staff";

/**
 * The Harness HTTP contract: every route under `/api/harness/`, its method,
 * and what it takes and answers. Slices implement exactly these; the browser
 * calls them only through `components/api.ts`.
 *
 * Every route passes the Access gate and resolves the Staff member with
 * `staffOrDenied()` (or `requirePermission()` for a write). Errors are JSON
 * `{ error: string }` with 400 (bad request), 401 (no Access), 403 (the Role
 * may not), 404, 409 (wrong state) or 429 (a limit).
 */
export const API_ROOT = "/api/harness";

/** The cookie that remembers which of the Owner's Staff is active. No authority: checked against the Owner on every request. */
export const STAFF_COOKIE = "harness_staff";

const id = (value: string) => encodeURIComponent(value);

function query(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Where each route lives. */
export const apiPath = {
  staff: () => `${API_ROOT}/staff`,
  staffSwitch: () => `${API_ROOT}/staff/switch`,

  sessions: () => `${API_ROOT}/sessions`,
  session: (sessionId: string) => `${API_ROOT}/sessions/${id(sessionId)}`,
  messages: (sessionId: string) =>
    `${API_ROOT}/sessions/${id(sessionId)}/messages`,
  chat: (sessionId: string) => `${API_ROOT}/sessions/${id(sessionId)}/chat`,

  runs: (filter: RunListQuery = {}) =>
    `${API_ROOT}/runs${query({ session: filter.sessionId })}`,
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  runStop: (runId: string) => `${API_ROOT}/runs/${id(runId)}/stop`,
  runEvents: (runId: string, from = 0) =>
    `${API_ROOT}/runs/${id(runId)}/events${query({ from: from || null })}`,
  approvalDecide: (approvalId: string) =>
    `${API_ROOT}/approvals/${id(approvalId)}/decide`,

  members: (filter: MemberListQuery = {}) =>
    `${API_ROOT}/records/members${query({ q: filter.q, employer: filter.employerId })}`,
  member: (memberId: string) => `${API_ROOT}/records/members/${id(memberId)}`,
  employers: () => `${API_ROOT}/records/employers`,
  employer: (employerId: string) =>
    `${API_ROOT}/records/employers/${id(employerId)}`,
  schedules: (filter: ScheduleListQuery = {}) =>
    `${API_ROOT}/records/schedules${query({ employer: filter.employerId })}`,
  memberRequests: (filter: MemberRequestListQuery = {}) =>
    `${API_ROOT}/records/member-requests${query({ kind: filter.kind, member: filter.memberId })}`,

  skills: () => `${API_ROOT}/skills`,
  skill: (skillId: string) => `${API_ROOT}/skills/${id(skillId)}`,
  skillRestore: (skillId: string) =>
    `${API_ROOT}/skills/${id(skillId)}/restore`,

  rules: (filter: RuleListQuery = {}) =>
    `${API_ROOT}/rules${query({ pipeline: filter.pipelineId })}`,
  rule: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}`,
  ruleRestore: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}/restore`,
  ruleHistory: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}/history`,

  sources: () => `${API_ROOT}/sources`,
  sourceUploadUrl: () => `${API_ROOT}/sources/upload-url`,
  source: (sourceId: string) => `${API_ROOT}/sources/${id(sourceId)}`,
  sourceIngest: (sourceId: string) =>
    `${API_ROOT}/sources/${id(sourceId)}/ingest`,
  sourcePreview: (sourceId: string) =>
    `${API_ROOT}/sources/${id(sourceId)}/preview`,
  search: (filter: SearchQuery) =>
    `${API_ROOT}/search${query({ q: filter.q, limit: filter.limit })}`,
  conflicts: (filter: ConflictListQuery = {}) =>
    `${API_ROOT}/conflicts${query({ status: filter.status })}`,
  conflictResolve: (conflictId: string) =>
    `${API_ROOT}/conflicts/${id(conflictId)}/resolve`,

  audit: (filter: AuditQuery = {}) =>
    `${API_ROOT}/audit${query({
      session: filter.sessionId,
      actor: filter.actorKind,
      action: filter.action,
      mine: filter.mine ? "1" : null,
      before: filter.before,
      limit: filter.limit,
    })}`,

  plugin: () => `${API_ROOT}/plugin`,
  mcpToken: () => `${API_ROOT}/mcp-token`,
  /** The consent page's Allow or Deny for an MCP client's OAuth sign-in. */
  consents: () => `${API_ROOT}/consents`,
  /** The Harness MCP server and its OAuth endpoints check their own bearer. */
  mcp: () => `${API_ROOT}/mcp`,
  oauth: (endpoint: "register" | "token") => `${API_ROOT}/oauth/${endpoint}`,
} as const;

export type ApiError = { error: string };

// Staff ------------------------------------------------------------------------

export type StaffListResponse = { staff: Staff[]; current: Staff };
export type StaffSwitchRequest = { staffId: string };
export type StaffSwitchResponse = { staff: Staff };

// Sessions and chat --------------------------------------------------------------

export type SessionListResponse = { sessions: SessionSummary[] };
export type SessionCreateRequest = { title?: string };
export type SessionResponse = { session: SessionSummary };
export type SessionPatchRequest = { title: string };
export type MessageListResponse = { messages: MessageView[] };

/** Answered as NDJSON `ChatEvent`s (`domain/chat-events.ts`). */
export type ChatRequest = {
  text: string;
  /** Sources uploaded for this message (already ingested or being read). */
  attachments?: string[];
};

// Runs and Approvals -----------------------------------------------------------

export type RunListQuery = { sessionId?: string | null };
export type RunListResponse = { runs: RunSummary[] };
export type RunStartRequest = {
  pipelineId: PipelineId;
  input: Record<string, unknown>;
  sessionId?: string | null;
  /** `demo` when a Beat starts it; `app` otherwise. */
  via?: "app" | "demo";
};
export type RunResponse = { run: RunView };
export type ApprovalDecideRequest = {
  decision: ApprovalDecision;
  note?: string;
};

// Records ----------------------------------------------------------------------

export type MemberListQuery = { q?: string; employerId?: string | null };
export type MemberListResponse = { members: Member[] };
export type MemberResponse = {
  member: Member;
  employer: Employer | null;
  requests: MemberRequest[];
};
export type EmployerListResponse = { employers: Employer[] };
export type EmployerResponse = { employer: Employer; schedules: Schedule[] };
export type ScheduleListQuery = { employerId?: string | null };
export type ScheduleListResponse = { schedules: Schedule[] };
export type MemberRequestListQuery = {
  kind?: MemberRequestKind | null;
  memberId?: string | null;
};
export type MemberRequestListResponse = {
  requests: (MemberRequest & {
    member: Pick<Member, "memberNo" | "fullName">;
  })[];
};

// Skills -------------------------------------------------------------------------

export type SkillListResponse = { skills: SkillView[] };
export type SkillResponse = { skill: SkillView; history: SkillVersion[] };
export type SkillSaveRequest = SkillText & { note?: string };
/** Leave `version` out (or 0) to put the Default back. Restoring saves a new Version. */
export type RestoreRequest = { version?: number };

// Rules --------------------------------------------------------------------------

export type RuleListQuery = { pipelineId?: PipelineId | null };
export type RuleListResponse = { rules: RuleView[] };
export type RuleSaveRequest = RuleEdit & { note?: string };
export type RuleResponse = { rule: RuleView };
/** The 400 a bad Rule edit gets: one error per field at fault. */
export type RuleSaveRefusal = ApiError & { errors: RuleEditError[] };
export type RuleHistoryResponse = { versions: RuleVersion[] };

// Knowledge base -----------------------------------------------------------------

export type SourceListResponse = { sources: SourceView[] };
export type SourceUploadUrlRequest = {
  /** The file's name as the browser has it; never used in a storage path as is. */
  name: string;
  type: string;
  bytes: number;
  /** The Session it is uploaded in, if any. */
  sessionId?: string | null;
};
export type SourceUploadUrlResponse = {
  source: SourceView;
  /** A signed URL the browser PUTs the file to. */
  uploadUrl: string;
};
/** How long the signed download URL of a Source's file lasts. */
export const PREVIEW_URL_SECONDS = 300;

/** What a Source's file is, for showing it. */
export type PreviewFormat = "pdf" | "csv" | "xlsx" | "docx" | "md" | "txt";

/**
 * A Source for reading raw: the text exactly as the Agent reads it, and (for a
 * Source with a file) a short-lived URL for the original. The storage key is
 * never sent as such.
 */
export type SourcePreviewResponse = {
  source: SourceView;
  /** The extracted text (cut at `textChars` if `truncated`); null when it could not be read. */
  text: string | null;
  /** The full length of the text. */
  textChars: number;
  truncated: boolean;
  /** Why there is no text, in words, or null. */
  textError: string | null;
  /** Null for a Source with no file (a seed, pasted text, a web page). */
  file: {
    url: string;
    expiresAt: string;
    name: string;
    format: PreviewFormat;
  } | null;
};

export type SourceIngestResponse = {
  source: SourceView;
  conflicts: ConflictView[];
};
export type SourceResponse = { source: SourceView; passages: Passage[] };
export type SourceRemoveResponse = { removed: true };
export type SearchQuery = { q: string; limit?: number };
export type SearchResponse = { hits: PassageHit[] };
export type ConflictListQuery = { status?: "open" | "resolved" | null };
export type ConflictListResponse = { conflicts: ConflictView[] };
export type ConflictResolveRequest = { resolution: Resolution };
export type ConflictResponse = { conflict: ConflictView };

// Audit trail --------------------------------------------------------------------

export type AuditQuery = {
  sessionId?: string | null;
  actorKind?: ActorKind | null;
  action?: AuditAction | null;
  /** An admin's "My Sessions": only the events of Sessions they own. A user always gets that. */
  mine?: boolean;
  /** Events older than this event id, for the next page. */
  before?: number | null;
  limit?: number | null;
};
export type AuditListResponse = {
  events: AuditEvent[];
  /** Pass as `before` for the next page; null at the end of the trail. */
  nextBefore: number | null;
  /** `workspace` for an admin, `own` for a user (their own Sessions' trails). */
  scope: "workspace" | "own";
};

// Plugin, MCP --------------------------------------------------------------------

export type McpTokenResponse = {
  token: string;
  expiresAt: string;
  /** The Harness MCP server's address to give the client. */
  url: string;
  /** The Staff member the token acts as; fixed when it is minted (ADR 0013). */
  staff: Staff;
};

/** The consent page's answer. The authorization request is read again on the server, never trusted from the page. */
export type ConsentRequest = {
  /** The authorization request's query string. */
  request: string;
  answer: "allow" | "deny";
  staffId: string;
  /** The host ticked "I trust <host>" for, when the callback is neither loopback nor a known client's. */
  trustHost: string | null;
};
/** Where to send the browser: the client's callback with a code, or with `access_denied`. */
export type ConsentResponse = { redirect: string };

// Route table --------------------------------------------------------------------

export type Slice =
  | "foundation"
  | "chat"
  | "pipelines"
  | "skills"
  | "knowledge"
  | "audit";

export type RouteSpec = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path under `/api/harness`, with `[param]` segments. */
  path: string;
  /** The names of the request and response types above, for the Docs tab. */
  request: string | null;
  response: string;
  /** Who builds it. */
  slice: Slice;
  summary: string;
};

/** Every route of the Harness, for the Docs tab and for checking nothing is missed. */
export const ROUTES: RouteSpec[] = [
  {
    method: "GET",
    path: "/staff",
    request: null,
    response: "StaffListResponse",
    slice: "foundation",
    summary: "The Workspace's Staff and who is signed in.",
  },
  {
    method: "POST",
    path: "/staff/switch",
    request: "StaffSwitchRequest",
    response: "StaffSwitchResponse",
    slice: "foundation",
    summary: "Sign in as another Staff member of this Workspace.",
  },
  {
    method: "GET",
    path: "/sessions",
    request: null,
    response: "SessionListResponse",
    slice: "foundation",
    summary: "Sessions: a user's own, an admin's whole Workspace.",
  },
  {
    method: "POST",
    path: "/sessions",
    request: "SessionCreateRequest",
    response: "SessionResponse",
    slice: "foundation",
    summary: "Open a Session.",
  },
  {
    method: "GET",
    path: "/sessions/[id]",
    request: null,
    response: "SessionResponse",
    slice: "foundation",
    summary: "One Session.",
  },
  {
    method: "PATCH",
    path: "/sessions/[id]",
    request: "SessionPatchRequest",
    response: "SessionResponse",
    slice: "foundation",
    summary: "Rename a Session.",
  },
  {
    method: "GET",
    path: "/sessions/[id]/messages",
    request: null,
    response: "MessageListResponse",
    slice: "foundation",
    summary: "A Session's messages, oldest first.",
  },
  {
    method: "POST",
    path: "/sessions/[id]/chat",
    request: "ChatRequest",
    response: "NDJSON ChatEvent",
    slice: "chat",
    summary: "Send a message; the Agent's turn streams back.",
  },
  {
    method: "GET",
    path: "/runs",
    request: "RunListQuery",
    response: "RunListResponse",
    slice: "pipelines",
    summary: "Runs, newest first; `?session=` for one Session's.",
  },
  {
    method: "POST",
    path: "/runs",
    request: "RunStartRequest",
    response: "RunResponse",
    slice: "pipelines",
    summary: "Start a Run from the app or a Beat.",
  },
  {
    method: "GET",
    path: "/runs/[id]",
    request: null,
    response: "RunResponse",
    slice: "pipelines",
    summary: "A Run with its Steps, Findings, Approvals and Drafts.",
  },
  {
    method: "POST",
    path: "/runs/[id]/stop",
    request: null,
    response: "RunResponse",
    slice: "pipelines",
    summary: "Stop a Run. Always works, whatever state the workflow is in.",
  },
  {
    method: "GET",
    path: "/runs/[id]/events",
    request: "?from=<seq>",
    response: "NDJSON RunEvent",
    slice: "pipelines",
    summary: "The Run's live stream, from an event number.",
  },
  {
    method: "POST",
    path: "/approvals/[id]/decide",
    request: "ApprovalDecideRequest",
    response: "RunResponse",
    slice: "pipelines",
    summary:
      "Approve or return a Draft. High risk needs an admin who did not start the Run.",
  },
  {
    method: "GET",
    path: "/records/members",
    request: "MemberListQuery",
    response: "MemberListResponse",
    slice: "pipelines",
    summary: "Find Members by name or number.",
  },
  {
    method: "GET",
    path: "/records/members/[id]",
    request: null,
    response: "MemberResponse",
    slice: "pipelines",
    summary: "A Member with their Employer and Member requests.",
  },
  {
    method: "GET",
    path: "/records/employers",
    request: null,
    response: "EmployerListResponse",
    slice: "pipelines",
    summary: "The plan's Employers.",
  },
  {
    method: "GET",
    path: "/records/employers/[id]",
    request: null,
    response: "EmployerResponse",
    slice: "pipelines",
    summary: "An Employer with its Schedules.",
  },
  {
    method: "GET",
    path: "/records/schedules",
    request: "ScheduleListQuery",
    response: "ScheduleListResponse",
    slice: "pipelines",
    summary: "Schedules, newest month first.",
  },
  {
    method: "GET",
    path: "/records/member-requests",
    request: "MemberRequestListQuery",
    response: "MemberRequestListResponse",
    slice: "pipelines",
    summary: "Member requests waiting or done.",
  },
  {
    method: "GET",
    path: "/skills",
    request: null,
    response: "SkillListResponse",
    slice: "skills",
    summary: "Every Skill as the Workspace has it, Rulebooks included.",
  },
  {
    method: "GET",
    path: "/skills/[id]",
    request: null,
    response: "SkillResponse",
    slice: "skills",
    summary: "A Skill and its Versions.",
  },
  {
    method: "PUT",
    path: "/skills/[id]",
    request: "SkillSaveRequest",
    response: "SkillResponse",
    slice: "skills",
    summary: "Save a new Version of a Skill (admin).",
  },
  {
    method: "POST",
    path: "/skills/[id]/restore",
    request: "RestoreRequest",
    response: "SkillResponse",
    slice: "skills",
    summary: "Put back the Default or an earlier Version (admin).",
  },
  {
    method: "GET",
    path: "/rules",
    request: "RuleListQuery",
    response: "RuleListResponse",
    slice: "skills",
    summary: "Rules as the Workspace has them; `?pipeline=` for one Rulebook.",
  },
  {
    method: "PUT",
    path: "/rules/[id]",
    request: "RuleSaveRequest",
    response: "RuleResponse | RuleSaveRefusal",
    slice: "skills",
    summary: "Save a new Version of a Rule (admin).",
  },
  {
    method: "POST",
    path: "/rules/[id]/restore",
    request: "RestoreRequest",
    response: "RuleResponse",
    slice: "skills",
    summary: "Put back the Default or an earlier Version (admin).",
  },
  {
    method: "GET",
    path: "/rules/[id]/history",
    request: null,
    response: "RuleHistoryResponse",
    slice: "skills",
    summary: "A Rule's Versions, newest first.",
  },
  {
    method: "GET",
    path: "/sources",
    request: null,
    response: "SourceListResponse",
    slice: "knowledge",
    summary: "The Knowledge base's Sources.",
  },
  {
    method: "POST",
    path: "/sources/upload-url",
    request: "SourceUploadUrlRequest",
    response: "SourceUploadUrlResponse",
    slice: "knowledge",
    summary: "Register a Source and get a signed upload URL.",
  },
  {
    method: "POST",
    path: "/sources/[id]/ingest",
    request: null,
    response: "SourceIngestResponse",
    slice: "knowledge",
    summary: "Read an uploaded Source into Passages and look for Conflicts.",
  },
  {
    method: "GET",
    path: "/sources/[id]",
    request: null,
    response: "SourceResponse",
    slice: "knowledge",
    summary: "A Source with its Passages.",
  },
  {
    method: "GET",
    path: "/sources/[id]/preview",
    request: null,
    response: "SourcePreviewResponse",
    slice: "knowledge",
    summary:
      "A Source's raw text and a 5-minute link to its original file (audited as a read).",
  },
  {
    method: "DELETE",
    path: "/sources/[id]",
    request: null,
    response: "SourceRemoveResponse",
    slice: "knowledge",
    summary: "Remove a Source that is not a seed (admin).",
  },
  {
    method: "GET",
    path: "/search",
    request: "SearchQuery",
    response: "SearchResponse",
    slice: "knowledge",
    summary: "Search Passages by words and meaning.",
  },
  {
    method: "GET",
    path: "/conflicts",
    request: "ConflictListQuery",
    response: "ConflictListResponse",
    slice: "knowledge",
    summary: "Conflicts, open first.",
  },
  {
    method: "POST",
    path: "/conflicts/[id]/resolve",
    request: "ConflictResolveRequest",
    response: "ConflictResponse",
    slice: "knowledge",
    summary: "Settle a Conflict (admin).",
  },
  {
    method: "GET",
    path: "/audit",
    request: "AuditQuery",
    response: "AuditListResponse",
    slice: "foundation",
    summary: "The Audit trail: a user's own Sessions, an admin's Workspace.",
  },
  {
    method: "GET",
    path: "/plugin",
    request: null,
    response: "application/zip",
    slice: "skills",
    summary: "The Claude Plugin built from the Workspace's current Skills.",
  },
  {
    method: "POST",
    path: "/mcp-token",
    request: null,
    response: "McpTokenResponse",
    slice: "chat",
    summary: "A token for an MCP client that cannot sign in with OAuth.",
  },
  {
    method: "POST",
    path: "/consents",
    request: "ConsentRequest",
    response: "ConsentResponse",
    slice: "chat",
    summary:
      "Allow or Deny an MCP client's OAuth sign-in: where to send the browser.",
  },
  {
    method: "POST",
    path: "/mcp",
    request: "MCP (streamable HTTP)",
    response: "MCP",
    slice: "chat",
    summary: "The Harness MCP server. Checks its own bearer.",
  },
  {
    method: "POST",
    path: "/oauth/register",
    request: "OAuth client registration",
    response: "OAuth",
    slice: "chat",
    summary: "OAuth dynamic client registration for MCP clients.",
  },
  {
    method: "POST",
    path: "/oauth/token",
    request: "OAuth token request",
    response: "OAuth",
    slice: "chat",
    summary: "OAuth token endpoint for MCP clients.",
  },
];
