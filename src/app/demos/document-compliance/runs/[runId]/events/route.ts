import { getRun } from "workflow/api";
import { accessOrDenied } from "@/features/access/server/gate";
import { workflowRunIdOf } from "@/features/document-compliance/server/repository";

// Stays open while the run streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/** Streams a live Pre-screen run's ScanEvents as newline-delimited JSON. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const access = await accessOrDenied();
  if (access instanceof Response) return access;
  const { runId } = await params;
  const workflowRunId = await workflowRunIdOf(runId);
  if (!workflowRunId) return new Response("Not found", { status: 404 });

  const from = Number(new URL(request.url).searchParams.get("from") ?? 0);
  const events = getRun(workflowRunId).getReadable({
    startIndex: Number.isFinite(from) ? from : 0,
  });
  const encoder = new TextEncoder();
  const body = events.pipeThrough(
    new TransformStream<unknown, Uint8Array>({
      transform(event, controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      },
    }),
  );
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
