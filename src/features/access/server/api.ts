import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isAppError } from "@/platform/errors";
import {
  authorize,
  isHost,
  sameOrigin,
  withAccess,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import {
  api,
  type BaseContext,
  derive,
  type Middleware,
} from "@/platform/http/pipeline";
import { errorResponse } from "@/platform/http/respond";
import { requestBrowser } from "./browser";
import { accessServices } from "./container";
import { UnavailableError } from "./errors";
import { currentAccess } from "./gate";

const DOOR_DOWN =
  "The door is not working right now, so nobody can be let in. Try again in a moment.";

/** This browser's Auth session and profile hint, over the request's cookies. */
function withBrowser<C extends BaseContext>() {
  return derive<C, { browser: ReturnType<typeof requestBrowser> }>(() => ({
    browser: requestBrowser(),
  }));
}

/** The Access of the request, or null: the door is open to a visitor too. */
function withCurrentAccess<C extends BaseContext>() {
  return derive<C, { access: Awaited<ReturnType<typeof currentAccess>> }>(
    async () => ({ access: await currentAccess() }),
  );
}

/**
 * Supabase Auth could not do its part: 503 with what went wrong
 * (`UnavailableError`). With `fallback`, any other failure that is not a
 * refusal (Supabase down, the `access` schema not exposed) is logged and told
 * to the visitor as that too, so a broken door says so and lets nobody in.
 */
function unavailable<C extends BaseContext>(
  fallback?: string,
): Middleware<C, C> {
  return async (context, next) => {
    try {
      return await next(context);
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof UnavailableError)
        return errorResponse(503, error.message);
      if (!fallback || isAppError(error) || error instanceof ZodError)
        throw error;
      console.error("[access] the door failed", error);
      return errorResponse(503, fallback);
    }
  };
}

/** The door at work: unexpected failures say the door is down. */
export function atTheDoor<C extends BaseContext>(): Middleware<C, C> {
  return unavailable<C>(DOOR_DOWN);
}

/**
 * The door's routes: open to everyone (that is how Access is got), so no
 * gate, but writes must come from this site's own pages.
 */
export const doorApi = api("access")
  .use(sameOrigin())
  .use(unavailable())
  .use(withCurrentAccess())
  .use(withVisitor())
  .use(withBrowser())
  .use(withServices(accessServices));

/**
 * A Host's routes: the gate, then only a Host (a Guest is refused like a
 * visitor). The proxy refuses everyone else first (`decide`).
 */
export const hostApi = api("access")
  .use(sameOrigin())
  .use(unavailable())
  .use(withAccess())
  .use(authorize(isHost))
  .use(withVisitor())
  .use(withBrowser())
  .use(withServices(accessServices));
