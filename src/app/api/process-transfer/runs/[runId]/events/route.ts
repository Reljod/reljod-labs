import { getRun as getWorkflowRun } from "workflow/api";
import {
  AccessDeniedError,
  denied,
  requireOwner,
} from "@/features/access/server/gate";
import { isOver, type RunEvent } from "@/features/process-transfer/domain/run";
import { ownedRun } from "@/features/process-transfer/server/repository";

// Stays open while the Run streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/** How long a finished Run's stream may go quiet before the route ends it itself. */
const IDLE_MS = 2500;

/** Streams a Run's events as newline-delimited JSON, to the Owner of the Run. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const gate = await requireOwner().catch((error) => {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!gate) return denied();
  const run = await ownedRun(gate.owner, runId);
  if (!run?.workflow_run_id) {
    return new Response("Not found", { status: 404 });
  }
  const from = Number(new URL(request.url).searchParams.get("from") ?? 0);
  const events = getWorkflowRun(run.workflow_run_id).getReadable<RunEvent>({
    startIndex: Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0,
  });
  // A Run that is over in the database may have a stream nobody closed (it
  // was stopped, or its workflow died). Its replay ends once it goes quiet.
  const over = isOver(run.status);
  const encoder = new TextEncoder();
  const line = (event: RunEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);
  const reader = events.getReader();
  let ended = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<"idle">((resolve) => {
        if (over) timer = setTimeout(() => resolve("idle"), IDLE_MS);
      });
      const next = await Promise.race([reader.read(), idle]);
      clearTimeout(timer);
      if (next === "idle" || next.done) {
        if (over && !ended && run.status !== "completed") {
          controller.enqueue(
            line({
              at: Date.now(),
              type: "end",
              status: run.status === "stopped" ? "stopped" : "failed",
            }),
          );
        }
        controller.close();
        void reader.cancel().catch(() => {});
        return;
      }
      if (next.value.type === "end") ended = true;
      controller.enqueue(line(next.value));
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
