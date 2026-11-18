import { requireOwner } from "@/features/access/server/gate";
import {
  parseRunId,
  type RunResponse,
} from "@/features/process-transfer/domain/api";
import { readRun } from "@/features/process-transfer/server/reads";
import {
  failure,
  json,
  refusal,
} from "@/features/process-transfer/server/respond";

/** One of this Owner's Runs. Another Owner's Run is "not found", like a missing one. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/process-transfer/runs/[runId]">,
) {
  try {
    const { owner } = await requireOwner();
    const runId = parseRunId((await params).runId);
    const run = runId ? await readRun(owner, runId) : null;
    if (!run) return refusal(404, "There is no such Run.");
    return json<RunResponse>({ run });
  } catch (error) {
    return failure(error);
  }
}
