/**
 * Request headers the e2e suite sends. Plain constants (no `server-only`),
 * so `playwright.config.ts` and the specs import the same names the server
 * checks.
 */

/** Carries `E2E_BYPASS_TOKEN`: passes the gates as the `e2e` Owner, skips visitor caps. */
export const E2E_HEADER = "x-e2e-token";

/**
 * Sent with `1` beside a valid e2e token to reach the real model, Sandbox and
 * other paid services. Without it the e2e suite runs on stubbed adapters: the
 * same services, gates, limits and database, with canned model answers.
 * Ignored on any request without the e2e token.
 */
export const E2E_LIVE_HEADER = "x-e2e-live";
