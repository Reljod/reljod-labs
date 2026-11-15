import { authorizationServerMetadata } from "@/features/client-manager/domain/oauth";
import {
  oauthJson,
  originOf,
  preflight,
} from "@/features/client-manager/server/oauth-http";

/** RFC 8414: where an MCP client registers, sends the person, and gets tokens. */
export function GET(request: Request) {
  return oauthJson(authorizationServerMetadata(originOf(request)));
}

export const OPTIONS = preflight;
