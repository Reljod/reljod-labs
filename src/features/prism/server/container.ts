import "server-only";
import { type Cap, pgRateLimiter } from "@/platform/rate/limiter";
import { container } from "@/platform/services/container";
import { LIMITS } from "../domain/limits";
import { gatewayDecider, stubDecider } from "./decide";
import type { RateKind } from "./ports";
import { createPrismService } from "./service";

const TODAY =
  "Prism has made all the decisions it may today. Come back tomorrow.";

/** A visitor's hour and everyone's day of one kind, in Decision Model calls. */
const caps = (perHour: number, perDay: number, what: string): Cap[] => [
  {
    scope: "visitor",
    window: "hour",
    max: perHour,
    message: `That would go over your ${perHour} ${what} this hour. Try again in a bit.`,
  },
  { scope: "everyone", window: "day", max: perDay, message: TODAY },
];

/** `prism.rate_hits` counts units (calls), and every hit names its Owner. */
const rate = pgRateLimiter<RateKind>({
  table: "prism.rate_hits",
  units: true,
  owner: true,
  caps: {
    refract: caps(
      LIMITS.refractionsPerHour,
      LIMITS.refractionsPerDay,
      "refractions",
    ),
    tribunal: caps(
      LIMITS.tribunalCallsPerHour,
      LIMITS.tribunalCallsPerDay,
      "tribunal model calls",
    ),
    cascade: caps(
      LIMITS.cascadeCallsPerHour,
      LIMITS.cascadeCallsPerDay,
      "cascade model calls",
    ),
  },
});

/**
 * Prism's composition root. Live: Decision Models through AI Gateway.
 * Stubbed (e2e without `x-e2e-live: 1`): deterministic calibrated answers,
 * no spend. The gate, the caps and the database are real in both.
 */
export const prism = container(({ stub }) =>
  createPrismService({
    decider: stub ? stubDecider : gatewayDecider,
    rate,
    now: () => performance.now(),
  }),
);
