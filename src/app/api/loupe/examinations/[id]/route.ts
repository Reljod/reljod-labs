import { requireOwner } from "@/features/access/server/gate";
import type { ExaminationResponse } from "@/features/loupe/domain/api";
import { examinationDetail } from "@/features/loupe/server/reads";
import { failure, json, notFound } from "@/features/loupe/server/respond";

/** One of the Owner's Examinations with its Trail, Measurements and Findings. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ owner }, { id }] = await Promise.all([requireOwner(), params]);
    const detail = await examinationDetail(owner, id);
    return detail ? json<ExaminationResponse>(detail) : notFound();
  } catch (error) {
    return failure(error);
  }
}
