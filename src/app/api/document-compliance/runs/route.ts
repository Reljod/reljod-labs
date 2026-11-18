import { requireOwner } from "@/features/access/server/gate";
import type { RunListResponse } from "@/features/document-compliance/domain/api";
import { listOwnerRuns } from "@/features/document-compliance/server/repository";
import { failure, json } from "@/features/document-compliance/server/respond";

/** The runs this Owner started, newest first, on any device. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<RunListResponse>(await listOwnerRuns(owner));
  } catch (error) {
    return failure(error);
  }
}
