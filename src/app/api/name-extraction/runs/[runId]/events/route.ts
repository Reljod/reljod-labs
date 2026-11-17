import { ownerOf } from "@/features/access/domain/owner";
import { currentAccess, denied } from "@/features/access/server/gate";
import {
  eventsAfter,
  getRunRow,
  isOver,
  ownedRun,
  type StoredEvent,
} from "@/features/name-extraction/server/repository";

// Stays open while the Run streams; the client reconnects with `after`.
export const maxDuration = 300;

const POLL_MS = 700;
/** Ends the response before the platform does, so the client reconnects cleanly. */
const OPEN_MS = 280_000;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Streams a Run's Audit trail as newline-delimited JSON, one `RunEvent & { seq }`
 * per line, to the Owner of the Run. `?after=<seq>` resumes after the last
 * event the client has. The stream ends after the `end` event, or after
 * about 280 s (reconnect with `after`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const access = await currentAccess();
  if (!access) return denied();
  const run = await ownedRun(ownerOf(access), runId);
  if (!run) return new Response("Not found", { status: 404 });
  const raw = Number(new URL(request.url).searchParams.get("after") ?? 0);
  let after = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  const encoder = new TextEncoder();
  const opened = Date.now();
  const signal = request.signal;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StoredEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        while (!signal.aborted && Date.now() - opened < OPEN_MS) {
          const events = await eventsAfter(run.id, after, 500);
          for (const event of events) {
            send(event);
            after = event.seq;
            if (event.type === "end") {
              controller.close();
              return;
            }
          }
          if (events.length === 500) continue;
          if (events.length === 0) {
            // A Run that is over but never wrote `end` (its workflow died) stops here.
            const latest = await getRunRow(run.id);
            if (!latest || isOver(latest.status)) {
              if (latest && latest.status !== "completed") {
                send({
                  seq: after,
                  at: Date.now(),
                  type: "end",
                  status: latest.status === "stopped" ? "stopped" : "failed",
                  ...(latest.error ? { error: latest.error } : {}),
                });
              }
              controller.close();
              return;
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
