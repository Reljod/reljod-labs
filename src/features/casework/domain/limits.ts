/**
 * The Casework desk's caps, taken in the server functions at every entry
 * point (app, chat, MCP): the rate limits and the one-Run rule in
 * `casework.create_run`, the chat caps in `casework.take_chat_turn`.
 */
export const LIMITS = {
  runsPerVisitorPerHour: 12,
  runsPerDay: 250,
  /** USD a session may spend on models before the desk stops starting work. */
  spendPerSession: 2,
  /**
   * USD one Owner's Desks may spend on models in a day, all Desks together,
   * so starting a new Desk never resets it.
   */
  spendPerOwnerPerDay: 5,
  /** Messages to the Specialist per visitor per hour. */
  messagesPerVisitorPerHour: 40,
  /** Messages to the Specialist per day, across the whole demo. */
  chatTurnsPerDay: 1500,
  documentsPerRun: 12,
};
