import "server-only";
import type { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import { ownerOf } from "@/features/access/domain/owner";
import {
  type Access,
  AccessDeniedError,
  requireAccess,
} from "@/features/access/server/gate";
import { ForbiddenError, InvalidError, TooLargeError } from "../errors";
import type { RequestMode } from "../request/mode";
import { type Visitor, visitorOf } from "../request/visitor";
import { type BaseContext, derive, guard, type Middleware } from "./pipeline";

/*
 * The standard layers. A feature stacks the ones it needs once
 * (`server/api.ts`), and a route adds the rest:
 *
 *   sameOrigin → access/owner → visitor → services → authorize → body/query
 *
 * Every layer only adds to the context or refuses, so they compose in any
 * order that satisfies their types, and a new one (an RBAC check, a tenant)
 * is one more `use`.
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-site request forgery guard for writes. Server actions had it built in
 * (Next compares Origin with Host); REST routes keep it here. A write must
 * come from this site's own pages (`Sec-Fetch-Site: same-origin`, or an
 * `Origin` whose host is the request's host), or carry the e2e token. A
 * browser without either header (very old ones) is refused, never trusted.
 */
export function sameOrigin<C extends BaseContext>(): Middleware<C, C> {
  return guard((context) => {
    const { request, mode } = context;
    if (!UNSAFE.has(request.method) || mode.e2e) return;
    const site = request.headers.get("sec-fetch-site");
    if (site === "same-origin") return;
    const origin = request.headers.get("origin");
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (site !== "cross-site" && origin && host) {
      try {
        if (new URL(origin).host === host) return;
      } catch {}
    }
    throw new ForbiddenError("That request didn't come from this site.");
  });
}

/** The gate (`requireAccess`): a Host, a Guest on a live pass, or the e2e suite. */
export function withAccess<C extends BaseContext>(): Middleware<
  C,
  C & { access: Access }
> {
  return derive(async () => ({ access: await requireAccess() }));
}

/**
 * The gate, and the Owner every saved row is scoped to. Use it for any route
 * that reads or writes saved data; never scope by a cookie or an id alone.
 */
export function withOwner<C extends BaseContext>(): Middleware<
  C,
  C & { access: Access; owner: Owner }
> {
  return derive(async () => {
    const access = await requireAccess();
    return { access, owner: ownerOf(access) };
  });
}

/** The salted visitor hash rate limits count against (trusted for e2e). */
export function withVisitor<C extends BaseContext>(): Middleware<
  C,
  C & { visitor: Visitor }
> {
  return derive((context) => ({
    visitor: visitorOf(context.request.headers, context.mode),
  }));
}

/**
 * A refusal reason, or null to allow. Policies are plain functions over the
 * context, so a Role check, a Host-only page or a future root user are all
 * the same shape and stack: `authorize(isHost)`, `authorize(permits("…"))`.
 */
export type Policy<C> = (context: C) => string | null | Promise<string | null>;

/** Refuses with 403 (and the policy's reason) unless the policy allows. */
export function authorize<C>(policy: Policy<C>): Middleware<C, C> {
  return guard(async (context) => {
    const refusal = await policy(context);
    if (refusal !== null) throw new ForbiddenError(refusal);
  });
}

/** Only a Host. A Guest is turned away as if they had no Access at all. */
export function isHost<C extends { access: Access }>(context: C) {
  if (context.access.kind !== "host") throw new AccessDeniedError();
  return null;
}

/**
 * A feature's services for this request: the container picks live or stub
 * adapters from the request's mode. The container is built once per
 * instance and mode, so this costs nothing per request.
 */
export function withServices<C extends BaseContext, S>(
  container: (mode: RequestMode) => S,
): Middleware<C, C & { services: S }> {
  return derive((context) => ({ services: container(context.mode) }));
}

const MAX_BODY = 256 * 1024;

/**
 * The body as text, read until `limit` bytes and no further: a chunked
 * request carries no length to refuse it by, so it is counted as it arrives.
 */
async function readCapped(request: Request, limit: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new TooLargeError("That request is too large.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The JSON body, parsed by the route's schema; 400 with the first issue when
 * it does not fit. Bodies over `limit` bytes (256 KB unless the route says
 * otherwise; files go to Storage by signed URL, never through here) are
 * refused before they are read into memory.
 */
export function body<C extends BaseContext, S extends z.ZodType>(
  schema: S,
  options: { limit?: number } = {},
): Middleware<C, C & { body: z.infer<S> }> {
  const limit = options.limit ?? MAX_BODY;
  return derive(async ({ request }) => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > limit) throw new TooLargeError("That request is too large.");
    const text = await readCapped(request, limit);
    let raw: unknown = {};
    if (text) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new InvalidError("That request isn't valid JSON.");
      }
    }
    return { body: schema.parse(raw) as z.infer<S> };
  });
}

/** The query string, parsed by the route's schema (single values only). */
export function query<C extends BaseContext, S extends z.ZodType>(
  schema: S,
): Middleware<C, C & { query: z.infer<S> }> {
  return derive(({ request }) => ({
    query: schema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    ) as z.infer<S>,
  }));
}

/** The dynamic segments, parsed by the route's schema (an id must be a uuid, …). */
export function params<C extends BaseContext, S extends z.ZodType>(
  schema: S,
): Middleware<C, C & { path: z.infer<S> }> {
  return derive(({ params: raw }) => ({
    path: schema.parse(raw) as z.infer<S>,
  }));
}
