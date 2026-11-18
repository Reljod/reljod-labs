import { ownerOf } from "@/features/access/domain/owner";
import { currentAccess, denied } from "@/features/access/server/gate";
import {
  readFrom,
  startCursor,
  takeFresh,
} from "@/features/name-extraction/server/event-cursor";
import { isOver, type RunEvent } from "@/features/operator/domain/contract";
import {
  eventsAfter,
  getRunRow,
  ownedRun,
} from "@/features/operator/server/repository";

// Stays open while the Run streams; the client reconnects with `after`.
export const maxDuration = 300;

const POLL_MS = 500;
/** Ends the response before the platform does, so the client reconnects cleanly. */
const OPEN_MS = 280_000;
/** Polls a Run seen over waits for its own `end` before the stream writes one. */
const OVER_GRACE_POLLS = 3;
const PAGE = 500;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Streams a Run's Trail as newline-delimited JSON, one `RunEvent` per line,
 * to the Owner of the Run. `?after=<seq>` resumes after the last event the
 * client has (0 for none; seqs start at 1). Each poll also reads back a few
 * seqs behind the cursor for events that committed late, so the client may
 * get an event it already has and dedupes by seq. The stream ends after the
 * `end` event, or after about 280 s (reconnect with `after`).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/operator/runs/[runId]/events">,
) {
  const { runId } = await params;
  const access = await currentAccess();
  if (!access) return denied();
  const run = await ownedRun(ownerOf(access), runId);
  if (!run) return new Response("Not found", { status: 404 });
  let cursor = startCursor(
    Number(new URL(request.url).searchParams.get("after") ?? 0),
  );
  const encoder = new TextEncoder();
  const opened = Date.now();
  const signal = request.signal;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let overPolls = 0;
      try {
        while (!signal.aborted && Date.now() - opened < OPEN_MS) {
          const page = await eventsAfter(run.id, readFrom(cursor), PAGE);
          const taken = takeFresh(cursor, page);
          cursor = taken.cursor;
          for (const event of taken.fresh) {
            send(event);
            if (event.type === "end") {
              controller.close();
              return;
            }
          }
          if (page.length === PAGE) continue;
          if (taken.fresh.length === 0) {
            // A Run that is over but never wrote `end` (its workflow died) stops here.
            const latest = await getRunRow(run.id);
            if (!latest || isOver(latest.status)) {
              if (overPolls < OVER_GRACE_POLLS) {
                overPolls += 1;
              } else {
                if (latest)
                  send({
                    seq: cursor.after,
                    at: Date.now(),
                    type: "end",
                    status: latest.status as "completed" | "failed" | "stopped",
                    ...(latest.error ? { error: latest.error } : {}),
                    ...(latest.stopped_by
                      ? { stoppedBy: latest.stopped_by }
                      : {}),
                  });
                controller.close();
                return;
              }
            }
          }
          await wait(POLL_MS, signal);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
