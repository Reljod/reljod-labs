import type { MemberResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { getMember } from "@/features/harness/server/records";
import { failure, json, notFound } from "@/features/harness/server/respond";

type Context = { params: Promise<{ id: string }> };

/** A Member, by id or member number, with their Employer and Member requests. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { owner } = await requireStaff();
    const { id } = await params;
    const member = await getMember(owner, decodeURIComponent(id));
    if (!member) return notFound("That Member is not in this Workspace.");
    return json<MemberResponse>(member);
  } catch (error) {
    return failure(error);
  }
}
