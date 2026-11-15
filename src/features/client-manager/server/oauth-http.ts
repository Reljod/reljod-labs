import "server-only";
import { getPublicOrigin } from "mcp-handler";

/** MCP clients that run in a browser read these endpoints cross-origin. */
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
