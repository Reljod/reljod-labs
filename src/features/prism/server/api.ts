import "server-only";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, type Middleware } from "@/platform/http/pipeline";
import { errorResponse } from "@/platform/http/respond";
import { prism } from "./container";
import { ProviderUnavailableError } from "./errors";

/**
 * A Decision Model that could not answer a Refraction: 503 with its message.
 * (A Tribunal's or Cascade's model failures are lines in their stream.)
 */
function modelUnavailable<C>(): Middleware<C, C> {
  return async (context, next) => {
    try {
      return await next(context);
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        return errorResponse(503, error.message);
      throw error;
    }
  };
}

/**
 * Prism's base route stack: same-origin writes, the Access gate and the
 * Owner its hits are filed under, the visitor hash its caps count against,
 * and its service. Each route adds its own body layer.
 */
export const prismApi = api("prism")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(modelUnavailable())
  .use(withServices(prism));
