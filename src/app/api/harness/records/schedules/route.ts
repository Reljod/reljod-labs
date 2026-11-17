import type { ScheduleListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { listSchedules } from "@/features/harness/server/records";
import { failure, json } from "@/features/harness/server/respond";

/** Schedules with their lines, newest month first; `?employer=` for one Employer's. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireStaff();
    const search = new URL(request.url).searchParams;
    return json<ScheduleListResponse>({
      schedules: await listSchedules(owner, {
        employerId: search.get("employer"),
        period: search.get("period"),
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
