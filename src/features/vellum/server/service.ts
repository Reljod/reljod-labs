import "server-only";
import type { Visitor } from "@/platform/request/visitor";
import type { Allowance, PassEvent, PassRequest } from "../domain/api";
import { LIMITS } from "../domain/limits";
import { preparePass } from "./pass";
import type { VellumPorts } from "./ports";

/**
 * Everything Vellum does. Nothing is saved (ADR 0034), so there is no Owner
 * here: only the visitor whose caps a Pass spends.
 */
export interface VellumService {
  /** How many Passes the visitor has left this hour, and which model draws. */
  allowance(visitor: Visitor): Promise<Allowance>;
  /**
   * Resolves once the request and every image are checked (an InvalidError
   * spends nothing) and the Pass is counted; then the marks stream.
   */
  pass(
    visitor: Visitor,
    request: PassRequest,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<PassEvent>>;
}

export function createVellumService(ports: VellumPorts): VellumService {
  const { draftsman, rate } = ports;
  return {
    async allowance(visitor) {
      const used = await rate.used(visitor, ["pass"]);
      return {
        used: used.pass,
        perHour: LIMITS.passesPerHour,
        model: draftsman.model,
      };
    },

    async pass(visitor, request, signal) {
      const prepared = preparePass(request);
      await rate.take("pass", visitor);
      return draftsman.draw(prepared, signal);
    },
  };
}
