/**
 * Every cap on paid or unbounded work in the Harness, in one place
 * (docs/engineering/conventions.md, "Cap paid work at every entry point").
 * Apply them in the server function, at every path that can add the work:
 * the app, the chat and the MCP server alike. Hourly limits count against
 * the visitor hash; the rest against the Workspace.
 */
export const LIMITS = {
  /** Staff messages a visitor may send in an hour. */
  messagesPerHour: 60,
  /** Characters in one message. */
  messageChars: 4_000,
  /** Model steps (tool calls included) the Agent may take in one chat turn. */
  stepsPerChatTurn: 12,
  /** Sessions a Workspace keeps. */
  sessionsPerWorkspace: 40,
  /** Runs a visitor may start in an hour, however they are started. */
  runsPerHour: 20,
  /** Runs at work in a Workspace at once (queued, running or waiting for an Approval). */
  maxConcurrentRuns: 3,
  /** Sources a visitor may add in an hour. */
  sourcesPerHour: 10,
  /** Sources a Workspace keeps, seed Sources included. */
  sourcesPerWorkspace: 60,
  /** Bytes in one upload; the `harness` bucket repeats it. */
  uploadBytes: 10 * 1024 * 1024,
  /** Passages one Source may be split into. */
  passagesPerSource: 200,
  /** New Passages of one Source checked against the old ones for Conflicts. */
  passagesCheckedPerSource: 24,
  /** Sandbox commands a visitor may run in an hour. */
  sandboxCommandsPerHour: 30,
  /** Audit events one page of the trail returns. */
  auditPageSize: 100,
} as const;

export type LimitName = keyof typeof LIMITS;
