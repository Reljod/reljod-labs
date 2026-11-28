import "server-only";
import { dbStats } from "@/server/postgres";
import { modeOf, type RequestMode } from "../request/mode";
import { failure, json, noContent } from "./respond";

type Params = Record<string, string | string[] | undefined>;

/** What every handler starts with; middleware adds to it. */
export type BaseContext = {
  request: Request;
  /** The route's dynamic segments, already awaited. */
  params: Params;
  /** e2e and stub flags, read once from the request's headers. */
  mode: RequestMode;
};

/**
 * One layer of a route: it may refuse (throw an AppError, or return a
 * Response), add to the context and call `next`, or wrap `next` (time it,
 * post-process its Response). Layers run in the order they are `use`d.
 */
export type Middleware<In, Out> = (
  context: In,
  next: (context: Out) => Promise<Response>,
) => Promise<Response>;

/**
 * The usual layer: work out something from the context and add it under a
 * name. Throwing refuses the request. `derive(async (c) => ({ owner }))`.
 */
export function derive<In, Add extends object>(
  build: (context: In) => Add | Promise<Add>,
): Middleware<In, In & Add> {
  return async (context, next) =>
    next({ ...context, ...(await build(context)) });
}

/** A check that adds nothing: throws (or returns a Response) to refuse. */
export function guard<In>(
  check: (context: In) => void | Response | Promise<void | Response>,
): Middleware<In, In> {
  return async (context, next) => {
    const refusal = await check(context);
    return refusal instanceof Response ? refusal : next(context);
  };
}

type Handler<C> = (context: C) => unknown | Promise<unknown>;
type RouteContext = { params: Promise<Params> };
export type RouteHandler = (
  request: Request,
  context: RouteContext,
) => Promise<Response>;

/**
 * A route built from stacked layers. Each `use` returns a new builder, so a
 * feature defines its base stack once (`floorwalkApi`) and each route adds
 * its own layers (body, Role) without touching the shared one:
 *
 *   export const POST = harnessApi
 *     .use(authorize(permits("rule.edit")))
 *     .use(body(saveSchema))
 *     .handle(({ services, staff, body }) => services.rules.save(staff, body));
 *
 * A handler returns a Response, or any value, sent as `CACHE.none` JSON
 * (`private, no-store`). Whatever a layer or the handler throws becomes the
 * one JSON error shape (`failure`).
 */
export class Route<C> {
  constructor(
    private readonly layers: readonly Middleware<unknown, unknown>[],
    private readonly scope: string,
  ) {}

  use<Out>(layer: Middleware<C, Out>): Route<Out> {
    return new Route<Out>(
      [...this.layers, layer as Middleware<unknown, unknown>],
      this.scope,
    );
  }

  handle(handler: Handler<C>): RouteHandler {
    const { layers, scope } = this;
    return async (request, routeContext) => {
      const started = dbStats.enabled ? dbStats.snapshot() : null;
      let response: Response;
      try {
        const base: BaseContext = {
          request,
          params: (await routeContext?.params) ?? {},
          mode: modeOf(request.headers),
        };
        const run = (index: number, context: unknown): Promise<Response> => {
          const layer = layers[index];
          if (layer) return layer(context, (next) => run(index + 1, next));
          return Promise.resolve(handler(context as C)).then((value) =>
            value instanceof Response
              ? value
              : value === undefined
                ? noContent()
                : json(value, { request }),
          );
        };
        response = await run(0, base);
      } catch (error) {
        response = failure(error, scope);
      }
      if (started) dbStats.annotate(response, started);
      return response;
    };
  }
}

/** A new route stack for one feature; `scope` names its log lines. */
export function api(scope: string): Route<BaseContext> {
  return new Route<BaseContext>([], scope);
}
