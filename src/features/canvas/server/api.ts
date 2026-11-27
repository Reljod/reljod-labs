import "server-only";
import { getPublicOrigin } from "mcp-handler";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import {
  api,
  type BaseContext,
  derive,
  type Middleware,
} from "@/platform/http/pipeline";
import type { Visitor } from "@/platform/request/visitor";
import { canvas } from "./container";
import type { Caller } from "./ports";
import type { CanvasServices } from "./services";

/**
 * A route's `[id]`. Any text up to 200 characters: a service answers an id
 * that is not the Owner's (or not a uuid) with the same 404, so ids leak nothing.
 */
export const idSchema = z.object({ id: z.string().min(1).max(200) });

/**
 * The person at the page as a Caller, with their Workspace made on first
 * use (one insert per instance and Owner), and the public origin the
 * in-process MCP client reaches the server at.
 */
function withCaller<
  C extends BaseContext & {
    owner: Owner;
    visitor: Visitor;
    services: CanvasServices;
  },
>(): Middleware<C, C & { caller: Caller; origin: string }> {
  return derive(async (context) => ({
    caller: await context.services.person(context.owner, context.visitor),
    origin: getPublicOrigin(context.request),
  }));
}

/**
 * Canvas's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its services (live, or
 * stubbed for the e2e suite) and the Caller they act for. Each route adds
 * its own body, query or params layer. The MCP route is not on it: it
 * checks its own bearer.
 */
export const canvasApi = api("canvas")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(canvas))
  .use(withCaller());
