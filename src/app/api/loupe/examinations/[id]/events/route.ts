import { ownerOf } from "@/features/access/domain/owner";
import { currentAccess, denied } from "@/features/access/server/gate";
import type { StoredEvent } from "@/features/loupe/domain/contract";
import {
  eventsAfter,
  getExamination,
  isOver,
  ownedExamination,
} from "@/features/loupe/server/repository";

// Stays open while the Examination streams; the client reconnects with `after`.
export const maxDuration = 300;

const POLL_MS = 600;
/** Ends the response before the platform does, so the client reconnects cleanly. */
const OPEN_MS = 280_000;
/** Polls an Examination seen over waits for its own `end` before the stream writes one. */
const OVER_GRACE_POLLS = 3;
const PAGE = 500;
/**
 * Events are read from a little behind the cursor, because one that was
 * given its seq first can commit a moment after a later one. The client
 * drops what it already has by seq.
 */
const OVERLAP = 12;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Streams an Examination's Trail as newline-delimited JSON, one
 * `StoredEvent` per line, to its Owner. `?after=<seq>` resumes after the last
 * event the client has. The stream ends after the `end` event, or after
 * about 280 s (reconnect with `after`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await currentAccess();
  if (!access) return denied();
  const examination = await ownedExamination(ownerOf(access), id);
  if (!examination) return new Response("Not found", { status: 404 });
  const given = Number(new URL(request.url).searchParams.get("after") ?? 0);
  let after = Number.isFinite(given) && given > 0 ? Math.floor(given) : 0;
  const sent = new Set<number>();
  const encoder = new TextEncoder();
  const opened = Date.now();
  const signal = request.signal;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StoredEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let overPolls = 0;
      try {
        while (!signal.aborted && Date.now() - opened < OPEN_MS) {
          const page = await eventsAfter(
            examination.id,
            Math.max(0, after - OVERLAP),
            PAGE,
          );
          const fresh = page.filter(
            (event) => event.seq > given && !sent.has(event.seq),
          );
          for (const event of fresh) {
            sent.add(event.seq);
            after = Math.max(after, event.seq);
            send(event);
            if (event.type === "end") {
              controller.close();
              return;
            }
          }
          if (page.length === PAGE) continue;
          if (fresh.length === 0) {
            // An Examination that is over but never wrote `end` (its workflow died) stops here.
            const latest = await getExamination(examination.id);
            if (!latest || isOver(latest.status)) {
              if (overPolls < OVER_GRACE_POLLS) {
                overPolls += 1;
              } else {
                if (latest)
                  send({
                    seq: after,
                    at: Date.now(),
                    type: "end",
                    status: latest.status as "completed" | "failed" | "stopped",
                    ...(latest.verdict
                      ? { verdict: latest.verdict.verdict }
                      : {}),
                    ...(latest.error ? { error: latest.error } : {}),
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
