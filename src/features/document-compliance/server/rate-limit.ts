import "server-only";
import { createHash } from "node:crypto";
import type { RunRefusal } from "./repository";

/**
 * Taken when a run is created, in the same transaction as its insert
 * (`createRun` in `repository.ts`, `create_prescreen_run` in the database).
 */
export const RATE_LIMITS = { perVisitorPerHour: 5, perDay: 100 };

/** Tag for runs started by the e2e suite; they skip limits and are deleted afterwards. */
export const E2E_VISITOR = "e2e";

export function hashVisitor(ip: string, salt: string) {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** What a visitor is told when a limit refused their run. */
export function rateLimitMessage(refusal: RunRefusal) {
  return refusal === "visitor"
    ? `You've run ${RATE_LIMITS.perVisitorPerHour} Pre-screens in the last hour. Showing the latest stored run instead.`
    : "The demo has reached today's limit of live runs. Showing the latest stored run instead.";
}
