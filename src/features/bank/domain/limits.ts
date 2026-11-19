/**
 * Every cap on paid or unbounded work in the bank demo, in one place
 * (docs/engineering/conventions.md, "Cap paid work at every entry point").
 * Applied in the server function, at every entry point: the app, the chat
 * and the MCP server. Hourly limits count against the visitor hash; the rest
 * against the Owner's bank.
 */
export const LIMITS = {
  /** Messages a visitor may send the Teller in an hour. */
  messagesPerHour: 40,
  messageChars: 2_000,
  /** Model steps (tool calls included) the Teller may take in one turn. */
  stepsPerChatTurn: 12,
  sessionsPerBank: 30,
  /** Writes (any command that changes the bank) a visitor may make in an hour. */
  writesPerHour: 400,
  /** Sandbox runs a visitor may make in an hour. */
  sandboxRunsPerHour: 20,
  customersPerBank: 40,
  accountsPerCustomer: 8,
  cardsPerAccount: 3,
  payeesPerCustomer: 20,
  standingOrdersPerCustomer: 12,
  loansPerCustomer: 4,
  /** Days one fast-forward of the clock may cross (each runs an end-of-day). */
  clockDaysPerJump: 31,
  /** The furthest the simulated clock may run ahead of the real one, in days. */
  clockDaysAhead: 365 * 3,
  /** Rows one page of a list returns. */
  pageSize: 50,
  auditPageSize: 100,
  /** How long a pending confirmation from the Teller waits for the person. */
  confirmationMinutes: 15,
  /** Growth requests one Owner may raise in a day, and in all while open. */
  growthPerDay: 3,
  growthOpenPerOwner: 5,
  /** Growth requests filed as GitHub issues per day, across every Owner. */
  growthIssuesPerDay: 6,
  growthTitleChars: 100,
  growthWantChars: 1_200,
  /** Characters of tool output handed back to the model. */
  toolOutputChars: 12_000,
  /** Bytes of data the harness writes into the Sandbox for one run. */
  sandboxDataBytes: 400_000,
} as const;

export type LimitName = keyof typeof LIMITS;
