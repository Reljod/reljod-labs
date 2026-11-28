import "server-only";
import { currentAccess } from "@/features/access/server/gate";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { clientManager } from "./container";

/**
 * Client Manager's base route stack: same-origin writes, the Access gate and
 * the Owner, the visitor hash its caps count against, its services, and the
 * `caller` (Owner and visitor) the services take. Each route adds its own
 * params, query or body layer. The MCP and OAuth routes are not on it: they
 * check their own bearer or need no Access.
 */
export const clientManagerApi = api("client-manager")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(clientManager))
  .use(derive(({ owner, visitor }) => ({ caller: { owner, visitor } })));

/**
 * The OAuth consent page's stack: writes from this site only, and the
 * Access of the request, which may be none. The service refuses that itself
 * (after the proxy refused it first), so it can answer without redirecting
 * anyone anywhere.
 */
/**
 * The stack of the routes that check their own bearer or need no Access:
 * the MCP server and the OAuth endpoints, which MCP clients call from
 * anywhere (so no same-origin guard either).
 */
export const openApi = api("client-manager").use(withServices(clientManager));

export const consentApi = api("client-manager")
  .use(sameOrigin())
  .use(derive(async () => ({ access: await currentAccess() })))
  .use(withVisitor())
  .use(withServices(clientManager));
