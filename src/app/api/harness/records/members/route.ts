import type { MemberListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { findMembers } from "@/features/harness/server/records";
import { failure, json } from "@/features/harness/server/respond";

/** Members whose name or number matches `?q=`, optionally of one `?employer=`. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireStaff();
    const search = new URL(request.url).searchParams;
    return json<MemberListResponse>({
      members: await findMembers(owner, {
        q: search.get("q") ?? "",
        employerId: search.get("employer"),
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
