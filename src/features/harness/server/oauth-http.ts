import "server-only";
import { getPublicOrigin } from "mcp-handler";

/*
 * What the Harness's OAuth endpoints and metadata answer with. MCP clients
 * that run in a browser (Claude.ai) read them cross-origin.
 */

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version",
};

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function oauthJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS, "cache-control": "no-store", pragma: "no-cache" },
  });
}

/** The origin the client reached, behind Vercel's proxy too. */
export const originOf = (request: Request) => getPublicOrigin(request);
