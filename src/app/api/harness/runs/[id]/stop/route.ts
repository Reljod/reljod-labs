import type { RunResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { failure, json } from "@/features/harness/server/respond";
import { stopRun } from "@/features/harness/server/runs";

type Context = { params: Promise<{ id: string }> };

/** Stops a Run. Always works, whatever state the workflow is in. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const context = await requirePermission("run.stop");
    const { id } = await params;
    return json<RunResponse>({ run: await stopRun({ ...context, runId: id }) });
  } catch (error) {
    return failure(error);
  }
}
