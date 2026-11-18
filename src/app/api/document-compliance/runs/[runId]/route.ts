import { requireOwner } from "@/features/access/server/gate";
import {
  isRunId,
  type RunResponse,
} from "@/features/document-compliance/domain/api";
import { loadRun } from "@/features/document-compliance/server/repository";
import {
  failure,
  json,
  NotFoundError,
} from "@/features/document-compliance/server/respond";

/** One of the Owner's runs, whole; another Owner's run is not found. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/document-compliance/runs/[runId]">,
) {
  try {
    const { owner } = await requireOwner();
    const { runId } = await params;
    const run = isRunId(runId) ? await loadRun(runId, owner) : null;
    if (!run) throw new NotFoundError("No such run.");
    return json<RunResponse>(run);
  } catch (error) {
    return failure(error);
  }
}
