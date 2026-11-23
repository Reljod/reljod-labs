import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import { EngineError } from "../domain/engine";
import { InvalidError, LimitError } from "./errors";

/** Every Firebreak answer is one visitor's, and can change. */
export const NO_STORE = "private, no-store";

const answer = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": NO_STORE } });

/**
 * Turns what a Firebreak route handler threw into the JSON answer the
 * contract promises (`domain/api.ts`), so every route fails the same way and
 * never returns a stack trace or a cause.
 */
export function failure(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof LimitError) return answer(429, error.message);
  if (error instanceof InvalidError || error instanceof EngineError)
    return answer(400, error.message);
  if (error instanceof ZodError)
    return answer(
      400,
      error.issues[0]?.message ?? "That request doesn't look right.",
    );
  console.error("[firebreak]", error);
  return answer(500, "Something went wrong on our side.");
}

/** JSON that is never cached. */
export function json<T>(body: T): Response {
  return Response.json(body, { headers: { "cache-control": NO_STORE } });
}

/** The response headers of an NDJSON stream. */
export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": `${NO_STORE}, no-transform`,
  "x-accel-buffering": "no",
} as const;

/**
 * Streams a generator as NDJSON. The first event is awaited before the
 * Response is returned, so a failure before any model output (a refused
 * Round, the rate) is still an ordinary JSON error; after that a failure is
 * an `error` line.
 */
export async function ndjson<E>(
  events: AsyncGenerator<E>,
  signal: AbortSignal,
  onError: (error: unknown) => E,
): Promise<Response> {
  const first = await events.next();
  const encoder = new TextEncoder();
  const line = (event: E) => encoder.encode(`${JSON.stringify(event)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(line(first.value));
        for await (const event of events) controller.enqueue(line(event));
      } catch (error) {
        if (!signal.aborted) {
          console.error("[firebreak] stream", error);
          controller.enqueue(line(onError(error)));
        }
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
