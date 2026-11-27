import "server-only";
import { createHash } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isAppError } from "../errors";

/**
 * Cache policies, chosen by who can change the data
 * (`docs/engineering/conventions.md`, "Cache by who can change the data").
 * Never `public`: every demo route is behind the gate.
 */
export const CACHE = {
  /** Anything an Owner saved, or that can still change. The default. */
  none: "private, no-store",
  /** Deterministic shared seed data, the same for every Owner. */
  seed: "private, max-age=300, stale-while-revalidate=3600",
  /** Data that changes rarely and is safe a few seconds stale (an allowance). */
  brief: "private, max-age=5",
} as const;

export type CachePolicy = (typeof CACHE)[keyof typeof CACHE];

const DEFAULT_ERROR = "Something went wrong on our side.";

/** A strong validator for a JSON body: the browser revalidates instead of downloading again. */
export function etagOf(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * JSON with a cache policy (`CACHE.none` unless the route says otherwise).
 * Given the request of a GET, it answers 304 when the browser already holds
 * this exact body (`If-None-Match`), so a poll or a refetch of unchanged data
 * costs no download and no parse.
 */
export function json<T>(
  body: T,
  init?: {
    status?: number;
    cache?: CachePolicy;
    request?: Request;
    headers?: HeadersInit;
  },
): Response {
  const text = JSON.stringify(body);
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  headers.set("cache-control", init?.cache ?? CACHE.none);
  const status = init?.status ?? 200;
  if (init?.request?.method === "GET" && status === 200) {
    const etag = etagOf(text);
    headers.set("etag", etag);
    if (init.request.headers.get("if-none-match") === etag) {
      headers.delete("content-type");
      return new Response(null, { status: 304, headers });
    }
  }
  return new Response(text, { status, headers });
}

/** 204: a write that has nothing to say beyond success. */
export function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": CACHE.none },
  });
}

/** The answer for an error: `{ error, ...extra }`, never a stack or a cause. */
export function errorResponse(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { ...extra, error },
    { status, headers: { "cache-control": CACHE.none } },
  );
}

/**
 * What a handler threw, as the JSON answer every route promises. Next's own
 * signals (a GET bailing out of prerender on cookies, `notFound()`,
 * `redirect()`) pass through. A service's AppError answers its status with
 * its message; a zod error answers 400 with its first issue; anything else
 * is logged under `scope` and answered as a bare 500.
 */
export function failure(error: unknown, scope = "api"): Response {
  unstable_rethrow(error);
  if (isAppError(error))
    return errorResponse(error.status, error.message, error.extra);
  if (error instanceof ZodError)
    return errorResponse(
      400,
      error.issues[0]?.message ?? "That request doesn't look right.",
    );
  console.error(`[${scope}]`, error);
  return errorResponse(500, DEFAULT_ERROR);
}

export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": `${CACHE.none}, no-transform`,
  "x-accel-buffering": "no",
} as const;

/**
 * Streams events as NDJSON, one JSON object per line. A failure after the
 * first byte cannot change the status any more, so it is logged and sent as
 * the `onError` line instead; a visitor who leaves (the request aborts) gets
 * nothing more, and the source iterator is closed so its work stops.
 */
export function ndjson<E>(
  events: AsyncIterable<E>,
  options: {
    signal?: AbortSignal;
    scope?: string;
    onError?: (error: unknown) => E | null;
    headers?: HeadersInit;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  const line = (event: E) => encoder.encode(`${JSON.stringify(event)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(line(value));
      } catch (error) {
        if (!options.signal?.aborted) {
          console.error(`[${options.scope ?? "api"}] stream`, error);
          const last = options.onError?.(error);
          if (last != null) controller.enqueue(line(last));
        }
        try {
          controller.close();
        } catch {}
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
  return new Response(stream, {
    headers: { ...NDJSON_HEADERS, ...options.headers },
  });
}
