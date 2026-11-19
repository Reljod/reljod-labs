/**
 * Every cap in one place. The harness enforces them in the server function,
 * at every entry point (the app, the Session's tool bridge, the MCP server);
 * the model never does.
 */
export const LIMITS = {
  /** The longest a Call may run, whatever the Call length Rule says. */
  callSeconds: 300,
  /** How long past its deadline a Call may sit before the Workflow cuts it off. */
  cutOffGraceSeconds: 20,
  /** One live Call per Owner at a time. */
  liveCalls: 1,
  callsPerHour: 12,
  /** Caller Turns on the text Line, and tool calls on either, per hour. */
  turnsPerHour: 240,
  /** Spend on one Call before the harness ends it. */
  usdPerCall: 0.75,
  /** Tool calls in one Call. */
  toolCallsPerCall: 40,
  /** Model steps in one text Turn. */
  stepsPerTurn: 6,
  /** Characters in one typed Turn. */
  turnChars: 600,
  /** Characters kept of one transcript Turn the browser reports. */
  transcriptChars: 4000,
  /** Events the browser may report in one request, and in one Call. */
  eventsPerRequest: 40,
  eventsPerCall: 1500,
  supervisorQuestionsPerHour: 20,
  supervisorSteps: 8,
  /** Past Calls the Supervisor's Sandbox is handed. */
  supervisorCalls: 20,
  sandboxRunsPerHour: 20,
  /** Runs of code in one Supervisor answer, and in one Wrap-up. */
  sandboxRunsPerAnswer: 3,
  /** How long a promised Callback waits, at most: this is a demo, not a call centre. */
  callbackMaxMinutes: 30,
  /** Calls listed in the history. */
  historyCalls: 50,
  /** A recording's size, the same number as the bucket's own limit. */
  audioBytes: 25 * 1024 * 1024,
  /** Saved Versions of one Rule. */
  ruleVersions: 50,
} as const;

/** Sandbox caps, the same shape as Sieve's and the Harness's. */
export const SANDBOX_LIMITS = {
  commandMs: 30_000,
  sandboxMs: 5 * 60_000,
  outputChars: 8_000,
  outputBytes: 32_000,
  outputFileBlocks: 20_000,
  codeChars: 20_000,
} as const;
