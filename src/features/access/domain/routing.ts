import {
  ACCESS_PATH,
  GUESTS_PATH,
  PROFILE_PATH,
  SIGN_IN_PATH,
} from "../constants";

/** Routes under the gated paths that browser code fetches, never visits. */
const NOT_A_PAGE = /^\/api\/|\/(events|builds)$|\/packs\//;

/** Outside MCP clients carry a bearer token, not cookies; the route checks it. */
export function checksItsOwnBearer(path: string) {
  return path === "/api/casework/mcp" || path.startsWith("/api/casework/mcp/");
}

export type Decision =
  | { kind: "pass" }
  | { kind: "redirect"; to: string }
  | { kind: "refuse" };

/**
 * What the proxy does with a request to a matched path, given who is asking.
 * Anything that is not plainly a page visit is refused, so a new stream or API
 * route under a gated path fails closed even before it is listed here.
 */
export function decide(request: {
  path: string;
  search: string;
  method: string;
  access: "host" | "guest" | "e2e" | null;
}): Decision {
  const { path, access } = request;
  if (path === ACCESS_PATH || path.startsWith(`${ACCESS_PATH}/`)) {
    // The door is open to everyone; a Host's own pages only to a Host.
    const hostOnly =
      path.startsWith(GUESTS_PATH) || path.startsWith(PROFILE_PATH);
    return !hostOnly || access === "host"
      ? { kind: "pass" }
      : { kind: "redirect", to: SIGN_IN_PATH };
  }
  if (access) return { kind: "pass" };
  const visiting =
    (request.method === "GET" || request.method === "HEAD") &&
    !NOT_A_PAGE.test(path);
  // A page visit goes to the door, and comes back once through it. Server
  // actions, streams and API calls are refused outright.
  return visiting
    ? {
        kind: "redirect",
        to: `${ACCESS_PATH}?next=${encodeURIComponent(path + request.search)}`,
      }
    : { kind: "refuse" };
}
