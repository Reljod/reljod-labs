"use client";

import {
  type ApprovalDecideRequest,
  type AuditListResponse,
  type AuditQuery,
  apiPath,
  type ChatRequest,
  type ConflictListQuery,
  type ConflictListResponse,
  type ConflictResolveRequest,
  type ConflictResponse,
  type EmployerListResponse,
  type EmployerResponse,
  type McpTokenResponse,
  type MemberListQuery,
  type MemberListResponse,
  type MemberRequestListQuery,
  type MemberRequestListResponse,
  type MemberResponse,
  type MessageListResponse,
  type RestoreRequest,
  type RuleHistoryResponse,
  type RuleListQuery,
  type RuleListResponse,
  type RuleResponse,
  type RuleSaveRequest,
  type RunListQuery,
  type RunListResponse,
  type RunResponse,
  type RunStartRequest,
  type SandboxStatusResponse,
  type ScheduleListQuery,
  type ScheduleListResponse,
  type SearchQuery,
  type SearchResponse,
  type SessionCreateRequest,
  type SessionListResponse,
  type SessionPatchRequest,
  type SessionResponse,
  type SkillListResponse,
  type SkillResponse,
  type SkillSaveRequest,
  type SourceIngestResponse,
  type SourceListResponse,
  type SourceRemoveResponse,
  type SourceResponse,
  type SourceUploadUrlRequest,
  type SourceUploadUrlResponse,
  type StaffListResponse,
  type StaffSwitchRequest,
  type StaffSwitchResponse,
} from "../domain/api";
import type { ChatEvent } from "../domain/chat-events";
import type { RuleEditError } from "../domain/rules";
import type { RunEvent } from "../domain/run";

/**
 * The browser's one client for the Harness API. Every tab calls the routes
 * in `domain/api.ts` through here, so a path or a type changes in one place.
 */

/** Query keys for React Query. After a write, invalidate the keys it changed. */
export const keys = {
  all: ["harness"] as const,
  staff: ["harness", "staff"] as const,
  sessions: ["harness", "sessions"] as const,
  session: (id: string) => ["harness", "session", id] as const,
  messages: (id: string) => ["harness", "messages", id] as const,
  runs: (filter: RunListQuery = {}) =>
    ["harness", "runs", filter.sessionId ?? "all"] as const,
  run: (id: string) => ["harness", "run", id] as const,
  members: (filter: MemberListQuery = {}) =>
    ["harness", "members", filter.q ?? "", filter.employerId ?? ""] as const,
  member: (id: string) => ["harness", "member", id] as const,
  employers: ["harness", "employers"] as const,
  employer: (id: string) => ["harness", "employer", id] as const,
  schedules: (filter: ScheduleListQuery = {}) =>
    ["harness", "schedules", filter.employerId ?? ""] as const,
  memberRequests: (filter: MemberRequestListQuery = {}) =>
    [
      "harness",
      "member-requests",
      filter.kind ?? "",
      filter.memberId ?? "",
    ] as const,
  skills: ["harness", "skills"] as const,
  skill: (id: string) => ["harness", "skill", id] as const,
  rules: (filter: RuleListQuery = {}) =>
    ["harness", "rules", filter.pipelineId ?? "all"] as const,
  ruleHistory: (id: string) => ["harness", "rule-history", id] as const,
  sources: ["harness", "sources"] as const,
  source: (id: string) => ["harness", "source", id] as const,
  search: (filter: SearchQuery) =>
    ["harness", "search", filter.q, filter.limit ?? 0] as const,
  conflicts: (filter: ConflictListQuery = {}) =>
    ["harness", "conflicts", filter.status ?? "all"] as const,
  audit: (filter: AuditQuery = {}) =>
    [
      "harness",
      "audit",
      filter.sessionId ?? "",
      filter.actorKind ?? "",
      filter.action ?? "",
    ] as const,
  sandbox: (sessionId?: string | null) =>
    ["harness", "sandbox", sessionId ?? ""] as const,
};

/** What a route answered when it refused: the message to show, and why. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    /** 401 no Access, 403 the Role may not, 404, 409 wrong state, 429 a limit, 501 not built yet. */
    readonly status: number,
    /** For a refused Rule edit: one error per field at fault. */
    readonly errors: RuleEditError[] = [],
  ) {
    super(message);
    this.name = "ApiFailure";
  }

  /** The Staff member's Role may not do this: offer to switch Staff. */
  get forbidden() {
    return this.status === 403;
  }

  /** The slice that answers this route has not landed. */
  get notBuilt() {
    return this.status === 501;
  }
}

const FALLBACK: Record<number, string> = {
  401: "Your access has ended. Open the demo again from the front door.",
  403: "Your Role may not do that.",
  404: "That is not in this Workspace.",
  429: "That's the limit for now. Try again soon.",
  501: "This part of the Harness is not built yet.",
};

async function failureOf(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    errors?: RuleEditError[];
  } | null;
  return new ApiFailure(
    body?.error ?? FALLBACK[response.status] ?? "That didn't work. Try again.",
    response.status,
    body?.errors ?? [],
  );
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw await failureOf(response);
  return response.json() as Promise<T>;
}

async function send<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failureOf(response);
  return response.json() as Promise<T>;
}

/** Reads a newline-delimited JSON response, one parsed value at a time. */
export async function* readNdjson<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as T;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as T;
  } finally {
    reader.releaseLock();
  }
}

/** PUTs a file to a signed upload URL. XHR, not fetch: fetch cannot report upload progress. */
export function putFile(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader(
      "content-type",
      file.type || "application/octet-stream",
    );
    request.setRequestHeader("x-upsert", "true");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(
            new Error(`Upload of ${file.name} failed (${request.status})`),
          );
    request.onerror = () => reject(new Error(`Upload of ${file.name} failed`));
    request.send(file);
  });
}

export const api = {
  staff: {
    list: () => get<StaffListResponse>(apiPath.staff()),
    switch: (body: StaffSwitchRequest) =>
      send<StaffSwitchResponse>(apiPath.staffSwitch(), "POST", body),
  },

  sessions: {
    list: async () =>
      (await get<SessionListResponse>(apiPath.sessions())).sessions,
    create: async (body: SessionCreateRequest = {}) =>
      (await send<SessionResponse>(apiPath.sessions(), "POST", body)).session,
    get: async (id: string) =>
      (await get<SessionResponse>(apiPath.session(id))).session,
    rename: async (id: string, body: SessionPatchRequest) =>
      (await send<SessionResponse>(apiPath.session(id), "PATCH", body)).session,
    messages: async (id: string) =>
      (await get<MessageListResponse>(apiPath.messages(id))).messages,
    /**
     * Sends a message and yields the Agent's turn as it streams. Ends with a
     * `done` or an `error` event; throws an ApiFailure when the route refuses
     * before streaming. Abort the signal to stop the turn.
     */
    async *chat(
      id: string,
      body: ChatRequest,
      signal?: AbortSignal,
    ): AsyncGenerator<ChatEvent> {
      const response = await fetch(apiPath.chat(id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw await failureOf(response);
      yield* readNdjson<ChatEvent>(response);
    },
  },

  runs: {
    list: async (filter: RunListQuery = {}) =>
      (await get<RunListResponse>(apiPath.runs(filter))).runs,
    start: async (body: RunStartRequest) =>
      (await send<RunResponse>(apiPath.runs(), "POST", body)).run,
    get: async (id: string) => (await get<RunResponse>(apiPath.run(id))).run,
    stop: async (id: string) =>
      (await send<RunResponse>(apiPath.runStop(id), "POST")).run,
    /**
     * The Run's live stream from event number `from`. Feed each event to
     * `reduceRun`; reconnect with the last `seq` + 1 if it drops.
     */
    async *events(
      id: string,
      from = 0,
      signal?: AbortSignal,
    ): AsyncGenerator<RunEvent> {
      const response = await fetch(apiPath.runEvents(id, from), {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw await failureOf(response);
      yield* readNdjson<RunEvent>(response);
    },
  },

  approvals: {
    decide: async (id: string, body: ApprovalDecideRequest) =>
      (await send<RunResponse>(apiPath.approvalDecide(id), "POST", body)).run,
  },

  records: {
    members: async (filter: MemberListQuery = {}) =>
      (await get<MemberListResponse>(apiPath.members(filter))).members,
    member: (id: string) => get<MemberResponse>(apiPath.member(id)),
    employers: async () =>
      (await get<EmployerListResponse>(apiPath.employers())).employers,
    employer: (id: string) => get<EmployerResponse>(apiPath.employer(id)),
    schedules: async (filter: ScheduleListQuery = {}) =>
      (await get<ScheduleListResponse>(apiPath.schedules(filter))).schedules,
    memberRequests: async (filter: MemberRequestListQuery = {}) =>
      (await get<MemberRequestListResponse>(apiPath.memberRequests(filter)))
        .requests,
  },

  skills: {
    list: async () => (await get<SkillListResponse>(apiPath.skills())).skills,
    get: (id: string) => get<SkillResponse>(apiPath.skill(id)),
    save: (id: string, body: SkillSaveRequest) =>
      send<SkillResponse>(apiPath.skill(id), "PUT", body),
    restore: (id: string, body: RestoreRequest = {}) =>
      send<SkillResponse>(apiPath.skillRestore(id), "POST", body),
  },

  rules: {
    list: async (filter: RuleListQuery = {}) =>
      (await get<RuleListResponse>(apiPath.rules(filter))).rules,
    /** Throws an ApiFailure whose `errors` name each field at fault when the edit is refused. */
    save: async (id: string, body: RuleSaveRequest) =>
      (await send<RuleResponse>(apiPath.rule(id), "PUT", body)).rule,
    restore: async (id: string, body: RestoreRequest = {}) =>
      (await send<RuleResponse>(apiPath.ruleRestore(id), "POST", body)).rule,
    history: async (id: string) =>
      (await get<RuleHistoryResponse>(apiPath.ruleHistory(id))).versions,
  },

  sources: {
    list: async () =>
      (await get<SourceListResponse>(apiPath.sources())).sources,
    get: (id: string) => get<SourceResponse>(apiPath.source(id)),
    uploadUrl: (body: SourceUploadUrlRequest) =>
      send<SourceUploadUrlResponse>(apiPath.sourceUploadUrl(), "POST", body),
    ingest: (id: string) =>
      send<SourceIngestResponse>(apiPath.sourceIngest(id), "POST"),
    remove: (id: string) =>
      send<SourceRemoveResponse>(apiPath.source(id), "DELETE"),
    /** The whole upload: register the Source, PUT the file, read it into Passages. */
    async upload(
      file: File,
      options: {
        sessionId?: string | null;
        onProgress?: (fraction: number) => void;
      } = {},
    ): Promise<SourceIngestResponse> {
      const { source, uploadUrl } = await api.sources.uploadUrl({
        name: file.name,
        type: file.type || "application/octet-stream",
        bytes: file.size,
        sessionId: options.sessionId ?? null,
      });
      await putFile(uploadUrl, file, options.onProgress);
      return api.sources.ingest(source.id);
    },
  },

  knowledge: {
    search: async (filter: SearchQuery) =>
      (await get<SearchResponse>(apiPath.search(filter))).hits,
    conflicts: async (filter: ConflictListQuery = {}) =>
      (await get<ConflictListResponse>(apiPath.conflicts(filter))).conflicts,
    resolve: async (id: string, body: ConflictResolveRequest) =>
      (await send<ConflictResponse>(apiPath.conflictResolve(id), "POST", body))
        .conflict,
  },

  audit: {
    list: (filter: AuditQuery = {}) =>
      get<AuditListResponse>(apiPath.audit(filter)),
  },

  sandbox: {
    status: async (sessionId?: string | null) =>
      (await get<SandboxStatusResponse>(apiPath.sandbox(sessionId))).sandbox,
  },

  plugin: {
    /** Where the Plugin zip downloads from: use it as a link's `href`. */
    href: () => apiPath.plugin(),
  },

  mcp: {
    token: () => send<McpTokenResponse>(apiPath.mcpToken(), "POST"),
  },
};

export type HarnessApi = typeof api;

/** The message to show for anything a fetcher threw. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "That didn't work. Try again.";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** USD to show beside a model call: `$0.0123`, `<$0.0001`, or a dash when unknown. */
export function formatCost(costUsd: number | null | undefined) {
  if (costUsd === null || costUsd === undefined) return "–";
  if (costUsd > 0 && costUsd < 0.0001) return "<$0.0001";
  return `$${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
}
