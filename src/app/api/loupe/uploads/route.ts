import { requireOwner } from "@/features/access/server/gate";
import type { UploadListResponse } from "@/features/loupe/domain/api";
import { listUploads } from "@/features/loupe/server/repository";
import { failure, json } from "@/features/loupe/server/respond";

/** The Owner's Uploads, newest first. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<UploadListResponse>(await listUploads(owner));
  } catch (error) {
    return failure(error);
  }
}
