import "server-only";
import { pgRateLimiter } from "@/platform/rate/limiter";
import { container } from "@/platform/services/container";
import { LIMITS } from "../domain/limits";
import { cannedDraftsman, modelDraftsman } from "./pass";
import type { SpendKind } from "./ports";
import { createVellumService } from "./service";

/** A Pass is one model call: per visitor per hour, and across everyone per day. */
const rate = pgRateLimiter<SpendKind>({
  table: "vellum.rate_hits",
  caps: {
    pass: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.passesPerHour,
        message: `That's ${LIMITS.passesPerHour} Passes this hour. Try again soon.`,
      },
      {
        scope: "everyone",
        window: "day",
        max: LIMITS.passesPerDay,
        message: "Vellum has drawn all it may today. Come back tomorrow.",
      },
    ],
  },
});

/**
 * Vellum's composition root. Live: the model through AI Gateway. Stubbed
 * (e2e without `x-e2e-live: 1`): the canned Drawing through the real
 * reporter, sanitizer and Ruler. The gate and the caps are real in both.
 */
export const vellum = container(({ stub }) =>
  createVellumService({
    draftsman: stub ? cannedDraftsman : modelDraftsman,
    rate,
  }),
);
