import { headers } from "next/headers";
import { after } from "next/server";
import { requireOwner } from "@/features/access/server/gate";
import {
  STUB_HEADER,
  type WalkEvent,
  walkRequestSchema,
} from "@/features/floorwalk/domain/api";
import { env } from "@/features/floorwalk/server/env";
import {
  assertOwnSource,
  loadFootage,
} from "@/features/floorwalk/server/footage";
import { take, visitor } from "@/features/floorwalk/server/rate";
import { failure, NDJSON_HEADERS } from "@/features/floorwalk/server/respond";
import { sweepUploads } from "@/features/floorwalk/server/storage";
import { walk } from "@/features/floorwalk/server/walker";

export const maxDuration = 300;

/**
 * One Walk: the Walker watches the footage and its checked Sightings stream
 * back as NDJSON. The gate, the request and the upload's owner are checked,
 * then the rate is taken, then the footage is read (so a read is never
 * unmetered), all before the model is called. After that, a failure is an
 * `error` line in the stream.
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
    assertOwnSource(source, owner);
    const bypass = env.e2eBypassToken();
    const stub =
      who.trusted &&
      Boolean(bypass) &&
      requestHeaders.get(STUB_HEADER) === bypass;
    await take("walk", who);
    after(sweepUploads);
    const footage = await loadFootage(
      source,
      owner,
      new URL(request.url).origin,
    );
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
          // Already closed when the visitor left mid-Walk.
          try {
            controller.close();
          } catch {}
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
