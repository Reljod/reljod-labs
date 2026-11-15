import { protectedResourceMetadata } from "@/features/client-manager/domain/oauth";
import {
  oauthJson,
  originOf,
  preflight,
} from "@/features/client-manager/server/oauth-http";

/** RFC 9728: the MCP server's 401 points here, and this points at the issuer. */
export function GET(request: Request) {
  return oauthJson(protectedResourceMetadata(originOf(request)));
}

export const OPTIONS = preflight;
