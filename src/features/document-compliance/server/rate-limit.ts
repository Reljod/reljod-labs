import "server-only";

/*
 * Kept only for the features that still import these from here while they
 * move onto the platform (`@/platform/request/visitor`). Document compliance
 * itself takes its caps in `services/runs.ts` (`LIMITS` in `domain/limits.ts`)
 * and gets its visitor from the route pipeline. Delete this file once nothing
 * imports it.
 */

export { hashVisitor } from "@/platform/request/visitor";

/** The visitor hash of the e2e suite (`visitorOf` in `@/platform/request/visitor`). */
export const E2E_VISITOR = "e2e";
