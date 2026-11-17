import { protectedResourceMetadata } from "@/features/harness/domain/oauth";
import {
  oauthJson,
  originOf,
  preflight,
} from "@/features/harness/server/oauth-http";

/** RFC 9728: the Harness MCP server's 401 points here, and this names the Harness's own issuer. */
export function GET(request: Request) {
  return oauthJson(protectedResourceMetadata(originOf(request)));
}

export const OPTIONS = preflight;
