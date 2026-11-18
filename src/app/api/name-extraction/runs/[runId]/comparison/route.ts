import { requireOwner } from "@/features/access/server/gate";
import { comparison } from "@/features/name-extraction/server/preview";
import { failure, refusalOr } from "@/features/name-extraction/server/respond";

/** One of the Owner's Runs set against the answer key, row by row. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/name-extraction/runs/[runId]/comparison">,
) {
  try {
    const { owner } = await requireOwner();
    const { runId } = await params;
    return refusalOr(await comparison(owner, runId));
  } catch (error) {
    return failure(error);
  }
}
