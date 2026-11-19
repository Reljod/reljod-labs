import { headers } from "next/headers";
import { requireAccess } from "@/features/access/server/gate";
import {
  type PassEvent,
  passRequestSchema,
  STUB_HEADER,
} from "@/features/vellum/domain/api";
import { env } from "@/features/vellum/server/env";
import { preparePass, runPass } from "@/features/vellum/server/pass";
import { takePass, visitor } from "@/features/vellum/server/rate";
import { failure, NDJSON_HEADERS } from "@/features/vellum/server/respond";

export const maxDuration = 300;

/**
 * One Pass: the Draftsman draws, and its marks stream back as NDJSON as they
 * complete. The gate, the request's shape and the rate are all checked before
 * the model is called; after that, a failure is an `error` line in the stream.
 */
export async function POST(request: Request) {
  let events: AsyncGenerator<PassEvent>;
  try {
    const [, who, body, requestHeaders] = await Promise.all([
      requireAccess(),
      visitor(),
      request.json().catch(() => ({})),
      headers(),
    ]);
    const prepared = preparePass(passRequestSchema.parse(body));
    const bypass = env.e2eBypassToken();
    const stub =
      who.trusted &&
      Boolean(bypass) &&
      requestHeaders.get(STUB_HEADER) === bypass;
    await takePass(who);
    events = runPass(prepared, { stub, signal: request.signal });
    const first = await events.next();
    const encoder = new TextEncoder();
    const line = (event: PassEvent) =>
      encoder.encode(`${JSON.stringify(event)}\n`);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done) controller.enqueue(line(first.value));
          for await (const event of events) controller.enqueue(line(event));
        } catch (error) {
          if (!request.signal.aborted) {
            console.error("[vellum] pass", error);
            controller.enqueue(
              line({
                t: "error",
                message: "The Draftsman stopped partway. Try another Pass.",
              }),
            );
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
  } catch (error) {
    return failure(error);
  }
}
