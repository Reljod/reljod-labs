import type { EmployerListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { listEmployers } from "@/features/harness/server/records";
import { failure, json } from "@/features/harness/server/respond";

/** The plan's Employers, by name. */
export async function GET() {
  try {
    const { owner } = await requireStaff();
    return json<EmployerListResponse>({
      employers: await listEmployers(owner),
    });
  } catch (error) {
    return failure(error);
  }
}
