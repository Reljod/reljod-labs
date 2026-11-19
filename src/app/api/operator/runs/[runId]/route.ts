import { requireOwner } from "@/features/access/server/gate";
import type { RunResponse } from "@/features/operator/domain/api";
import { runDetail } from "@/features/operator/server/reads";
import { failure, json, notFound } from "@/features/operator/server/respond";

/** One of the Owner's Runs with its Trail and Findings; 404 if not theirs. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/operator/runs/[runId]">,
) {
  try {
    const { owner } = await requireOwner();
    const { runId } = await params;
    const detail = await runDetail(owner, runId);
    return detail ? json<RunResponse>(detail) : notFound();
  } catch (error) {
    return failure(error);
  }
}
