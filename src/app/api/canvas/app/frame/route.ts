import { getPublicOrigin } from "mcp-handler";
import { requireCallerAccess } from "@/features/canvas/server/caller";
import { appCsp, readViewApp } from "@/features/canvas/server/host";
import { failure } from "@/features/canvas/server/respond";

/**
 * The document the page's sandboxed frame loads: the View App, fetched from
 * the MCP server with `resources/read` and served under the
 * Content-Security-Policy its resource declared. The frame carries
 * `sandbox="allow-scripts"` and the header repeats it, so the App runs in an
 * opaque origin with no network whichever way it is opened (ADR 0031).
 */
export async function GET(request: Request) {
  try {
    const { caller, access } = await requireCallerAccess();
    const app = await readViewApp(access, caller, getPublicOrigin(request));
    const csp = appCsp(app.meta?.csp as Record<string, unknown> | undefined);
    // The page puts this document in the frame's `srcdoc` (a sandboxed frame
    // sends no cookies of its own to fetch it), where a response header does
    // not reach: the same policy rides inside the document as a meta tag.
    const html = app.html.replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${csp.replace("; sandbox allow-scripts", "")}">`,
    );
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
  } catch (error) {
    return failure(error);
  }
}
