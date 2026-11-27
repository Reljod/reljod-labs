"use client";

import {
  ApiError,
  attempt,
  errorOf,
  getJson,
  send as write,
} from "@/platform/client/api";
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
  type ConsentRequest,
  type ConsentResponse,
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
  type SourcePreviewResponse,
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
  sourcePreview: (id: string) => ["harness", "source-preview", id] as const,
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
      filter.mine ? "mine" : "",
    ] as const,
};

/**
 * What a route answered when it refused (`@/platform/client/api`): the
 * message to show, the status (401 no Access, 403 the Role may not, 404, 409
 * wrong state, 429 a limit) and the rest of the body.
 */
export { ApiError };

/** For a refused Rule edit: one error per field at fault (the 400's `errors`). */
export function ruleErrorsOf(error: unknown): RuleEditError[] {
  return error instanceof ApiError && Array.isArray(error.body.errors)
    ? (error.body.errors as RuleEditError[])
    : [];
}

/** What a read takes besides its own arguments: the signal that cancels it. */
export type ReadInit = { signal?: AbortSignal };

const get = <T>(url: string, init: ReadInit = {}): Promise<T> =>
  getJson<T>(url, { signal: init.signal });

const send = <T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> => write<T>(method, url, body);

/** Reads a newline-delimited JSON response, one parsed value at a time. */
async function* readNdjson<T>(response: Response): AsyncGenerator<T> {
  if (!response.ok) throw await errorOf(response);
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
    list: (init?: ReadInit) => get<StaffListResponse>(apiPath.staff(), init),
    switch: (body: StaffSwitchRequest) =>
      send<StaffSwitchResponse>(apiPath.staffSwitch(), "POST", body),
  },

  sessions: {
    list: async (init?: ReadInit) =>
      (await get<SessionListResponse>(apiPath.sessions(), init)).sessions,
    create: async (body: SessionCreateRequest = {}) =>
      (await send<SessionResponse>(apiPath.sessions(), "POST", body)).session,
    get: async (id: string) =>
      (await get<SessionResponse>(apiPath.session(id))).session,
    rename: async (id: string, body: SessionPatchRequest) =>
      (await send<SessionResponse>(apiPath.session(id), "PATCH", body)).session,
    messages: async (id: string, init?: ReadInit) =>
      (await get<MessageListResponse>(apiPath.messages(id), init)).messages,
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
      yield* readNdjson<ChatEvent>(response);
    },
  },

  runs: {
    list: async (filter: RunListQuery = {}, init?: ReadInit) =>
      (await get<RunListResponse>(apiPath.runs(filter), init)).runs,
    start: async (body: RunStartRequest) =>
      (await send<RunResponse>(apiPath.runs(), "POST", body)).run,
    get: async (id: string, init?: ReadInit) =>
      (await get<RunResponse>(apiPath.run(id), init)).run,
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
    list: async (init?: ReadInit) =>
      (await get<SkillListResponse>(apiPath.skills(), init)).skills,
    get: (id: string) => get<SkillResponse>(apiPath.skill(id)),
    save: (id: string, body: SkillSaveRequest) =>
      send<SkillResponse>(apiPath.skill(id), "PUT", body),
    restore: (id: string, body: RestoreRequest = {}) =>
      send<SkillResponse>(apiPath.skillRestore(id), "POST", body),
  },

  rules: {
    list: async (filter: RuleListQuery = {}, init?: ReadInit) =>
      (await get<RuleListResponse>(apiPath.rules(filter), init)).rules,
    /** Throws an ApiFailure whose `errors` name each field at fault when the edit is refused. */
    save: async (id: string, body: RuleSaveRequest) =>
      (await send<RuleResponse>(apiPath.rule(id), "PUT", body)).rule,
    restore: async (id: string, body: RestoreRequest = {}) =>
      (await send<RuleResponse>(apiPath.ruleRestore(id), "POST", body)).rule,
    history: async (id: string) =>
      (await get<RuleHistoryResponse>(apiPath.ruleHistory(id))).versions,
  },

  sources: {
    list: async (init?: ReadInit) =>
      (await get<SourceListResponse>(apiPath.sources(), init)).sources,
    get: (id: string) => get<SourceResponse>(apiPath.source(id)),
    preview: (id: string) =>
      get<SourcePreviewResponse>(apiPath.sourcePreview(id)),
    uploadUrl: (body: SourceUploadUrlRequest) =>
      send<SourceUploadUrlResponse>(apiPath.sourceUploadUrl(), "POST", body),
    ingest: (id: string) =>
      send<SourceIngestResponse>(apiPath.sourceIngest(id), "POST"),
    remove: (id: string) =>
      send<SourceRemoveResponse>(apiPath.source(id), "DELETE"),
    /**
     * The upload a chat attachment makes: register the Source and PUT the
     * file. The Source stays `pending`, attached but not filed: the Agent
     * and a Pipeline can read it, and it has no Passages and no Conflict
     * check until it is filed (`ingest`, or the Agent's `file_source`).
     */
    async attach(
      file: File,
      options: {
        sessionId?: string | null;
        onProgress?: (fraction: number) => void;
      } = {},
    ): Promise<SourceUploadUrlResponse["source"]> {
      const { source, uploadUrl } = await api.sources.uploadUrl({
        name: file.name,
        type: file.type || "application/octet-stream",
        bytes: file.size,
        sessionId: options.sessionId ?? null,
      });
      await putFile(uploadUrl, file, options.onProgress);
      return source;
    },
  },

  knowledge: {
    search: async (filter: SearchQuery) =>
      (await get<SearchResponse>(apiPath.search(filter))).hits,
    conflicts: async (filter: ConflictListQuery = {}, init?: ReadInit) =>
      (await get<ConflictListResponse>(apiPath.conflicts(filter), init))
        .conflicts,
    resolve: async (id: string, body: ConflictResolveRequest) =>
      (await send<ConflictResponse>(apiPath.conflictResolve(id), "POST", body))
        .conflict,
  },

  audit: {
    list: (filter: AuditQuery = {}, init?: ReadInit) =>
      get<AuditListResponse>(apiPath.audit(filter), init),
  },

  plugin: {
    /** Where the Plugin zip downloads from: use it as a link's `href`. */
    href: () => apiPath.plugin(),
    /** The Plugin zip. Rejects with the route's message (a Role that may not, no Access). */
    async download(): Promise<Blob> {
      const response = await fetch(apiPath.plugin(), { cache: "no-store" });
      if (!response.ok) throw await errorOf(response);
      return response.blob();
    },
  },

  mcp: {
    token: () => send<McpTokenResponse>(apiPath.mcpToken(), "POST"),
    /** The consent page's Allow or Deny; the error is shown where it was clicked. */
    consent: (body: ConsentRequest) =>
      attempt(() => send<ConsentResponse>(apiPath.consents(), "POST", body)),
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
