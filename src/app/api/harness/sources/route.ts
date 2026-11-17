import type { SourceListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { listSources } from "@/features/harness/server/knowledge";
import { failure, json } from "@/features/harness/server/respond";

/** The Knowledge base's Sources: newest first, seed Sources after. */
export async function GET() {
  try {
    const { owner } = await requireStaff();
    return json<SourceListResponse>({ sources: await listSources(owner) });
  } catch (error) {
    return failure(error);
  }
}
