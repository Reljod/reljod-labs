import { requireOwner } from "@/features/access/server/gate";
import type { DeskResponse } from "@/features/process-transfer/domain/api";
import { readDesk } from "@/features/process-transfer/server/reads";
import { failure, json } from "@/features/process-transfer/server/respond";

/** The Desk: this Owner's Runs, Rules, models and spend, in one read. */
export async function GET() {
  try {
    const { access, owner } = await requireOwner();
    return json<DeskResponse>({ desk: await readDesk(access, owner) });
  } catch (error) {
    return failure(error);
  }
}
