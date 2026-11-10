import { getRun as getWorkflowRun } from "workflow/api";
import { getRun } from "@/features/casework/server/repository";
import { currentSession } from "@/features/casework/server/session";

// Stays open while the run streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/** Streams a Run's events as newline-delimited JSON, to the session that owns it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const [run, session] = await Promise.all([getRun(runId), currentSession()]);
  if (!run?.workflow_run_id || !session || run.session_id !== session.id) {
    return new Response("Not found", { status: 404 });
  }
  const from = Number(new URL(request.url).searchParams.get("from") ?? 0);
  const events = getWorkflowRun(run.workflow_run_id).getReadable({
    startIndex: Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0,
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
