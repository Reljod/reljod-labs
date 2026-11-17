import "server-only";
import { headers } from "next/headers";

/** e2e only: with the bypass token, paid work spends nothing unless this header asks for the live model. */
export const LIVE_HEADER = "x-harness-live";

/**
 * Whether a trusted caller's (the e2e suite's) paid work runs on its
 * deterministic stand-ins: Runs' model Steps use their fallbacks and the
 * Conflict check its stub. Anyone else always gets the model.
 */
export async function modelStubbed(trusted: boolean): Promise<boolean> {
  if (!trusted) return false;
  try {
    return (await headers()).get(LIVE_HEADER) !== "1";
  } catch {
    // Not in a request: a trusted caller with no header is stubbed.
    return true;
  }
}
