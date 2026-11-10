import { getRun } from "workflow/api";
import { viewableBuild } from "@/features/client-manager/server/service";
import { currentSessionId } from "@/features/client-manager/server/session";
import { failure } from "../../../respond";

// Stays open while the Build streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/** Streams a Build's events as newline-delimited JSON. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/client-manager/builds/[buildId]/events">,
) {
  const { buildId } = await params;
  let workflowRunId: string | null | undefined;
  try {
    const found = await viewableBuild(buildId, await currentSessionId());
    workflowRunId = found?.build.workflow_run_id;
  } catch (error) {
    return failure(error);
  }
  if (!workflowRunId) {
    return new Response("Not found", { status: 404 });
  }
  const from = Number(new URL(request.url).searchParams.get("from") ?? 0);
  const events = getRun(workflowRunId).getReadable({
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
