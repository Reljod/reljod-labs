import "server-only";
import { LimitError } from "@/platform/errors";
import { type Cap, capLock, pgRateLimiter } from "@/platform/rate/limiter";
import { LIMITS, voiceRefusal } from "../domain/limits";
import { sql } from "./db";
import type { SwitchboardRate } from "./ports";

const callRefusal = `That's ${LIMITS.callsPerHour} Calls this hour. Try again soon.`;

const callCaps: Cap<"call">[] = [
  {
    scope: "visitor",
    window: "hour",
    max: LIMITS.callsPerHour,
    message: callRefusal,
  },
];

/** The visitor's hourly caps, in `switchboard.rate_hits` (which also records the Owner). */
const hourly = pgRateLimiter<"call" | "turn">({
  table: "switchboard.rate_hits",
  owner: true,
  caps: {
    call: callCaps,
    turn: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.turnsPerHour,
        message: `That's ${LIMITS.turnsPerHour} Turns and tool calls this hour. Try again soon.`,
      },
    ],
  },
});

/**
 * Switchboard's caps in Postgres (never process memory). The hourly ones are
 * the shared limiter's. A voice Call is not: it also counts against the
 * Owner's voice Calls today, whatever IP they come from, which the shared
 * limiter (per visitor or for everyone) cannot express. It takes the
 * visitor's `call` place and a `voice` place in one transaction, under
 * advisory locks taken in one order (the shared limiter's `call` lock, the
 * Owner's, everyone's), and writes both hits only when all three caps have
 * room, so a refusal on one spends none (ADR 0029, decision 6).
 */
export const switchboardRate: SwitchboardRate = {
  take: (kind, { owner, visitor }) => hourly.take(kind, visitor, { owner }),

  async takeVoiceCall({ owner, visitor }) {
    if (visitor.trusted) return;
    const refusal = await sql().begin(async (tx) => {
      // The very lock the shared limiter takes for a text Call's `call` cap,
      // so the two never both take the visitor's last Call place.
      await tx`select pg_advisory_xact_lock(hashtextextended(${capLock("switchboard", "call", visitor, callCaps)}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`swb:owner:${owner}:voice`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${"swb:all:voice"}, 0))`;
      const [use] = await tx<
        { visitorHour: number; ownerToday: number; everyoneToday: number }[]
      >`
        select
          (select count(*)::int from switchboard.rate_hits
            where visitor_hash = ${visitor.hash} and kind = 'call'
              and created_at > now() - interval '1 hour') as "visitorHour",
          (select count(*)::int from switchboard.rate_hits
            where owner = ${owner} and kind = 'voice'
              and created_at > now() - interval '1 day') as "ownerToday",
          (select count(*)::int from switchboard.rate_hits
            where kind = 'voice'
              and created_at > now() - interval '1 day') as "everyoneToday"`;
      const used = use ?? { visitorHour: 0, ownerToday: 0, everyoneToday: 0 };
      if (used.visitorHour >= LIMITS.callsPerHour) return callRefusal;
      const voice = voiceRefusal(used);
      if (voice) return voice;
      await tx`
        insert into switchboard.rate_hits (owner, visitor_hash, kind)
        values (${owner}, ${visitor.hash}, 'call'), (${owner}, ${visitor.hash}, 'voice')`;
      return null;
    });
    if (refusal) throw new LimitError(refusal);
  },

  async used(visitor) {
    const used = await hourly.used(visitor, ["call", "turn"]);
    return {
      call: { used: used.call, perHour: LIMITS.callsPerHour },
      turn: { used: used.turn, perHour: LIMITS.turnsPerHour },
    };
  },
};
