import type { RateLimiter } from "@/platform/rate/limiter";
import type { RefractResponse } from "../domain/api";
import type { DecisionModelId } from "../domain/models";
import type { PrismQuestionMap } from "../domain/questions";

/**
 * What the Prism service needs from the outside world. The container
 * (`container.ts`) wires the real adapters; tests and the stubbed e2e suite
 * hand in fakes.
 */

/**
 * A Decision Model behind Vercel AI Gateway: one Refraction of one Slip
 * against a slate of questions. Throws `ProviderUnavailableError` when the
 * model could not answer, with a message safe to show.
 */
export interface Decider {
  decide(input: {
    modelId: DecisionModelId;
    state: string;
    questions: PrismQuestionMap;
    signal?: AbortSignal;
  }): Promise<RefractResponse>;
}

/** What a Prism request spends from: one cap each, counted in Decision Model calls. */
export type RateKind = "refract" | "tribunal" | "cascade";

export type PrismPorts = {
  decider: Decider;
  rate: RateLimiter<RateKind>;
  /** Milliseconds on a monotonic clock, for a Tribunal's or Cascade's wall time. */
  now: () => number;
};
