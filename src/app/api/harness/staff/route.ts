import type { StaffListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { failure, json } from "@/features/harness/server/respond";
import { listStaff } from "@/features/harness/server/staff";

/** The Workspace's Staff and who the visitor is signed in as. */
export async function GET() {
  try {
    const context = await requireStaff();
    return json<StaffListResponse>({
      staff: await listStaff(context.owner),
      current: context.staff,
    });
  } catch (error) {
    return failure(error);
  }
}
