import { requireOwner } from "@/features/access/server/gate";
import type { ExaminationListResponse } from "@/features/loupe/domain/api";
import { listExaminations } from "@/features/loupe/server/repository";
import { failure, json } from "@/features/loupe/server/respond";

/** The Owner's Examinations, newest first. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<ExaminationListResponse>(await listExaminations(owner));
  } catch (error) {
    return failure(error);
  }
}
