import "server-only";
import { z } from "zod";
import {
  params,
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, type BaseContext } from "@/platform/http/pipeline";
import { operator } from "./container";

/**
 * The Operator's base route stack: same-origin writes, the Access gate and
 * the Owner, the visitor hash its caps count against, and its services.
 * Each route adds its own body, query or params layer. The MCP route is not
 * on it: it checks its own bearer token.
 */
export const operatorApi = api("operator")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(operator));

const runPath = z.object({ runId: z.string().max(64) });

/** A Run's id in the path. The service answers 404 for one that is not a uuid, as for one that is not the Owner's. */
export const runParams = <C extends BaseContext>() =>
  params<C, typeof runPath>(runPath);
