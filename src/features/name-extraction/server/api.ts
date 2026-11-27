import "server-only";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { sieve } from "./container";
import type { Caller } from "./services/runs";

/**
 * Sieve's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its services, and
 * `caller`, the Owner and visitor every write is made for. Each route adds
 * its own body, query or path layer. The MCP route is not on it: it checks
 * its own bearer.
 */
export const sieveApi = api("name-extraction")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(sieve))
  .use(
    derive(({ owner, visitor }) => ({
      caller: { owner, visitor } satisfies Caller as Caller,
    })),
  );
