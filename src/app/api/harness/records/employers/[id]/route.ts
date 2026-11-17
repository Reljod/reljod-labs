import type { EmployerResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { getEmployer } from "@/features/harness/server/records";
import { failure, json, notFound } from "@/features/harness/server/respond";

type Context = { params: Promise<{ id: string }> };

/** An Employer, by id or code, with its Schedules. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { owner } = await requireStaff();
    const { id } = await params;
    const employer = await getEmployer(owner, decodeURIComponent(id));
    if (!employer) return notFound("That Employer is not in this Workspace.");
    return json<EmployerResponse>(employer);
  } catch (error) {
    return failure(error);
  }
}
