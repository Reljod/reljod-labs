/**
 * Every cap on paid or unbounded work in Canvas, in one place
 * (docs/engineering/conventions.md, "Cap paid work at every entry point").
 * The harness applies them in the service, at every entry point: the
 * page, the chat and the MCP server. Hourly ones count against the visitor
 * hash; the rest against the Owner. A Rule may lower a per-Query cap, never
 * raise it past the number here.
 */
export const LIMITS = {
  /** Questions a visitor may ask in an hour. */
  questionsPerHour: 20,
  /** Characters in one Question. */
  questionChars: 2_000,
  /** Model turns the Analyst may take to answer one Question. */
  turnsPerQuestion: 14,
  /** USD of model spend one Question may reach; the turn that passes it is the last. */
  usdPerQuestion: 0.6,
  /** Output tokens of one Analyst turn. */
  outputTokensPerTurn: 6_000,
  /** Seconds of Sandbox time one Question may use, Queries and code together. */
  sandboxSecondsPerQuestion: 120,
  /** Runs (Queries, code, Control changes) a visitor may start in an hour. */
  runsPerHour: 600,
  /** Seconds one Query or one piece of code may run. */
  runSeconds: 30,
  /** Rows one Query returns to a View or to the Analyst. */
  rowsReturned: 5_000,
  /** Rows of a Query's result the Analyst is shown in a tool result. */
  rowsShownToAnalyst: 60,
  /** Rows a Query may hand to code as an input file. */
  rowsToCode: 500_000,
  /** Characters of SQL or code in one Query. */
  queryChars: 12_000,
  /** Characters of stdout and of stderr kept from one piece of code. */
  outputChars: 8_000,
  /** Conversations an Owner keeps; the oldest goes first. */
  conversationsPerOwner: 30,
  /** Views one Conversation may hold. */
  viewsPerConversation: 24,
  /** Boards an Owner keeps. */
  boardsPerOwner: 12,
  /** Views on one Board. */
  viewsPerBoard: 12,
  /** Refreshes a visitor may start in an hour. */
  refreshesPerHour: 12,
  /** The shortest Schedule a Board may refresh on, in minutes. */
  scheduleMinMinutes: 15,
  /** How many times a Schedule fires before it must be set again. */
  scheduleRuns: 24,
  /** Bytes in one Upload; the `canvas` bucket repeats it. */
  uploadBytes: 20 * 1024 * 1024,
  /** Uploads an Owner keeps. */
  uploadsPerOwner: 8,
  /** Uploads a visitor may add in an hour. */
  uploadsPerHour: 6,
  /** Columns an Upload may have. */
  uploadColumns: 80,
  /** Trail events one page returns. */
  trailPageSize: 100,
} as const;

export type LimitName = keyof typeof LIMITS;
