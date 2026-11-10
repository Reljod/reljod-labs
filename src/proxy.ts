import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_PATH,
  DENIED_MESSAGE,
  GUESTS_PATH,
  PROFILE_PATH,
  SIGN_IN_PATH,
} from "@/features/access/constants";
import { type Access, accessThrough } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";

/** Routes under the gated paths that browser code fetches, never visits. */
const NOT_A_PAGE = /^\/api\/|\/(events|builds)$|\/packs\//;

/**
 * The first gate in front of the demos: a visitor without Access is sent to
 * the door before any demo page or route runs. The landing and About pages are
 * not matched, so they stay open to everyone. Server functions check again
 * with `requireAccess`, because a server action can be posted to any page.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Outside MCP clients carry a bearer token, not cookies; the route checks it.
  if (path.startsWith("/api/casework/mcp")) return NextResponse.next();

  let response = NextResponse.next({ request });
  let access: Access | null = null;
  try {
    access = await accessThrough({
      e2eToken: request.headers.get(E2E_HEADER),
      cookies: {
        getAll: () => request.cookies.getAll(),
        // Supabase refreshed the session: hand the new cookies to the page
        // being rendered and to the browser, and keep the response uncached.
        setAll: (items, cacheHeaders) => {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
          for (const [name, value] of Object.entries(cacheHeaders)) {
            response.headers.set(name, value);
          }
        },
      },
    });
  } catch (error) {
    // If Access cannot be checked, the demos stay shut.
    console.error("[access] could not check Access", error);
  }
  const to = (target: string) =>
    NextResponse.redirect(new URL(target, request.url));
  let refusal: NextResponse;
  if (path.startsWith(ACCESS_PATH)) {
    // The door is open to everyone; a Host's own pages only to a Host.
    const hostOnly =
      path.startsWith(GUESTS_PATH) || path.startsWith(PROFILE_PATH);
    if (!hostOnly || access?.kind === "host") return response;
    refusal = to(SIGN_IN_PATH);
  } else if (access) {
    return response;
  } else if (
    (request.method === "GET" || request.method === "HEAD") &&
    !NOT_A_PAGE.test(path)
  ) {
    // A page visit goes to the door, and comes back here once through it.
    refusal = to(
      `${ACCESS_PATH}?next=${encodeURIComponent(path + request.nextUrl.search)}`,
    );
  } else {
    // Server actions, streams and API calls are refused outright.
    refusal = new NextResponse(DENIED_MESSAGE, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }
  for (const cookie of response.cookies.getAll()) refusal.cookies.set(cookie);
  return refusal;
}

export const config = {
  matcher: [
    "/demos/:path*",
    "/ask/:path*",
    "/api/casework/:path*",
    "/access/:path*",
  ],
};
