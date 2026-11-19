import { requireOwner } from "@/features/access/server/gate";
import type { RunListResponse } from "@/features/operator/domain/api";
import { runsFor } from "@/features/operator/server/reads";
import { failure, json } from "@/features/operator/server/respond";

/** The Owner's Runs, newest first. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<RunListResponse>(await runsFor(owner));
  } catch (error) {
    return failure(error);
  }
}
