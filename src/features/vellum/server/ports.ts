import type { RateLimiter } from "@/platform/rate/limiter";
import type { PassEvent } from "../domain/api";
import type { PreparedPass } from "./pass";

/**
 * What the Vellum service needs from the outside world. The container
 * (`container.ts`) wires the real adapters; tests and the stubbed e2e suite
 * hand in fakes.
 */

/** The model that draws: one Pass, as NDJSON events ending in the whole Drawing. */
export interface Draftsman {
  draw(prepared: PreparedPass, signal: AbortSignal): AsyncGenerator<PassEvent>;
  /** The model id shown on the page. */
  readonly model: string;
}

/** A Pass is the one thing Vellum spends on. */
export type SpendKind = "pass";

export type VellumPorts = {
  draftsman: Draftsman;
  rate: RateLimiter<SpendKind>;
};
