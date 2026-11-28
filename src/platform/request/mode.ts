import "server-only";
import { isE2eToken } from "@/features/access/server/e2e";
import { E2E_HEADER, E2E_LIVE_HEADER } from "./headers";

export { E2E_HEADER, E2E_LIVE_HEADER };

/**
 * How a request is served. `e2e` passes the gates and the visitor's rate
 * limits (the suite owns its own data as the `e2e` Owner); `stub` swaps the
 * paid adapters for canned ones in a feature's container. Only a request
 * that carries the e2e token can be either; stub is the suite's default.
 */
export type RequestMode = { e2e: boolean; stub: boolean };

export const LIVE: RequestMode = { e2e: false, stub: false };

export function modeOf(headers: Pick<Headers, "get">): RequestMode {
  if (!isE2eToken(headers.get(E2E_HEADER))) return LIVE;
  return { e2e: true, stub: headers.get(E2E_LIVE_HEADER) !== "1" };
}
