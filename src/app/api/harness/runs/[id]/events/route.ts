import type { RunEvent } from "@/features/harness/domain/run";
import { requireStaff } from "@/features/harness/server/context";
import {
  failure,
  NDJSON_HEADERS,
  notFound,
} from "@/features/harness/server/respond";
import { runEventsStream } from "@/features/harness/server/runs";

// Stays open while the Run streams; a reconnect resumes from `?from=`.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

/** The Run's live stream as NDJSON `RunEvent`s, from event number `from`. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { owner } = await requireStaff();
    const { id } = await params;
    const from = Number(new URL(request.url).searchParams.get("from") ?? 0);
    const events = await runEventsStream(
      owner,
      id,
      Number.isFinite(from) ? from : 0,
    );
    if (!events) return notFound("That Run is not in this Workspace.");
    const encoder = new TextEncoder();
    const body = events.pipeThrough(
      new TransformStream<RunEvent, Uint8Array>({
        transform(event, controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        },
      }),
    );
    return new Response(body, { headers: NDJSON_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
