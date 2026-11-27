import { canvasApi } from "@/features/canvas/server/api";

/**
 * The document the page's sandboxed frame loads: the View App, fetched from
 * the MCP server with `resources/read` and served under the
 * Content-Security-Policy its resource declared. The frame carries
 * `sandbox="allow-scripts"` and the header repeats it, so the App runs in an
 * opaque origin with no network whichever way it is opened (ADR 0031).
 */
export const GET = canvasApi.handle(
  async ({ services, access, caller, origin }) => {
    const { html, csp } = await services.host.frame(access, caller, origin);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        // The same document for every View; the frame is cheap to open again.
        "cache-control": "private, max-age=300",
      },
    });
  },
);
