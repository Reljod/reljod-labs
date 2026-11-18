/**
 * Every cap of the Operator demo, in one place. The harness enforces them in
 * the server functions, at every entry point (the page, the MCP server, the
 * workflow), never the model and never only the UI (conventions.md).
 */
export const LIMITS = {
  /** Model calls the Operator may make in one Run. */
  turnsPerRun: 40,
  /** Actions (clicks, typing, key presses, scrolls, waits) in one Run, whoever drives. */
  actionsPerRun: 240,
  /** Actions the Operator may ask for in one turn. */
  actionsPerTurn: 12,
  /** What one Run may spend on the model, in USD. */
  usdPerRun: 1.25,
  /** How long a Run's Screen sandbox may live, in minutes. */
  sandboxMinutes: 15,
  /** `run_code` calls in one Run. */
  codeRunsPerRun: 6,
  /** How long a paused Run waits for a person before the Action is refused. */
  approvalWaitMinutes: 10,
  runsPerVisitorPerHour: 6,
  runsPerOwnerPerDay: 24,
  /** Runs with a live Screen one Owner may have at once. */
  activePerOwner: 1,
  /** Characters of an own Task. */
  taskChars: 1200,
  manifestBytes: 512_000,
  manifestRows: 60,
  manifestsPerOwnerPerDay: 20,
  rulebooksPerOwnerPerDay: 50,
  /** Inputs of one "take the keyboard" attempt the server will replay. */
  handInputs: 4000,
  handRunsPerVisitorPerHour: 30,
  /** Frames one `get_run` or trail read returns at most. */
  trailEvents: 400,
} as const;

/** A Run older than this that still says it is going has lost its workflow. */
export const STALE_RUN_MS = (LIMITS.sandboxMinutes + 5) * 60_000;

/**
 * The request header that asks for the scripted Operator (a sample Task's
 * Script, no model call). Honoured only when it carries the e2e bypass token.
 */
export const STUB_HEADER = "x-operator-stub";
