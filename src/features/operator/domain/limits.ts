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
  /** Pauses one Run may take; a guarded Action after that is refused by the harness. */
  pausesPerRun: 3,
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

/** What one `run_code` may take and give back, in the Code sandbox. */
export const CODE_LIMITS = {
  commandMs: 30_000,
  sandboxMs: 6 * 60_000,
  codeChars: 20_000,
  outputChars: 6_000,
  outputBytes: 24_000,
  outputFileBlocks: 20_000,
} as const;

/** A Run older than this that still says it is going has lost its workflow. */
export const STALE_RUN_MINUTES =
  LIMITS.sandboxMinutes + LIMITS.pausesPerRun * LIMITS.approvalWaitMinutes + 5;
export const STALE_RUN_MS = STALE_RUN_MINUTES * 60_000;
