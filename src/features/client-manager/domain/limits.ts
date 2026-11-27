/**
 * Client Manager's caps, in one place. They are taken in the server function
 * (`takeLimit` and `checkLimits` in `server/service.ts`) at every entry point:
 * the app, the chat and the MCP server.
 */
export const LIMITS = {
  files: 8,
  fileBytes: 10 * 1024 * 1024,
  noteChars: 20_000,
  buildsPerHour: 6,
  asksPerHour: 40,
  /** Research turns search the web several times each. */
  researchPerHour: 8,
  buildsPerDay: 150,
  /** Questions (asks and research) from everyone, per day. */
  asksPerDay: 1500,
  spendPerVisitorPerDay: 2,
  /** One Owner's spend per day, in USD, whatever IP they come from. */
  spendPerOwnerPerDay: 3,
};

export type Usage24h = {
  /** This visitor, in the last hour. */
  hourBuilds: number;
  hourAsks: number;
  hourResearch: number;
  /** This visitor's and this Owner's spend in the last day, in USD. */
  visitorCost: number;
  ownerCost: number;
  /** Everyone, in the last day. */
  allBuilds: number;
  allAsks: number;
};

export type LimitKind = "build" | "ask" | "research";

/** Which cap this usage has reached for one more of `kind`, as the refusal to show; null when there is room. Pure. */
export function refusalFor(kind: LimitKind, usage: Usage24h): string | null {
  if (usage.visitorCost >= LIMITS.spendPerVisitorPerDay)
    return "You've used today's model budget for this demo. Come back tomorrow.";
  if (usage.ownerCost >= LIMITS.spendPerOwnerPerDay)
    return "Your book has used today's model budget for this demo. Come back tomorrow.";
  if (kind === "build") {
    if (usage.hourBuilds >= LIMITS.buildsPerHour)
      return `That's ${LIMITS.buildsPerHour} graph builds this hour. Try again soon.`;
    if (usage.allBuilds >= LIMITS.buildsPerDay)
      return "The demo has reached today's limit of graph builds.";
    return null;
  }
  if (usage.hourAsks >= LIMITS.asksPerHour)
    return `That's ${LIMITS.asksPerHour} questions this hour. Try again soon.`;
  if (kind === "research" && usage.hourResearch >= LIMITS.researchPerHour)
    return `That's ${LIMITS.researchPerHour} research runs this hour. Ask without Research, or try again soon.`;
  if (usage.allAsks >= LIMITS.asksPerDay)
    return "The demo has reached today's limit of questions. Come back tomorrow.";
  return null;
}
