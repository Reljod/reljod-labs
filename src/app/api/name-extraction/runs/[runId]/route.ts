import { requireOwner } from "@/features/access/server/gate";
import type { RunResponse } from "@/features/name-extraction/domain/api";
import { runDetail } from "@/features/name-extraction/server/reads";
import {
  failure,
  json,
  notFound,
} from "@/features/name-extraction/server/respond";

/** One of the Owner's Runs with its Audit trail and its Register; 404 if not theirs. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/name-extraction/runs/[runId]">,
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
