import { type NextRequest, NextResponse } from "next/server";
import { DENIED_MESSAGE } from "@/features/access/constants";
import { checksItsOwnBearer, decide } from "@/features/access/domain/routing";
import { type Access, accessThrough } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";

/**
 * The first gate in front of the demos: a visitor without Access is sent to
 * the door before any demo page or route runs. The landing and About pages are
 * not matched, so they stay open to everyone. Server functions check again
 * with `requireAccess`, because a server action can be posted to any page.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (checksItsOwnBearer(path)) return NextResponse.next();

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
  const decision = decide({
    path,
    search: request.nextUrl.search,
    method: request.method,
    access: access?.kind ?? null,
  });
  if (decision.kind === "pass") return response;
  const refusal =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : new NextResponse(DENIED_MESSAGE, {
          status: 401,
          headers: { "cache-control": "no-store" },
        });
  for (const cookie of response.cookies.getAll()) refusal.cookies.set(cookie);
  return refusal;
}

export const config = {
  matcher: [
    "/demos/:path*",
    "/ask/:path*",
    "/api/casework/:path*",
    "/api/client-manager/:path*",
    "/access/:path*",
  ],
};
