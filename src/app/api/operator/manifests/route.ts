import { requireOwner } from "@/features/access/server/gate";
import type { ManifestListResponse } from "@/features/operator/domain/api";
import { manifestsOf } from "@/features/operator/server/repository";
import { failure, json } from "@/features/operator/server/respond";

/** The Manifests the Owner attached and the server could read, newest first. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<ManifestListResponse>(await manifestsOf(owner));
  } catch (error) {
    return failure(error);
  }
}
