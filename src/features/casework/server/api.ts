import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive, type Middleware } from "@/platform/http/pipeline";
import type { Visitor } from "@/platform/request/visitor";
import { type CaseworkServices, casework } from "./container";
import type { SessionRow } from "./repository";

/**
 * Which of the Owner's Desks this browser has open. Only a pointer: a Desk is
 * opened only when its Owner is the request's Owner (`services/desks.ts`), so
 * the cookie never reaches someone else's Desk.
 */
export const SESSION_COOKIE = "casework_session";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Desk id the browser remembers, if it looks like one. */
export function rememberedDeskOf(headers: Pick<Headers, "get">): string | null {
  for (const pair of (headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const id = decodeURIComponent(value.join("="));
    return UUID.test(id) ? id : null;
  }
  return null;
}

/** Has the browser remember `deskId` as its open Desk, when it is not already. */
export function rememberDesk(
  response: Response,
  deskId: string,
  rememberedId: string | null,
): Response {
  if (deskId === rememberedId) return response;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  try {
    response.headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=${deskId}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
    );
  } catch {
    // A response with immutable headers keeps the old pointer; the next write sets it.
  }
  return response;
}

type DeskContext = {
  services: CaseworkServices;
  owner: Owner;
  visitor: Visitor;
  rememberedId: string | null;
};

/**
 * The open Desk: the Owner's Desk this browser remembers, else their latest.
 * With `create`, one is opened on first use (a write that needs a Desk);
 * without, there being none answers 404. The browser is told to remember the
 * Desk the request worked in.
 */
export function withDesk<C extends DeskContext>(options: {
  create: boolean;
}): Middleware<C, C & { desk: SessionRow }> {
  return async (context, next) => {
    const { services, owner, visitor, rememberedId } = context;
    const desk = options.create
      ? await services.desks.ensure({ owner, visitor }, rememberedId)
      : await services.desks.current(owner, rememberedId);
    if (!desk) throw new NotFoundError("No desk is open.");
    return rememberDesk(
      await next({ ...context, desk }),
      desk.id,
      rememberedId,
    );
  };
}

/**
 * Casework's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash the chat caps count against, its services, and the
 * Desk id the browser remembers. Each route adds its own Desk, body, query or
 * params layer. The MCP route is not on it: it checks its own bearer token.
 */
export const caseworkApi = api("casework")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(casework))
  .use(
    derive(({ request }) => ({
      rememberedId: rememberedDeskOf(request.headers),
    })),
  );
