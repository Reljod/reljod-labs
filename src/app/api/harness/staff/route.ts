import type { StaffListResponse } from "@/features/harness/domain/api";
import { resolveStaff } from "@/features/harness/server/context";
import { failure, json } from "@/features/harness/server/respond";

/** The Workspace's Staff and who the visitor is signed in as. */
export async function GET() {
  try {
    // The gate reads the Workspace's Staff already: one read, not two.
    const { context, everyone } = await resolveStaff();
    return json<StaffListResponse>({ staff: everyone, current: context.staff });
  } catch (error) {
    return failure(error);
  }
}
