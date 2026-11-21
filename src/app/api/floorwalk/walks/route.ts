import { headers } from "next/headers";
import { requireOwner } from "@/features/access/server/gate";
import {
  STUB_HEADER,
  type WalkEvent,
  walkRequestSchema,
} from "@/features/floorwalk/domain/api";
import { env } from "@/features/floorwalk/server/env";
import { loadFootage } from "@/features/floorwalk/server/footage";
import { take, visitor } from "@/features/floorwalk/server/rate";
import { failure, NDJSON_HEADERS } from "@/features/floorwalk/server/respond";
import { walk } from "@/features/floorwalk/server/walker";

export const maxDuration = 300;

/**
 * One Walk: the Walker watches the footage and its checked Sightings stream
 * back as NDJSON. The gate, the request, the footage and the rate are all
 * checked before the model is called; after that, a failure is an `error`
 * line in the stream.
 */
export async function POST(request: Request) {
  try {
    const [{ owner }, who, body, requestHeaders] = await Promise.all([
      requireOwner(),
      visitor(),
      request.json().catch(() => ({})),
      headers(),
    ]);
    const { source } = walkRequestSchema.parse(body);
    const footage = await loadFootage(
      source,
      owner,
      new URL(request.url).origin,
    );
    const bypass = env.e2eBypassToken();
    const stub =
      who.trusted &&
      Boolean(bypass) &&
      requestHeaders.get(STUB_HEADER) === bypass;
    await take("walk", who);
    const events = walk(footage, { stub, signal: request.signal });
    const encoder = new TextEncoder();
    const line = (event: WalkEvent) =>
      encoder.encode(`${JSON.stringify(event)}\n`);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) controller.enqueue(line(event));
        } catch (error) {
          if (!request.signal.aborted) {
            console.error("[floorwalk] walk", error);
            controller.enqueue(
              line({
                t: "error",
                message: "The Walker stopped partway. Try the Walk again.",
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
